import { initAuthCreds, proto } from 'baileys'
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from 'baileys'
import { CacheManager } from './cache/cache-manager.js'
import { RedisTcpCacheAdapter } from './cache/redis-tcp.js'
import { decrypt, encrypt } from './encryption/aes.js'
import { LocalMutexLock } from './lock/mutex-lock.js'
import { RedisDistributedLock } from './lock/redis-lock.js'
import { deserialize, serialize } from './serialization.js'
import { SessionManager } from './session-manager.js'
import type { AuthManagerOptions } from './types.js'
import { noopLogger } from './utils/logger.js'
import { WriteBatcher } from './utils/write-batcher.js'

const CREDS_KEY = 'creds'

interface Lock {
	withLock<T>(key: string, fn: () => Promise<T>): Promise<T>
}

/**
 * The main entry point. Builds a `{ state, saveCreds, sessionManager }` triple
 * that's a drop-in replacement for what Baileys' own `useMultiFileAuthState`
 * returns, except backed by whatever database adapter you hand it instead of the
 * local filesystem, and wrapped in caching, encryption, batching, and locking.
 *
 * Wire it up the same way you would the original:
 * ```ts
 * const { state, saveCreds } = await useHybridAuthState(options)
 * const sock = makeWASocket({ auth: state })
 * sock.ev.on('creds.update', saveCreds)
 * ```
 */
export async function useHybridAuthState(options: AuthManagerOptions): Promise<{
	state: AuthenticationState
	saveCreds: () => Promise<void>
	sessionManager: SessionManager
	/** Stops the retention auto-run timer (if any) and flushes any pending write. Does not close your adapter. */
	close: () => Promise<void>
}> {
	const { sessionId, adapter, encryption, logger = noopLogger } = options

	await adapter.init()

	const cache = new CacheManager(adapter, options.cache, logger)

	// TCP Redis gets a real distributed lock, so two server processes writing the
	// same session can't race. HTTP/REST Redis (and no Redis at all) fall back to
	// an in-process mutex, which is enough to protect a single process but not
	// multiple ones, that trade-off is spelled out in the README.
	const redisAdapter = options.cache?.redis
	const lock: Lock =
		redisAdapter instanceof RedisTcpCacheAdapter
			? new RedisDistributedLock(redisAdapter.getRawClient() as unknown as ConstructorParameters<typeof RedisDistributedLock>[0])
			: new LocalMutexLock()

	const encode = (value: unknown): string => {
		const json = serialize(value)
		return encryption?.enabled ? encrypt(json, encryption.key) : json
	}

	const decode = <T>(raw: string): T => {
		const json = encryption?.enabled ? decrypt(raw, encryption.key) : raw
		return deserialize<T>(json)
	}

	// The batcher is what turns a burst of rapid writes (common during pairing,
	// or when several signal keys update within the same event loop tick) into a
	// single database round trip. Each flush already went through encode(), so
	// there's nothing left to do here except hand the batch to the adapter and
	// update the cache once the write actually landed.
	const batcher = new WriteBatcher(async entries => {
		await lock.withLock(sessionId, async () => {
			await adapter.setMany(sessionId, entries)
			await Promise.all(entries.map(entry => cache.onWritten(sessionId, entry.key, entry.value, Date.now())))
		})
	}, options.writeDebounceMs ?? 50)

	const loadCreds = async (): Promise<AuthenticationCreds> => {
		const raw = await cache.get(sessionId, CREDS_KEY)
		if (raw) {
			return decode<AuthenticationCreds>(raw)
		}

		return initAuthCreds()
	}

	const creds = await loadCreds()

	const sessionManager = new SessionManager({
		sessionId,
		adapter,
		cache,
		logger,
		concurrency: options.concurrency,
		retention: options.retention
	})

	// The auto-run timer for opt-in key retention lives here rather than inside
	// SessionManager, since only the factory knows when the whole auth state is
	// being torn down (see `close` below). It's a single shared, unref'd interval,
	// the same defensive pattern MemoryCache's own sweep uses, so an unattended
	// bot process is never kept alive by this alone.
	let retentionTimer: ReturnType<typeof setInterval> | null = null
	if (options.retention?.enabled && options.retention.autoRunIntervalMs) {
		retentionTimer = setInterval(() => {
			sessionManager.pruneExpiredKeys().catch(error => {
				logger.warn('automatic key retention pass failed', { error: error instanceof Error ? error.message : String(error) })
			})
		}, options.retention.autoRunIntervalMs)
		retentionTimer.unref?.()
	}

	return {
		state: {
			creds,
			keys: {
				get: async (type, ids) => {
					const data: { [id: string]: SignalDataTypeMap[typeof type] } = {}

					await Promise.all(
						ids.map(async id => {
							const cacheKeyName = `${type}-${id}`
							const raw = await cache.get(sessionId, cacheKeyName)
							if (!raw) return

							let value = decode<unknown>(raw)
							if (type === 'app-state-sync-key' && value) {
								value = proto.Message.AppStateSyncKeyData.fromObject(value as Record<string, unknown>)
							}

							data[id] = value as SignalDataTypeMap[typeof type]
						})
					)

					return data
				},
				set: async data => {
					// Baileys already hands us every category/id it wants to change in one
					// call (during pairing this can be hundreds of pre-keys at once). The
					// whole point of batching is to write all of that in a single round
					// trip, so we collect everything here first and hand it to the adapter
					// as one setMany() call, instead of going through the debounced
					// WriteBatcher per key. Awaiting a write per key in this loop used to be
					// the bug: with a lock held per sessionId (not per key), hundreds of
					// sequential lock-acquire/write/release round trips here would starve
					// out anything else waiting on that same lock, like a session key a
					// concurrent sendMessage() needed to write.
					const entries: Array<{ key: string; value: string }> = []
					const deletions: string[] = []

					for (const category in data) {
						const bucket = data[category as keyof SignalDataTypeMap]
						if (!bucket) continue

						for (const id in bucket) {
							const value = bucket[id]
							const cacheKeyName = `${category}-${id}`

							if (value) {
								entries.push({ key: cacheKeyName, value: encode(value) })
							} else {
								deletions.push(cacheKeyName)
							}
						}
					}

					if (entries.length > 0) {
						await lock.withLock(sessionId, async () => {
							await adapter.setMany(sessionId, entries)
							await Promise.all(entries.map(entry => cache.onWritten(sessionId, entry.key, entry.value, Date.now())))
						})
					}

					if (deletions.length > 0) {
						await lock.withLock(sessionId, async () => {
							await adapter.deleteMany(sessionId, deletions)
							await Promise.all(deletions.map(key => cache.onDeleted(sessionId, key)))
						})
					}
				}
			}
		},
		saveCreds: async () => {
			await batcher.write(CREDS_KEY, encode(creds))
			await batcher.flushNow()
		},
		sessionManager,
		close: async () => {
			if (retentionTimer) {
				clearInterval(retentionTimer)
				retentionTimer = null
			}

			await batcher.destroy()
			await cache.close()
		}
	}
}

import type { CacheOptions, IDatabaseAdapter, Logger } from '../types.js'
import { MemoryCache } from './memory-cache.js'

const cacheKey = (sessionId: string, key: string) => `${sessionId}:${key}`

/**
 * Orchestrates the three storage levels Baileys' auth state actually needs:
 *
 *   L1: in-memory, per-process, effectively free reads
 *   L2: Redis, shared across every instance of your app, one network hop away
 *   L3: the real database, the source of truth, everything eventually lands here
 *
 * Reads walk down the levels until they hit data, then backfill the levels above
 * so the next read is faster. Writes go straight to L3 first (it must succeed or
 * the caller needs to know), then update L2 and L1 on the way back up. If the
 * cache layers fail on a write, that's logged and swallowed, the database write
 * already succeeded, a stale cache entry is just a missed optimization, not data
 * loss, it'll sort itself out on the next miss or the next invalidation.
 */
export class CacheManager {
	private readonly l1: MemoryCache
	private readonly l2?: CacheOptions['redis']
	private readonly adapter: IDatabaseAdapter
	private readonly logger: Logger
	private readonly invalidationReady: Promise<void> | null

	constructor(adapter: IDatabaseAdapter, options: CacheOptions | undefined, logger: Logger) {
		this.adapter = adapter
		this.logger = logger
		this.l1 = new MemoryCache({
			ttlMs: options?.memoryTtlMs,
			maxEntries: options?.memoryMaxEntries,
			maxBytes: options?.memoryMaxBytes
		})
		this.l2 = options?.redis
		this.invalidationReady = null

		if (this.l2?.mode === 'tcp' && this.l2.subscribeInvalidation) {
			this.invalidationReady = this.l2
				.subscribeInvalidation(invalidatedKey => this.l1.delete(invalidatedKey))
				.catch(error => {
					this.logger.warn('failed to subscribe to redis cache invalidation, L1 may serve stale reads across instances', {
						error: error instanceof Error ? error.message : String(error)
					})
				})
		}
	}

	async get(sessionId: string, key: string): Promise<string | null> {
		const compositeKey = cacheKey(sessionId, key)

		const l1Hit = this.l1.get(compositeKey)
		if (l1Hit) {
			if (this.l2?.mode === 'http') {
				// HTTP mode has no pub/sub, so we can't be told about writes from other
				// instances. Instead we do a cheap version check against L2 and only
				// trust L1 if the versions still agree.
				const l2Check = await this.safeL2Get(compositeKey)
				if (l2Check && l2Check.version !== l1Hit.version) {
					this.l1.delete(compositeKey)
				} else {
					return l1Hit.value
				}
			} else {
				return l1Hit.value
			}
		}

		if (this.l2) {
			const l2Hit = await this.safeL2Get(compositeKey)
			if (l2Hit) {
				this.l1.set(compositeKey, l2Hit.value, l2Hit.version)
				return l2Hit.value
			}
		}

		const record = await this.adapter.get(sessionId, key)
		if (!record) {
			return null
		}

		this.l1.set(compositeKey, record.value, record.version)
		await this.safeL2Set(compositeKey, record.value, record.version)

		return record.value
	}

	/** Batched read, used by keys.get() when Baileys asks for many ids at once. */
	async getMany(sessionId: string, keys: string[]): Promise<Map<string, string>> {
		const result = new Map<string, string>()
		const misses: string[] = []

		for (const key of keys) {
			const compositeKey = cacheKey(sessionId, key)
			const l1Hit = this.l1.get(compositeKey)
			if (l1Hit && this.l2?.mode !== 'http') {
				result.set(key, l1Hit.value)
			} else {
				misses.push(key)
			}
		}

		if (misses.length === 0) {
			return result
		}

		const records = await this.adapter.getMany(sessionId, misses)
		for (const [key, record] of records) {
			const compositeKey = cacheKey(sessionId, key)
			this.l1.set(compositeKey, record.value, record.version)
			await this.safeL2Set(compositeKey, record.value, record.version)
			result.set(key, record.value)
		}

		return result
	}

	/** Called by the write path after a batched database write already succeeded. */
	async onWritten(sessionId: string, key: string, value: string, version: number): Promise<void> {
		const compositeKey = cacheKey(sessionId, key)
		this.l1.set(compositeKey, value, version)
		await this.safeL2Set(compositeKey, value, version)

		if (this.l2?.mode === 'tcp' && this.l2.publishInvalidation) {
			await this.invalidationReady
			await this.l2.publishInvalidation(compositeKey).catch(error => {
				this.logger.warn('failed to publish cache invalidation', { error: error instanceof Error ? error.message : String(error) })
			})
		}
	}

	async onDeleted(sessionId: string, key: string): Promise<void> {
		const compositeKey = cacheKey(sessionId, key)
		this.l1.delete(compositeKey)
		await this.l2?.del(compositeKey).catch(() => {})

		if (this.l2?.mode === 'tcp' && this.l2.publishInvalidation) {
			await this.l2.publishInvalidation(compositeKey).catch(() => {})
		}
	}

	clearSession(sessionId: string): void {
		this.l1.deleteByPrefix(`${sessionId}:`)
	}

	clearAll(): void {
		this.l1.clear()
	}

	async close(): Promise<void> {
		this.l1.destroy()
		await this.l2?.close().catch(() => {})
	}

	private async safeL2Get(compositeKey: string): Promise<{ value: string; version: number } | null> {
		if (!this.l2) {
			return null
		}

		try {
			return await this.l2.get(compositeKey)
		} catch (error) {
			this.logger.warn('redis cache read failed, falling back to database', {
				error: error instanceof Error ? error.message : String(error)
			})
			return null
		}
	}

	private async safeL2Set(compositeKey: string, value: string, version: number): Promise<void> {
		if (!this.l2) {
			return
		}

		try {
			await this.l2.set(compositeKey, value, version)
		} catch (error) {
			this.logger.warn('redis cache write failed, database write already succeeded so this is non-fatal', {
				error: error instanceof Error ? error.message : String(error)
			})
		}
	}
}

import pLimit from 'p-limit'
import type { CacheManager } from './cache/cache-manager.js'
import { pruneExpiredKeys } from './retention.js'
import type { IDatabaseAdapter, KeyRetentionOptions, Logger } from './types.js'

export interface SessionInfo {
	sessionId: string
	keys: string[]
	updatedAt: number
}

const DISABLED_RETENTION: KeyRetentionOptions = { enabled: false, maxAgeMsByCategory: {} }

interface SessionManagerDeps {
	sessionId: string
	adapter: IDatabaseAdapter
	cache: CacheManager
	logger: Logger
	concurrency?: number
	/** Defaults to fully disabled if the caller never configured retention. */
	retention?: KeyRetentionOptions
}

/**
 * Note on encryption: export/import move the stored representation as-is. If
 * encryption is enabled, that means the exported values are still ciphertext,
 * which is exactly what you want for a backup, it can sit in a file or another
 * database without exposing raw WhatsApp credentials, and only becomes readable
 * again through useHybridAuthState with the matching encryption key.
 */

/**
 * The session management API: everything you need beyond the plain auth state
 * itself, listing what sessions exist, inspecting one, deleting it, or moving it
 * somewhere else entirely. `useHybridAuthState` builds one of these off the exact
 * same adapter and cache instances it already created, so this always reflects
 * the live state, not a stale snapshot.
 */
export class SessionManager {
	private readonly sessionId: string
	private readonly adapter: IDatabaseAdapter
	private readonly cache: CacheManager
	private readonly logger: Logger
	private readonly limit: ReturnType<typeof pLimit>
	private readonly retention: KeyRetentionOptions

	constructor(deps: SessionManagerDeps) {
		this.sessionId = deps.sessionId
		this.adapter = deps.adapter
		this.cache = deps.cache
		this.logger = deps.logger
		this.limit = pLimit(deps.concurrency ?? 10)
		this.retention = deps.retention ?? DISABLED_RETENTION
	}

	async listSessions(): Promise<string[]> {
		return this.adapter.listSessions()
	}

	async getSessionInfo(sessionId: string = this.sessionId): Promise<SessionInfo | null> {
		const exists = await this.adapter.sessionExists(sessionId)
		if (!exists) return null

		const keys = await this.adapter.getAllKeys(sessionId)

		// We don't have a single "last updated" column to read cheaply across every
		// backend, so we take the most recent of whatever creds/keys we can see.
		// This is a light read, not a full table scan, capped by the concurrency
		// limiter so a session with hundreds of keys doesn't open hundreds of
		// simultaneous connections against the database.
		let updatedAt = 0
		await Promise.all(
			keys.map(key =>
				this.limit(async () => {
					const record = await this.adapter.get(sessionId, key)
					if (record && record.updatedAt > updatedAt) {
						updatedAt = record.updatedAt
					}
				})
			)
		)

		return { sessionId, keys, updatedAt }
	}

	async sessionExists(sessionId: string = this.sessionId): Promise<boolean> {
		return this.adapter.sessionExists(sessionId)
	}

	async deleteSession(sessionId: string = this.sessionId): Promise<void> {
		await this.adapter.deleteSession(sessionId)
		this.cache.clearSession(sessionId)
		this.logger.info('deleted session', { sessionId })
	}

	/**
	 * Streams every key/value pair for a session, low memory even for sessions with
	 * thousands of pre-keys, since nothing builds up a giant object in RAM. Values
	 * come back already decrypted and JSON-decoded to a plain string, ready to be
	 * written straight into another store with importSession.
	 */
	async *exportSession(sessionId: string = this.sessionId): AsyncIterable<[key: string, value: string]> {
		const keys = await this.adapter.getAllKeys(sessionId)

		for (const key of keys) {
			const record = await this.limit(() => this.adapter.get(sessionId, key))
			if (record) {
				yield [key, record.value]
			}
		}
	}

	/** Convenience wrapper for small sessions where a plain object is easier to work with than a stream. */
	async exportSessionToObject(sessionId: string = this.sessionId): Promise<Record<string, string>> {
		const result: Record<string, string> = {}
		for await (const [key, value] of this.exportSession(sessionId)) {
			result[key] = value
		}

		return result
	}

	/** Writes a previously exported session (or a hand-built one) into the given session id. */
	async importSession(sessionId: string, data: Record<string, string>): Promise<void> {
		const entries = Object.entries(data).map(([key, value]) => ({ key, value }))
		await this.adapter.setMany(sessionId, entries)
		this.cache.clearSession(sessionId)
		this.logger.info('imported session', { sessionId, keyCount: entries.length })
	}

	/** Manually busts the cache, useful after writing to the database through some other path. */
	async clearCache(sessionId?: string): Promise<void> {
		if (sessionId) {
			this.cache.clearSession(sessionId)
		} else {
			this.cache.clearAll()
		}
	}

	/**
	 * Runs one pass of the opt-in, time-based key cleanup described in
	 * docs/key-retention-and-cleanup.md. A no-op that returns an empty list
	 * unless retention was explicitly enabled when this session was set up,
	 * calling this manually doesn't bypass that, there is no way to prune
	 * anything without first opting in through useHybridAuthState's `retention`
	 * option.
	 */
	async pruneExpiredKeys(sessionId: string = this.sessionId): Promise<{ prunedKeys: string[] }> {
		return pruneExpiredKeys({
			sessionId,
			adapter: this.adapter,
			cache: this.cache,
			logger: this.logger,
			options: this.retention
		})
	}
}

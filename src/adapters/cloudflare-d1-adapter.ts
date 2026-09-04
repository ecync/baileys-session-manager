import type { IDatabaseAdapter, Logger, RetryOptions, SessionRecord } from '../types.js'
import { BaseAdapter, SESSIONS_TABLE } from './base-adapter.js'

/**
 * D1 has no standalone Node.js client, it only exists as a binding injected into
 * a Cloudflare Worker's `env` (e.g. `env.DB`). This type describes just the shape
 * of that binding we actually use, so the adapter compiles without pulling in
 * `@cloudflare/workers-types` as a hard dependency.
 */
export interface D1Database {
	prepare(query: string): D1PreparedStatement
	batch(statements: D1PreparedStatement[]): Promise<unknown[]>
	exec(query: string): Promise<unknown>
}

export interface D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement
	first<T = unknown>(): Promise<T | null>
	all<T = unknown>(): Promise<{ results: T[] }>
	run(): Promise<unknown>
}

interface D1Row {
	session_id: string
	key: string
	value: string
	updated_at: number
	version: number
}

const toRecord = (row: D1Row): SessionRecord => ({
	sessionId: row.session_id,
	key: row.key,
	value: row.value,
	updatedAt: row.updated_at,
	version: row.version
})

/**
 * Cloudflare D1 adapter. Takes the D1Database binding straight from your Worker's
 * env (`new CloudflareD1Adapter(env.DB)`), since that binding is how D1 is always
 * accessed, there's nothing to lazily import here the way there is for the other
 * SQL adapters.
 */
export class CloudflareD1Adapter extends BaseAdapter implements IDatabaseAdapter {
	readonly name = 'cloudflare-d1'

	private readonly db: D1Database

	constructor(db: D1Database, logger?: Logger, retryOptions?: RetryOptions) {
		super(logger, retryOptions)
		this.db = db
	}

	async init(): Promise<void> {
		await this.withRetry(
			() =>
				this.db.exec(`
					CREATE TABLE IF NOT EXISTS ${SESSIONS_TABLE} (
						session_id TEXT NOT NULL,
						key TEXT NOT NULL,
						value TEXT NOT NULL,
						updated_at INTEGER NOT NULL,
						version INTEGER NOT NULL DEFAULT 1,
						PRIMARY KEY (session_id, key)
					)
				`),
			'init'
		)
	}

	async get(sessionId: string, key: string): Promise<SessionRecord | null> {
		const row = await this.withRetry(
			() => this.db.prepare(`SELECT * FROM ${SESSIONS_TABLE} WHERE session_id = ? AND key = ?`).bind(sessionId, key).first<D1Row>(),
			'get'
		)
		return row ? toRecord(row) : null
	}

	async getMany(sessionId: string, keys: string[]): Promise<Map<string, SessionRecord>> {
		const map = new Map<string, SessionRecord>()
		if (keys.length === 0) return map

		const placeholders = keys.map(() => '?').join(',')
		const { results } = await this.withRetry(
			() => this.db.prepare(`SELECT * FROM ${SESSIONS_TABLE} WHERE session_id = ? AND key IN (${placeholders})`).bind(sessionId, ...keys).all<D1Row>(),
			'getMany'
		)

		for (const row of results) {
			map.set(row.key, toRecord(row))
		}

		return map
	}

	async set(sessionId: string, key: string, value: string): Promise<void> {
		await this.setMany(sessionId, [{ key, value }])
	}

	async setMany(sessionId: string, entries: Array<{ key: string; value: string }>): Promise<void> {
		if (entries.length === 0) return
		const now = Date.now()

		// D1's batch() runs every statement in one implicit transaction, which is
		// the closest equivalent it has to the multi-row upserts the other SQL
		// adapters use.
		const statements = entries.map(entry =>
			this.db
				.prepare(
					`INSERT INTO ${SESSIONS_TABLE} (session_id, key, value, updated_at, version)
					 VALUES (?, ?, ?, ?, 1)
					 ON CONFLICT (session_id, key) DO UPDATE SET
					   value = excluded.value,
					   updated_at = excluded.updated_at,
					   version = ${SESSIONS_TABLE}.version + 1`
				)
				.bind(sessionId, entry.key, entry.value, now)
		)

		await this.withRetry(() => this.db.batch(statements), 'setMany')
	}

	async delete(sessionId: string, key: string): Promise<void> {
		await this.deleteMany(sessionId, [key])
	}

	async deleteMany(sessionId: string, keys: string[]): Promise<void> {
		if (keys.length === 0) return
		const placeholders = keys.map(() => '?').join(',')
		await this.withRetry(() => this.db.prepare(`DELETE FROM ${SESSIONS_TABLE} WHERE session_id = ? AND key IN (${placeholders})`).bind(sessionId, ...keys).run(), 'deleteMany')
	}

	async getAllKeys(sessionId: string): Promise<string[]> {
		const { results } = await this.withRetry(
			() => this.db.prepare(`SELECT key FROM ${SESSIONS_TABLE} WHERE session_id = ?`).bind(sessionId).all<{ key: string }>(),
			'getAllKeys'
		)
		return results.map(r => r.key)
	}

	async deleteSession(sessionId: string): Promise<void> {
		await this.withRetry(() => this.db.prepare(`DELETE FROM ${SESSIONS_TABLE} WHERE session_id = ?`).bind(sessionId).run(), 'deleteSession')
	}

	async listSessions(): Promise<string[]> {
		const { results } = await this.withRetry(
			() => this.db.prepare(`SELECT DISTINCT session_id FROM ${SESSIONS_TABLE}`).all<{ session_id: string }>(),
			'listSessions'
		)
		return results.map(r => r.session_id)
	}

	async sessionExists(sessionId: string): Promise<boolean> {
		const row = await this.withRetry(
			() => this.db.prepare(`SELECT 1 as found FROM ${SESSIONS_TABLE} WHERE session_id = ? LIMIT 1`).bind(sessionId).first(),
			'sessionExists'
		)
		return !!row
	}

	async close(): Promise<void> {
		// D1 bindings are managed by the Workers runtime itself, there is no
		// connection on our side to close.
	}
}

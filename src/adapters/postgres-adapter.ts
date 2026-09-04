import type { IDatabaseAdapter, Logger, RetryOptions, SessionRecord } from '../types.js'
import { BaseAdapter, SESSIONS_TABLE } from './base-adapter.js'

// Typed against the small slice of the `pg` API we actually call, so this file
// compiles fine even when `pg` isn't installed (it's an optional peer dependency).
interface PgPoolLike {
	query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>
	end(): Promise<void>
}

interface PgRow {
	session_id: string
	key: string
	value: string
	updated_at: string | number
	version: number
}

const toRecord = (row: PgRow): SessionRecord => ({
	sessionId: row.session_id,
	key: row.key,
	value: row.value,
	updatedAt: Number(row.updated_at),
	version: row.version
})

/**
 * PostgreSQL adapter. Uses a plain `pg.Pool`, so it works the same whether you're
 * pointed at a local Postgres, RDS, Supabase, Neon, or anything else that speaks
 * the Postgres wire protocol.
 */
export class PostgresAdapter extends BaseAdapter implements IDatabaseAdapter {
	readonly name = 'postgres'

	private pool: PgPoolLike | null = null
	private readonly connectionString: string | undefined
	private readonly poolOptions: Record<string, unknown> | undefined

	constructor(options: { connectionString?: string; pool?: Record<string, unknown> } = {}, logger?: Logger, retryOptions?: RetryOptions) {
		super(logger, retryOptions)
		this.connectionString = options.connectionString
		this.poolOptions = options.pool
	}

	async init(): Promise<void> {
		const { Pool } = await import('pg')
		this.pool = new Pool({ connectionString: this.connectionString, ...this.poolOptions }) as unknown as PgPoolLike

		await this.withRetry(
			() =>
				this.pool!.query(`
					CREATE TABLE IF NOT EXISTS ${SESSIONS_TABLE} (
						session_id TEXT NOT NULL,
						key TEXT NOT NULL,
						value TEXT NOT NULL,
						updated_at BIGINT NOT NULL,
						version INTEGER NOT NULL DEFAULT 1,
						PRIMARY KEY (session_id, key)
					)
				`),
			'init'
		)
	}

	private get client(): PgPoolLike {
		if (!this.pool) {
			throw new Error('PostgresAdapter.init() must be called before it is used.')
		}

		return this.pool
	}

	async get(sessionId: string, key: string): Promise<SessionRecord | null> {
		const { rows } = await this.withRetry(
			() => this.client.query(`SELECT * FROM ${SESSIONS_TABLE} WHERE session_id = $1 AND key = $2`, [sessionId, key]),
			'get'
		)
		return rows[0] ? toRecord(rows[0] as PgRow) : null
	}

	async getMany(sessionId: string, keys: string[]): Promise<Map<string, SessionRecord>> {
		const map = new Map<string, SessionRecord>()
		if (keys.length === 0) return map

		const { rows } = await this.withRetry(
			() => this.client.query(`SELECT * FROM ${SESSIONS_TABLE} WHERE session_id = $1 AND key = ANY($2)`, [sessionId, keys]),
			'getMany'
		)

		for (const row of rows as PgRow[]) {
			map.set(row.key, toRecord(row))
		}

		return map
	}

	async set(sessionId: string, key: string, value: string): Promise<void> {
		await this.setMany(sessionId, [{ key, value }])
	}

	async setMany(sessionId: string, entries: Array<{ key: string; value: string }>): Promise<void> {
		if (entries.length === 0) return

		// One INSERT with multiple VALUES tuples instead of N separate statements,
		// this is what turns a burst of key updates into a single round trip.
		const now = Date.now()
		const values: string[] = []
		const params: unknown[] = []

		entries.forEach((entry, i) => {
			const base = i * 4
			values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`)
			params.push(sessionId, entry.key, entry.value, now)
		})

		await this.withRetry(
			() =>
				this.client.query(
					`INSERT INTO ${SESSIONS_TABLE} (session_id, key, value, updated_at)
					 VALUES ${values.join(', ')}
					 ON CONFLICT (session_id, key) DO UPDATE SET
					   value = EXCLUDED.value,
					   updated_at = EXCLUDED.updated_at,
					   version = ${SESSIONS_TABLE}.version + 1`,
					params
				),
			'setMany'
		)
	}

	async delete(sessionId: string, key: string): Promise<void> {
		await this.deleteMany(sessionId, [key])
	}

	async deleteMany(sessionId: string, keys: string[]): Promise<void> {
		if (keys.length === 0) return
		await this.withRetry(() => this.client.query(`DELETE FROM ${SESSIONS_TABLE} WHERE session_id = $1 AND key = ANY($2)`, [sessionId, keys]), 'deleteMany')
	}

	async getAllKeys(sessionId: string): Promise<string[]> {
		const { rows } = await this.withRetry(() => this.client.query(`SELECT key FROM ${SESSIONS_TABLE} WHERE session_id = $1`, [sessionId]), 'getAllKeys')
		return (rows as Array<{ key: string }>).map(r => r.key)
	}

	async deleteSession(sessionId: string): Promise<void> {
		await this.withRetry(() => this.client.query(`DELETE FROM ${SESSIONS_TABLE} WHERE session_id = $1`, [sessionId]), 'deleteSession')
	}

	async listSessions(): Promise<string[]> {
		const { rows } = await this.withRetry(() => this.client.query(`SELECT DISTINCT session_id FROM ${SESSIONS_TABLE}`), 'listSessions')
		return (rows as Array<{ session_id: string }>).map(r => r.session_id)
	}

	async sessionExists(sessionId: string): Promise<boolean> {
		const { rows } = await this.withRetry(
			() => this.client.query(`SELECT 1 FROM ${SESSIONS_TABLE} WHERE session_id = $1 LIMIT 1`, [sessionId]),
			'sessionExists'
		)
		return rows.length > 0
	}

	async close(): Promise<void> {
		await this.pool?.end()
		this.pool = null
	}
}

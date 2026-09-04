import type { IDatabaseAdapter, Logger, RetryOptions, SessionRecord } from '../types.js'
import { BaseAdapter, SESSIONS_TABLE } from './base-adapter.js'

interface MysqlPoolLike {
	query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>
	end(): Promise<void>
}

interface MysqlRow {
	session_id: string
	key: string
	value: string
	updated_at: number
	version: number
}

const toRecord = (row: MysqlRow): SessionRecord => ({
	sessionId: row.session_id,
	key: row.key,
	value: row.value,
	updatedAt: Number(row.updated_at),
	version: row.version
})

/** MySQL / MariaDB adapter, built on mysql2's promise API and a connection pool. */
export class MysqlAdapter extends BaseAdapter implements IDatabaseAdapter {
	readonly name = 'mysql'

	private pool: MysqlPoolLike | null = null
	private readonly poolOptions: Record<string, unknown>

	constructor(poolOptions: Record<string, unknown>, logger?: Logger, retryOptions?: RetryOptions) {
		super(logger, retryOptions)
		this.poolOptions = poolOptions
	}

	async init(): Promise<void> {
		const mysql = await import('mysql2/promise')
		this.pool = mysql.createPool(this.poolOptions) as unknown as MysqlPoolLike

		await this.withRetry(
			() =>
				this.pool!.query(`
					CREATE TABLE IF NOT EXISTS ${SESSIONS_TABLE} (
						session_id VARCHAR(255) NOT NULL,
						\`key\` VARCHAR(255) NOT NULL,
						value LONGTEXT NOT NULL,
						updated_at BIGINT NOT NULL,
						version INT NOT NULL DEFAULT 1,
						PRIMARY KEY (session_id, \`key\`)
					)
				`),
			'init'
		)
	}

	private get client(): MysqlPoolLike {
		if (!this.pool) {
			throw new Error('MysqlAdapter.init() must be called before it is used.')
		}

		return this.pool
	}

	async get(sessionId: string, key: string): Promise<SessionRecord | null> {
		const [rows] = await this.withRetry(
			() => this.client.query(`SELECT * FROM ${SESSIONS_TABLE} WHERE session_id = ? AND \`key\` = ?`, [sessionId, key]),
			'get'
		)
		const row = (rows as MysqlRow[])[0]
		return row ? toRecord(row) : null
	}

	async getMany(sessionId: string, keys: string[]): Promise<Map<string, SessionRecord>> {
		const map = new Map<string, SessionRecord>()
		if (keys.length === 0) return map

		const placeholders = keys.map(() => '?').join(',')
		const [rows] = await this.withRetry(
			() => this.client.query(`SELECT * FROM ${SESSIONS_TABLE} WHERE session_id = ? AND \`key\` IN (${placeholders})`, [sessionId, ...keys]),
			'getMany'
		)

		for (const row of rows as MysqlRow[]) {
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
		const values = entries.map(() => '(?, ?, ?, ?)').join(', ')
		const params: unknown[] = []
		for (const entry of entries) {
			params.push(sessionId, entry.key, entry.value, now)
		}

		await this.withRetry(
			() =>
				this.client.query(
					`INSERT INTO ${SESSIONS_TABLE} (session_id, \`key\`, value, updated_at)
					 VALUES ${values}
					 ON DUPLICATE KEY UPDATE
					   value = VALUES(value),
					   updated_at = VALUES(updated_at),
					   version = version + 1`,
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
		const placeholders = keys.map(() => '?').join(',')
		await this.withRetry(
			() => this.client.query(`DELETE FROM ${SESSIONS_TABLE} WHERE session_id = ? AND \`key\` IN (${placeholders})`, [sessionId, ...keys]),
			'deleteMany'
		)
	}

	async getAllKeys(sessionId: string): Promise<string[]> {
		const [rows] = await this.withRetry(() => this.client.query(`SELECT \`key\` FROM ${SESSIONS_TABLE} WHERE session_id = ?`, [sessionId]), 'getAllKeys')
		return (rows as Array<{ key: string }>).map(r => r.key)
	}

	async deleteSession(sessionId: string): Promise<void> {
		await this.withRetry(() => this.client.query(`DELETE FROM ${SESSIONS_TABLE} WHERE session_id = ?`, [sessionId]), 'deleteSession')
	}

	async listSessions(): Promise<string[]> {
		const [rows] = await this.withRetry(() => this.client.query(`SELECT DISTINCT session_id FROM ${SESSIONS_TABLE}`), 'listSessions')
		return (rows as Array<{ session_id: string }>).map(r => r.session_id)
	}

	async sessionExists(sessionId: string): Promise<boolean> {
		const [rows] = await this.withRetry(
			() => this.client.query(`SELECT 1 FROM ${SESSIONS_TABLE} WHERE session_id = ? LIMIT 1`, [sessionId]),
			'sessionExists'
		)
		return (rows as unknown[]).length > 0
	}

	async close(): Promise<void> {
		await this.pool?.end()
		this.pool = null
	}
}

import { parentPort, workerData } from 'worker_threads'
import { SESSIONS_TABLE } from './base-adapter.js'

/**
 * This file runs inside a worker_threads worker, not on the main thread. It exists
 * because better-sqlite3 is deliberately synchronous, which is normally a nice
 * property (no callback soup) but means a slow query would otherwise block Node's
 * single event loop thread, stalling everything else the process is doing (like
 * handling other WhatsApp connections). Moving the actual synchronous calls in
 * here keeps the main thread free; the adapter on the other end just awaits a
 * message instead of a promise from the driver directly.
 */

interface Request {
	id: number
	op: 'init' | 'get' | 'getMany' | 'set' | 'setMany' | 'delete' | 'deleteMany' | 'getAllKeys' | 'deleteSession' | 'listSessions' | 'sessionExists' | 'close'
	args: unknown[]
}

async function main() {
	const Database = (await import('better-sqlite3')).default
	const db = new Database(workerData.filename as string)
	db.pragma('journal_mode = WAL')

	function init() {
		db.exec(`
			CREATE TABLE IF NOT EXISTS ${SESSIONS_TABLE} (
				session_id TEXT NOT NULL,
				key TEXT NOT NULL,
				value TEXT NOT NULL,
				updated_at INTEGER NOT NULL,
				version INTEGER NOT NULL DEFAULT 1,
				PRIMARY KEY (session_id, key)
			)
		`)
	}

	function get(sessionId: string, key: string) {
		const row = db.prepare(`SELECT * FROM ${SESSIONS_TABLE} WHERE session_id = ? AND key = ?`).get(sessionId, key)
		return row ?? null
	}

	function getMany(sessionId: string, keys: string[]) {
		if (keys.length === 0) return []
		const placeholders = keys.map(() => '?').join(',')
		return db.prepare(`SELECT * FROM ${SESSIONS_TABLE} WHERE session_id = ? AND key IN (${placeholders})`).all(sessionId, ...keys)
	}

	function setMany(sessionId: string, entries: Array<{ key: string; value: string }>) {
		const now = Date.now()
		const upsert = db.prepare(`
			INSERT INTO ${SESSIONS_TABLE} (session_id, key, value, updated_at, version)
			VALUES (@sessionId, @key, @value, @updatedAt, 1)
			ON CONFLICT (session_id, key) DO UPDATE SET
				value = excluded.value,
				updated_at = excluded.updated_at,
				version = ${SESSIONS_TABLE}.version + 1
		`)
		const tx = db.transaction((rows: Array<{ key: string; value: string }>) => {
			for (const row of rows) {
				upsert.run({ sessionId, key: row.key, value: row.value, updatedAt: now })
			}
		})
		tx(entries)
	}

	function deleteMany(sessionId: string, keys: string[]) {
		if (keys.length === 0) return
		const placeholders = keys.map(() => '?').join(',')
		db.prepare(`DELETE FROM ${SESSIONS_TABLE} WHERE session_id = ? AND key IN (${placeholders})`).run(sessionId, ...keys)
	}

	function getAllKeys(sessionId: string) {
		const rows = db.prepare(`SELECT key FROM ${SESSIONS_TABLE} WHERE session_id = ?`).all(sessionId) as Array<{ key: string }>
		return rows.map(r => r.key)
	}

	function deleteSession(sessionId: string) {
		db.prepare(`DELETE FROM ${SESSIONS_TABLE} WHERE session_id = ?`).run(sessionId)
	}

	function listSessions() {
		const rows = db.prepare(`SELECT DISTINCT session_id FROM ${SESSIONS_TABLE}`).all() as Array<{ session_id: string }>
		return rows.map(r => r.session_id)
	}

	function sessionExists(sessionId: string) {
		const row = db.prepare(`SELECT 1 FROM ${SESSIONS_TABLE} WHERE session_id = ? LIMIT 1`).get(sessionId)
		return !!row
	}

	parentPort!.on('message', (req: Request) => {
		try {
			let result: unknown
			switch (req.op) {
				case 'init':
					init()
					result = null
					break
				case 'get':
					result = get(req.args[0] as string, req.args[1] as string)
					break
				case 'getMany':
					result = getMany(req.args[0] as string, req.args[1] as string[])
					break
				case 'setMany':
					setMany(req.args[0] as string, req.args[1] as Array<{ key: string; value: string }>)
					result = null
					break
				case 'deleteMany':
					deleteMany(req.args[0] as string, req.args[1] as string[])
					result = null
					break
				case 'getAllKeys':
					result = getAllKeys(req.args[0] as string)
					break
				case 'deleteSession':
					deleteSession(req.args[0] as string)
					result = null
					break
				case 'listSessions':
					result = listSessions()
					break
				case 'sessionExists':
					result = sessionExists(req.args[0] as string)
					break
				case 'close':
					db.close()
					result = null
					break
				default:
					throw new Error(`Unknown sqlite worker op: ${req.op}`)
			}

			parentPort!.postMessage({ id: req.id, ok: true, result })
		} catch (error) {
			parentPort!.postMessage({ id: req.id, ok: false, error: error instanceof Error ? error.message : String(error) })
		}
	})

	parentPort!.postMessage({ id: 0, ok: true, result: 'ready' })
}

main().catch(error => {
	parentPort?.postMessage({ id: 0, ok: false, error: error instanceof Error ? error.message : String(error) })
})

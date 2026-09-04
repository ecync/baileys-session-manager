import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { Worker } from 'worker_threads'
import type { IDatabaseAdapter, Logger, RetryOptions, SessionRecord } from '../types.js'
import { BaseAdapter } from './base-adapter.js'

interface WorkerRow {
	session_id: string
	key: string
	value: string
	updated_at: number
	version: number
}

const toRecord = (row: WorkerRow): SessionRecord => ({
	sessionId: row.session_id,
	key: row.key,
	value: row.value,
	updatedAt: row.updated_at,
	version: row.version
})

/** Finds the built sqlite-worker file next to this one, whichever extension the current build format used. */
function resolveWorkerPath(): string {
	// import.meta.url is available in both real ESM output and in the CJS build,
	// since tsup shims it there too, so this works no matter how the package was built.
	const here = dirname(fileURLToPath(import.meta.url))
	const candidates = ['sqlite-worker.js', 'sqlite-worker.cjs', 'sqlite-worker.mjs']

	for (const candidate of candidates) {
		const full = join(here, candidate)
		if (existsSync(full)) {
			return full
		}
	}

	throw new Error(`Could not locate the sqlite-worker build output next to ${here}. This is a packaging bug, please report it.`)
}

interface WorkerResponse {
	id: number
	ok: boolean
	result?: unknown
	error?: string
}

/**
 * The SQLite adapter, backed by better-sqlite3 running inside a dedicated
 * worker_threads worker instead of on the main thread. better-sqlite3 is
 * synchronous by design (that's why it's fast), but a synchronous call blocks
 * whichever thread runs it. Running it in a worker means a slow query never
 * stalls the rest of your app, socket handling, HTTP requests, everything else
 * Node is juggling on the main thread keeps moving.
 */
export class SqliteAdapter extends BaseAdapter implements IDatabaseAdapter {
	readonly name = 'sqlite'

	private readonly filename: string
	private readonly workerPath: string
	private worker: Worker | null = null
	private nextRequestId = 1
	private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
	private ready: Promise<void> | null = null

	/**
	 * `workerPath` is an escape hatch, not something most consumers need. It exists
	 * so this package's own test suite can point at a freshly built worker file
	 * explicitly (running tests straight against TypeScript source means the
	 * usual "next to this file" auto-detection has nothing compiled to find yet),
	 * and it's there for anyone else who ends up in an unusual bundling setup too.
	 */
	constructor(filename: string, logger?: Logger, retryOptions?: RetryOptions, workerPath?: string) {
		super(logger, retryOptions)
		this.filename = filename
		this.workerPath = workerPath ?? resolveWorkerPath()
	}

	private ensureWorker(): Promise<void> {
		if (this.ready) {
			return this.ready
		}

		this.ready = new Promise((resolve, reject) => {
			const worker = new Worker(this.workerPath, { workerData: { filename: this.filename } })
			this.worker = worker

			worker.once('message', (msg: WorkerResponse) => {
				if (msg.id === 0 && msg.ok) {
					resolve()
				} else {
					reject(new Error(msg.error ?? 'sqlite worker failed to start'))
				}
			})

			worker.on('message', (msg: WorkerResponse) => {
				if (msg.id === 0) return
				const waiter = this.pending.get(msg.id)
				if (!waiter) return
				this.pending.delete(msg.id)

				if (msg.ok) {
					waiter.resolve(msg.result)
				} else {
					waiter.reject(new Error(msg.error ?? 'sqlite worker call failed'))
				}
			})

			worker.on('error', error => {
				for (const waiter of this.pending.values()) {
					waiter.reject(error)
				}
				this.pending.clear()
			})
		})

		return this.ready
	}

	private async call<T>(op: string, ...args: unknown[]): Promise<T> {
		await this.ensureWorker()
		const id = this.nextRequestId++

		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve: v => resolve(v as T), reject })
			this.worker!.postMessage({ id, op, args })
		})
	}

	async init(): Promise<void> {
		await this.withRetry(() => this.call('init'), 'init')
	}

	async get(sessionId: string, key: string): Promise<SessionRecord | null> {
		const row = await this.withRetry(() => this.call<WorkerRow | null>('get', sessionId, key), 'get')
		return row ? toRecord(row) : null
	}

	async getMany(sessionId: string, keys: string[]): Promise<Map<string, SessionRecord>> {
		const rows = await this.withRetry(() => this.call<WorkerRow[]>('getMany', sessionId, keys), 'getMany')
		const map = new Map<string, SessionRecord>()
		for (const row of rows) {
			map.set(row.key, toRecord(row))
		}

		return map
	}

	async set(sessionId: string, key: string, value: string): Promise<void> {
		await this.setMany(sessionId, [{ key, value }])
	}

	async setMany(sessionId: string, entries: Array<{ key: string; value: string }>): Promise<void> {
		if (entries.length === 0) return
		await this.withRetry(() => this.call('setMany', sessionId, entries), 'setMany')
	}

	async delete(sessionId: string, key: string): Promise<void> {
		await this.deleteMany(sessionId, [key])
	}

	async deleteMany(sessionId: string, keys: string[]): Promise<void> {
		if (keys.length === 0) return
		await this.withRetry(() => this.call('deleteMany', sessionId, keys), 'deleteMany')
	}

	async getAllKeys(sessionId: string): Promise<string[]> {
		return this.withRetry(() => this.call<string[]>('getAllKeys', sessionId), 'getAllKeys')
	}

	async deleteSession(sessionId: string): Promise<void> {
		await this.withRetry(() => this.call('deleteSession', sessionId), 'deleteSession')
	}

	async listSessions(): Promise<string[]> {
		return this.withRetry(() => this.call<string[]>('listSessions'), 'listSessions')
	}

	async sessionExists(sessionId: string): Promise<boolean> {
		return this.withRetry(() => this.call<boolean>('sessionExists', sessionId), 'sessionExists')
	}

	async close(): Promise<void> {
		if (!this.worker) return
		await this.call('close').catch(() => {})
		await this.worker.terminate()
		this.worker = null
		this.ready = null
	}
}

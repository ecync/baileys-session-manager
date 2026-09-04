import type { IDatabaseAdapter, Logger, RetryOptions, SessionRecord } from '../types.js'
import { BaseAdapter } from './base-adapter.js'

interface RtdbDataSnapshot {
	val(): unknown
	exists(): boolean
}

interface RtdbReference {
	set(value: unknown): Promise<void>
	update(value: Record<string, unknown>): Promise<void>
	remove(): Promise<void>
	once(event: 'value'): Promise<RtdbDataSnapshot>
}

interface RtdbLike {
	ref(path: string): RtdbReference
}

interface StoredValue {
	value: string
	updatedAt: number
	version: number
}

// Firebase RTDB keys can't contain ".", "#", "$", "[", "]", or "/", but our own
// session/key strings sometimes do (JIDs contain "@" and ":", which are fine, but
// better safe than sorted about it). We escape the handful of disallowed
// characters so any legal session id or key round-trips safely as a path segment.
const escapeSegment = (segment: string) => segment.replace(/[.#$[\]/]/g, char => `~${char.charCodeAt(0)}~`)

/**
 * Firebase Realtime Database adapter. Stores everything under
 * `/baileys_sessions/{sessionId}/{key}`, which makes "delete a whole session" and
 * "list keys for a session" both cheap, single-path operations.
 */
export class FirebaseRealtimeAdapter extends BaseAdapter implements IDatabaseAdapter {
	readonly name = 'firebase-realtime-database'

	private db: RtdbLike | null = null
	private readonly databaseURL: string | undefined
	private readonly appName: string | undefined

	constructor(options: { databaseURL?: string; appName?: string } = {}, logger?: Logger, retryOptions?: RetryOptions) {
		super(logger, retryOptions)
		this.databaseURL = options.databaseURL
		this.appName = options.appName
	}

	async init(): Promise<void> {
		const admin = await import('firebase-admin/app')
		const { getDatabase } = await import('firebase-admin/database')

		const apps = admin.getApps()
		const app = apps.find(a => a?.name === (this.appName ?? '[DEFAULT]')) ?? admin.initializeApp({ databaseURL: this.databaseURL }, this.appName)

		this.db = getDatabase(app) as unknown as RtdbLike
	}

	private get client(): RtdbLike {
		if (!this.db) {
			throw new Error('FirebaseRealtimeAdapter.init() must be called before it is used.')
		}

		return this.db
	}

	private path(sessionId: string, key?: string): string {
		const base = `baileys_sessions/${escapeSegment(sessionId)}`
		return key ? `${base}/${escapeSegment(key)}` : base
	}

	async get(sessionId: string, key: string): Promise<SessionRecord | null> {
		const snapshot = await this.withRetry(() => this.client.ref(this.path(sessionId, key)).once('value'), 'get')
		if (!snapshot.exists()) return null

		const stored = snapshot.val() as StoredValue
		return { sessionId, key, value: stored.value, updatedAt: stored.updatedAt, version: stored.version }
	}

	async getMany(sessionId: string, keys: string[]): Promise<Map<string, SessionRecord>> {
		const map = new Map<string, SessionRecord>()
		await Promise.all(
			keys.map(async key => {
				const record = await this.get(sessionId, key)
				if (record) map.set(key, record)
			})
		)

		return map
	}

	async set(sessionId: string, key: string, value: string): Promise<void> {
		await this.setMany(sessionId, [{ key, value }])
	}

	async setMany(sessionId: string, entries: Array<{ key: string; value: string }>): Promise<void> {
		if (entries.length === 0) return
		const now = Date.now()

		// Firebase RTDB supports multi-path updates from one call, that's our
		// equivalent of a bulk upsert here: one network round trip for the whole batch.
		const existingVersions = await this.getMany(
			sessionId,
			entries.map(e => e.key)
		)

		const update: Record<string, StoredValue> = {}
		for (const entry of entries) {
			const currentVersion = existingVersions.get(entry.key)?.version ?? 0
			update[this.path(sessionId, entry.key)] = { value: entry.value, updatedAt: now, version: currentVersion + 1 }
		}

		await this.withRetry(() => this.client.ref('/').update(update), 'setMany')
	}

	async delete(sessionId: string, key: string): Promise<void> {
		await this.withRetry(() => this.client.ref(this.path(sessionId, key)).remove(), 'delete')
	}

	async deleteMany(sessionId: string, keys: string[]): Promise<void> {
		if (keys.length === 0) return
		const update: Record<string, null> = {}
		for (const key of keys) {
			update[this.path(sessionId, key)] = null
		}

		await this.withRetry(() => this.client.ref('/').update(update), 'deleteMany')
	}

	async getAllKeys(sessionId: string): Promise<string[]> {
		const snapshot = await this.withRetry(() => this.client.ref(this.path(sessionId)).once('value'), 'getAllKeys')
		if (!snapshot.exists()) return []

		return Object.keys(snapshot.val() as Record<string, unknown>)
	}

	async deleteSession(sessionId: string): Promise<void> {
		await this.withRetry(() => this.client.ref(this.path(sessionId)).remove(), 'deleteSession')
	}

	async listSessions(): Promise<string[]> {
		const snapshot = await this.withRetry(() => this.client.ref('baileys_sessions').once('value'), 'listSessions')
		if (!snapshot.exists()) return []

		return Object.keys(snapshot.val() as Record<string, unknown>)
	}

	async sessionExists(sessionId: string): Promise<boolean> {
		const snapshot = await this.withRetry(() => this.client.ref(this.path(sessionId)).once('value'), 'sessionExists')
		return snapshot.exists()
	}

	async close(): Promise<void> {
		// firebase-admin apps are typically shared across a process, we don't tear
		// down the app here since other code may still be using it.
	}
}

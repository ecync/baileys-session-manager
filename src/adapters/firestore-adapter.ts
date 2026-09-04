import type { IDatabaseAdapter, Logger, RetryOptions, SessionRecord } from '../types.js'
import { BaseAdapter, SESSIONS_TABLE } from './base-adapter.js'

interface FirestoreDocSnapshot {
	exists: boolean
	data(): FirestoreDoc
	id: string
}

interface FirestoreQuerySnapshot {
	docs: FirestoreDocSnapshot[]
	empty: boolean
}

interface FirestoreDocRef {
	set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<unknown>
	delete(): Promise<unknown>
	get(): Promise<FirestoreDocSnapshot>
}

interface FirestoreCollectionRef {
	doc(id: string): FirestoreDocRef
	where(field: string, op: string, value: unknown): FirestoreQueryable
	get(): Promise<FirestoreQuerySnapshot>
}

interface FirestoreQueryable {
	where(field: string, op: string, value: unknown): FirestoreQueryable
	get(): Promise<FirestoreQuerySnapshot>
}

interface FirestoreWriteBatch {
	set(ref: FirestoreDocRef, data: Record<string, unknown>, options?: { merge?: boolean }): void
	delete(ref: FirestoreDocRef): void
	commit(): Promise<unknown>
}

interface FirestoreLike {
	collection(name: string): FirestoreCollectionRef
	batch(): FirestoreWriteBatch
}

interface FirestoreDoc {
	sessionId: string
	key: string
	value: string
	updatedAt: number
	version: number
}

const toRecord = (doc: FirestoreDoc): SessionRecord => ({
	sessionId: doc.sessionId,
	key: doc.key,
	value: doc.value,
	updatedAt: doc.updatedAt,
	version: doc.version
})

// Firestore document ids can't contain "/", everything else in a session id or
// key is safe, so we just guard against that one character.
const docId = (sessionId: string, key: string) => `${sessionId.replace(/\//g, '_')}__${key.replace(/\//g, '_')}`

/**
 * Firestore adapter. One collection (`baileys_sessions`), one document per
 * session+key pair, with the session id stored as a field so `listSessions` and
 * `deleteSession` can query by it. Batched writes go through Firestore's
 * WriteBatch, which commits up to 500 operations atomically in a single call.
 */
export class FirestoreAdapter extends BaseAdapter implements IDatabaseAdapter {
	readonly name = 'firestore'

	private db: FirestoreLike | null = null
	private readonly appName: string | undefined

	constructor(options: { appName?: string } = {}, logger?: Logger, retryOptions?: RetryOptions) {
		super(logger, retryOptions)
		this.appName = options.appName
	}

	async init(): Promise<void> {
		const admin = await import('firebase-admin/app')
		const { getFirestore } = await import('firebase-admin/firestore')

		const apps = admin.getApps()
		const app = apps.find(a => a?.name === (this.appName ?? '[DEFAULT]')) ?? admin.initializeApp(undefined, this.appName)

		this.db = getFirestore(app) as unknown as FirestoreLike
	}

	private get client(): FirestoreLike {
		if (!this.db) {
			throw new Error('FirestoreAdapter.init() must be called before it is used.')
		}

		return this.db
	}

	private get collection(): FirestoreCollectionRef {
		return this.client.collection(SESSIONS_TABLE)
	}

	async get(sessionId: string, key: string): Promise<SessionRecord | null> {
		const snap = await this.withRetry(() => this.collection.doc(docId(sessionId, key)).get(), 'get')
		if (!snap.exists) return null

		return toRecord(snap.data())
	}

	async getMany(sessionId: string, keys: string[]): Promise<Map<string, SessionRecord>> {
		const map = new Map<string, SessionRecord>()
		if (keys.length === 0) return map

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

		// One WriteBatch commit for the whole set() call instead of N separate
		// document writes, this is where Firestore gets its share of the batching win.
		const batch = this.client.batch()
		for (const entry of entries) {
			const ref = this.collection.doc(docId(sessionId, entry.key))
			batch.set(
				ref,
				{
					sessionId,
					key: entry.key,
					value: entry.value,
					updatedAt: now,
					version: 1
				},
				{ merge: false }
			)
		}

		await this.withRetry(() => batch.commit(), 'setMany')
	}

	async delete(sessionId: string, key: string): Promise<void> {
		await this.withRetry(() => this.collection.doc(docId(sessionId, key)).delete(), 'delete')
	}

	async deleteMany(sessionId: string, keys: string[]): Promise<void> {
		if (keys.length === 0) return
		const batch = this.client.batch()
		for (const key of keys) {
			batch.delete(this.collection.doc(docId(sessionId, key)))
		}

		await this.withRetry(() => batch.commit(), 'deleteMany')
	}

	async getAllKeys(sessionId: string): Promise<string[]> {
		const snap = await this.withRetry(() => this.collection.where('sessionId', '==', sessionId).get(), 'getAllKeys')
		return snap.docs.map(d => d.data().key)
	}

	async deleteSession(sessionId: string): Promise<void> {
		const snap = await this.withRetry(() => this.collection.where('sessionId', '==', sessionId).get(), 'deleteSession')
		if (snap.empty) return

		const batch = this.client.batch()
		for (const doc of snap.docs) {
			batch.delete(this.collection.doc(doc.id))
		}

		await this.withRetry(() => batch.commit(), 'deleteSession')
	}

	async listSessions(): Promise<string[]> {
		const snap = await this.withRetry(() => this.collection.get(), 'listSessions')
		const sessionIds = new Set<string>()
		for (const doc of snap.docs) {
			sessionIds.add(doc.data().sessionId)
		}

		return [...sessionIds]
	}

	async sessionExists(sessionId: string): Promise<boolean> {
		const snap = await this.withRetry(() => this.collection.where('sessionId', '==', sessionId).get(), 'sessionExists')
		return !snap.empty
	}

	async close(): Promise<void> {
		// Same story as the Realtime Database adapter, the firebase-admin app is
		// typically shared, so we leave it running rather than tearing it down here.
	}
}

import type { IDatabaseAdapter, Logger, RetryOptions, SessionRecord } from '../types.js'
import { BaseAdapter, SESSIONS_TABLE } from './base-adapter.js'

interface MongoDoc {
	sessionId: string
	key: string
	value: string
	updatedAt: number
	version: number
}

interface MongoCollectionLike {
	createIndex(spec: Record<string, 1 | -1>, options?: Record<string, unknown>): Promise<unknown>
	findOne(filter: Record<string, unknown>): Promise<MongoDoc | null>
	find(filter: Record<string, unknown>): { toArray(): Promise<MongoDoc[]> }
	bulkWrite(ops: unknown[]): Promise<unknown>
	deleteOne(filter: Record<string, unknown>): Promise<unknown>
	deleteMany(filter: Record<string, unknown>): Promise<unknown>
	distinct(field: string): Promise<string[]>
}

interface MongoClientLike {
	connect(): Promise<unknown>
	close(): Promise<void>
	db(name?: string): { collection(name: string): MongoCollectionLike }
}

const toRecord = (doc: MongoDoc): SessionRecord => ({
	sessionId: doc.sessionId,
	key: doc.key,
	value: doc.value,
	updatedAt: doc.updatedAt,
	version: doc.version
})

/**
 * MongoDB adapter. One collection, a compound unique index on (sessionId, key),
 * and bulk writes for batched key updates so a burst of Baileys' signal key
 * mutations turns into one bulkWrite call instead of many individual updates.
 */
export class MongoAdapter extends BaseAdapter implements IDatabaseAdapter {
	readonly name = 'mongodb'

	private client: MongoClientLike | null = null
	private collection: MongoCollectionLike | null = null
	private readonly uri: string
	private readonly dbName: string | undefined

	constructor(options: { uri: string; dbName?: string }, logger?: Logger, retryOptions?: RetryOptions) {
		super(logger, retryOptions)
		this.uri = options.uri
		this.dbName = options.dbName
	}

	async init(): Promise<void> {
		const { MongoClient } = await import('mongodb')
		this.client = new MongoClient(this.uri) as unknown as MongoClientLike
		await this.client.connect()
		this.collection = this.client.db(this.dbName).collection(SESSIONS_TABLE)

		await this.withRetry(() => this.collection!.createIndex({ sessionId: 1, key: 1 }, { unique: true }), 'init')
	}

	private get col(): MongoCollectionLike {
		if (!this.collection) {
			throw new Error('MongoAdapter.init() must be called before it is used.')
		}

		return this.collection
	}

	async get(sessionId: string, key: string): Promise<SessionRecord | null> {
		const doc = await this.withRetry(() => this.col.findOne({ sessionId, key }), 'get')
		return doc ? toRecord(doc) : null
	}

	async getMany(sessionId: string, keys: string[]): Promise<Map<string, SessionRecord>> {
		const map = new Map<string, SessionRecord>()
		if (keys.length === 0) return map

		const docs = await this.withRetry(() => this.col.find({ sessionId, key: { $in: keys } }).toArray(), 'getMany')
		for (const doc of docs) {
			map.set(doc.key, toRecord(doc))
		}

		return map
	}

	async set(sessionId: string, key: string, value: string): Promise<void> {
		await this.setMany(sessionId, [{ key, value }])
	}

	async setMany(sessionId: string, entries: Array<{ key: string; value: string }>): Promise<void> {
		if (entries.length === 0) return
		const now = Date.now()

		const ops = entries.map(entry => ({
			updateOne: {
				filter: { sessionId, key: entry.key },
				update: {
					$set: { value: entry.value, updatedAt: now },
					$setOnInsert: { sessionId, key: entry.key },
					$inc: { version: 1 }
				},
				upsert: true
			}
		}))

		await this.withRetry(() => this.col.bulkWrite(ops), 'setMany')
	}

	async delete(sessionId: string, key: string): Promise<void> {
		await this.withRetry(() => this.col.deleteOne({ sessionId, key }), 'delete')
	}

	async deleteMany(sessionId: string, keys: string[]): Promise<void> {
		if (keys.length === 0) return
		await this.withRetry(() => this.col.deleteMany({ sessionId, key: { $in: keys } }), 'deleteMany')
	}

	async getAllKeys(sessionId: string): Promise<string[]> {
		const docs = await this.withRetry(() => this.col.find({ sessionId }).toArray(), 'getAllKeys')
		return docs.map(d => d.key)
	}

	async deleteSession(sessionId: string): Promise<void> {
		await this.withRetry(() => this.col.deleteMany({ sessionId }), 'deleteSession')
	}

	async listSessions(): Promise<string[]> {
		return this.withRetry(() => this.col.distinct('sessionId'), 'listSessions')
	}

	async sessionExists(sessionId: string): Promise<boolean> {
		const doc = await this.withRetry(() => this.col.findOne({ sessionId }), 'sessionExists')
		return !!doc
	}

	async close(): Promise<void> {
		await this.client?.close()
		this.client = null
		this.collection = null
	}
}

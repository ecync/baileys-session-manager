import type { IDatabaseAdapter, SessionRecord } from '../../src/types.js'

/**
 * A trivial in-memory IDatabaseAdapter for tests, with call counters so tests
 * can assert how many times the "database" was actually hit (which is the whole
 * point of testing the cache layers, we want to prove L1/L2 are actually saving
 * us round trips, not just that the final value comes back correct).
 */
export class FakeAdapter implements IDatabaseAdapter {
	readonly name = 'fake'
	readonly rows = new Map<string, SessionRecord>()

	getCalls = 0
	getManyCalls = 0
	setCalls = 0
	setManyCalls = 0

	/** Simulated network latency per setMany() call, used to make a regression like "N sequential round trips instead of one" show up as a timing difference in tests. */
	private readonly setManyLatencyMs: number

	constructor(options: { setManyLatencyMs?: number } = {}) {
		this.setManyLatencyMs = options.setManyLatencyMs ?? 0
	}

	private key(sessionId: string, key: string) {
		return `${sessionId}:${key}`
	}

	async init(): Promise<void> {}

	async get(sessionId: string, key: string): Promise<SessionRecord | null> {
		this.getCalls++
		return this.rows.get(this.key(sessionId, key)) ?? null
	}

	async getMany(sessionId: string, keys: string[]): Promise<Map<string, SessionRecord>> {
		this.getManyCalls++
		const result = new Map<string, SessionRecord>()
		for (const key of keys) {
			const row = this.rows.get(this.key(sessionId, key))
			if (row) result.set(key, row)
		}

		return result
	}

	async set(sessionId: string, key: string, value: string): Promise<void> {
		this.setCalls++
		await this.setMany(sessionId, [{ key, value }])
	}

	async setMany(sessionId: string, entries: Array<{ key: string; value: string }>): Promise<void> {
		this.setManyCalls++
		if (this.setManyLatencyMs > 0) {
			await new Promise(resolve => setTimeout(resolve, this.setManyLatencyMs))
		}

		for (const entry of entries) {
			const existing = this.rows.get(this.key(sessionId, entry.key))
			this.rows.set(this.key(sessionId, entry.key), {
				sessionId,
				key: entry.key,
				value: entry.value,
				updatedAt: Date.now(),
				version: (existing?.version ?? 0) + 1
			})
		}
	}

	async delete(sessionId: string, key: string): Promise<void> {
		this.rows.delete(this.key(sessionId, key))
	}

	async deleteMany(sessionId: string, keys: string[]): Promise<void> {
		for (const key of keys) this.rows.delete(this.key(sessionId, key))
	}

	async getAllKeys(sessionId: string): Promise<string[]> {
		return [...this.rows.values()].filter(r => r.sessionId === sessionId).map(r => r.key)
	}

	async deleteSession(sessionId: string): Promise<void> {
		for (const [k, v] of this.rows) {
			if (v.sessionId === sessionId) this.rows.delete(k)
		}
	}

	async listSessions(): Promise<string[]> {
		return [...new Set([...this.rows.values()].map(r => r.sessionId))]
	}

	async sessionExists(sessionId: string): Promise<boolean> {
		return [...this.rows.values()].some(r => r.sessionId === sessionId)
	}

	async close(): Promise<void> {}
}

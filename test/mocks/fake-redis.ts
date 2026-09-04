import type { IRedisCacheAdapter } from '../../src/types.js'

/** A minimal in-memory stand-in for a TCP Redis cache, with a fake pub/sub loop. */
export class FakeRedisTcp implements IRedisCacheAdapter {
	readonly mode = 'tcp' as const
	private readonly store = new Map<string, { value: string; version: number }>()
	private listeners: Array<(key: string) => void> = []

	getCalls = 0
	setCalls = 0

	async get(key: string) {
		this.getCalls++
		return this.store.get(key) ?? null
	}

	async set(key: string, value: string, version: number) {
		this.setCalls++
		this.store.set(key, { value, version })
	}

	async del(key: string) {
		this.store.delete(key)
	}

	async subscribeInvalidation(onMessage: (key: string) => void) {
		this.listeners.push(onMessage)
	}

	async publishInvalidation(key: string) {
		for (const listener of this.listeners) listener(key)
	}

	async close() {}
}

/** A minimal stand-in for HTTP/REST Redis: same storage, but no pub/sub methods at all. */
export class FakeRedisHttp implements IRedisCacheAdapter {
	readonly mode = 'http' as const
	private readonly store = new Map<string, { value: string; version: number }>()

	getCalls = 0
	setCalls = 0

	async get(key: string) {
		this.getCalls++
		return this.store.get(key) ?? null
	}

	async set(key: string, value: string, version: number) {
		this.setCalls++
		this.store.set(key, { value, version })
	}

	async del(key: string) {
		this.store.delete(key)
	}

	async close() {}
}

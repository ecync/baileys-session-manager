import { beforeEach, describe, expect, it } from 'vitest'
import { CacheManager } from '../src/cache/cache-manager.js'
import { noopLogger } from '../src/utils/logger.js'
import { FakeAdapter } from './mocks/fake-adapter.js'
import { FakeRedisHttp, FakeRedisTcp } from './mocks/fake-redis.js'

const SESSION = 'session-1'

describe('CacheManager', () => {
	let adapter: FakeAdapter

	beforeEach(() => {
		adapter = new FakeAdapter()
	})

	it('serves a second read for the same key entirely from L1, without touching the database', async () => {
		await adapter.set(SESSION, 'creds', 'hello')
		const cache = new CacheManager(adapter, undefined, noopLogger)

		const first = await cache.get(SESSION, 'creds')
		expect(first).toBe('hello')
		expect(adapter.getCalls).toBe(1)

		const second = await cache.get(SESSION, 'creds')
		expect(second).toBe('hello')
		expect(adapter.getCalls).toBe(1) // still 1: served from L1, no second database hit
	})

	it('falls through to L2 (Redis) on an L1 miss, without touching the database', async () => {
		const redis = new FakeRedisTcp()
		await redis.set(`${SESSION}:creds`, 'from-redis', 1)

		const cache = new CacheManager(adapter, { redis }, noopLogger)
		const value = await cache.get(SESSION, 'creds')

		expect(value).toBe('from-redis')
		expect(redis.getCalls).toBe(1)
		expect(adapter.getCalls).toBe(0)
	})

	it('falls all the way through to the database on a full miss, then backfills L1 and L2', async () => {
		await adapter.set(SESSION, 'creds', 'from-db')
		const redis = new FakeRedisTcp()
		const cache = new CacheManager(adapter, { redis }, noopLogger)

		const value = await cache.get(SESSION, 'creds')
		expect(value).toBe('from-db')
		expect(adapter.getCalls).toBe(1)

		// Backfilled: a second read shouldn't need the database again.
		const second = await cache.get(SESSION, 'creds')
		expect(second).toBe('from-db')
		expect(adapter.getCalls).toBe(1)

		// And Redis should have been populated too, independent of L1.
		expect(await redis.get(`${SESSION}:creds`)).toEqual({ value: 'from-db', version: expect.any(Number) })
	})

	it('treats an HTTP-mode Redis version mismatch as a cache miss and refetches', async () => {
		const redis = new FakeRedisHttp()
		const cache = new CacheManager(adapter, { redis }, noopLogger)

		// Seed L1 (and L2) with version 1 via a normal write notification.
		await cache.onWritten(SESSION, 'creds', 'v1-value', 1)
		expect(await cache.get(SESSION, 'creds')).toBe('v1-value')

		// Simulate another instance writing a newer version straight to Redis,
		// without this instance's L1 knowing about it (no pub/sub in HTTP mode).
		await redis.set(`${SESSION}:creds`, 'v2-value', 2)

		const value = await cache.get(SESSION, 'creds')
		expect(value).toBe('v2-value')
	})

	it('drops the matching L1 entry when a TCP Redis invalidation message arrives', async () => {
		const redis = new FakeRedisTcp()
		const cache = new CacheManager(adapter, { redis }, noopLogger)

		await cache.onWritten(SESSION, 'creds', 'first', 1)
		expect(await cache.get(SESSION, 'creds')).toBe('first')

		// A second instance overwrites the value directly in the fake DB/Redis and
		// publishes an invalidation, the way onWritten() would on that instance.
		await redis.set(`${SESSION}:creds`, 'second', 2)
		await redis.publishInvalidation(`${SESSION}:creds`)

		// Give the subscription's async wiring a tick to run.
		await new Promise(resolve => setTimeout(resolve, 0))

		const value = await cache.get(SESSION, 'creds')
		expect(value).toBe('second')
	})
})

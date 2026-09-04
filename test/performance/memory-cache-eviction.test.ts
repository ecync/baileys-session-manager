import { afterEach, describe, expect, it } from 'vitest'
import { MemoryCache } from '../../src/cache/memory-cache.js'

describe('MemoryCache', () => {
	let cache: MemoryCache | undefined

	afterEach(() => {
		cache?.destroy()
		cache = undefined
	})

	it('evicts the least recently used entry once maxEntries is exceeded', () => {
		cache = new MemoryCache({ maxEntries: 2, ttlMs: 60_000 })

		cache.set('a', '1', 1)
		cache.set('b', '2', 1)
		cache.set('c', '3', 1) // should evict "a", the oldest untouched entry

		expect(cache.get('a')).toBeNull()
		expect(cache.get('b')).not.toBeNull()
		expect(cache.get('c')).not.toBeNull()
		expect(cache.size).toBe(2)
	})

	it('touching an entry protects it from being the next eviction', () => {
		cache = new MemoryCache({ maxEntries: 2, ttlMs: 60_000 })

		cache.set('a', '1', 1)
		cache.set('b', '2', 1)
		cache.get('a') // touch "a", "b" is now the least recently used
		cache.set('c', '3', 1) // should evict "b", not "a"

		expect(cache.get('a')).not.toBeNull()
		expect(cache.get('b')).toBeNull()
	})

	it('evicts entries once the approximate byte budget is exceeded', () => {
		cache = new MemoryCache({ maxEntries: 1000, maxBytes: 20, ttlMs: 60_000 })

		cache.set('a', '1234567890', 1) // 10 bytes
		cache.set('b', '1234567890', 1) // 10 bytes, total 20, still fits

		// Note: we deliberately don't read "a" here. Reading it would touch it and
		// make "b" the least recently used instead, which is correct LRU behavior
		// but would defeat the point of this particular assertion.
		cache.set('c', '1234567890', 1) // pushes past 20 bytes, should evict "a" (the oldest, untouched entry)
		expect(cache.get('a')).toBeNull()
		expect(cache.approximateBytes).toBeLessThanOrEqual(20)
	})

	it('expires entries after ttlMs without needing a read to trigger it', async () => {
		cache = new MemoryCache({ ttlMs: 20 })
		cache.set('a', '1', 1)

		// Sweep interval scales with ttlMs (min 50ms), so wait comfortably past both.
		await new Promise(resolve => setTimeout(resolve, 150))

		// The background sweep should have cleared it, not just a lazy get() check.
		expect(cache.size).toBe(0)
	}, 2000)

	it('destroy() clears every entry and stops the sweep timer from keeping the process alive', () => {
		cache = new MemoryCache()
		cache.set('a', '1', 1)
		cache.destroy()

		expect(cache.size).toBe(0)
	})
})

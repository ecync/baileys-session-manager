import { beforeEach, describe, expect, it } from 'vitest'
import { CacheManager } from '../src/cache/cache-manager.js'
import { useHybridAuthState } from '../src/factory.js'
import { pruneExpiredKeys, resolveCategory } from '../src/retention.js'
import type { KeyRetentionOptions } from '../src/types.js'
import { noopLogger } from '../src/utils/logger.js'
import { FakeAdapter } from './mocks/fake-adapter.js'

const SESSION = 'session-1'

describe('resolveCategory', () => {
	it('picks the longest matching prefix, so sender-key-memory wins over sender-key', () => {
		expect(resolveCategory('sender-key-memory-abc123')).toBe('sender-key-memory')
		expect(resolveCategory('sender-key-abc123')).toBe('sender-key')
	})

	it('resolves every other known category correctly', () => {
		expect(resolveCategory('pre-key-1')).toBe('pre-key')
		expect(resolveCategory('session-1234@s.whatsapp.net')).toBe('session')
		expect(resolveCategory('app-state-sync-key-abc')).toBe('app-state-sync-key')
		expect(resolveCategory('app-state-sync-version-critical_block')).toBe('app-state-sync-version')
		expect(resolveCategory('device-list-123')).toBe('device-list')
		expect(resolveCategory('identity-key-123')).toBe('identity-key')
		expect(resolveCategory('lid-mapping-123')).toBe('lid-mapping')
		expect(resolveCategory('tctoken-123')).toBe('tctoken')
	})

	it('returns null for creds, it is not a signal data category', () => {
		expect(resolveCategory('creds')).toBeNull()
	})

	it('returns null for something unrecognized', () => {
		expect(resolveCategory('some-made-up-key')).toBeNull()
	})
})

describe('pruneExpiredKeys', () => {
	let adapter: FakeAdapter
	let cache: CacheManager

	beforeEach(() => {
		adapter = new FakeAdapter()
		cache = new CacheManager(adapter, undefined, noopLogger)
	})

	async function writeAged(key: string, value: string, ageMs: number) {
		await adapter.setMany(SESSION, [{ key, value }])
		// Backdate updatedAt directly on the fake store so we don't need to
		// actually wait in real time for something to become "stale".
		const record = adapter.rows.get(`${SESSION}:${key}`)!
		record.updatedAt = Date.now() - ageMs
	}

	it('does nothing at all when retention is disabled', async () => {
		await writeAged('sender-key-memory-abc', 'x', 999_999_999)

		const options: KeyRetentionOptions = { enabled: false, maxAgeMsByCategory: { 'sender-key-memory': 1 } }
		const result = await pruneExpiredKeys({ sessionId: SESSION, adapter, cache, logger: noopLogger, options })

		expect(result.prunedKeys).toEqual([])
		expect(await adapter.get(SESSION, 'sender-key-memory-abc')).not.toBeNull()
	})

	it('prunes a stale entry in a configured category', async () => {
		await writeAged('sender-key-memory-abc', 'x', 10_000)

		const options: KeyRetentionOptions = { enabled: true, maxAgeMsByCategory: { 'sender-key-memory': 5_000 } }
		const result = await pruneExpiredKeys({ sessionId: SESSION, adapter, cache, logger: noopLogger, options })

		expect(result.prunedKeys).toEqual(['sender-key-memory-abc'])
		expect(await adapter.get(SESSION, 'sender-key-memory-abc')).toBeNull()
	})

	it('leaves a fresh entry in the same category alone', async () => {
		await writeAged('sender-key-memory-abc', 'x', 1_000)

		const options: KeyRetentionOptions = { enabled: true, maxAgeMsByCategory: { 'sender-key-memory': 5_000 } }
		const result = await pruneExpiredKeys({ sessionId: SESSION, adapter, cache, logger: noopLogger, options })

		expect(result.prunedKeys).toEqual([])
		expect(await adapter.get(SESSION, 'sender-key-memory-abc')).not.toBeNull()
	})

	it('leaves a category alone entirely when it is not listed in maxAgeMsByCategory, no matter how old', async () => {
		await writeAged('session-1234@s.whatsapp.net', 'x', 999_999_999)

		const options: KeyRetentionOptions = { enabled: true, maxAgeMsByCategory: { 'sender-key-memory': 1 } }
		const result = await pruneExpiredKeys({ sessionId: SESSION, adapter, cache, logger: noopLogger, options })

		expect(result.prunedKeys).toEqual([])
		expect(await adapter.get(SESSION, 'session-1234@s.whatsapp.net')).not.toBeNull()
	})

	it('never prunes creds, even if a huge max age were mistakenly supplied for every category', async () => {
		await writeAged('creds', 'the-actual-login', 999_999_999)
		await writeAged('sender-key-memory-abc', 'x', 999_999_999)

		// A maxAgeMsByCategory keyed by every real category, "creds" isn't a valid
		// key in this type at all, so there's no way to even ask for it to be pruned.
		const options: KeyRetentionOptions = {
			enabled: true,
			maxAgeMsByCategory: {
				'sender-key-memory': 1,
				session: 1,
				'pre-key': 1,
				'sender-key': 1,
				'app-state-sync-key': 1,
				'app-state-sync-version': 1,
				'lid-mapping': 1,
				'device-list': 1,
				tctoken: 1,
				'identity-key': 1
			}
		}

		const result = await pruneExpiredKeys({ sessionId: SESSION, adapter, cache, logger: noopLogger, options })

		expect(result.prunedKeys).not.toContain('creds')
		expect(await adapter.get(SESSION, 'creds')).not.toBeNull()
		expect((await adapter.get(SESSION, 'creds'))?.value).toBe('the-actual-login')
	})

	it('also clears the pruned key out of the cache, not just the database', async () => {
		await writeAged('sender-key-memory-abc', 'x', 10_000)
		// Prime the cache the way a normal read would.
		await cache.get(SESSION, 'sender-key-memory-abc')

		const options: KeyRetentionOptions = { enabled: true, maxAgeMsByCategory: { 'sender-key-memory': 5_000 } }
		await pruneExpiredKeys({ sessionId: SESSION, adapter, cache, logger: noopLogger, options })

		expect(await cache.get(SESSION, 'sender-key-memory-abc')).toBeNull()
	})
})

describe('autoRunIntervalMs (wired through useHybridAuthState)', () => {
	it('fires a prune pass on its own, without pruneExpiredKeys ever being called manually', async () => {
		const adapter = new FakeAdapter()

		const { close } = await useHybridAuthState({
			sessionId: SESSION,
			adapter,
			retention: {
				enabled: true,
				maxAgeMsByCategory: { 'sender-key-memory': 10 },
				autoRunIntervalMs: 20
			}
		})

		// Write directly to the fake store and backdate it, the auto-run timer
		// should find and prune this on its own on the next tick.
		await adapter.setMany(SESSION, [{ key: 'sender-key-memory-abc', value: 'x' }])
		const record = adapter.rows.get(`${SESSION}:sender-key-memory-abc`)!
		record.updatedAt = Date.now() - 1_000

		await new Promise(resolve => setTimeout(resolve, 100))

		expect(await adapter.get(SESSION, 'sender-key-memory-abc')).toBeNull()

		await close()
	})

	it('never runs automatically when retention is not enabled, even with an interval-shaped config mistake', async () => {
		const adapter = new FakeAdapter()

		const { close } = await useHybridAuthState({
			sessionId: SESSION,
			adapter,
			retention: {
				enabled: false,
				maxAgeMsByCategory: { 'sender-key-memory': 10 },
				autoRunIntervalMs: 20
			}
		})

		await adapter.setMany(SESSION, [{ key: 'sender-key-memory-abc', value: 'x' }])
		const record = adapter.rows.get(`${SESSION}:sender-key-memory-abc`)!
		record.updatedAt = Date.now() - 1_000

		await new Promise(resolve => setTimeout(resolve, 100))

		expect(await adapter.get(SESSION, 'sender-key-memory-abc')).not.toBeNull()

		await close()
	})
})

import { describe, expect, it } from 'vitest'
import { useHybridAuthState } from '../../src/factory.js'
import { FakeAdapter } from '../mocks/fake-adapter.js'

const SESSION = 'session-1'

/**
 * Regression test for a real production bug: keys.set() used to await a
 * batcher.write() call per key inside a for loop, so a single keys.set() call
 * carrying many entries (Baileys hands over hundreds of pre-keys at once
 * during pairing) turned into hundreds of sequential lock-acquire/write/release
 * round trips instead of one batched write. With a lock held per sessionId
 * (not per key), that also starved out anything else waiting on the same lock,
 * which is why a sendMessage() needing to write a session key could hang
 * behind hundreds of still-in-flight pre-key writes.
 */
describe('keys.set batching', () => {
	it('writes every entry from a single keys.set call as one setMany call, not one per key', async () => {
		const adapter = new FakeAdapter()
		const { state } = await useHybridAuthState({ sessionId: SESSION, adapter })

		const preKeys: Record<string, { public: Uint8Array; private: Uint8Array }> = {}
		for (let i = 0; i < 50; i++) {
			preKeys[String(i)] = { public: new Uint8Array([i]), private: new Uint8Array([i]) }
		}

		await state.keys.set({ 'pre-key': preKeys })

		expect(adapter.setManyCalls).toBe(1)
		expect((await adapter.getAllKeys(SESSION)).length).toBe(50)
	})

	it('does not serialize through N round trips worth of latency for a large single keys.set call', async () => {
		// Simulated network latency per database round trip, standing in for real
		// latency to Mongo/Postgres/etc. If keys.set were still writing one entry
		// at a time (the bug), 50 entries at 20ms each would take at least 1000ms.
		// Batched into one call, it should take roughly one round trip's worth.
		const adapter = new FakeAdapter({ setManyLatencyMs: 20 })
		const { state } = await useHybridAuthState({ sessionId: SESSION, adapter })

		const preKeys: Record<string, { public: Uint8Array; private: Uint8Array }> = {}
		for (let i = 0; i < 50; i++) {
			preKeys[String(i)] = { public: new Uint8Array([i]), private: new Uint8Array([i]) }
		}

		const start = Date.now()
		await state.keys.set({ 'pre-key': preKeys })
		const elapsedMs = Date.now() - start

		expect(adapter.setManyCalls).toBe(1)
		// Generous upper bound, well under the ~1000ms+ the old sequential
		// behavior would have taken, but tolerant of slow CI machines.
		expect(elapsedMs).toBeLessThan(300)
	})

	it('a keys.set for one session does not block a concurrent keys.set for the same session behind hundreds of individual writes', async () => {
		const adapter = new FakeAdapter({ setManyLatencyMs: 20 })
		const { state } = await useHybridAuthState({ sessionId: SESSION, adapter })

		const preKeys: Record<string, { public: Uint8Array; private: Uint8Array }> = {}
		for (let i = 0; i < 100; i++) {
			preKeys[String(i)] = { public: new Uint8Array([i]), private: new Uint8Array([i]) }
		}

		const bigWrite = state.keys.set({ 'pre-key': preKeys })
		// A second, small write (standing in for a session key a concurrent
		// sendMessage() needs to write) should still complete promptly, not queue
		// up behind 100 individual pre-key writes.
		const smallWriteStart = Date.now()
		await state.keys.set({ session: { 'some-jid': new Uint8Array([1, 2, 3]) } })
		const smallWriteElapsedMs = Date.now() - smallWriteStart

		await bigWrite

		expect(smallWriteElapsedMs).toBeLessThan(300)
	})
})

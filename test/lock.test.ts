import { describe, expect, it } from 'vitest'
import { LocalMutexLock } from '../src/lock/mutex-lock.js'

describe('LocalMutexLock', () => {
	it('serializes two concurrent writers to the same key', async () => {
		const lock = new LocalMutexLock()
		const order: string[] = []

		const slow = lock.withLock('session-a', async () => {
			order.push('slow-start')
			await new Promise(resolve => setTimeout(resolve, 30))
			order.push('slow-end')
		})

		// Give the first call a moment to actually acquire the lock before the
		// second one tries, so we're testing "waits its turn", not "won the race".
		await new Promise(resolve => setTimeout(resolve, 5))

		const fast = lock.withLock('session-a', async () => {
			order.push('fast-start')
			order.push('fast-end')
		})

		await Promise.all([slow, fast])

		expect(order).toEqual(['slow-start', 'slow-end', 'fast-start', 'fast-end'])
	})

	it('lets two different keys run concurrently, without waiting on each other', async () => {
		const lock = new LocalMutexLock()
		const order: string[] = []

		const a = lock.withLock('session-a', async () => {
			order.push('a-start')
			await new Promise(resolve => setTimeout(resolve, 20))
			order.push('a-end')
		})

		const b = lock.withLock('session-b', async () => {
			order.push('b-start')
			order.push('b-end')
		})

		await Promise.all([a, b])

		// b should finish well before a, since they don't share a lock key.
		expect(order.indexOf('b-end')).toBeLessThan(order.indexOf('a-end'))
	})
})

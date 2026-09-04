import { describe, expect, it } from 'vitest'
import { WriteBatcher } from '../../src/utils/write-batcher.js'

describe('WriteBatcher', () => {
	it('collapses several writes that arrive within the debounce window into a single flush call', async () => {
		const flushes: Array<Array<{ key: string; value: string }>> = []
		const batcher = new WriteBatcher(async entries => {
			flushes.push(entries)
		}, 30)

		// Fire off a burst of writes, the way ten creds fields updating within the
		// same event loop tick during pairing would.
		const writes = Promise.all([batcher.write('a', '1'), batcher.write('b', '2'), batcher.write('c', '3')])

		await writes

		expect(flushes).toHaveLength(1)
		expect(flushes[0]).toHaveLength(3)
	})

	it('only keeps the latest value when the same key is written more than once before a flush', async () => {
		const flushes: Array<Array<{ key: string; value: string }>> = []
		const batcher = new WriteBatcher(async entries => {
			flushes.push(entries)
		}, 30)

		await Promise.all([batcher.write('creds', 'stale'), batcher.write('creds', 'fresh')])

		expect(flushes).toHaveLength(1)
		expect(flushes[0]).toEqual([{ key: 'creds', value: 'fresh' }])
	})

	it('flushes immediately when debounceMs is 0', async () => {
		const flushes: Array<Array<{ key: string; value: string }>> = []
		const batcher = new WriteBatcher(async entries => {
			flushes.push(entries)
		}, 0)

		await batcher.write('a', '1')
		await batcher.write('b', '2')

		// With no debounce window, each write flushes on its own.
		expect(flushes).toHaveLength(2)
	})

	it('flushNow() flushes whatever is pending without waiting out the debounce window', async () => {
		const flushes: Array<Array<{ key: string; value: string }>> = []
		const batcher = new WriteBatcher(async entries => {
			flushes.push(entries)
		}, 5000) // long debounce, flushNow should bypass it

		const pending = batcher.write('a', '1')
		await batcher.flushNow()
		await pending

		expect(flushes).toHaveLength(1)
	})
})

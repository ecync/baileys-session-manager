import { describe, expect, it, vi } from 'vitest'
import { withRetry } from '../src/utils/retry.js'

describe('withRetry', () => {
	it('returns the result immediately when the first attempt succeeds', async () => {
		const fn = vi.fn().mockResolvedValue('ok')
		const result = await withRetry(fn, { retries: 3, minDelayMs: 1, maxDelayMs: 5 })

		expect(result).toBe('ok')
		expect(fn).toHaveBeenCalledTimes(1)
	})

	it('retries the configured number of times before succeeding', async () => {
		let attempts = 0
		const fn = vi.fn().mockImplementation(async () => {
			attempts++
			if (attempts < 3) throw new Error('transient failure')
			return 'recovered'
		})

		const result = await withRetry(fn, { retries: 3, minDelayMs: 1, maxDelayMs: 5 })

		expect(result).toBe('recovered')
		expect(fn).toHaveBeenCalledTimes(3)
	})

	it('throws the last error once every retry is exhausted', async () => {
		const fn = vi.fn().mockRejectedValue(new Error('always fails'))

		await expect(withRetry(fn, { retries: 2, minDelayMs: 1, maxDelayMs: 5 })).rejects.toThrow('always fails')
		expect(fn).toHaveBeenCalledTimes(3) // 1 initial attempt + 2 retries
	})
})

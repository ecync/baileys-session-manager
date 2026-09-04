import { describe, expect, it, vi } from 'vitest'
import { BaseAdapter } from '../../src/adapters/base-adapter.js'
import { noopLogger } from '../../src/utils/logger.js'
import type { SessionRecord } from '../../src/types.js'

/** A minimal concrete adapter so we can exercise BaseAdapter's shared withRetry behavior. */
class FlakyTestAdapter extends BaseAdapter {
	readonly name = 'flaky-test'
	private attempts = 0

	async init() {}

	async get(_sessionId: string, _key: string): Promise<SessionRecord | null> {
		return this.withRetry(async () => {
			this.attempts++
			if (this.attempts < 2) throw new Error('simulated connection drop')
			return { sessionId: 's', key: 'k', value: 'v', updatedAt: 0, version: 1 }
		}, 'get')
	}

	async getMany() {
		return new Map<string, SessionRecord>()
	}

	async set() {}
	async setMany() {}
	async delete() {}
	async deleteMany() {}
	async getAllKeys() {
		return []
	}

	async deleteSession() {}
	async listSessions() {
		return []
	}

	async sessionExists() {
		return false
	}

	async close() {}
}

describe('BaseAdapter.withRetry', () => {
	it('retries a failing call through withRetry and eventually succeeds', async () => {
		const adapter = new FlakyTestAdapter(noopLogger, { retries: 2, minDelayMs: 1, maxDelayMs: 5 })
		const result = await adapter.get('s', 'k')
		expect(result?.value).toBe('v')
	})

	it('logs a warning through the provided logger on each retry', async () => {
		const warn = vi.fn()
		const logger = { ...noopLogger, warn }
		const adapter = new FlakyTestAdapter(logger, { retries: 2, minDelayMs: 1, maxDelayMs: 5 })

		await adapter.get('s', 'k')
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toContain('flaky-test adapter: get')
	})
})

import type { Logger, RetryOptions } from '../types.js'
import { noopLogger } from './logger.js'

const DEFAULT_RETRIES = 3
const DEFAULT_MIN_DELAY_MS = 200
const DEFAULT_MAX_DELAY_MS = 5000

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Runs `fn`, retrying with exponential backoff if it throws. This is what protects
 * us from the everyday reality of databases: a dropped connection, a momentary
 * timeout, a pool that's briefly out of clients. None of those should crash a bot,
 * they should just be retried a couple of times before we give up and let the
 * caller know something is actually wrong.
 *
 * The delay doubles every attempt (200ms, 400ms, 800ms, ...) and is capped at
 * `maxDelayMs` so a flaky connection doesn't leave us waiting minutes between tries.
 */
export async function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions, logger: Logger = noopLogger, label = 'operation'): Promise<T> {
	const retries = options?.retries ?? DEFAULT_RETRIES
	const minDelayMs = options?.minDelayMs ?? DEFAULT_MIN_DELAY_MS
	const maxDelayMs = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS

	let lastError: unknown
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			return await fn()
		} catch (error) {
			lastError = error
			const attemptsLeft = retries - attempt
			if (attemptsLeft <= 0) {
				break
			}

			const delay = Math.min(minDelayMs * 2 ** attempt, maxDelayMs)
			logger.warn(`${label} failed, retrying in ${delay}ms (${attemptsLeft} attempt(s) left)`, {
				error: error instanceof Error ? error.message : String(error)
			})
			await sleep(delay)
		}
	}

	throw lastError
}

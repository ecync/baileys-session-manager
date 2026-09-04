import { randomUUID } from 'crypto'

interface RedisLockClient {
	set(key: string, value: string, mode: 'PX', ttl: number, flag: 'NX'): Promise<'OK' | null>
	eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>
}

// Only releases a lock if it's still the one we set. Without this, a slow
// operation whose lock already expired could delete a lock some other, newer
// operation has since legitimately acquired. Classic Redlock single-node pattern.
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`

const DEFAULT_TTL_MS = 10_000
const DEFAULT_RETRY_DELAY_MS = 50
const DEFAULT_MAX_WAIT_MS = 10_000

/**
 * A distributed lock built on Redis, for when more than one server process might
 * try to write the same WhatsApp session at once (a couple of pods behind a load
 * balancer, a serverless function that got scaled out, etc). Uses `SET key val NX
 * PX ttl` to acquire (atomic: only succeeds if nobody else holds it) and a small
 * Lua script to release (atomic: only deletes if we're still the owner).
 *
 * This only makes sense with a TCP Redis connection, since it needs `EVAL`
 * support; the HTTP/REST mode intentionally does not get a distributed lock and
 * falls back to the in-process mutex instead (documented in the README).
 */
export class RedisDistributedLock {
	private readonly client: RedisLockClient
	private readonly ttlMs: number

	constructor(client: RedisLockClient, ttlMs = DEFAULT_TTL_MS) {
		this.client = client
		this.ttlMs = ttlMs
	}

	async withLock<T>(key: string, fn: () => Promise<T>, maxWaitMs = DEFAULT_MAX_WAIT_MS): Promise<T> {
		const lockKey = `baileys-auth:lock:${key}`
		const token = randomUUID()
		const deadline = Date.now() + maxWaitMs

		while (true) {
			const acquired = await this.client.set(lockKey, token, 'PX', this.ttlMs, 'NX')
			if (acquired === 'OK') {
				break
			}

			if (Date.now() >= deadline) {
				throw new Error(`Timed out waiting for distributed lock on "${key}" after ${maxWaitMs}ms`)
			}

			await new Promise(resolve => setTimeout(resolve, DEFAULT_RETRY_DELAY_MS))
		}

		try {
			return await fn()
		} finally {
			await this.client.eval(RELEASE_SCRIPT, 1, lockKey, token).catch(() => {
				// If release fails, the TTL still guarantees this lock frees itself
				// eventually, so we don't need to throw here and mask the real result.
			})
		}
	}
}

import type { IRedisCacheAdapter } from '../types.js'

// Same idea as redis-tcp.ts: type against the shape we actually use so this file
// compiles without @upstash/redis (or any other REST Redis client) installed.
interface RedisRestLike {
	get(key: string): Promise<string | null>
	set(key: string, value: string, opts?: { ex?: number }): Promise<unknown>
	del(key: string): Promise<unknown>
}

/**
 * Redis over plain HTTP/REST, the way Upstash (and similar serverless-friendly
 * providers) offer it. There's no persistent connection here, every call is its
 * own HTTP request, which means no pub/sub: nothing stays "subscribed" between
 * requests.
 *
 * To make cross-instance cache invalidation work anyway, every cached value carries
 * a `version` number. The cache manager compares the version it gets back from L2
 * against whatever it already has in L1, and treats a mismatch as a cache miss.
 * That's not instant like pub/sub, but it needs no open connection at all, which
 * fits the serverless/edge environments this mode is usually chosen for.
 */
export class RedisHttpCacheAdapter implements IRedisCacheAdapter {
	readonly mode = 'http' as const

	private readonly client: RedisRestLike

	constructor(client: RedisRestLike) {
		this.client = client
	}

	async get(key: string): Promise<{ value: string; version: number } | null> {
		const raw = await this.client.get(key)
		if (!raw) {
			return null
		}

		return JSON.parse(raw) as { value: string; version: number }
	}

	async set(key: string, value: string, version: number, ttlSeconds?: number): Promise<void> {
		const payload = JSON.stringify({ value, version })
		await this.client.set(key, payload, ttlSeconds ? { ex: ttlSeconds } : undefined)
	}

	async del(key: string): Promise<void> {
		await this.client.del(key)
	}

	// No subscribeInvalidation/publishInvalidation here on purpose. The cache
	// manager checks for their presence before calling them, so leaving them
	// undefined is how this adapter tells it "use version checking instead".

	async close(): Promise<void> {
		// REST clients don't hold a connection open, so there's nothing to release.
	}
}

/**
 * Convenience factory for Upstash's REST client. Any other REST-based Redis
 * client that exposes get/set/del with a compatible shape works too, just
 * construct RedisHttpCacheAdapter directly with it.
 */
export async function createRedisHttpCache(options: { url: string; token: string }): Promise<RedisHttpCacheAdapter> {
	const { Redis } = await import('@upstash/redis')
	const client = new Redis({ url: options.url, token: options.token })
	return new RedisHttpCacheAdapter(client as unknown as RedisRestLike)
}

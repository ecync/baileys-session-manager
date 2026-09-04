import type { IRedisCacheAdapter } from '../types.js'

const INVALIDATION_CHANNEL = 'baileys-auth:invalidate'

// We only need a handful of ioredis methods, so we type against that shape instead
// of importing ioredis' types directly, keeping this file compilable even when
// ioredis isn't installed at all.
interface RedisLike {
	get(key: string): Promise<string | null>
	set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>
	set(key: string, value: string): Promise<unknown>
	del(key: string): Promise<unknown>
	publish(channel: string, message: string): Promise<unknown>
	subscribe(channel: string): Promise<unknown>
	on(event: 'message', listener: (channel: string, message: string) => void): unknown
	quit(): Promise<unknown>
	duplicate(): RedisLike
}

/**
 * Redis over a real TCP connection (via ioredis). This is the mode that gets full
 * pub/sub cache invalidation, since a TCP connection can just stay open and listen.
 *
 * We store `value` and `version` together as one JSON string so a single GET gives
 * us everything we need, rather than two round trips per read.
 */
export class RedisTcpCacheAdapter implements IRedisCacheAdapter {
	readonly mode = 'tcp' as const

	private readonly client: RedisLike
	// Pub/sub requires its own dedicated connection in Redis, you can't subscribe
	// and run normal commands on the same connection at the same time.
	private subscriber: RedisLike | null = null

	constructor(client: RedisLike) {
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
		if (ttlSeconds) {
			await this.client.set(key, payload, 'EX', ttlSeconds)
		} else {
			await this.client.set(key, payload)
		}
	}

	async del(key: string): Promise<void> {
		await this.client.del(key)
	}

	async publishInvalidation(key: string): Promise<void> {
		await this.client.publish(INVALIDATION_CHANNEL, key)
	}

	async subscribeInvalidation(onMessage: (key: string) => void): Promise<void> {
		this.subscriber = this.client.duplicate()
		await this.subscriber.subscribe(INVALIDATION_CHANNEL)
		this.subscriber.on('message', (_channel, message) => onMessage(message))
	}

	async close(): Promise<void> {
		await this.subscriber?.quit().catch(() => {})
		await this.client.quit().catch(() => {})
	}

	/**
	 * Hands back the underlying ioredis client, used only by the distributed lock
	 * (RedisDistributedLock), which needs raw SET NX PX and EVAL access that the
	 * cache adapter interface itself doesn't expose.
	 */
	getRawClient(): RedisLike {
		return this.client
	}
}

/**
 * Convenience factory: builds a RedisTcpCacheAdapter from connection details using
 * ioredis, which is only imported here, lazily, so it stays an optional dependency.
 */
export async function createRedisTcpCache(options: { url?: string; host?: string; port?: number; password?: string } = {}): Promise<RedisTcpCacheAdapter> {
	const { default: IORedis } = await import('ioredis')
	const client = options.url ? new IORedis(options.url) : new IORedis(options)
	return new RedisTcpCacheAdapter(client as unknown as RedisLike)
}

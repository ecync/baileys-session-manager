# Caching

Redis is entirely optional. Skip it and every cache miss just falls through to your database (L1 in-memory only), which is fine for smaller deployments. Add it once you're running multiple instances and want cache hits shared across all of them, not just kept per process.

## The three levels

1. **L1, in-memory.** A `Map` inside your process (`src/cache/memory-cache.ts`), bounded by both entry count (`memoryMaxEntries`, default 5000) and approximate byte size (`memoryMaxBytes`, default 25 MB), with least-recently-used eviction once either limit is hit. Reads from here cost basically nothing.
2. **L2, Redis (optional).** One network hop, shared by every instance pointed at the same Redis.
3. **L3, your database.** The source of truth. Every write lands here no matter what.

A read checks L1, then L2, then L3, stopping at the first hit and backfilling the levels above it so the next read is faster. A write always goes to L3 first (that's the one that actually has to succeed), then updates L2 and L1.

## TCP mode (ioredis)

The normal way to run Redis: a persistent connection over the wire.

```ts
import { createRedisTcpCache, useHybridAuthState } from '@ecync/baileys-session-manager'

const redis = await createRedisTcpCache({ url: 'redis://localhost:6379' })

const { state, saveCreds } = await useHybridAuthState({
	sessionId: 'my-bot',
	adapter,
	cache: { redis }
})
```

TCP mode gets full pub/sub cache invalidation: after a write, the writing instance publishes a small invalidation message on a shared channel, and every other instance's cache manager (subscribed on its own dedicated connection, since Redis pub/sub needs a connection that isn't also running normal commands) is notified and drops the matching L1 entry immediately.

## HTTP / REST mode (Upstash and similar)

For serverless and edge environments that can't hold a persistent TCP connection open, Upstash (and compatible providers) offer Redis over plain HTTP.

```ts
import { createRedisHttpCache, useHybridAuthState } from '@ecync/baileys-session-manager'

const redis = await createRedisHttpCache({
	url: process.env.UPSTASH_REDIS_REST_URL!,
	token: process.env.UPSTASH_REDIS_REST_TOKEN!
})

const { state, saveCreds } = await useHybridAuthState({
	sessionId: 'my-bot',
	adapter,
	cache: { redis }
})
```

There's no persistent connection here, every call is its own HTTP request, which means no pub/sub is possible, nothing stays "subscribed" between requests. Instead, every cached value carries a `version` number (bumped on every database write). On a read, if L1 already has an entry, its version is checked against what L2 currently holds; a mismatch means some other instance wrote a newer value since, so the stale L1 entry is dropped and the newer value fetched instead. This isn't instant the way pub/sub is, but it needs no open connection at all, which is exactly the trade-off serverless environments are already making.

## Tuning

```ts
cache: {
	memoryTtlMs: 30_000,       // how long an L1 entry lives before the background sweep clears it
	memoryMaxEntries: 5_000,   // LRU eviction once this many entries are cached
	memoryMaxBytes: 25 * 1024 * 1024, // LRU eviction once this many bytes are cached
	redis                        // omit entirely to run L1-only
}
```

See [Performance and memory management](./performance.md) for why the eviction and sweep behavior is designed the way it is.

## Failure behavior

A Redis failure (a momentary connection drop, say) on a cache read or write is logged through your provided logger and swallowed, not thrown. A cache miss just falls back to the database, it's not data loss, so there's no reason to fail the whole operation over it. See [Error handling and retries](./error-handling.md) for the distinction between that and how database failures are handled.

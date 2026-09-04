# Concurrency and locking

If two server processes try to write the same session at the same time (two pods behind a load balancer, a serverless function that scaled out mid-write), something needs to stop them from corrupting each other's writes. Which mechanism gets used is picked automatically based on your configuration, you don't configure this yourself.

## Local mutex (default, no TCP Redis)

`src/lock/mutex-lock.ts`, one `async-mutex` per session id, created lazily and reused. This is the same idea `useMultiFileAuthState` uses for its own file locks. It protects a single process from racing itself (two async calls inside the same Node process both trying to write the same session), which is enough if you're only ever running one instance.

This is the fallback whenever you haven't configured a TCP Redis cache, including when you're running HTTP/REST Redis (Upstash) instead, since a distributed lock built the way this one is needs `EVAL` support, which HTTP-mode Redis clients don't expose the same way.

## Distributed lock (TCP Redis configured)

`src/lock/redis-lock.ts`. The moment you hand `useHybridAuthState` a TCP Redis cache (`cache: { redis: await createRedisTcpCache(...) }`), it automatically switches to a real distributed lock instead:

- **Acquire**: `SET key value NX PX <ttl>`, atomic, only succeeds if nobody else currently holds the lock.
- **Release**: a small Lua script that only deletes the key if it's still set to the value this process wrote, atomic, so a slow operation whose lock already expired can't accidentally delete a lock some other, newer operation has since legitimately acquired.

This is the classic single-node Redlock pattern. It's what actually protects a session across multiple server processes, not just within one.

## What's actually locked

Every write, whether a batched `keys.set` flush or `saveCreds()`, acquires the lock for that `sessionId` before touching the database, and releases it once the write (and the corresponding cache update) completes. Reads are not locked, they don't need to be, a read racing a write just means you might see the value slightly before or after the write lands, which is normal, expected behavior for any concurrent system, not a correctness problem.

## Tuning

The distributed lock's TTL defaults to 10 seconds (long enough to cover a slow write plus retries, short enough that a crashed process holding a lock doesn't block everyone else for long). If you construct `RedisDistributedLock` directly rather than letting `useHybridAuthState` wire it up, you can pass a different TTL, most consumers never need to.

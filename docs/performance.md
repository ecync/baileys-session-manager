# Performance and memory management

Baileys calls into `keys.get`/`keys.set` constantly, every message can touch sender keys, pre-keys, and sessions. This package is built to never block the event loop and to keep memory bounded no matter how long a process runs.

## Writes are batched

`keys.set` can already receive many key updates in a single call from Baileys (it groups them by category itself). Those get written to your database as one bulk operation (`setMany` on the adapter) instead of one call per key, see each [adapter's page](./adapters/overview.md) for exactly how that batching looks for that backend.

On top of that, rapid separate calls, several `saveCreds()` calls firing within a few milliseconds of each other, which happens a lot during pairing when multiple creds fields update almost at once, are coalesced by a short debounce window (`src/utils/write-batcher.ts`) before anything is written. Ten updates in a burst become one database write, not ten.

```ts
await useHybridAuthState({
	sessionId: 'my-bot',
	adapter,
	writeDebounceMs: 100 // default is 50, set to 0 for immediate, unbatched writes
})
```

The batcher is built on `p-queue` with `concurrency: 1` per session, so flushes for a given session always land in order, a flush never starts before the previous one finished, which keeps "last write wins" semantics predictable even under load.

## SQLite runs off the main thread

`better-sqlite3` is deliberately synchronous, which is normally a nice property (no callback soup), but a synchronous call blocks Node's single event loop thread for however long it takes. `SqliteAdapter` runs its actual database calls inside a dedicated `worker_threads` worker, so a slow query never stalls whatever else your process is doing, handling other WhatsApp connections, serving HTTP requests. See [the SQLite adapter page](./adapters/sqlite.md) for the detail. Every other adapter's underlying driver (`pg`, `mysql2`, `mongodb`, `firebase-admin`) is natively async already, so they don't need this.

## The in-memory cache is bounded, not just TTL'd

L1 (`src/cache/memory-cache.ts`) tracks both entry count (`memoryMaxEntries`, default 5000) and approximate byte size (`memoryMaxBytes`, default 25 MB), evicting the least recently used entries first once either limit is hit, that's an actual LRU, not just a size cap that stops accepting new entries. Expired entries are cleared by one shared, `unref()`'d sweep interval instead of a timer per key, so a long-running process touching thousands of sessions over weeks doesn't slowly leak timers or memory. The sweep interval itself scales with your configured TTL (clamped between 50ms and 5000ms), a short TTL sweeps often, a long one rarely, so the overhead stays proportionate.

## Concurrency is capped, not unbounded

Operations that fan out across many keys, `keys.get` fetching several ids at once, or `sessionManager.exportSession()`/`getSessionInfo()` reading every key for a session, are limited to a configurable number of simultaneous database calls (`concurrency`, default 10, using `p-limit`), so a session with hundreds of pre-keys doesn't exhaust your connection pool.

```ts
await useHybridAuthState({
	sessionId: 'my-bot',
	adapter,
	concurrency: 20 // default is 10
})
```

## Large exports stream instead of loading everything into memory

`sessionManager.exportSession()` returns an async iterable, values come out one at a time, so backing up a session with thousands of keys doesn't require holding the whole thing in RAM at once:

```ts
for await (const [key, value] of sessionManager.exportSession()) {
	// write each pair somewhere, one at a time
}
```

`sessionManager.exportSessionToObject()` is a convenience wrapper around the same iterable for the common case of a small session where a plain object is easier to work with. See [Session management API](./session-management.md) for the rest of what's available.

## Retention pruning is also bounded

The opt-in [key retention feature](./key-retention-and-cleanup.md) reuses the same batched `getMany`/`deleteMany` calls every other operation does, a prune pass doesn't issue one database call per key.

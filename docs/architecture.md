# Architecture

```
                          ┌─────────────────────────┐
   Baileys keys.get/set   │   useHybridAuthState()   │
  ───────────────────────▶│                          │
                          └────────────┬─────────────┘
                                       │
                     ┌─────────────────┼─────────────────┐
                     │           encode / decode          │
                     │       (AES-256-GCM, if enabled)     │
                     └─────────────────┬─────────────────┘
                                       │
                          ┌────────────▼─────────────┐
                          │       CacheManager        │
                          │                            │
                          │  L1  in-memory (per process)
                          │  L2  Redis (optional, shared)
                          │  L3  your database (source of truth)
                          └────────────┬─────────────┘
                                       │
                          ┌────────────▼─────────────┐
                          │       IDatabaseAdapter     │
                          │  Mongo / Postgres / MySQL  │
                          │  SQLite / D1 / Firebase    │
                          └───────────────────────────┘
```

## The read path

A call to `keys.get(type, ids)` (Baileys asking for one or more signal keys, or the initial creds load) walks down through the levels and stops at the first hit:

1. **L1, in-memory.** A bounded `Map` inside your process. If the value is here, it comes back essentially for free, no network hop, no extra work.
2. **L2, Redis (optional).** One network round trip, shared by every instance of your app pointed at the same Redis. Skipped entirely if you didn't configure a cache.
3. **L3, your database.** The source of truth. Whatever comes back here gets written back up into L2 and L1 before the value is returned, so the next read for the same key is faster.

See [Caching](./caching.md) for the full detail on how cross-instance invalidation works, since that's the genuinely tricky part of a multi-level cache.

## The write path

A call to `keys.set(data)` or `saveCreds()` goes the other direction, database first:

1. The value is serialized (Baileys' own `BufferJSON` format, so `Buffer`/`Uint8Array` values round-trip correctly) and, if encryption is enabled, encrypted, see [Encryption at rest](./encryption.md).
2. Multiple values arriving close together (either in one `keys.set` call, which Baileys already batches by category, or across several rapid separate calls) are coalesced by a short debounce window before anything is written, see [Performance](./performance.md) for why and how to tune it.
3. The actual write is wrapped in a lock, either a local mutex or a Redis-backed distributed lock depending on your setup, see [Concurrency and locking](./concurrency-and-locking.md), so two processes can't corrupt the same session by writing at the same time.
4. Once the database write succeeds, L2 and L1 are updated (and, in TCP Redis mode, an invalidation message is published so other instances drop their own stale L1 entry).

A database write failure is not swallowed, Baileys expects `keys.set` to actually persist, so an error here propagates all the way back to the caller after the configured retries are exhausted (see [Error handling and retries](./error-handling.md)). A cache-layer failure (say, a momentary Redis hiccup) is logged and swallowed instead, since the database write already succeeded and a stale cache entry just means falling back to L3 on the next read, not lost data.

## Deletion

Baileys itself drives most deletion: an identity key change or a PN-to-LID JID migration makes Baileys call `keys.set({ category: { [id]: null } })`, which this package detects (a falsy value in the `set` payload) and routes straight to the adapter's `deleteMany` plus a cache invalidation for each key, no configuration needed. On top of that, an opt-in, time-based safety net exists for stale entries Baileys never explicitly nulls out, see [Key retention and cleanup](./key-retention-and-cleanup.md).

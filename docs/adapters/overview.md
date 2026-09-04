# Adapters overview

Every backend this package supports implements the same interface, `IDatabaseAdapter` (defined in `src/types.ts`), which is what makes switching backends a one-line change: build a different adapter, hand it to the same `useHybridAuthState` call, everything else stays identical.

```ts
interface IDatabaseAdapter {
	readonly name: string
	init(): Promise<void>
	get(sessionId: string, key: string): Promise<SessionRecord | null>
	getMany(sessionId: string, keys: string[]): Promise<Map<string, SessionRecord>>
	set(sessionId: string, key: string, value: string): Promise<void>
	setMany(sessionId: string, entries: Array<{ key: string; value: string }>): Promise<void>
	delete(sessionId: string, key: string): Promise<void>
	deleteMany(sessionId: string, keys: string[]): Promise<void>
	getAllKeys(sessionId: string): Promise<string[]>
	deleteSession(sessionId: string): Promise<void>
	listSessions(): Promise<string[]>
	sessionExists(sessionId: string): Promise<boolean>
	close(): Promise<void>
}
```

Every built-in adapter extends `BaseAdapter` (`src/adapters/base-adapter.ts`), which provides a shared `withRetry` helper (exponential backoff around every database call, see [Error handling and retries](../error-handling.md)) so individual adapters only need to implement the actual database calls, not their own resilience logic.

## Per-backend pages

- [MongoDB](./mongodb.md)
- [PostgreSQL](./postgres.md)
- [MySQL / MariaDB](./mysql.md)
- [SQLite](./sqlite.md)
- [Cloudflare D1](./cloudflare-d1.md)
- [Firebase Realtime Database](./firebase-realtime-database.md)
- [Firestore](./firestore.md)

## Writing your own adapter

Not on the list? Implement `IDatabaseAdapter` yourself. The SQL adapters (`postgres-adapter.ts`, `mysql-adapter.ts`, `sqlite-adapter.ts`) all share the same table shape, which is a reasonable template to start from if your backend also speaks SQL:

```sql
CREATE TABLE IF NOT EXISTS baileys_sessions (
	session_id TEXT NOT NULL,
	key TEXT NOT NULL,
	value TEXT NOT NULL,
	updated_at BIGINT NOT NULL,
	version INTEGER NOT NULL DEFAULT 1,
	PRIMARY KEY (session_id, key)
)
```

A few things every adapter needs to get right, since the rest of the package depends on them:

- `setMany` should be a real batched write (one bulk `INSERT`/`bulkWrite`/`WriteBatch`, not a loop calling `set` once per entry), this is what turns a burst of key updates into one round trip instead of many, see [Performance](../performance.md).
- `version` should increment on every write to the same `(sessionId, key)` pair. It's used by the HTTP-mode Redis cache to detect a stale L1 entry, see [Caching](../caching.md).
- `getAllKeys` and `listSessions` back the session management API (export, `getSessionInfo`, `pruneExpiredKeys`), they need to be correct, not just fast.

If you write an adapter for a backend not covered here, consider [opening a pull request](../../CONTRIBUTING.md), that's exactly the kind of contribution this project welcomes.

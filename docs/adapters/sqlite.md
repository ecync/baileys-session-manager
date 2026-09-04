# SQLite

```bash
npm install better-sqlite3
```

```ts
import { SqliteAdapter, useHybridAuthState } from '@ecync/baileys-session-manager'

const adapter = new SqliteAdapter('./sessions.sqlite')

const { state, saveCreds } = await useHybridAuthState({ sessionId: 'my-bot', adapter })
```

Good for a single-server deployment where you'd rather not run a separate database service at all.

## Why this adapter looks different internally

`better-sqlite3` is deliberately synchronous, no callbacks, no promises, just a fast blocking call. That's normally a nice property, but a synchronous call blocks Node's single event loop thread for however long it takes, and Baileys reads keys constantly. Blocking the whole process on every SQLite query would stall everything else it's doing, handling other WhatsApp connections, serving HTTP requests, whatever else shares that process.

To avoid that, `SqliteAdapter` runs `better-sqlite3` inside a dedicated `worker_threads` worker (`src/adapters/sqlite-worker.ts`), spawned once and reused for the adapter's lifetime. The adapter itself just sends messages to that worker and awaits a response, the actual blocking call happens on a separate thread, so your main thread stays free. See [Performance](../performance.md) for the same reasoning applied to writes generally.

This is the one adapter with an unusual escape hatch in its constructor:

```ts
new SqliteAdapter(filename, logger?, retryOptions?, workerPath?)
```

`workerPath` overrides where the adapter looks for its compiled worker file, most consumers never need this, it exists for unusual bundling setups (and for this package's own test suite, which points it at a freshly built worker file explicitly rather than relying on the auto-detected "next to this file" default).

## How it stores data

Same table shape the other SQL adapters use:

```sql
CREATE TABLE IF NOT EXISTS baileys_sessions (
	session_id TEXT NOT NULL,
	key TEXT NOT NULL,
	value TEXT NOT NULL,
	updated_at INTEGER NOT NULL,
	version INTEGER NOT NULL DEFAULT 1,
	PRIMARY KEY (session_id, key)
)
```

WAL journal mode is enabled automatically for better concurrent read/write behavior. Batched writes run inside one `better-sqlite3` transaction.

## Notes

- `adapter.close()` terminates the worker thread cleanly, call it on shutdown.

See [Choosing a database](./overview.md) for the shared `IDatabaseAdapter` contract every backend implements the same way.

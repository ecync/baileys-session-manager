# PostgreSQL

```bash
npm install pg
```

```ts
import { PostgresAdapter, useHybridAuthState } from '@acync/baileys-session-manager'

const adapter = new PostgresAdapter({
	connectionString: process.env.DATABASE_URL
})

const { state, saveCreds } = await useHybridAuthState({ sessionId: 'my-bot', adapter })
```

You can also pass a second `pool` object with any extra `pg.Pool` options (`max`, `ssl`, and so on):

```ts
const adapter = new PostgresAdapter({
	connectionString: process.env.DATABASE_URL,
	pool: { max: 10, ssl: { rejectUnauthorized: false } }
})
```

## How it stores data

Creates a `baileys_sessions` table on `init()` if it doesn't already exist:

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

Batched writes use one `INSERT ... VALUES (...), (...), ...` statement with an `ON CONFLICT (session_id, key) DO UPDATE`, so a burst of key updates is one round trip, not N.

## Notes

- Works against any Postgres-compatible service: RDS, Supabase, Neon, Railway, a plain local instance.
- Uses a `pg.Pool`, connections are managed for you, call `adapter.close()` on shutdown to drain the pool cleanly.

See [Choosing a database](./overview.md) for the shared `IDatabaseAdapter` contract every backend implements the same way.

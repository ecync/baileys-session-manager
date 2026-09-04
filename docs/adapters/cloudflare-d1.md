# Cloudflare D1

D1 only exists as a binding inside a Cloudflare Worker, there's no standalone Node client for it the way there is for a normal database. Nothing to `npm install` beyond the base package, you hand the adapter the `D1Database` binding straight from your Worker's `env`.

```ts
import { CloudflareD1Adapter, useHybridAuthState } from '@ecync/baileys-session-manager'

export default {
	async fetch(request: Request, env: { DB: D1Database }) {
		const adapter = new CloudflareD1Adapter(env.DB)
		const { state, saveCreds } = await useHybridAuthState({ sessionId: 'my-bot', adapter })

		// ... use state/saveCreds
	}
}
```

## How it stores data

Same table shape as the other SQL adapters. Batched writes go through D1's `batch()`, which runs every statement in one implicit transaction, the closest equivalent D1 has to the multi-row `INSERT` the Postgres/MySQL adapters use.

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

## Notes

- `adapter.close()` is a no-op here on purpose, D1 bindings are managed entirely by the Workers runtime, there's no connection on your side to close.
- Type your Worker's `env` however you normally do, `D1Database`/`D1PreparedStatement` are re-exported from this package (`import type { D1Database } from '@ecync/baileys-session-manager'`) as a lightweight alternative to depending on `@cloudflare/workers-types` just for this.

See [Choosing a database](./overview.md) for the shared `IDatabaseAdapter` contract every backend implements the same way.

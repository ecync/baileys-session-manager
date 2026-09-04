# MySQL / MariaDB

```bash
npm install mysql2
```

```ts
import { MysqlAdapter, useHybridAuthState } from '@acync/baileys-session-manager'

const adapter = new MysqlAdapter({
	host: 'localhost',
	user: 'root',
	password: 'secret',
	database: 'whatsapp'
})

const { state, saveCreds } = await useHybridAuthState({ sessionId: 'my-bot', adapter })
```

The constructor's first argument is passed straight through to `mysql2/promise`'s `createPool`, so any pool option that library accepts works here too (`connectionLimit`, `ssl`, and so on).

## How it stores data

Same table shape as the Postgres adapter, using `INSERT ... ON DUPLICATE KEY UPDATE` for upserts:

```sql
CREATE TABLE IF NOT EXISTS baileys_sessions (
	session_id VARCHAR(255) NOT NULL,
	`key` VARCHAR(255) NOT NULL,
	value LONGTEXT NOT NULL,
	updated_at BIGINT NOT NULL,
	version INT NOT NULL DEFAULT 1,
	PRIMARY KEY (session_id, `key`)
)
```

## Notes

- Works against MySQL and MariaDB alike, anything `mysql2` supports.
- Uses a connection pool, call `adapter.close()` on shutdown to drain it cleanly.

See [Choosing a database](./overview.md) for the shared `IDatabaseAdapter` contract every backend implements the same way.

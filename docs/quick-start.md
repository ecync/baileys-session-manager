# Quick start (SQLite)

SQLite needs no external service, so it's the fastest way to see the whole package working end to end. Once this makes sense, switching to any other backend is a one-line change, see [Choosing a database](./adapters/overview.md).

## 1. Install

```bash
npm install @ecync/baileys-session-manager baileys better-sqlite3
```

## 2. Wire it up

```ts
import { makeWASocket } from 'baileys'
import { useHybridAuthState, SqliteAdapter } from '@ecync/baileys-session-manager'

const adapter = new SqliteAdapter('./sessions.sqlite')

const { state, saveCreds, sessionManager, close } = await useHybridAuthState({
	sessionId: 'my-bot',
	adapter
})

const sock = makeWASocket({ auth: state })
sock.ev.on('creds.update', saveCreds)

// Anything from the session management API is available right away too.
console.log(await sessionManager.listSessions())

// When your process shuts down, close() stops any background timers this
// package started (like a retention auto-run, if you configured one) and
// flushes any pending write. It does not close your adapter, that's still
// yours to close (adapter.close()) since you own its connection/handle.
process.on('SIGINT', async () => {
	await close()
	await adapter.close()
	process.exit(0)
})
```

That's the whole shape every backend follows: build an adapter, hand it to `useHybridAuthState` along with a `sessionId`, wire `state` and `saveCreds` into Baileys exactly the way you would with `useMultiFileAuthState`. Everything else (the database, caching, encryption, locking) is configuration, not code you write yourself.

## 3. What you get back

| Field | What it is |
| --- | --- |
| `state` | The `AuthenticationState` Baileys expects: `{ creds, keys }`. Pass it straight into `makeWASocket({ auth: state })`. |
| `saveCreds` | Call this from `sock.ev.on('creds.update', saveCreds)`, exactly like `useMultiFileAuthState`. |
| `sessionManager` | List/inspect/delete/export/import sessions. See [Session management API](./session-management.md). |
| `close` | Stops background timers and flushes pending writes on shutdown. Doesn't touch your adapter's own connection. |

## Next steps

- [Architecture](./architecture.md) for how a read/write actually flows through the caching and locking layers.
- [Choosing a database](./adapters/overview.md) to switch to Mongo, Postgres, MySQL, D1, or Firebase.
- [Encryption at rest](./encryption.md) if you want your stored credentials to be ciphertext, not plaintext JSON.

# Migrating from useMultiFileAuthState

## The swap

```ts
// Before
import { useMultiFileAuthState } from 'baileys'
const { state, saveCreds } = await useMultiFileAuthState('./auth')

// After
import { useHybridAuthState, SqliteAdapter } from '@ecync/baileys-session-manager'
const adapter = new SqliteAdapter('./auth.sqlite')
const { state, saveCreds } = await useHybridAuthState({ sessionId: 'my-bot', adapter })
```

Everything downstream stays exactly the same:

```ts
const sock = makeWASocket({ auth: state })
sock.ev.on('creds.update', saveCreds)
```

Once that's working, swapping `SqliteAdapter` for any other backend (`MongoAdapter`, `PostgresAdapter`, and so on) is a one-line change, see [Choosing a database](./adapters/overview.md).

## Bringing an existing file-based session across

`useMultiFileAuthState`'s folder holds one file per key: `creds.json`, plus `<category>-<id>.json` for every signal key (with `/` replaced by `__` and `:` replaced by `-` in filenames, see the file-naming logic in Baileys' own `useMultiFileAuthState`). To migrate an existing session:

1. Read every file in the folder.
2. For each, recover the original key name (reverse the filename escaping: `__` back to `/`, the trailing `-<n>` back to `:<n>` where that applies, `creds.json` maps to the key `creds`).
3. Read each file's JSON content as a plain string (don't re-parse/re-serialize it, the stored format is already Baileys' own `BufferJSON`-encoded JSON, which is exactly what this package expects too).
4. Build a `{ key: value }` map and call `sessionManager.importSession(sessionId, thatMap)`.

```ts
import { readFile, readdir } from 'fs/promises'
import { join } from 'path'

const folder = './old-auth-folder'
const files = await readdir(folder)
const data: Record<string, string> = {}

for (const file of files) {
	const key = file.replace(/\.json$/, '').replace(/__/g, '/')
	data[key] = await readFile(join(folder, file), 'utf-8')
}

await sessionManager.importSession('my-bot', data)
```

Double-check a handful of keys came across correctly (`creds` at minimum) before deleting the old folder. `importSession` also busts the cache for that session, so a fresh `useHybridAuthState` call afterward reads the newly imported data, not anything stale.

## What doesn't change

- The shape of `state` (`{ creds, keys }`) and how you wire it into Baileys.
- How Baileys itself decides to delete stale signal keys (identity key changes, PN-to-LID migration), that already flows through automatically on both the old and new setup, see [Architecture](./architecture.md#deletion).

## What's new that you might want to turn on

- [Encryption at rest](./encryption.md), the plain file-based version stores everything as readable JSON on disk.
- [Redis caching](./caching.md), if you're running more than one instance.
- [Key retention and cleanup](./key-retention-and-cleanup.md), an opt-in safety net for stale entries.

# Session management API

Every call to `useHybridAuthState` returns a `sessionManager` alongside `state`/`saveCreds`, covering everything beyond the live auth state itself.

```ts
const { sessionManager } = await useHybridAuthState({ sessionId: 'my-bot', adapter })
```

## `listSessions(): Promise<string[]>`

Every session id currently in storage, across the whole database, not just the one this `sessionManager` was built for.

```ts
await sessionManager.listSessions()
// => ['my-bot', 'my-other-bot']
```

## `getSessionInfo(sessionId?): Promise<SessionInfo | null>`

A lightweight look at one session without loading its full auth state. Returns `null` if the session doesn't exist.

```ts
await sessionManager.getSessionInfo('my-bot')
// => { sessionId: 'my-bot', keys: ['creds', 'pre-key-1', 'session-...'], updatedAt: 1735000000000 }
```

`updatedAt` is the most recent write across every key in the session, not a single dedicated column (most backends don't have one cheaply available), so this does a light, concurrency-limited read across the session's keys rather than a full table scan.

## `sessionExists(sessionId?): Promise<boolean>`

## `deleteSession(sessionId?): Promise<void>`

Wipes every database row for the session and clears its entries from the cache. Irreversible, there's no soft-delete.

## `exportSession(sessionId?): AsyncIterable<[key: string, value: string]>`

Streams every key/value pair, low memory even for a session with thousands of keys, nothing builds up a giant object in memory. If [encryption](./encryption.md) is enabled, values come back exactly as stored, still ciphertext, which is what you want for a backup: it can sit in a file or another database without exposing raw credentials, and only becomes readable again through `useHybridAuthState` with the matching key.

```ts
for await (const [key, value] of sessionManager.exportSession('my-bot')) {
	// write each pair somewhere
}
```

## `exportSessionToObject(sessionId?): Promise<Record<string, string>>`

A convenience wrapper around `exportSession` for the common case of a small session where a plain object is easier to work with than a stream.

## `importSession(sessionId, data): Promise<void>`

Writes a previously exported session (or a hand-built `{ key: value }` map) into the given session id, and busts that session's cache entries so subsequent reads see the imported data immediately.

```ts
const backup = await sessionManager.exportSessionToObject('my-bot')
await sessionManager.importSession('my-bot-restored', backup)
```

## `clearCache(sessionId?): Promise<void>`

Manually busts the cache. Useful after writing to the database through some other path (a migration script, a manual fix in a DB console) that this package's own write path wouldn't otherwise know to invalidate. Omit `sessionId` to clear every session's cache at once.

## `pruneExpiredKeys(sessionId?): Promise<{ prunedKeys: string[] }>`

Runs one pass of the opt-in, time-based key cleanup. A no-op unless [key retention](./key-retention-and-cleanup.md) was explicitly enabled when the session was set up, calling this manually doesn't bypass that.

```ts
const { prunedKeys } = await sessionManager.pruneExpiredKeys()
```

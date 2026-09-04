# MongoDB

```bash
npm install mongodb
```

```ts
import { MongoAdapter, useHybridAuthState } from '@acync/baileys-session-manager'

const adapter = new MongoAdapter({
	uri: process.env.MONGO_URI ?? 'mongodb://localhost:27017',
	dbName: 'whatsapp' // optional, defaults to whatever's in your connection string
})

const { state, saveCreds } = await useHybridAuthState({ sessionId: 'my-bot', adapter })
```

## How it stores data

One `baileys_sessions` collection, with a compound unique index on `(sessionId, key)` created automatically the first time `init()` runs. Batched writes (`setMany`, used whenever several keys update together) go through `bulkWrite`, so a burst of signal key updates costs one round trip to Mongo, not one per key.

## Notes

- `MongoClient` connects once during `init()` and is reused for the lifetime of the adapter, call `adapter.close()` when your process shuts down to release it cleanly.
- Works against any MongoDB-compatible service: Atlas, a self-hosted replica set, a local instance, whatever you're already running.

See [Choosing a database](./overview.md) for the shared `IDatabaseAdapter` contract every backend implements the same way.

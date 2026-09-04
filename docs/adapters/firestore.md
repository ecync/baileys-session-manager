# Firestore

```bash
npm install firebase-admin
```

```ts
import { FirestoreAdapter, useHybridAuthState } from '@acync/baileys-session-manager'

const adapter = new FirestoreAdapter()

const { state, saveCreds } = await useHybridAuthState({ sessionId: 'my-bot', adapter })
```

Same Firebase Admin initialization requirement as the [Realtime Database adapter](./firebase-realtime-database.md), an `admin.initializeApp(...)` call needs to have already run somewhere in your process. Pass `appName` if you're running more than one Firebase app.

## How it stores data

One `baileys_sessions` collection, one document per `(sessionId, key)` pair (document id `${sessionId}__${key}`, slashes escaped since they're not valid in a Firestore document id), with `sessionId` also stored as a field so `listSessions`/`deleteSession`/`getAllKeys` can query by it.

Batched writes go through Firestore's `WriteBatch`, which commits up to 500 operations atomically in a single call.

## Notes

- `adapter.close()` intentionally doesn't tear down the shared `firebase-admin` app, same reasoning as the Realtime Database adapter.

See [Choosing a database](./overview.md) for the shared `IDatabaseAdapter` contract every backend implements the same way.

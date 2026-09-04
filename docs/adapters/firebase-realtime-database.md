# Firebase Realtime Database

```bash
npm install firebase-admin
```

```ts
import { FirebaseRealtimeAdapter, useHybridAuthState } from '@ecync/baileys-session-manager'

const adapter = new FirebaseRealtimeAdapter({
	databaseURL: 'https://your-project.firebaseio.com'
})

const { state, saveCreds } = await useHybridAuthState({ sessionId: 'my-bot', adapter })
```

Make sure `firebase-admin` is already initialized with credentials somewhere in your process (the usual `admin.initializeApp(...)` call with a service account), or pass `appName` to point this adapter at a specific named app if you're running more than one:

```ts
const adapter = new FirebaseRealtimeAdapter({ databaseURL: '...', appName: 'my-bot-app' })
```

## How it stores data

Everything lives under `/baileys_sessions/{sessionId}/{key}`, path-based, which makes "delete a whole session" and "list keys for a session" both cheap, single-path operations rather than a filtered query. Session/key strings are escaped where needed, since RTDB paths can't contain `.`, `#`, `$`, `[`, `]`, or `/`.

Batched writes use RTDB's multi-path update (one call updating several paths at once under a common ancestor), so a burst of key updates is one network round trip.

## Notes

- `adapter.close()` intentionally doesn't tear down the shared `firebase-admin` app, since other code in your process may still be using it.

See [Choosing a database](./overview.md) for the shared `IDatabaseAdapter` contract every backend implements the same way.

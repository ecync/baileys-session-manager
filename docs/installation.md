# Installation

```bash
npm install @acync/baileys-session-manager baileys
```

`@acync/baileys-session-manager` only ever bundles logic, never database drivers. Every driver is an optional peer dependency, lazily imported inside the one adapter that needs it, so `npm install` stays light and you only add the driver for the backend you actually chose.

| Backend | Install this too |
| --- | --- |
| MongoDB | `npm install mongodb` |
| PostgreSQL | `npm install pg` |
| MySQL / MariaDB | `npm install mysql2` |
| SQLite | `npm install better-sqlite3` |
| Cloudflare D1 | nothing, it's a Worker binding, see [the D1 adapter page](./adapters/cloudflare-d1.md) |
| Firebase Realtime Database | `npm install firebase-admin` |
| Firestore | `npm install firebase-admin` |
| Redis over TCP | `npm install ioredis` |
| Redis over HTTP (Upstash) | `npm install @upstash/redis` |

If you try to use an adapter whose driver isn't installed, you get a normal "Cannot find module" error the moment you call that adapter's `init()`, not some cryptic failure buried somewhere else. Nothing is imported until you actually construct and initialize that specific adapter, so having, say, `pg` installed doesn't pull `mongodb` in behind the scenes or vice versa.

## Node version

This package targets Node 18 and newer (see `engines` in `package.json`). Everything here is native ESM with a CommonJS build alongside it, see the [API reference](./api-reference.md) for how the two builds are exposed.

## Next step

[Quick start (SQLite)](./quick-start.md) walks through getting a working session end to end with no external service required.

# @ecync/baileys-session-manager

[![CI](https://github.com/ecync/baileys-session-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/ecync/baileys-session-manager/actions/workflows/ci.yml)
[![Publish to npm](https://github.com/ecync/baileys-session-manager/actions/workflows/publish.yml/badge.svg)](https://github.com/ecync/baileys-session-manager/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/@ecync/baileys-session-manager.svg)](https://www.npmjs.com/package/@ecync/baileys-session-manager)
[![npm downloads](https://img.shields.io/npm/dm/@ecync/baileys-session-manager.svg)](https://www.npmjs.com/package/@ecync/baileys-session-manager)
[![License: MIT](https://img.shields.io/npm/l/@ecync/baileys-session-manager.svg)](./LICENSE)

A drop-in replacement for [Baileys'](https://github.com/WhiskeySockets/Baileys) `useMultiFileAuthState`, built for production instead of a single bot on a single machine.

Baileys ships with `useMultiFileAuthState`, which writes your WhatsApp session (creds and signal keys) to JSON files on local disk. That's great for getting started, but it falls apart the moment you need more than one server, want your session backed by a real database, or care about what happens if someone gets read access to your disk. This package solves all of that: pick a database, optionally add Redis caching, optionally encrypt everything at rest, and you get back the same `{ state, saveCreds }` shape Baileys already expects, plus a full session management API on top.

See [Baileys' own session management docs](https://baileys.wiki/authentication/session-management) for background on how auth state works in Baileys itself.

## Why this exists

`useMultiFileAuthState` is fine for a hobby bot. It stops being fine the moment any of these are true for you:

- You're running more than one server process (or container, or a serverless function that scales out), and they all need to see the same session.
- You want the session stored somewhere durable and backed up, not sitting in a folder on one machine's disk.
- Baileys reads your keys constantly, and hammering a database directly for every one of those reads gets expensive and slow.
- You'd rather not have raw WhatsApp credentials sitting in plaintext in your database.
- Two processes writing the same session at the same time can corrupt it, and nothing in the file-based version stops that from happening across machines.

This package addresses each of those: a pluggable database adapter so you can pick whatever you already run, an optional two-level cache (in-memory plus Redis) so reads stay fast, AES-256-GCM encryption at rest, and a distributed lock so concurrent writes from different processes don't race.

## Installation

```bash
npm install @ecync/baileys-session-manager baileys
```

Every database driver is an optional peer dependency, install the one for whichever backend you're using, see [Installation](./docs/installation.md) for the full table.

## Quick start

```ts
import { makeWASocket } from 'baileys'
import { useHybridAuthState, SqliteAdapter } from '@ecync/baileys-session-manager'

const adapter = new SqliteAdapter('./sessions.sqlite')

const { state, saveCreds, sessionManager } = await useHybridAuthState({
	sessionId: 'my-bot',
	adapter
})

const sock = makeWASocket({ auth: state })
sock.ev.on('creds.update', saveCreds)
```

That's the whole shape every backend follows: build an adapter, hand it to `useHybridAuthState` along with a `sessionId`, wire `state`/`saveCreds` into Baileys exactly like `useMultiFileAuthState`. Full walkthrough (including graceful shutdown): [Quick start](./docs/quick-start.md).

## What's included

| Feature | Docs |
| --- | --- |
| 7 database backends (Mongo, Postgres, MySQL, SQLite, Cloudflare D1, Firebase Realtime DB, Firestore) | [Adapters overview](./docs/adapters/overview.md) |
| Multi-level cache (in-memory + Redis, TCP or HTTP/Upstash) | [Caching](./docs/caching.md) |
| AES-256-GCM encryption at rest | [Encryption](./docs/encryption.md) |
| Local mutex / Redis distributed locking | [Concurrency and locking](./docs/concurrency-and-locking.md) |
| Batched writes, worker-thread SQLite, bounded LRU cache, streamed exports | [Performance](./docs/performance.md) |
| Opt-in, category-scoped auto-expiry for stale signal keys | [Key retention and cleanup](./docs/key-retention-and-cleanup.md) |
| List / inspect / delete / export / import sessions | [Session management API](./docs/session-management.md) |
| Retry with exponential backoff, swallowed cache failures vs. propagated database failures | [Error handling](./docs/error-handling.md) |

## Documentation

Full reference lives in [`docs/`](./docs/README.md):

- [Installation](./docs/installation.md) · [Quick start](./docs/quick-start.md) · [Architecture](./docs/architecture.md)
- [Adapters](./docs/adapters/overview.md) (one page per backend)
- [Caching](./docs/caching.md) · [Encryption](./docs/encryption.md) · [Concurrency and locking](./docs/concurrency-and-locking.md)
- [Performance](./docs/performance.md) · [Key retention and cleanup](./docs/key-retention-and-cleanup.md)
- [Session management API](./docs/session-management.md) · [Error handling](./docs/error-handling.md)
- [Full API reference](./docs/api-reference.md) · [Migrating from useMultiFileAuthState](./docs/migration-from-file-auth-state.md)

## Testing this package

```bash
npm install
npm test           # builds first (needed for the SQLite worker thread), then runs the suite
```

Vitest, see [CONTRIBUTING.md](./CONTRIBUTING.md) for the full local setup and what's expected before opening a pull request.

## Contributing

Bug reports, feature requests, and pull requests are all welcome, including new database adapters. See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to get set up, and use the issue templates for [bug reports](.github/ISSUE_TEMPLATE/bug_report.md) or [feature requests](.github/ISSUE_TEMPLATE/feature_request.md) when opening an issue.

## License

MIT, see [LICENSE](./LICENSE).

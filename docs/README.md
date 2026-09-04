# Documentation

Deep-dive reference for `@ecync/baileys-session-manager`. The top-level [README](../README.md) is the quick overview and quick start, this folder is where each concern gets a full explanation, so you can jump straight to what you need.

- [Installation](./installation.md)
- [Quick start (SQLite)](./quick-start.md)
- [Architecture](./architecture.md)
- Adapters
  - [Overview and the IDatabaseAdapter contract](./adapters/overview.md)
  - [MongoDB](./adapters/mongodb.md)
  - [PostgreSQL](./adapters/postgres.md)
  - [MySQL / MariaDB](./adapters/mysql.md)
  - [SQLite](./adapters/sqlite.md)
  - [Cloudflare D1](./adapters/cloudflare-d1.md)
  - [Firebase Realtime Database](./adapters/firebase-realtime-database.md)
  - [Firestore](./adapters/firestore.md)
- [Caching (L1/L2/L3, TCP vs HTTP invalidation)](./caching.md)
- [Encryption at rest](./encryption.md)
- [Concurrency and locking](./concurrency-and-locking.md)
- [Performance and memory management](./performance.md)
- [Key retention and cleanup (auto-expiring keys)](./key-retention-and-cleanup.md)
- [Session management API](./session-management.md)
- [Error handling and retries](./error-handling.md)
- [Full API reference](./api-reference.md)
- [Migrating from useMultiFileAuthState](./migration-from-file-auth-state.md)
- [Releasing (CI, npm publish, GitHub Actions)](./releasing.md)

Want to contribute a fix or a new adapter? See [CONTRIBUTING.md](../CONTRIBUTING.md) in the repo root.

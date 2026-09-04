---
name: Bug report
about: Report something that isn't working correctly
title: "[BUG]"
labels: bug
assignees: ''

---

**Describe the bug**
A clear description of what's wrong.

**To reproduce**
Steps to reproduce the behavior:
1. Configured `useHybridAuthState` with...
2. Called...
3. Saw...

**Expected behavior**
What you expected to happen instead.

**Your setup (please complete the following information):**
- Which database adapter are you using? (MongoDB, Postgres, MySQL, SQLite, Cloudflare D1, Firebase Realtime DB, Firestore)
- Are you using Redis caching? If so, TCP (ioredis) or HTTP (Upstash)?
- Is encryption at rest (`encryption.enabled`) turned on?
- Is key retention/auto-pruning (`retention.enabled`) turned on, and with what `maxAgeMsByCategory`?
- Node.js version (`node -v`)
- `@acync/baileys-session-manager` version, and `baileys` version
- How many server instances/processes are sharing this session, if more than one?

**Logs**
If you passed a `logger` to `useHybridAuthState`, any relevant `warn`/`error` output. Redact anything sensitive (connection strings, encryption keys, credentials).

**Additional context**
Anything else that might be relevant.

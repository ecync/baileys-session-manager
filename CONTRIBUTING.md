# Contributing

Thanks for wanting to help with `@acync/baileys-session-manager`. Bug fixes, new database adapters, documentation improvements, and general cleanup are all welcome.

## Getting set up

```bash
git clone https://github.com/ecync/baileys-session-manager.git
cd baileys-session-manager
npm install
```

Local checks, all three should pass before you open a pull request:

```bash
npm run typecheck   # tsc --noEmit
npm run build       # tsup, dual ESM/CJS build
npm test            # vitest, builds first (needed for the SQLite worker thread)
```

`npm test` runs the SQLite adapter tests against a real, temporary database file and a real worker thread, not mocks. If your machine can't build `better-sqlite3`'s native module (no C++ toolchain, unsupported Node version), those specific tests skip themselves automatically rather than failing the whole suite, that's expected, not something you need to fix locally.

## Code style

- Strict TypeScript. `npm run typecheck` needs to be clean, no `any` unless there's genuinely no better option (and even then, prefer `unknown` plus a narrowing check).
- No em dashes, anywhere, in code, comments, or docs. Use a comma, a colon, or a plain hyphen instead. This is a deliberate style choice for the whole project, not a nitpick, keep it consistent.
- Comments explain the *why*, not the *what*. If a comment just restates what the code already says, it's not adding anything, delete it. Write one when there's a non-obvious reason behind a decision (a bug it works around, a trade-off, a constraint from the database/driver you're wiring up).
- Match the existing tone: plain, direct, a little conversational. Read a few files in `src/` before writing new ones, the style should feel like the same person wrote all of it.
- Prettier config is in `.prettierrc`. Run `npm run format` before committing if you're not sure your editor is applying it.

## Adding a new database adapter

If you want to add a backend this package doesn't support yet:

1. Implement `IDatabaseAdapter` (defined in `src/types.ts`), extending `BaseAdapter` (`src/adapters/base-adapter.ts`) for the shared retry wrapper.
2. Look at an existing adapter close to your target backend as a starting point, `src/adapters/postgres-adapter.ts` and `src/adapters/mysql-adapter.ts` are good templates for anything SQL-shaped, `src/adapters/mongodb-adapter.ts` for anything document-shaped.
3. Make sure `setMany`/`deleteMany` are real batched operations (one bulk write, not a loop calling `set`/`delete` once per entry), and that `version` increments on every write to the same `(sessionId, key)` pair, both matter to the rest of the package, see [docs/adapters/overview.md](./docs/adapters/overview.md) for why.
4. Lazily import your database driver inside `init()` (`await import('your-driver')`), the same way every existing adapter does, so it stays an optional peer dependency and doesn't bloat installs for people not using your backend.
5. Add it to `peerDependencies`/`peerDependenciesMeta` in `package.json` (marked `optional: true`), and to `dependencies`/`devDependencies` needed for local testing.
6. Write tests in `test/adapters/your-adapter.test.ts`. If your backend needs a real running service to test against (unlike SQLite, which can run fully in-memory/on a temp file), that's fine, follow the pattern in `test/adapters/sqlite-adapter.test.ts` for detecting when the service isn't available locally and skipping cleanly rather than failing CI.
7. Add a docs page under `docs/adapters/your-backend.md` (see the existing ones for the shape: install command, a usage example, "how it stores data", any notes specific to that backend), and link it from `docs/adapters/overview.md` and `docs/README.md`.

## Pull requests

Use the PR template, it's short: what changed, why, and a checklist confirming `typecheck`/`build`/`test` pass locally. Keep PRs focused, a new adapter and an unrelated bug fix should be two PRs, not one, that makes review (and, if something needs reverting later) much easier.

## Reporting bugs / requesting features

Use the issue templates: [bug report](.github/ISSUE_TEMPLATE/bug_report.md) or [feature request](.github/ISSUE_TEMPLATE/feature_request.md). For a bug report, the more specific you can be about your setup (which adapter, which Redis mode if any, encryption on or off, Node version), the faster it's actionable.

## License

By contributing, you agree your contribution is licensed under this project's [MIT license](./LICENSE).

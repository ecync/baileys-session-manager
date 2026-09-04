# Key retention and cleanup

There are two different kinds of "deleting old keys" this package deals with, and it's worth being clear about which one you're reading about before turning anything on.

## What already happens automatically, with zero configuration

Baileys itself decides when a signal key genuinely needs to go away, and it already tells this package about it:

- **Identity key changes** (Trust on First Use). When a contact's identity key changes, Baileys' `saveIdentity` clears the old `session` entry for that address before trusting the new key, that's the whole point of TOFU, an old session encrypted against a since-replaced identity key is no longer trustworthy.
- **PN-to-LID migration**. When WhatsApp moves a contact from a phone-number-based JID to a Linked Identity JID, Baileys' `migrateSession` copies the relevant session data across and discards the old phone-number-keyed entries.
- **Explicit session removal**, whenever your own code (or Baileys internally) decides a session should be dropped.

All three work by Baileys calling `keys.set({ session: { [id]: null }, ... })`, a `null` value for a key. This package's `keys.set` handler (`src/factory.ts`) already detects that and routes it straight to the adapter's `deleteMany` plus a cache invalidation for each affected key. **You don't need to configure anything for this, it already works today**, and nothing on this page changes or replaces it.

## What this page is actually about

Some entries go stale without Baileys ever explicitly nulling them out: a `session` for a contact you haven't exchanged a message with in months, orphaned `sender-key-memory` bookkeeping bits, an old `device-list` cache entry for a number that stopped using WhatsApp entirely. Nothing tells this package to clean those up on its own, they'll sit in your database indefinitely otherwise.

`KeyRetentionOptions` is an opt-in, time-based safety net for exactly that case, a garbage collector, not a protocol mechanism.

## Why this is off by default, and stays scoped per category

Signal Protocol key material is not uniformly safe to age out on a timer:

- **Risky to time-box**: `session`, `identity-key`, `pre-key`, `sender-key`. Deleting a still-needed `session`/`identity-key` entry breaks decryption for that contact until a fresh handshake happens (usually recoverable, but a real, visible behavior change: the next message from or to that contact may fail or need a re-exchange). A `pre-key` that's already been consumed *should* be deleted (Signal Protocol expects one-time pre-keys to be discarded once used, for forward secrecy), but Baileys already handles that itself via explicit `keys.set(null)` when it consumes one, not by age, so a blanket age-based deletion of `pre-key` entries risks deleting ones that are still valid and unconsumed.
- **Low-risk bookkeeping**: `sender-key-memory`, `device-list`, `app-state-sync-version`. These are convenience/cache data, not the cryptographic material a session actually depends on to decrypt messages. Aging these out is safe and, for a long-running bot talking to many contacts, actively useful for keeping storage lean.

Because of that split, `KeyRetentionOptions.enabled` defaults to `false`, and even once enabled, **only categories you explicitly list in `maxAgeMsByCategory` are ever touched**. `creds` is not a valid key in that map at all, in code, not just by convention, since deleting it would destroy the whole session rather than tidy it up.

## Usage

### The safe default: only bookkeeping categories

```ts
import { useHybridAuthState } from '@ecync/baileys-session-manager'

const { state, saveCreds } = await useHybridAuthState({
	sessionId: 'my-bot',
	adapter,
	retention: {
		enabled: true,
		maxAgeMsByCategory: {
			'sender-key-memory': 30 * 24 * 60 * 60 * 1000, // 30 days
			'device-list': 30 * 24 * 60 * 60 * 1000,
			'app-state-sync-version': 30 * 24 * 60 * 60 * 1000
		},
		autoRunIntervalMs: 6 * 60 * 60 * 1000 // run a prune pass every 6 hours
	}
})
```

### "I know what I'm doing" example: aging out sessions too

Only do this if you understand the trade-off above, an old `session` disappearing means the next message to or from that contact triggers a fresh Signal handshake, which is a real, user-visible thing (a brief delay, and depending on your app, possibly a "safety number changed"-style moment on the other end).

```ts
retention: {
	enabled: true,
	maxAgeMsByCategory: {
		'sender-key-memory': 30 * 24 * 60 * 60 * 1000,
		session: 180 * 24 * 60 * 60 * 1000 // 6 months of no contact before a session is dropped
	}
}
```

### Running it manually instead of on a timer

Skip `autoRunIntervalMs` and call it yourself, from a cron job, an admin endpoint, wherever fits your deployment:

```ts
const { prunedKeys } = await sessionManager.pruneExpiredKeys()
console.log(`pruned ${prunedKeys.length} stale keys`)
```

`pruneExpiredKeys()` also accepts a specific `sessionId` if you're managing more than one session and want to prune just one of them.

## How it decides what's stale

Every key stored is `${category}-${id}` (`creds` is the one exception, stored bare). Recovering the category needs longest-prefix matching against the known category list, since several categories contain hyphens themselves (`sender-key-memory` contains `sender-key`), this is handled by `resolveCategory()` in `src/retention.ts`, checking longest candidates first so `sender-key-memory-abc` resolves to `sender-key-memory`, not the shorter, wrong `sender-key`.

For each candidate key in a configured category, its `updatedAt` timestamp (already tracked by every adapter) is compared against `Date.now()`. Once the difference reaches that category's configured `maxAgeMsByCategory` value, it's deleted through the same `adapter.deleteMany` + cache invalidation path the protocol-driven deletions above already use, batched, not one call per key, see [Performance](./performance.md).

## Cleanup on shutdown

If you configured `autoRunIntervalMs`, it runs on a shared, `unref()`'d timer, the same defensive pattern the [in-memory cache's sweep](./caching.md) uses, so it never keeps your process alive on its own. Calling the `close()` function returned by `useHybridAuthState` stops that timer explicitly as part of a clean shutdown.

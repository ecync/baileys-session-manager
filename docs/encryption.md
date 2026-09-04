# Encryption at rest

Off by default, so the [quick start](./quick-start.md) stays simple. Turn it on when you don't want raw WhatsApp credentials sitting in plaintext in whatever database or Redis instance you're using, worth doing for essentially any production deployment.

```ts
import { generateEncryptionKey, useHybridAuthState } from '@ecync/baileys-session-manager'

// Run this once, then store the result somewhere safe: an environment
// variable, a secrets manager. Losing it makes every encrypted session
// permanently unreadable, there's no recovery path around that by design.
const key = generateEncryptionKey()

const { state, saveCreds } = await useHybridAuthState({
	sessionId: 'my-bot',
	adapter,
	encryption: { enabled: true, key }
})
```

## How it works

AES-256-GCM (`src/encryption/aes.ts`). Every value gets its own random 12-byte IV before it's encrypted, so encrypting the same input twice never produces the same ciphertext, that randomness is what keeps GCM safe to reuse a key across many values. A 16-byte authentication tag travels alongside the ciphertext, so tampering with stored data (or trying to decrypt with the wrong key) fails loudly and immediately instead of silently returning garbage that might look like valid session data.

Everything (IV, tag, ciphertext) is base64-encoded together into one string, prefixed with `enc:v1:` so it's identifiable at a glance, and that string is what gets written wherever the value would otherwise go. No database schema changes are needed to turn this on, it still fits the same plain `value` text column every adapter already uses.

## Where encryption happens

Encryption happens right before a value reaches the cache layers, decryption happens right after a value comes back from them. That means the cached bytes, both in L1 (in-memory) and L2 (Redis, if configured), are ciphertext too, not just what ends up on disk in your primary database. If someone got read access to your Redis instance, they'd see the same ciphertext they'd see reading your database directly.

## Key format

`generateEncryptionKey()` returns a 64-character hex string. `encrypt`/`decrypt` also accept a base64-encoded 32-byte key if you'd rather generate or store it that way, whichever fits your secrets management setup better.

## What this doesn't protect against

Encryption at rest protects data sitting in your database or cache from someone who gets read access to that storage without your application's encryption key. It does not protect against: a compromised process that already has the key in memory (it needs the key to actually use the session), a database with write access being fed malicious data (GCM's auth tag catches tampering on read, but doesn't stop a write from happening), or anything upstream of this package, like a compromised environment variable store holding the key itself. Treat the key with the same care you'd treat any other secret capable of decrypting a WhatsApp login.

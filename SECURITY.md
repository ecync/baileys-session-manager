# Security Policy

## Reporting a vulnerability

**Please don't file security issues as public GitHub issues.** This package handles WhatsApp session credentials, a public report of a real vulnerability is effectively a how-to guide for anyone watching the repo.

Use a private channel instead:

1. **Preferred:** [GitHub Security Advisories](https://github.com/ecync/baileys-session-manager/security/advisories/new) on this repository. This gives us a private space to discuss the issue and coordinate a fix before anything is public.
2. If GitHub Advisories isn't an option for you, open a regular issue asking for another way to reach a maintainer privately, without describing the vulnerability itself.

We'll do our best to acknowledge a report within a few days. This is a small, community-maintained project without a dedicated security team, so response times won't match a large company's, but every report gets read.

## What to include

- Which part is affected: a specific adapter, the cache layer, encryption (`src/encryption/aes.ts`), locking, or the key retention logic
- What an attacker could actually do, and under what conditions (do they need database access already, network access, a malicious value passed to an API, etc.)
- A minimal reproduction if you have one

## What's in scope

- Encryption at rest not actually protecting what it claims to (a way to recover plaintext without the key, a weak IV/nonce reuse, an auth tag bypass)
- A database adapter that leaks session data somewhere it shouldn't (logs, error messages, an unintended query)
- The distributed lock or retry logic allowing a race condition that corrupts or leaks another session's data
- A dependency this package pulls in that's reachable through this package's own API

## What's likely out of scope

- Vulnerabilities in `baileys` itself, please report those to [the Baileys project](https://github.com/WhiskeySockets/Baileys/security/advisories/new) instead
- Vulnerabilities in a database driver you chose to install (MongoDB, pg, mysql2, etc.), those belong to that driver's own project
- "This could be misused for spam/automation abuse", that's a WhatsApp Terms of Service question, not a vulnerability in this package

## A note for anyone using this package

- If you enable [encryption at rest](./docs/encryption.md), treat the encryption key the same way you'd treat any other secret capable of decrypting a WhatsApp login: not in source control, not in a screenshot, not pasted into a support ticket.
- The session data this package stores (even encrypted) is equivalent to a long-lived credential. Restrict database and cache access accordingly.

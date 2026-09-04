/**
 * Run with: npm install better-sqlite3 && tsx examples/encrypted-session-example.ts
 *
 * Shows AES-256-GCM encryption at rest turned on. The database file this writes
 * to never contains readable WhatsApp credentials, only ciphertext, decryption
 * only happens in memory, right after a value comes back from storage.
 */
import { SqliteAdapter, generateEncryptionKey, useHybridAuthState } from '../src/index.js'

async function main() {
	// In a real app, generate this once and keep it in an environment variable
	// or a secrets manager, not regenerated on every run like this example does.
	const encryptionKey = generateEncryptionKey()
	console.log('generated encryption key (store this somewhere safe):', encryptionKey)

	const adapter = new SqliteAdapter('./encrypted-sessions.sqlite')

	const { state, saveCreds } = await useHybridAuthState({
		sessionId: 'example-bot',
		adapter,
		encryption: { enabled: true, key: encryptionKey }
	})

	console.log('creds loaded, registered =', state.creds.registered)
	await saveCreds()

	// The row this just wrote to encrypted-sessions.sqlite is ciphertext, not
	// readable JSON, try opening the file with a plain SQLite browser to see.
	await adapter.close()
}

main().catch(console.error)

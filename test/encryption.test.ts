import { describe, expect, it } from 'vitest'
import { decrypt, encrypt, generateEncryptionKey, isEncrypted } from '../src/encryption/aes.js'

describe('AES-256-GCM encryption', () => {
	it('decrypts back to the original plaintext', () => {
		const key = generateEncryptionKey()
		const plaintext = JSON.stringify({ registrationId: 12345, advSecretKey: 'super-secret' })

		const ciphertext = encrypt(plaintext, key)
		expect(isEncrypted(ciphertext)).toBe(true)
		expect(ciphertext).not.toContain('super-secret')

		expect(decrypt(ciphertext, key)).toBe(plaintext)
	})

	it('produces different ciphertext for the same plaintext on every call', () => {
		const key = generateEncryptionKey()
		const a = encrypt('same input', key)
		const b = encrypt('same input', key)

		// Random IV per call means these should never match, even for identical input.
		expect(a).not.toBe(b)
	})

	it('refuses to decrypt with the wrong key', () => {
		const ciphertext = encrypt('sensitive session data', generateEncryptionKey())
		expect(() => decrypt(ciphertext, generateEncryptionKey())).toThrow()
	})

	it('refuses to decrypt tampered ciphertext', () => {
		const key = generateEncryptionKey()
		const ciphertext = encrypt('sensitive session data', key)

		const tampered = ciphertext.slice(0, -4) + (ciphertext.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA')
		expect(() => decrypt(tampered, key)).toThrow()
	})

	it('rejects a key that is not 32 bytes once decoded', () => {
		expect(() => encrypt('data', 'too-short')).toThrow()
	})
})

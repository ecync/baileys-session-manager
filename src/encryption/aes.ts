import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const KEY_LENGTH = 32
/** Prefix so we can tell an encrypted payload apart from plain JSON at a glance. */
const ENCRYPTED_PREFIX = 'enc:v1:'

/**
 * Generates a fresh, random 32-byte key and returns it as a hex string, ready to
 * drop into an EncryptionOptions.key field or an environment variable. Run this
 * once when you set the package up, then keep the result somewhere safe, losing
 * it means every encrypted session becomes unreadable.
 */
export function generateEncryptionKey(): string {
	return randomBytes(KEY_LENGTH).toString('hex')
}

function resolveKey(key: string): Buffer {
	// Accept either hex (64 chars) or base64, whichever the user finds easier to store.
	const asHex = /^[0-9a-fA-F]{64}$/.test(key) ? Buffer.from(key, 'hex') : null
	const buffer = asHex ?? Buffer.from(key, 'base64')

	if (buffer.length !== KEY_LENGTH) {
		throw new Error(
			`Encryption key must be exactly 32 bytes once decoded (got ${buffer.length}). ` +
				'Generate a valid one with generateEncryptionKey().'
		)
	}

	return buffer
}

/**
 * Encrypts a plaintext string with AES-256-GCM. Every call uses a fresh random IV,
 * so encrypting the same value twice never produces the same ciphertext, that's
 * intentional and is what keeps GCM safe to use. The IV and auth tag both travel
 * alongside the ciphertext in one base64 string, so it still fits in the plain
 * `value: string` column every database adapter already expects.
 */
export function encrypt(plaintext: string, keyInput: string): string {
	const key = resolveKey(keyInput)
	const iv = randomBytes(IV_LENGTH)
	const cipher = createCipheriv(ALGORITHM, key, iv)

	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
	const authTag = cipher.getAuthTag()

	// Layout: iv (12 bytes) + authTag (16 bytes) + ciphertext, all base64-encoded together.
	const payload = Buffer.concat([iv, authTag, ciphertext]).toString('base64')
	return ENCRYPTED_PREFIX + payload
}

/**
 * Decrypts a string produced by `encrypt`. Throws if the auth tag doesn't match,
 * which happens if the ciphertext was tampered with or the wrong key was used.
 * That failure is intentional: silently returning garbage would be far worse than
 * a clear "this data can't be trusted" error.
 */
export function decrypt(payload: string, keyInput: string): string {
	if (!payload.startsWith(ENCRYPTED_PREFIX)) {
		throw new Error('Value does not look like it was encrypted by this package (missing enc:v1: prefix).')
	}

	const key = resolveKey(keyInput)
	const raw = Buffer.from(payload.slice(ENCRYPTED_PREFIX.length), 'base64')

	const iv = raw.subarray(0, IV_LENGTH)
	const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16)
	const ciphertext = raw.subarray(IV_LENGTH + 16)

	const decipher = createDecipheriv(ALGORITHM, key, iv)
	decipher.setAuthTag(authTag)

	const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
	return plaintext.toString('utf8')
}

export function isEncrypted(payload: string): boolean {
	return payload.startsWith(ENCRYPTED_PREFIX)
}

/**
 * Test-only stand-in for the `baileys` package.
 *
 * We can't install the real `baileys` package in this environment (its
 * dependency tree pulls in a git-hosted package that some sandboxes block), and
 * even where it can be installed, pulling in the whole WhatsApp socket library
 * just to run our unit tests would be overkill. This mock reimplements just the
 * handful of exports we actually touch (BufferJSON's replacer/reviver, a
 * minimal initAuthCreds, and a passthrough proto.Message.AppStateSyncKeyData),
 * wired in via a vitest alias (see vitest.config.ts) so `import ... from
 * 'baileys'` resolves here during tests only. The published package never uses
 * this, real consumers get the real baileys.
 */
import { randomBytes } from 'crypto'

export const BufferJSON = {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	replacer: (_key: string, value: any) => {
		if (Buffer.isBuffer(value) || value instanceof Uint8Array || value?.type === 'Buffer') {
			return { type: 'Buffer', data: Buffer.from(value?.data || value).toString('base64') }
		}

		return value
	},

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	reviver: (_key: string, value: any) => {
		if (typeof value === 'object' && value !== null && value.type === 'Buffer' && typeof value.data === 'string') {
			return Buffer.from(value.data, 'base64')
		}

		return value
	}
}

export function initAuthCreds() {
	return {
		noiseKey: { public: randomBytes(32), private: randomBytes(32) },
		pairingEphemeralKeyPair: { public: randomBytes(32), private: randomBytes(32) },
		signedIdentityKey: { public: randomBytes(32), private: randomBytes(32) },
		signedPreKey: { keyPair: { public: randomBytes(32), private: randomBytes(32) }, signature: randomBytes(64), keyId: 1 },
		registrationId: 1234,
		advSecretKey: randomBytes(32).toString('base64'),
		processedHistoryMessages: [],
		nextPreKeyId: 1,
		firstUnuploadedPreKeyId: 1,
		accountSyncCounter: 0,
		accountSettings: { unarchiveChats: false },
		registered: false,
		pairingCode: undefined,
		lastPropHash: undefined,
		routingInfo: undefined
	}
}

export const proto = {
	Message: {
		AppStateSyncKeyData: {
			fromObject: (obj: Record<string, unknown>) => obj
		}
	}
}

/**
 * Development-only ambient shim for the `baileys` peer dependency.
 *
 * This file exists purely so we can typecheck and build this package in an
 * environment where installing the real `baileys` npm package isn't possible
 * (its dependency tree pulls in a git-hosted package, which some sandboxed CI
 * or offline setups block outright). It is NOT shipped in the published
 * package (see .npmignore / package.json "files"), and it is never bundled
 * into dist, tsup treats "baileys" as external and just re-emits the import.
 *
 * A real consumer of this package installs the actual `baileys` package as a
 * peer dependency, and TypeScript resolves against baileys' own, authoritative
 * type declarations instead of this shim. If Baileys changes these shapes,
 * only this dev-time shim (and, at runtime, nothing at all, since we never
 * duplicate their logic) would need updating, actual behavior always comes
 * from the real library.
 */
declare module 'baileys' {
	export type KeyPair = { public: Uint8Array; private: Uint8Array }

	export type SignalCreds = {
		readonly signedIdentityKey: KeyPair
		readonly signedPreKey: { keyPair: KeyPair; signature: Uint8Array; keyId: number; timestampS?: number }
		readonly registrationId: number
	}

	export type AuthenticationCreds = SignalCreds & {
		readonly noiseKey: KeyPair
		readonly pairingEphemeralKeyPair: KeyPair
		advSecretKey: string
		me?: Record<string, unknown>
		account?: Record<string, unknown>
		signalIdentities?: unknown[]
		myAppStateKeyId?: string
		firstUnuploadedPreKeyId: number
		nextPreKeyId: number
		lastAccountSyncTimestamp?: number
		platform?: string
		processedHistoryMessages: unknown[]
		accountSyncCounter: number
		accountSettings: Record<string, unknown>
		registered: boolean
		pairingCode: string | undefined
		lastPropHash: string | undefined
		routingInfo: Buffer | undefined
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		additionalData?: any
	}

	export type SignalDataTypeMap = {
		'pre-key': KeyPair
		session: Uint8Array
		'sender-key': Uint8Array
		'sender-key-memory': { [jid: string]: boolean }
		'app-state-sync-key': Record<string, unknown>
		'app-state-sync-version': { version: number; hash: Buffer; indexValueMap: Record<string, unknown> }
		'lid-mapping': string
		'device-list': string[]
		tctoken: { token: Buffer; timestamp?: string; senderTimestamp?: number }
		'identity-key': Uint8Array
	}

	export type SignalDataSet = { [T in keyof SignalDataTypeMap]?: { [id: string]: SignalDataTypeMap[T] | null } }

	type Awaitable<T> = T | Promise<T>

	export type SignalKeyStore = {
		get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]): Awaitable<{ [id: string]: SignalDataTypeMap[T] }>
		set(data: SignalDataSet): Awaitable<void>
		clear?(): Awaitable<void>
	}

	export type AuthenticationState = {
		creds: AuthenticationCreds
		keys: SignalKeyStore
	}

	export function initAuthCreds(): AuthenticationCreds

	export const BufferJSON: {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		replacer: (key: string, value: any) => any
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		reviver: (key: string, value: any) => any
	}

	export namespace proto {
		namespace Message {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const AppStateSyncKeyData: { fromObject(object: Record<string, unknown>): any }
		}
	}
}

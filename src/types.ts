import type { SignalDataTypeMap } from 'baileys'

/**
 * Shared contracts for the whole package. Everything else (adapters, cache layers,
 * the factory function) is written against these interfaces, not against any
 * concrete driver, which is what lets a user swap MongoDB for Postgres without
 * touching the rest of their code.
 */

/** One logical row of session data: a single creds blob or a single signal key. */
export interface SessionRecord {
	sessionId: string
	key: string
	value: string
	updatedAt: number
	/** Bumped on every write, used by the HTTP-mode Redis cache to detect stale entries. */
	version: number
}

/**
 * Anything that can durably store and retrieve session rows implements this.
 * This is the interface every database adapter (Mongo, Postgres, MySQL, SQLite,
 * D1, Firebase RTDB, Firestore) is built against.
 */
export interface IDatabaseAdapter {
	/** Name shown in logs and error messages, e.g. "postgres" or "mongodb". */
	readonly name: string

	/** Creates tables/collections/indexes if they don't exist yet. Safe to call more than once. */
	init(): Promise<void>

	get(sessionId: string, key: string): Promise<SessionRecord | null>

	/** Fetches several keys in one call, cheaper than N single gets on most backends. */
	getMany(sessionId: string, keys: string[]): Promise<Map<string, SessionRecord>>

	set(sessionId: string, key: string, value: string): Promise<void>

	/** Writes many rows in a single round trip. Adapters should batch this natively where possible. */
	setMany(sessionId: string, entries: Array<{ key: string; value: string }>): Promise<void>

	delete(sessionId: string, key: string): Promise<void>

	deleteMany(sessionId: string, keys: string[]): Promise<void>

	/** All keys currently stored for a session, used to enumerate signal keys and for exports. */
	getAllKeys(sessionId: string): Promise<string[]>

	/** Wipes every row belonging to a session. */
	deleteSession(sessionId: string): Promise<void>

	/** Distinct session ids currently in storage. */
	listSessions(): Promise<string[]>

	sessionExists(sessionId: string): Promise<boolean>

	/** Releases any pool/connection/worker this adapter is holding onto. */
	close(): Promise<void>
}

/** A Redis-backed L2 cache, either over a real TCP connection or a plain HTTP/REST API. */
export interface IRedisCacheAdapter {
	readonly mode: 'tcp' | 'http'

	get(key: string): Promise<{ value: string; version: number } | null>

	set(key: string, value: string, version: number, ttlSeconds?: number): Promise<void>

	del(key: string): Promise<void>

	/**
	 * Only meaningful in TCP mode, where a persistent connection can subscribe to
	 * pub/sub. HTTP-mode adapters simply do not implement this, since a REST call
	 * has nothing to stay subscribed with.
	 */
	subscribeInvalidation?(onMessage: (key: string) => void): Promise<void>

	publishInvalidation?(key: string): Promise<void>

	close(): Promise<void>
}

export interface EncryptionOptions {
	/** Turns AES-256-GCM encryption at rest on or off. Off by default so quick starts stay simple. */
	enabled: boolean
	/** 32-byte key, given as a 64-char hex string or a base64 string. Generate one with `generateEncryptionKey()`. */
	key: string
}

export interface CacheOptions {
	/** How long an entry lives in the in-memory L1 cache before it's swept. Defaults to 30 seconds. */
	memoryTtlMs?: number
	/** Max number of entries kept in L1 before LRU eviction kicks in. Defaults to 5000. */
	memoryMaxEntries?: number
	/** Max approximate bytes kept in L1 before LRU eviction kicks in. Defaults to 25 MB. */
	memoryMaxBytes?: number
	/** Optional Redis L2 cache. Skipping this just means every miss falls straight through to the database. */
	redis?: IRedisCacheAdapter
}

export interface RetryOptions {
	/** How many attempts to make before giving up. Defaults to 3. */
	retries?: number
	/** Delay before the first retry, doubled on each subsequent attempt. Defaults to 200ms. */
	minDelayMs?: number
	/** Upper bound for the backoff delay, so retries don't end up waiting minutes. Defaults to 5000ms. */
	maxDelayMs?: number
}

export interface Logger {
	trace(msg: string, meta?: Record<string, unknown>): void
	debug(msg: string, meta?: Record<string, unknown>): void
	info(msg: string, meta?: Record<string, unknown>): void
	warn(msg: string, meta?: Record<string, unknown>): void
	error(msg: string, meta?: Record<string, unknown>): void
}

/**
 * Controls for the opt-in, time-based key pruning described in
 * docs/key-retention-and-cleanup.md. This is a safety net for entries that go
 * stale without Baileys ever explicitly deleting them (a session for a contact
 * you haven't messaged in months, orphaned sender-key-memory bookkeeping), not a
 * replacement for the protocol-driven deletion Baileys already does on its own
 * (an identity key change, a PN-to-LID migration) by calling keys.set with a
 * null value, which this package already handles with zero configuration.
 *
 * Deliberately off by default. Signal Protocol key material is not uniformly
 * safe to age out: pruning a still-needed `session` or `identity-key` entry can
 * break decryption or force an unexpected re-handshake, while low-risk
 * bookkeeping categories like `sender-key-memory` or `device-list` are fine to
 * clear out on a timer. So nothing is ever touched unless a category is
 * explicitly listed here, on purpose, by whoever configured this package.
 */
export interface KeyRetentionOptions {
	/** Nothing is auto-deleted unless this is explicitly true. */
	enabled: boolean
	/**
	 * Max age, in milliseconds, per signal data category, before an entry is
	 * considered stale and eligible for pruning. Only categories present here
	 * are ever touched, anything omitted is left alone forever. "creds" is not
	 * a valid key here, it is excluded unconditionally in code, not just by
	 * convention, since deleting it would destroy the whole session rather than
	 * tidy it up.
	 */
	maxAgeMsByCategory: Partial<Record<keyof SignalDataTypeMap, number>>
	/**
	 * If set, runs a prune pass automatically on this interval (ms), via a
	 * shared, unref'd timer so it never keeps the process alive on its own.
	 * If omitted, pruning only happens when sessionManager.pruneExpiredKeys()
	 * is called explicitly.
	 */
	autoRunIntervalMs?: number
}

export interface AuthManagerOptions {
	/** Groups every row that belongs to one WhatsApp session/bot instance. */
	sessionId: string
	adapter: IDatabaseAdapter
	cache?: CacheOptions
	encryption?: EncryptionOptions
	retry?: RetryOptions
	logger?: Logger
	/**
	 * How long to wait (in ms) after a saveCreds()/keys.set() call before actually
	 * writing, in case more writes arrive in the same burst. Defaults to 50ms.
	 * Set to 0 to write immediately with no batching.
	 */
	writeDebounceMs?: number
	/** Max number of concurrent database calls when fanning out reads/writes. Defaults to 10. */
	concurrency?: number
	/** Opt-in, time-based cleanup of stale signal keys. Off by default, see KeyRetentionOptions. */
	retention?: KeyRetentionOptions
}

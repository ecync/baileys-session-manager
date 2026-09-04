# Full API reference

## `useHybridAuthState(options): Promise<{ state, saveCreds, sessionManager, close }>`

The main entry point.

```ts
interface AuthManagerOptions {
	sessionId: string
	adapter: IDatabaseAdapter
	cache?: {
		memoryTtlMs?: number       // default 30_000
		memoryMaxEntries?: number  // default 5_000
		memoryMaxBytes?: number    // default 25 MB
		redis?: IRedisCacheAdapter
	}
	encryption?: {
		enabled: boolean
		key: string // 32 bytes, hex or base64, see generateEncryptionKey()
	}
	retry?: {
		retries?: number      // default 3
		minDelayMs?: number   // default 200
		maxDelayMs?: number   // default 5000
	}
	logger?: Logger
	writeDebounceMs?: number // default 50
	concurrency?: number     // default 10
	retention?: {
		enabled: boolean
		maxAgeMsByCategory: Partial<Record<SignalDataCategory, number>>
		autoRunIntervalMs?: number
	}
}
```

Returns:

```ts
{
	state: AuthenticationState        // from 'baileys', drop-in for makeWASocket({ auth: state })
	saveCreds: () => Promise<void>    // wire into sock.ev.on('creds.update', saveCreds)
	sessionManager: SessionManager    // see session-management.md
	close: () => Promise<void>        // stops background timers, flushes pending writes, on shutdown
}
```

See: [Quick start](./quick-start.md), [Caching](./caching.md), [Encryption](./encryption.md), [Error handling](./error-handling.md), [Performance](./performance.md), [Key retention](./key-retention-and-cleanup.md).

## `IDatabaseAdapter`

The interface every database adapter implements. See [Adapters overview](./adapters/overview.md) for the full contract and how to write your own.

## `SessionManager`

See [Session management API](./session-management.md) for every method with examples.

```ts
class SessionManager {
	listSessions(): Promise<string[]>
	getSessionInfo(sessionId?: string): Promise<SessionInfo | null>
	sessionExists(sessionId?: string): Promise<boolean>
	deleteSession(sessionId?: string): Promise<void>
	exportSession(sessionId?: string): AsyncIterable<[key: string, value: string]>
	exportSessionToObject(sessionId?: string): Promise<Record<string, string>>
	importSession(sessionId: string, data: Record<string, string>): Promise<void>
	clearCache(sessionId?: string): Promise<void>
	pruneExpiredKeys(sessionId?: string): Promise<{ prunedKeys: string[] }>
}
```

## Encryption

```ts
function generateEncryptionKey(): string
function encrypt(plaintext: string, key: string): string
function decrypt(ciphertext: string, key: string): string
function isEncrypted(value: string): boolean
```

See [Encryption at rest](./encryption.md).

## Caching

```ts
class CacheManager { /* orchestrates L1/L2/L3, see caching.md */ }
class MemoryCache { /* the L1 layer */ }

class RedisTcpCacheAdapter implements IRedisCacheAdapter {}
function createRedisTcpCache(options: { url?: string; host?: string; port?: number; password?: string }): Promise<RedisTcpCacheAdapter>

class RedisHttpCacheAdapter implements IRedisCacheAdapter {}
function createRedisHttpCache(options: { url: string; token: string }): Promise<RedisHttpCacheAdapter>
```

See [Caching](./caching.md).

## Locking

```ts
class LocalMutexLock {}
class RedisDistributedLock {}
```

See [Concurrency and locking](./concurrency-and-locking.md).

## Adapters

```ts
class BaseAdapter {}          // shared retry wrapper every concrete adapter extends
class MongoAdapter {}
class PostgresAdapter {}
class MysqlAdapter {}
class SqliteAdapter {}
class CloudflareD1Adapter {}
class FirebaseRealtimeAdapter {}
class FirestoreAdapter {}
```

See each backend's own page under [Adapters](./adapters/overview.md).

## Key retention

```ts
function pruneExpiredKeys(deps: {
	sessionId: string
	adapter: IDatabaseAdapter
	cache: CacheManager
	logger: Logger
	options: KeyRetentionOptions
}): Promise<{ prunedKeys: string[] }>

function resolveCategory(key: string): keyof SignalDataTypeMap | null
```

Most consumers only need `sessionManager.pruneExpiredKeys()` and the `retention` option on `useHybridAuthState`, these lower-level exports are there for anyone building their own tooling around the same category-resolution logic. See [Key retention and cleanup](./key-retention-and-cleanup.md).

## Utilities

```ts
const noopLogger: Logger
const consoleLogger: Logger

function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions, logger?: Logger, label?: string): Promise<T>

class WriteBatcher {}

function serialize(data: unknown): string
function deserialize<T>(text: string): T
```

`serialize`/`deserialize` reuse Baileys' own `BufferJSON` replacer/reviver rather than reimplementing it, see [Architecture](./architecture.md).

## Module format

Ships as both ESM and CommonJS builds from one source tree (via `tsup`), with a matching `exports` map in `package.json` so either `import` or `require` resolves correctly. TypeScript types are included for both.

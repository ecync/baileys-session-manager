export { useHybridAuthState } from './factory.js'
export { SessionManager } from './session-manager.js'
export type { SessionInfo } from './session-manager.js'

export type {
	AuthManagerOptions,
	CacheOptions,
	EncryptionOptions,
	IDatabaseAdapter,
	IRedisCacheAdapter,
	KeyRetentionOptions,
	Logger,
	RetryOptions,
	SessionRecord
} from './types.js'

export { pruneExpiredKeys, resolveCategory } from './retention.js'

export { deserialize, serialize } from './serialization.js'

export { decrypt, encrypt, generateEncryptionKey, isEncrypted } from './encryption/aes.js'

export { CacheManager } from './cache/cache-manager.js'
export { MemoryCache } from './cache/memory-cache.js'
export { RedisTcpCacheAdapter, createRedisTcpCache } from './cache/redis-tcp.js'
export { RedisHttpCacheAdapter, createRedisHttpCache } from './cache/redis-http.js'

export { LocalMutexLock } from './lock/mutex-lock.js'
export { RedisDistributedLock } from './lock/redis-lock.js'

export { BaseAdapter, SESSIONS_TABLE } from './adapters/base-adapter.js'
export { MongoAdapter } from './adapters/mongodb-adapter.js'
export { PostgresAdapter } from './adapters/postgres-adapter.js'
export { MysqlAdapter } from './adapters/mysql-adapter.js'
export { SqliteAdapter } from './adapters/sqlite-adapter.js'
export { CloudflareD1Adapter } from './adapters/cloudflare-d1-adapter.js'
export type { D1Database, D1PreparedStatement } from './adapters/cloudflare-d1-adapter.js'
export { FirebaseRealtimeAdapter } from './adapters/firebase-realtime-adapter.js'
export { FirestoreAdapter } from './adapters/firestore-adapter.js'

export { consoleLogger, noopLogger } from './utils/logger.js'
export { withRetry } from './utils/retry.js'
export { WriteBatcher } from './utils/write-batcher.js'

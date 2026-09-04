import type { IDatabaseAdapter, Logger, RetryOptions } from '../types.js'
import { noopLogger } from '../utils/logger.js'
import { withRetry } from '../utils/retry.js'

/** Table/collection name every adapter uses. One shared constant keeps every backend's docs consistent. */
export const SESSIONS_TABLE = 'baileys_sessions'

/**
 * Shared plumbing every concrete adapter builds on: a consistent retry wrapper
 * around whatever the underlying driver throws, and a `name` field for logging.
 * Concrete adapters only need to implement the actual database calls, this class
 * takes care of making those calls resilient to the connection drops and
 * transient errors that are just a normal part of talking to a network service.
 */
export abstract class BaseAdapter implements IDatabaseAdapter {
	abstract readonly name: string

	protected readonly logger: Logger
	protected readonly retryOptions: RetryOptions | undefined

	constructor(logger: Logger = noopLogger, retryOptions?: RetryOptions) {
		this.logger = logger
		this.retryOptions = retryOptions
	}

	protected withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
		return withRetry(fn, this.retryOptions, this.logger, `${this.name} adapter: ${label}`)
	}

	abstract init(): Promise<void>
	abstract get(sessionId: string, key: string): ReturnType<IDatabaseAdapter['get']>
	abstract getMany(sessionId: string, keys: string[]): ReturnType<IDatabaseAdapter['getMany']>
	abstract set(sessionId: string, key: string, value: string): Promise<void>
	abstract setMany(sessionId: string, entries: Array<{ key: string; value: string }>): Promise<void>
	abstract delete(sessionId: string, key: string): Promise<void>
	abstract deleteMany(sessionId: string, keys: string[]): Promise<void>
	abstract getAllKeys(sessionId: string): Promise<string[]>
	abstract deleteSession(sessionId: string): Promise<void>
	abstract listSessions(): Promise<string[]>
	abstract sessionExists(sessionId: string): Promise<boolean>
	abstract close(): Promise<void>
}

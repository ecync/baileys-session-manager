import { Mutex } from 'async-mutex'

/**
 * The single-instance concurrency guard. This is the same trick the original
 * `useMultiFileAuthState` uses for file writes, one Mutex per key, created lazily
 * and reused. It's enough to stop two async calls inside the *same* Node process
 * from racing to write the same session, but it does nothing across processes,
 * that's what RedisDistributedLock is for.
 */
export class LocalMutexLock {
	private readonly locks = new Map<string, Mutex>()

	private getMutex(key: string): Mutex {
		let mutex = this.locks.get(key)
		if (!mutex) {
			mutex = new Mutex()
			this.locks.set(key, mutex)
		}

		return mutex
	}

	async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
		return this.getMutex(key).runExclusive(fn)
	}
}

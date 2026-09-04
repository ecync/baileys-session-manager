import PQueue from 'p-queue'

type FlushFn = (entries: Array<{ key: string; value: string }>) => Promise<void>

/**
 * Coalesces rapid writes into fewer database round trips. Baileys can fire off
 * several `saveCreds()`/`keys.set()` calls within a few milliseconds of each
 * other, especially during pairing when a handful of creds fields update almost
 * at once. Writing each one individually is correct but wasteful; this batcher
 * waits a short debounce window, collects whatever arrives during it, and flushes
 * everything as one call to the adapter's `setMany`.
 *
 * It's built on `p-queue` with `concurrency: 1` so flushes for the same session
 * always happen in order, a flush never starts before the previous one finished,
 * which keeps "last write wins" semantics predictable even under load.
 */
export class WriteBatcher {
	private readonly queue = new PQueue({ concurrency: 1 })
	private readonly pending = new Map<string, string>()
	private readonly debounceMs: number
	private readonly flush: FlushFn
	private timer: ReturnType<typeof setTimeout> | null = null
	private flushWaiters: Array<() => void> = []

	constructor(flush: FlushFn, debounceMs = 50) {
		this.flush = flush
		this.debounceMs = debounceMs
	}

	/** Queues a write. Resolves once that value has actually been flushed to the database. */
	async write(key: string, value: string): Promise<void> {
		this.pending.set(key, value)

		if (this.debounceMs <= 0) {
			await this.flushNow()
			return
		}

		return new Promise<void>(resolve => {
			this.flushWaiters.push(resolve)

			if (this.timer) {
				clearTimeout(this.timer)
			}

			this.timer = setTimeout(() => {
				this.flushNow().catch(() => {
					// Errors surface to whoever's awaiting flushNow() via the queue task
					// itself; swallowing here just stops an unhandled rejection on the timer.
				})
			}, this.debounceMs)
			this.timer.unref?.()
		})
	}

	/** Forces whatever is pending to flush immediately, used by saveCreds() and shutdown. */
	async flushNow(): Promise<void> {
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}

		const waiters = this.flushWaiters
		this.flushWaiters = []

		await this.queue.add(async () => {
			if (this.pending.size === 0) return

			const entries = [...this.pending.entries()].map(([key, value]) => ({ key, value }))
			this.pending.clear()

			await this.flush(entries)
		})

		for (const resolve of waiters) resolve()
	}

	async destroy(): Promise<void> {
		await this.flushNow()
		this.queue.clear()
	}
}

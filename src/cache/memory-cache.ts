interface CacheEntry {
	value: string
	version: number
	expiresAt: number
	byteSize: number
}

const DEFAULT_TTL_MS = 30_000
const DEFAULT_MAX_ENTRIES = 5_000
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024 // 25 MB

/**
 * The L1 cache. Everything lives in one process's memory, so reads from here are
 * effectively free, no network hop, no serialization cost beyond what's already
 * done. The tricky part is not letting it grow forever: a long-running bot process
 * touching thousands of sessions over weeks would otherwise slowly turn this into
 * a memory leak.
 *
 * We use a plain Map as an LRU: Map iterates in insertion order, so re-inserting a
 * key on every access ("touch") naturally pushes it to the end, and the least
 * recently used entry is always whatever's still sitting at the front.
 */
export class MemoryCache {
	private readonly store = new Map<string, CacheEntry>()
	private readonly ttlMs: number
	private readonly maxEntries: number
	private readonly maxBytes: number
	private currentBytes = 0
	private sweepTimer: ReturnType<typeof setInterval> | null = null

	constructor(options?: { ttlMs?: number; maxEntries?: number; maxBytes?: number }) {
		this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS
		this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES
		this.maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES

		// One shared interval instead of a timer per key, that's what keeps this
		// cheap even with thousands of entries in flight. The interval scales with
		// the configured TTL (a short TTL sweeps often, a long one rarely) but is
		// clamped to a sane range so it's never pathologically tight or pathologically
		// slow. `.unref()` means this timer alone will never keep the Node process
		// alive, it only runs while something else is keeping the event loop busy anyway.
		const sweepIntervalMs = Math.min(Math.max(this.ttlMs / 2, 50), 5000)
		this.sweepTimer = setInterval(() => this.sweepExpired(), sweepIntervalMs)
		this.sweepTimer.unref?.()
	}

	get(key: string): { value: string; version: number } | null {
		const entry = this.store.get(key)
		if (!entry) {
			return null
		}

		if (entry.expiresAt <= Date.now()) {
			this.store.delete(key)
			this.currentBytes -= entry.byteSize
			return null
		}

		// Touch: move this entry to the end so it counts as "recently used".
		this.store.delete(key)
		this.store.set(key, entry)

		return { value: entry.value, version: entry.version }
	}

	set(key: string, value: string, version: number): void {
		const existing = this.store.get(key)
		if (existing) {
			this.currentBytes -= existing.byteSize
			this.store.delete(key)
		}

		const byteSize = Buffer.byteLength(value, 'utf8')
		this.store.set(key, { value, version, expiresAt: Date.now() + this.ttlMs, byteSize })
		this.currentBytes += byteSize

		this.evictIfNeeded()
	}

	delete(key: string): void {
		const entry = this.store.get(key)
		if (entry) {
			this.currentBytes -= entry.byteSize
			this.store.delete(key)
		}
	}

	/** Drops every entry whose key starts with the given session prefix, used by deleteSession/clearCache. */
	deleteByPrefix(prefix: string): void {
		for (const key of this.store.keys()) {
			if (key.startsWith(prefix)) {
				this.delete(key)
			}
		}
	}

	clear(): void {
		this.store.clear()
		this.currentBytes = 0
	}

	get size(): number {
		return this.store.size
	}

	get approximateBytes(): number {
		return this.currentBytes
	}

	/** Stops the sweep interval. Call this when the auth manager is done, so it doesn't leak a handle. */
	destroy(): void {
		if (this.sweepTimer) {
			clearInterval(this.sweepTimer)
			this.sweepTimer = null
		}

		this.clear()
	}

	private evictIfNeeded(): void {
		// The Map iterates oldest-first, which is exactly LRU order for us.
		while ((this.store.size > this.maxEntries || this.currentBytes > this.maxBytes) && this.store.size > 0) {
			const oldestKey = this.store.keys().next().value as string | undefined
			if (!oldestKey) {
				break
			}

			this.delete(oldestKey)
		}
	}

	private sweepExpired(): void {
		const now = Date.now()
		for (const [key, entry] of this.store) {
			if (entry.expiresAt <= now) {
				this.delete(key)
			}
		}
	}
}

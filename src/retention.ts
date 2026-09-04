import type { SignalDataTypeMap } from 'baileys'
import type { CacheManager } from './cache/cache-manager.js'
import type { IDatabaseAdapter, KeyRetentionOptions, Logger } from './types.js'

const CREDS_KEY = 'creds'

/**
 * Every signal data category Baileys knows about, this list has to be kept in
 * sync with SignalDataTypeMap (src/types.ts re-exports it from 'baileys'). It's
 * a plain array rather than deriving it from the type at runtime because
 * TypeScript types don't exist at runtime, there's no way to enumerate a type's
 * keys without writing them down somewhere.
 *
 * Sorted longest-first on purpose: stored keys look like "<category>-<id>", and
 * several categories contain hyphens themselves ("sender-key-memory" contains
 * "sender-key"). Checking the longest candidates first means "sender-key-memory-abc"
 * resolves to "sender-key-memory", not the shorter, wrong "sender-key" prefix.
 */
const CATEGORIES: Array<keyof SignalDataTypeMap> = [
	'app-state-sync-version',
	'sender-key-memory',
	'app-state-sync-key',
	'identity-key',
	'device-list',
	'lid-mapping',
	'sender-key',
	'pre-key',
	'session',
	'tctoken'
].sort((a, b) => b.length - a.length) as Array<keyof SignalDataTypeMap>

/**
 * Recovers which signal data category a stored key belongs to. Returns null for
 * "creds" (it isn't a signal data category at all) and for anything that
 * doesn't match a known category, which should only happen if this list ever
 * drifts out of sync with Baileys' own SignalDataTypeMap.
 */
export function resolveCategory(key: string): keyof SignalDataTypeMap | null {
	if (key === CREDS_KEY) {
		return null
	}

	for (const category of CATEGORIES) {
		if (key === category || key.startsWith(`${category}-`)) {
			return category
		}
	}

	return null
}

interface PruneDeps {
	sessionId: string
	adapter: IDatabaseAdapter
	cache: CacheManager
	logger: Logger
	options: KeyRetentionOptions
}

/**
 * Walks every key stored for a session and deletes the ones that are both in a
 * configured category and older than that category's configured max age. This
 * is a safety net for entries Baileys never explicitly told us to delete (see
 * KeyRetentionOptions' own doc comment in src/types.ts for the full reasoning),
 * not a replacement for the protocol-driven deletion that already flows through
 * keys.set(..., null) in src/factory.ts with zero configuration needed.
 */
export async function pruneExpiredKeys(deps: PruneDeps): Promise<{ prunedKeys: string[] }> {
	const { sessionId, adapter, cache, logger, options } = deps

	if (!options.enabled) {
		return { prunedKeys: [] }
	}

	const configuredCategories = options.maxAgeMsByCategory
	const allKeys = await adapter.getAllKeys(sessionId)

	// "creds" is excluded here unconditionally, not just by relying on
	// resolveCategory() returning null for it (which it does), the check below
	// is written to be obviously correct on its own even if resolveCategory's
	// behavior ever changed.
	const candidates = allKeys.filter(key => {
		if (key === CREDS_KEY) return false

		const category = resolveCategory(key)
		return category !== null && configuredCategories[category] !== undefined
	})

	if (candidates.length === 0) {
		return { prunedKeys: [] }
	}

	const records = await adapter.getMany(sessionId, candidates)
	const now = Date.now()
	const staleKeys: string[] = []

	for (const key of candidates) {
		const record = records.get(key)
		if (!record) continue

		const category = resolveCategory(key)
		if (!category) continue

		const maxAgeMs = configuredCategories[category]
		if (maxAgeMs === undefined) continue

		if (now - record.updatedAt >= maxAgeMs) {
			staleKeys.push(key)
		}
	}

	if (staleKeys.length === 0) {
		return { prunedKeys: [] }
	}

	await adapter.deleteMany(sessionId, staleKeys)
	await Promise.all(staleKeys.map(key => cache.onDeleted(sessionId, key)))

	logger.info('pruned expired keys', { sessionId, count: staleKeys.length, keys: staleKeys })

	return { prunedKeys: staleKeys }
}

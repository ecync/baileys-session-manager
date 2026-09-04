import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteAdapter } from '../../src/adapters/sqlite-adapter.js'
import { noopLogger } from '../../src/utils/logger.js'

// The sqlite adapter spawns a worker_threads worker from a compiled JS file on
// disk (see src/adapters/sqlite-worker.ts), which does not exist until `npm run
// build` has produced dist/. The "test" script runs the build first for exactly
// this reason; we still check here and skip cleanly instead of failing the
// whole suite if someone runs vitest directly without building first.
//
// better-sqlite3 also ships prebuilt native binaries for common Node
// versions/platforms; on an unsupported combination, or with native builds
// blocked (some sandboxes disable them entirely), it simply isn't loadable.
// That is an environment problem, not a bug in this package, so we skip
// rather than fail in that case too.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const builtWorkerPath = join(repoRoot, 'dist', 'adapters', 'sqlite-worker.js')

let sqliteAvailable = existsSync(builtWorkerPath)
if (sqliteAvailable) {
	try {
		// Importing the module can succeed even when its native binding can't
		// actually load (e.g. no prebuilt binary for this Node version/platform,
		// and no toolchain available to compile one), the failure only shows up
		// once you try to open a database, so that's what we check here.
		const { default: Database } = await import('better-sqlite3')
		new Database(':memory:').close()
	} catch {
		sqliteAvailable = false
	}
}

describe.skipIf(!sqliteAvailable)('SqliteAdapter', () => {
	let dir: string
	let adapter: SqliteAdapter

	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), 'baileys-session-manager-test-'))
		adapter = new SqliteAdapter(join(dir, 'test.sqlite'), noopLogger, undefined, builtWorkerPath)
		await adapter.init()
	})

	afterEach(async () => {
		await adapter.close()
		if (existsSync(dir)) {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it('returns null for a key that was never written', async () => {
		expect(await adapter.get('session-1', 'creds')).toBeNull()
	})

	it('writes and reads a value back', async () => {
		await adapter.set('session-1', 'creds', 'hello world')
		const record = await adapter.get('session-1', 'creds')

		expect(record?.value).toBe('hello world')
		expect(record?.sessionId).toBe('session-1')
		expect(record?.key).toBe('creds')
	})

	it('bumps the version on every subsequent write to the same key', async () => {
		await adapter.set('session-1', 'creds', 'v1')
		const first = await adapter.get('session-1', 'creds')

		await adapter.set('session-1', 'creds', 'v2')
		const second = await adapter.get('session-1', 'creds')

		expect(second?.value).toBe('v2')
		expect(second!.version).toBeGreaterThan(first!.version)
	})

	it('batches multiple entries from setMany into the store', async () => {
		await adapter.setMany('session-1', [
			{ key: 'pre-key-1', value: 'a' },
			{ key: 'pre-key-2', value: 'b' }
		])

		const keys = await adapter.getAllKeys('session-1')
		expect(keys.sort()).toEqual(['pre-key-1', 'pre-key-2'])
	})

	it('deletes a single key', async () => {
		await adapter.set('session-1', 'creds', 'hello')
		await adapter.delete('session-1', 'creds')

		expect(await adapter.get('session-1', 'creds')).toBeNull()
	})

	it('lists distinct session ids across multiple sessions', async () => {
		await adapter.set('session-a', 'creds', '1')
		await adapter.set('session-b', 'creds', '2')

		expect((await adapter.listSessions()).sort()).toEqual(['session-a', 'session-b'])
	})

	it('reports sessionExists correctly before and after deletion', async () => {
		await adapter.set('session-1', 'creds', 'hello')
		expect(await adapter.sessionExists('session-1')).toBe(true)

		await adapter.deleteSession('session-1')
		expect(await adapter.sessionExists('session-1')).toBe(false)
	})
})

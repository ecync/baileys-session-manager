/**
 * Run with: npm install pg && tsx examples/postgres-example.ts
 *
 * PostgreSQL adapter with a Redis TCP cache layered on top, so this example also
 * shows how the cache option plugs into the same useHybridAuthState() call.
 */
import { PostgresAdapter, createRedisTcpCache, useHybridAuthState } from '../src/index.js'

async function main() {
	const adapter = new PostgresAdapter({
		connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres'
	})

	const redis = await createRedisTcpCache({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' })

	const { state, saveCreds, sessionManager } = await useHybridAuthState({
		sessionId: 'example-bot',
		adapter,
		cache: { redis }
	})

	console.log('creds loaded, registered =', state.creds.registered)
	await saveCreds()

	const info = await sessionManager.getSessionInfo()
	console.log('session info:', info)

	await adapter.close()
	await redis.close()
}

main().catch(console.error)

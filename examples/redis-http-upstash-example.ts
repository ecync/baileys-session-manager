/**
 * Run with: npm install @upstash/redis better-sqlite3 && tsx examples/redis-http-upstash-example.ts
 *
 * Shows the HTTP/REST Redis mode (Upstash), which is the one to reach for in
 * serverless or edge environments that can't hold a persistent TCP connection
 * open. Paired here with SQLite as the primary store just to keep the example
 * runnable without any other external service, in a real deployment you'd
 * likely pair this with D1, Postgres, or another edge-friendly database.
 */
import { SqliteAdapter, createRedisHttpCache, useHybridAuthState } from '../src/index.js'

async function main() {
	const adapter = new SqliteAdapter('./sessions.sqlite')

	const redis = await createRedisHttpCache({
		url: process.env.UPSTASH_REDIS_REST_URL!,
		token: process.env.UPSTASH_REDIS_REST_TOKEN!
	})

	const { state, saveCreds } = await useHybridAuthState({
		sessionId: 'example-bot',
		adapter,
		cache: { redis }
	})

	console.log('creds loaded, registered =', state.creds.registered)
	await saveCreds()

	await adapter.close()
}

main().catch(console.error)

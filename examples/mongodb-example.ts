/**
 * Run with: npm install mongodb && tsx examples/mongodb-example.ts
 *
 * Shows the MongoDB adapter on its own, with no cache or encryption configured,
 * just to keep the example focused on what's specific to MongoDB.
 */
import { MongoAdapter, useHybridAuthState } from '../src/index.js'

async function main() {
	const adapter = new MongoAdapter({
		uri: process.env.MONGO_URI ?? 'mongodb://localhost:27017',
		dbName: 'whatsapp'
	})

	const { state, saveCreds, sessionManager } = await useHybridAuthState({
		sessionId: 'example-bot',
		adapter
	})

	console.log('creds loaded, registered =', state.creds.registered)

	// In a real app you'd wire this into Baileys instead:
	// const sock = makeWASocket({ auth: state })
	// sock.ev.on('creds.update', saveCreds)

	await saveCreds()
	console.log('sessions in mongo:', await sessionManager.listSessions())

	await adapter.close()
}

main().catch(console.error)

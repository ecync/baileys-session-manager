import { BufferJSON } from 'baileys'

/**
 * We deliberately reuse Baileys' own BufferJSON replacer/reviver instead of writing
 * our own. Signal keys are full of Buffer/Uint8Array values, and Baileys already
 * knows exactly how it wants those round-tripped through JSON. Reimplementing that
 * here would just be one more place for the two projects to quietly drift apart.
 */
export function serialize(data: unknown): string {
	return JSON.stringify(data, BufferJSON.replacer)
}

export function deserialize<T>(text: string): T {
	return JSON.parse(text, BufferJSON.reviver) as T
}

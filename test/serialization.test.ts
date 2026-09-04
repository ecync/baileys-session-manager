import { describe, expect, it } from 'vitest'
import { deserialize, serialize } from '../src/serialization.js'

describe('serialization', () => {
	it('round-trips plain values untouched', () => {
		const input = { a: 1, b: 'text', c: [1, 2, 3], d: null }
		const result = deserialize<typeof input>(serialize(input))
		expect(result).toEqual(input)
	})

	it('round-trips Buffer values through the BufferJSON wire format', () => {
		const input = { key: Buffer.from('hello world', 'utf8') }
		const json = serialize(input)

		// Confirms we are actually going through BufferJSON's { type: "Buffer", data } shape,
		// not just relying on JSON.stringify's default (wrong) Buffer serialization.
		expect(json).toContain('"type":"Buffer"')

		const result = deserialize<{ key: Buffer }>(json)
		expect(Buffer.isBuffer(result.key)).toBe(true)
		expect(result.key.toString('utf8')).toBe('hello world')
	})

	it('round-trips Uint8Array values the same way Buffers are', () => {
		const input = { key: new Uint8Array([1, 2, 3, 255]) }
		const result = deserialize<{ key: Buffer }>(serialize(input))
		expect(Buffer.from(result.key).equals(Buffer.from([1, 2, 3, 255]))).toBe(true)
	})
})

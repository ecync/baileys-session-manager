import type { Logger } from '../types.js'

/**
 * A logger that does nothing. This is the default so the package stays quiet
 * unless a user hands us a real logger (pino, winston, or anything shaped like
 * the Logger interface works fine).
 */
export const noopLogger: Logger = {
	trace: () => {},
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {}
}

/** A tiny console-backed logger, handy for local development or examples. */
export const consoleLogger: Logger = {
	trace: (msg, meta) => console.debug(`[trace] ${msg}`, meta ?? ''),
	debug: (msg, meta) => console.debug(`[debug] ${msg}`, meta ?? ''),
	info: (msg, meta) => console.info(`[info] ${msg}`, meta ?? ''),
	warn: (msg, meta) => console.warn(`[warn] ${msg}`, meta ?? ''),
	error: (msg, meta) => console.error(`[error] ${msg}`, meta ?? '')
}

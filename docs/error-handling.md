# Error handling and retries

Databases drop connections. Networks hiccup. None of that should crash a bot over a momentary blip.

## Retries

Every adapter wraps its database calls in an exponential backoff retry (`src/utils/retry.ts`, shared through `BaseAdapter.withRetry`, see [Adapters overview](./adapters/overview.md)). A failed call is retried a few times, the delay doubling each attempt, before the error is finally allowed to surface:

```ts
await useHybridAuthState({
	sessionId: 'my-bot',
	adapter,
	retry: {
		retries: 5,        // default is 3
		minDelayMs: 500,   // default is 200 (delay before the first retry)
		maxDelayMs: 10_000 // default is 5000 (cap on the doubling delay)
	},
	logger: myPinoLogger // anything shaped like { trace, debug, info, warn, error }
})
```

With the defaults, a failing call is retried after roughly 200ms, then 400ms, then 800ms, before finally throwing. Every retry attempt logs a `warn` through your provided logger (or is silent if you didn't provide one, the default logger is a no-op).

## What's thrown vs. what's swallowed

- **Database failures are not swallowed.** `keys.set`/`saveCreds` are expected to actually persist, Baileys relies on that. Once every retry is exhausted, the error propagates all the way back to the caller.
- **Cache-layer failures are swallowed**, logged as a `warn`, not thrown. A Redis hiccup on a read just means falling back to the database; on a write, it means the database write (which already succeeded) has a temporarily stale cache entry, which resolves itself on the next miss or the next invalidation. Neither case is data loss, so failing the whole operation over it would make the system less reliable, not more.

## Supplying your own logger

Anything shaped like the `Logger` interface works, this package doesn't depend on a specific logging library:

```ts
interface Logger {
	trace(msg: string, meta?: Record<string, unknown>): void
	debug(msg: string, meta?: Record<string, unknown>): void
	info(msg: string, meta?: Record<string, unknown>): void
	warn(msg: string, meta?: Record<string, unknown>): void
	error(msg: string, meta?: Record<string, unknown>): void
}
```

A pino logger already satisfies this directly. Two built-in options are exported for convenience: `noopLogger` (the default, does nothing) and `consoleLogger` (logs to `console`, handy for local development).

import { defineConfig } from 'tsup'

// We ship both ESM and CJS builds because Baileys itself is ESM-only these days,
// but plenty of consumers of this package still run on CommonJS. Building both
// from one config keeps us from maintaining two separate build pipelines.
export default defineConfig({
  // sqlite-worker gets its own entry point because it runs inside a
  // worker_threads worker, spawned by path at runtime, not imported normally.
  entry: {
    index: 'src/index.ts',
    'adapters/sqlite-worker': 'src/adapters/sqlite-worker.ts'
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  splitting: false,
  treeshake: true,
  // These are all optional peer deps, loaded with dynamic import() only when
  // a given adapter is actually used. Bundling them would defeat the point.
  external: [
    'baileys',
    'mongodb',
    'pg',
    'mysql2',
    'mysql2/promise',
    'better-sqlite3',
    'ioredis',
    '@upstash/redis',
    'firebase-admin',
    'firebase-admin/database',
    'firebase-admin/firestore',
    'worker_threads'
  ]
})

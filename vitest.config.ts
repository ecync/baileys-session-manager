import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // The real `baileys` package can't be installed in every environment
      // that runs this test suite (see test/mocks/baileys.ts for why), so we
      // point the module specifier at a small local stand-in during tests only.
      baileys: fileURLToPath(new URL('./test/mocks/baileys.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts']
    },
    testTimeout: 15000
  }
})

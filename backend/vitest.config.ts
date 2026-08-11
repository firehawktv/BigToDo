import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
})

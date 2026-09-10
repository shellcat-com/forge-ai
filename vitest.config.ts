import { defineConfig } from 'vitest/config'
export default defineConfig({
  esbuild: { tsconfigRaw: '{}' },
  test: {
    environment: 'node',
    // Native database suites start isolated servers; bound contention without relaxing assertions.
    maxWorkers: 1,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'server/**/*.test.mjs'],
  },
})

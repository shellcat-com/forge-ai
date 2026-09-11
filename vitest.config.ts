import { defineConfig } from 'vitest/config'
export default defineConfig({
  esbuild: { tsconfigRaw: '{}' },
  test: {
    environment: 'node',
    // Native suites each start PostgreSQL. Bound process/disk contention instead
    // of relaxing lease deadlines or the tests' failure timeouts.
    maxWorkers: 1,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'server/**/*.test.mjs'],
  },
})

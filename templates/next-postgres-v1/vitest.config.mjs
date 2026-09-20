import { defineConfig } from 'vitest/config'
// Generated source cannot add test/config files or replace this protected suite.
export default defineConfig({ test: { environment: 'node', include: ['platform/**/*.test.ts'], passWithNoTests: false } })

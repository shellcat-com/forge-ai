import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'

export default defineConfig(({ mode }) => ({
  server: { proxy: {
    ...(loadEnv(mode, process.cwd(), 'VITE_FORGE_ENGINE_UI').VITE_FORGE_ENGINE_UI === 'true'
      ? { '/api/v1': { target: 'http://127.0.0.1:3002', changeOrigin: false } } : {}),
    '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
  } },
  test: {
    environment: 'node',
  },
}))

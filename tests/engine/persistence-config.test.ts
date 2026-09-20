import { describe, expect, it } from 'vitest'
import {
  exactHostedOrigin,
  hostedPostgresConfig,
  persistenceChecks,
  persistencePlan,
} from '../../engine/hosting/persistence-config.ts'

describe('hosted persistence configuration is not readiness evidence', () => {
  it('uses exact HTTPS origins and same-origin API paths, with missing services explicit', () => {
    expect(persistencePlan({ FORGE_HOSTED_ORIGIN: 'https://forge-demo.vercel.app' })).toMatchObject(
      {
        apiBase: '/api',
        controlReady: false,
        worker: 'unavailable',
        storage: 'unavailable',
      }
    )
    for (const origin of [
      'http://forge.vercel.app',
      'https://localhost',
      'https://127.0.0.1',
      'https://[::1]',
      'https://forge.vercel.app/',
      'https://forge.vercel.app/path',
      'https://*.vercel.app',
      'https://user:pass@forge.vercel.app',
    ])
      expect(() => exactHostedOrigin(origin)).toThrow()
    expect(() =>
      persistencePlan({
        FORGE_HOSTED_ORIGIN: 'https://forge.vercel.app',
        FORGE_BROWSER_API_BASE: 'http://127.0.0.1:3001',
      })
    ).toThrow('same-origin')
    expect(() =>
      persistencePlan({
        FORGE_HOSTED_ORIGIN: 'https://forge.vercel.app',
        NEXT_PUBLIC_DATABASE_URL: 'private',
      })
    ).toThrow('server-only')
    expect(() =>
      persistencePlan({
        FORGE_HOSTED_ORIGIN: 'https://forge.vercel.app',
        BETTER_AUTH_URL: 'https://other.vercel.app',
      })
    ).toThrow('mismatch')
    expect(() =>
      persistencePlan({
        FORGE_HOSTED_ORIGIN: 'https://forge.vercel.app',
        FORGE_DURABLE_WORKER: 'vercel-function',
      })
    ).toThrow('not selected')
  })
  it('keeps configured adapters unverified until all independently observed checks pass', () => {
    const env = {
      FORGE_HOSTED_ORIGIN: 'https://forge.vercel.app',
      FORGE_HOSTED_MODE: 'control',
      FORGE_DURABLE_WORKER: 'external-process',
      FORGE_OBJECT_BACKEND: 'postgres-encrypted-v1',
    }
    expect(persistencePlan(env).blockers).toEqual([...persistenceChecks])
    const simulated = Object.fromEntries(persistenceChecks.map((k) => [k, 'passed' as const]))
    expect(persistencePlan(env, simulated).controlReady).toBe(true)
    expect(persistencePlan(env, { ...simulated, deployedRestore: 'unverified' }).controlReady).toBe(
      false
    )
  })
  it('pins the administrator PostgreSQL host and verifies TLS regardless of DSN sslmode', () => {
    const config = hostedPostgresConfig(
      'postgresql://runtime:placeholder@ep-example.neon.tech/control?sslmode=require',
      'ep-example.neon.tech'
    )
    expect(config).toMatchObject({
      host: 'ep-example.neon.tech',
      max: 2,
      ssl: { rejectUnauthorized: true, servername: 'ep-example.neon.tech' },
    })
    expect(config.connectionString).toBeUndefined()
    for (const dsn of [
      'postgres://runtime:x@127.0.0.1/control',
      'postgres://runtime:x@other.neon.tech/control',
      'postgres://runtime:x@ep-example.neon.tech/control?sslmode=disable',
      'postgres://runtime:x@ep-example.neon.tech/control?options=-c%20role%3Dadmin',
      'postgres://runtime:x@ep-example.neon.tech/control?sslmode=require&sslmode=disable',
    ])
      expect(() => hostedPostgresConfig(dsn, 'ep-example.neon.tech')).toThrow('rejected')
  })
})

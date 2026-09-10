import { afterAll, beforeAll, expect, it } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { startNativePostgres } from './native-postgres.ts'
import {
  openReadinessProbes,
  runHostedReadiness,
  readinessConfig,
} from '../../scripts/check-hosted-readiness.ts'
import type { ReadinessConfig } from '../../scripts/check-hosted-readiness.ts'

// Synthetic native SQL evidence; socket injection is NOT Neon/TLS/live acceptance.
const env = {
  FORGE_AUTH_MODE: 'hosted',
  FORGE_HOSTED_CONTROL: 'true',
  BETTER_AUTH_URL: 'https://forge.example.com',
  BETTER_AUTH_SECRET: 'synthetic-auth-configuration-not-a-credential',
  FORGE_IDENTITY_BRIDGE_KEY: '11'.repeat(32),
  FORGE_CREDENTIAL_KEYS_JSON: JSON.stringify({ v1: '22'.repeat(32) }),
  FORGE_AUTH_DATABASE_HOST: 'pg.example.com',
  FORGE_CONTROL_DATABASE_HOST: 'pg.example.com',
  FORGE_AUTH_DATABASE_URL: 'postgresql://auth:synthetic@pg.example.com/forge',
  FORGE_CONTROL_API_DATABASE_URL: 'postgresql://api:synthetic@pg.example.com/forge',
  FORGE_CONTROL_WORKER_DATABASE_URL: 'postgresql://worker:synthetic@pg.example.com/forge',
  FORGE_CONTROL_MAINTENANCE_DATABASE_URL: 'postgresql://maintenance:synthetic@pg.example.com/forge',
}
let cluster: Awaited<ReturnType<typeof startNativePostgres>>
beforeAll(async () => {
  cluster = await startNativePostgres()
  for (const name of [
    '0001_initial.sql',
    '0002_runtime_version.sql',
    '0003_unified.sql',
    '0005_public_auth.sql',
  ])
    await cluster.admin.query(
      await readFile(new URL(`../../drizzle/${name}`, import.meta.url), 'utf8')
    )
  for (const name of (await readdir(new URL('../../engine/migrations/', import.meta.url)))
    .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/.test(name) && Number(name.slice(0, 4)) > 2)
    .sort())
    await cluster.admin.query(
      await readFile(new URL(`../../engine/migrations/${name}`, import.meta.url), 'utf8')
    )
  for (const path of ['public-auth-grants.sql', 'hosted-control-database-grants.sql'])
    await cluster.admin.query(
      await readFile(new URL(`../../docs/examples/${path}`, import.meta.url), 'utf8')
    )
  await cluster.admin
    .query(`CREATE ROLE readiness_auth LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    GRANT forge_auth_api TO readiness_auth;
    UPDATE forge_control.control_settings SET environment='hosted',admission_enabled=false,worker_enabled=false,max_running=1,max_previews=2;
    INSERT INTO forge_control.hosted_identity_settings(issuer,enabled,max_users) VALUES('https://forge.example.com/api/auth',false,10)`)
}, 30000)
afterAll(async () => {
  await cluster?.close()
})
function nativeConfig(config: ReadinessConfig) {
  return {
    ...config,
    databases: {
      auth: { ...cluster.config, user: 'readiness_auth' },
      api: { ...cluster.config, user: 'e1_api' },
      worker: { ...cluster.config, user: 'e1_worker' },
      maintenance: { ...cluster.config, user: 'e1_maintenance' },
    },
  }
}
const run = () => runHostedReadiness(env, (cfg) => openReadinessProbes(nativeConfig(cfg)))
it('checks restricted roles/current schemas/disabled gates without changing database state', async () => {
  const before = await cluster.admin.query('SELECT * FROM forge_control.control_settings')
  const result = await run()
  expect(result.foundationPassed, JSON.stringify(result)).toBe(true)
  expect(result.releaseReady).toBe(false)
  expect(result.blockers).toEqual(
    expect.arrayContaining(['ADMISSION_DISABLED', 'WORKER_DISABLED', 'HOSTED_ENROLLMENT_DISABLED'])
  )
  expect((await cluster.admin.query('SELECT * FROM forge_control.control_settings')).rows).toEqual(
    before.rows
  )
  expect(
    (await cluster.admin.query('SELECT count(*)::int AS count FROM public.forge_user')).rows[0]
      .count
  ).toBe(0)
})
it('uses read-only sessions for all four production probe connections', async () => {
  const probes = await openReadinessProbes(nativeConfig(readinessConfig(env)))
  try {
    for (const probe of Object.values(probes)) {
      const result = await probe.query(
        "SELECT current_setting('default_transaction_read_only') AS readonly"
      )
      expect(result.rows[0].readonly).toBe('on')
    }
  } finally {
    for (const probe of Object.values(probes)) await probe.close()
  }
})
it('rejects privilege drift without silently re-granting or resetting roles', async () => {
  await cluster.admin.query('GRANT TEMP ON DATABASE postgres TO e1_api')
  try {
    const result = await run()
    expect(result.foundationPassed).toBe(false)
    expect(result.blockers).toContain('API_RUNTIME_FAILED')
    expect(
      (
        await cluster.admin.query(
          "SELECT has_database_privilege('e1_api','postgres','TEMP') AS allowed"
        )
      ).rows[0].allowed
    ).toBe(true)
  } finally {
    await cluster.admin.query('REVOKE TEMP ON DATABASE postgres FROM e1_api')
  }
})
it('rejects actual RLS drift without repairing it', async () => {
  await cluster.admin.query(
    'ALTER TABLE forge_control.provider_credentials NO FORCE ROW LEVEL SECURITY'
  )
  try {
    const result = await run()
    expect(result.foundationPassed).toBe(false)
    expect(result.blockers).toContain('CONTROL_SCHEMA_FAILED')
  } finally {
    await cluster.admin.query(
      'ALTER TABLE forge_control.provider_credentials FORCE ROW LEVEL SECURITY'
    )
  }
})
it('rejects the wrong Better Auth issuer and cleans up for a subsequent invocation', async () => {
  await cluster.admin.query(
    "UPDATE forge_control.hosted_identity_settings SET issuer='https://wrong.example.com/api/auth'"
  )
  try {
    const result = await run()
    expect(result.foundationPassed).toBe(false)
    expect(result.blockers).toContain('HOSTED_ENROLLMENT_FAILED')
  } finally {
    await cluster.admin.query(
      "UPDATE forge_control.hosted_identity_settings SET issuer='https://forge.example.com/api/auth'"
    )
  }
  expect((await run()).foundationPassed).toBe(true)
})

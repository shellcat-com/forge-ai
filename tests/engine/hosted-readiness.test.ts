import { describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  readinessConfig,
  readinessExitCode,
  runHostedReadiness,
} from '../../scripts/check-hosted-readiness.ts'
import type { ReadinessProbe } from '../../scripts/check-hosted-readiness.ts'

// Synthetic configuration/SQL ports; not live Neon, OAuth or release acceptance.
export const readinessEnv = {
  FORGE_AUTH_MODE: 'hosted',
  FORGE_HOSTED_CONTROL: 'true',
  BETTER_AUTH_URL: 'https://forge.example.com',
  BETTER_AUTH_SECRET: 'synthetic-auth-configuration-not-a-credential',
  FORGE_IDENTITY_BRIDGE_KEY: '11'.repeat(32),
  FORGE_CREDENTIAL_KEYS_JSON: JSON.stringify({ v1: '22'.repeat(32) }),
  FORGE_AUTH_DATABASE_HOST: 'pg.example.com',
  FORGE_CONTROL_DATABASE_HOST: 'pg.example.com',
  FORGE_AUTH_DATABASE_URL: 'postgresql://auth:synthetic@pg.example.com/forge?sslmode=verify-full',
  FORGE_CONTROL_API_DATABASE_URL:
    'postgresql://api:synthetic@pg.example.com/forge?sslmode=verify-full',
  FORGE_CONTROL_WORKER_DATABASE_URL:
    'postgresql://worker:synthetic@pg.example.com/forge?sslmode=verify-full',
  FORGE_CONTROL_MAINTENANCE_DATABASE_URL:
    'postgresql://maintenance:synthetic@pg.example.com/forge?sslmode=verify-full',
  GOOGLE_CLIENT_ID: 'synthetic-id',
  GOOGLE_CLIENT_SECRET: 'synthetic-value',
  GITHUB_CLIENT_ID: 'synthetic-id',
  GITHUB_CLIENT_SECRET: 'synthetic-value',
}
function fixtures(
  change?: (sql: string, rows: Record<string, unknown>[]) => Record<string, unknown>[]
) {
  const seen: string[] = []
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    seen.push(sql)
    expect(sql.trim()).toMatch(/^SELECT\b/)
    expect(sql).not.toMatch(/neon_auth|INSERT INTO|UPDATE |DELETE FROM|CREATE |ALTER |DROP /)
    let rows: Record<string, unknown>[] = []
    if (sql.includes('AS privileged'))
      rows = [
        { privileged: false, temporary_access: false, public_create: false, expected_member: true },
      ]
    else if (sql.includes('AS permitted')) rows = [{ permitted: true }]
    else if (sql.includes('SELECT version'))
      rows = (values![0] as number[]).map((version) => ({ version }))
    else if (sql.includes('c.relname,c.relrowsecurity'))
      rows = (values![0] as string[]).map((relname) => ({
        relname,
        relrowsecurity: true,
        relforcerowsecurity: true,
      }))
    else if (sql.includes('SELECT environment'))
      rows = [
        {
          environment: 'hosted',
          admission_enabled: false,
          worker_enabled: false,
          security_shutdown: false,
          max_running: 1,
          max_previews: 2,
        },
      ]
    else if (sql.includes('SELECT issuer'))
      rows = [{ issuer: readinessEnv.BETTER_AUTH_URL + '/api/auth', enabled: false }]
    return { rows: change ? change(sql, rows) : rows }
  })
  const make = (): ReadinessProbe => ({
    check: vi.fn(async () => {}),
    query,
    close: vi.fn(async () => {}),
  })
  return { probes: { auth: make(), api: make(), worker: make(), maintenance: make() }, seen }
}
describe('current hosted foundation preflight', () => {
  it('validates strict TLS and distinct runtime identities without migration credentials', () => {
    const cfg = readinessConfig(readinessEnv)
    expect(cfg.databases.api.ssl).toEqual({
      rejectUnauthorized: true,
      servername: 'pg.example.com',
    })
    expect(cfg.databases.auth.user).toBe('auth')
  })
  it.each([
    { FORGE_AUTH_MODE: 'local' },
    { BETTER_AUTH_URL: 'http://localhost' },
    { FORGE_APP_ORIGIN: 'https://other.example.com' },
    { BETTER_AUTH_SECRET: 'short' },
    { FORGE_CREDENTIAL_KEYS_JSON: '{' },
    { FORGE_CREDENTIAL_KEYS_JSON: '{}' },
    { FORGE_CREDENTIAL_KEY_ID: 'missing' },
    { NEXT_PUBLIC_PROVIDER_KEY: 'do-not-expose' },
    { FORGE_AUTH_DATABASE_URL: readinessEnv.FORGE_CONTROL_API_DATABASE_URL },
    { FORGE_CONTROL_API_DATABASE_URL: 'postgresql://api:synthetic@pg.example.com/other' },
    {
      FORGE_CONTROL_API_DATABASE_URL:
        'postgresql://api:synthetic@pg.example.com/forge?sslmode=disable',
    },
    { FORGE_SIGNUP_POLICY: 'anything' },
  ])('rejects unsafe or mismatched configuration %# before opening a database', async (changes) => {
    const open = vi.fn()
    const result = await runHostedReadiness({ ...readinessEnv, ...changes }, open)
    expect(result.foundationPassed).toBe(false)
    expect(result.releaseReady).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
  it('reports missing current configuration without requiring legacy Neon auth settings', async () => {
    const result = await runHostedReadiness({}, vi.fn())
    expect(result.blockers.join()).toContain('FORGE_CONTROL_API_DATABASE_URL')
    expect(result.blockers.join()).not.toMatch(/NEON_AUTH_BASE_URL|DATABASE_MIGRATION_URL/)
  })
  it('keeps installed foundations and disabled admission distinct from a release pass', async () => {
    const { probes, seen } = fixtures()
    const result = await runHostedReadiness(readinessEnv, () => probes)
    expect(result.foundationPassed).toBe(true)
    expect(readinessExitCode(result)).toBe(2)
    expect(result.releaseReady).toBe(false)
    expect(result.liveAcceptance).toBe('not-evaluated')
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        'ADMISSION_DISABLED',
        'WORKER_DISABLED',
        'HOSTED_ENROLLMENT_DISABLED',
        'LIVE_BETA_ACCEPTANCE_NOT_EVALUATED',
      ])
    )
    expect(result.gates.freeAllowances).toBe('unverified')
    expect(seen.some((sql) => sql.includes('public.forge_user LIMIT 0'))).toBe(true)
    for (const probe of Object.values(probes)) expect(probe.close).toHaveBeenCalledTimes(1)
  })
  it.each(['privileged', 'temporary_access', 'public_create'])(
    'rejects excessive runtime permission %s',
    async (privilege) => {
      const { probes } = fixtures((sql, rows) =>
        sql.includes('AS privileged') ? [{ ...rows[0], [privilege]: true }] : rows
      )
      expect((await runHostedReadiness(readinessEnv, () => probes)).foundationPassed).toBe(false)
    }
  )
  it('rejects missing migrations, unforced tenant RLS and mismatched issuer', async () => {
    for (const change of [
      (sql: string, rows: Record<string, unknown>[]) =>
        sql.includes('SELECT version') ? rows.slice(0, -1) : rows,
      (sql: string, rows: Record<string, unknown>[]) =>
        sql.includes('c.relname,c.relrowsecurity')
          ? rows.map((r) => ({ ...r, relforcerowsecurity: false }))
          : rows,
      (sql: string, rows: Record<string, unknown>[]) =>
        sql.includes('SELECT issuer')
          ? [{ issuer: 'https://other.example.com/api/auth', enabled: true }]
          : rows,
    ]) {
      const { probes } = fixtures(change)
      expect((await runHostedReadiness(readinessEnv, () => probes)).foundationPassed).toBe(false)
    }
  })
  it('reports absent enrollment, invite-only access and missing social configuration without writing settings', async () => {
    const { probes } = fixtures((sql, rows) => (sql.includes('SELECT issuer') ? [] : rows))
    const result = await runHostedReadiness(
      {
        ...readinessEnv,
        FORGE_SIGNUP_POLICY: 'invite',
        FORGE_HOSTED_CONTROL: 'false',
        GOOGLE_CLIENT_ID: '',
      },
      () => probes
    )
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        'HOSTED_ENROLLMENT_UNCONFIGURED',
        'PUBLIC_SIGNUP_DISABLED',
        'HOSTED_CONNECTIONS_DISABLED',
        'SOCIAL_OAUTH_CONFIGURATION_INCOMPLETE',
      ])
    )
  })
  it('never infers release readiness from enabled settings', async () => {
    const { probes } = fixtures((sql, rows) =>
      sql.includes('SELECT environment')
        ? [{ ...rows[0], admission_enabled: true, worker_enabled: true }]
        : sql.includes('SELECT issuer')
          ? [{ ...rows[0], enabled: true }]
          : rows
    )
    const result = await runHostedReadiness(readinessEnv, () => probes)
    expect(result.releaseReady).toBe(false)
    expect(result.gates.providerGeneration).toBe('unverified')
  })
  it('redacts failures and closes every probe even after a failed check or cleanup', async () => {
    const { probes } = fixtures()
    probes.worker.check = async () => {
      throw new Error(readinessEnv.FORGE_CONTROL_WORKER_DATABASE_URL)
    }
    probes.auth.close = vi.fn(async () => {
      throw new Error('synthetic-private-diagnostic')
    })
    const result = await runHostedReadiness(readinessEnv, () => probes)
    expect(result.foundationPassed).toBe(false)
    expect(JSON.stringify(result)).not.toMatch(/postgresql:|synthetic-private|synthetic-auth/)
    for (const probe of Object.values(probes)) expect(probe.close).toHaveBeenCalledTimes(1)
  })
  it('preserves the existing standalone command and fails closed with no environment', () => {
    const result = spawnSync(process.execPath, ['scripts/check-cloud-readiness.mjs'], {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
      timeout: 15000,
      env: { PATH: process.env.PATH },
    })
    expect(result.status, result.stderr).toBe(1)
    const report = JSON.parse(result.stdout)
    expect(report.releaseReady).toBe(false)
    expect(report.scope).toBe('hosted-foundation-only')
  })
})

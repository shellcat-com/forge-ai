import type { Pool, PoolConfig } from 'pg'
import { readdirSync } from 'node:fs'
import { hostedPostgresConfig, exactHostedOrigin } from '../engine/hosting/persistence-config.ts'

const runtimes = ['auth', 'api', 'worker', 'maintenance'] as const
type Runtime = (typeof runtimes)[number]
const roles = {
  auth: 'forge_auth_api',
  api: 'forge_control_api',
  worker: 'forge_control_worker',
  maintenance: 'forge_control_maintenance',
} as const
const urlVariables = {
  auth: 'FORGE_AUTH_DATABASE_URL',
  api: 'FORGE_CONTROL_API_DATABASE_URL',
  worker: 'FORGE_CONTROL_WORKER_DATABASE_URL',
  maintenance: 'FORGE_CONTROL_MAINTENANCE_DATABASE_URL',
} as const
const tenantTables = [
  'projects',
  'jobs',
  'job_steps',
  'artifacts',
  'snapshots',
  'provider_credentials',
  'provider_validations',
  'provider_choices',
]
const authTables = [
  'forge_user',
  'forge_session',
  'forge_account',
  'forge_verification',
  'forge_beta_invites',
  'forge_auth_admission',
]
type Env = Readonly<Record<string, string | undefined>>
type Row = Record<string, unknown>
export interface ReadinessProbe {
  check(): Promise<void>
  query(sql: string, values?: unknown[]): Promise<{ rows: Row[] }>
  close(): Promise<void>
}
export interface ReadinessConfig {
  origin: string
  databases: Record<Runtime, PoolConfig>
  connectionsEnabled: boolean
  publicSignup: boolean
  googleConfigured: boolean
  githubConfigured: boolean
}
export interface ReadinessReport {
  schemaVersion: 1
  scope: 'hosted-foundation-only'
  foundationPassed: boolean
  releaseReady: false
  liveAcceptance: 'not-evaluated'
  checks: { name: string; passed: boolean }[]
  blockers: string[]
  gates: Record<string, boolean | 'unverified' | 'unconfigured'>
}
export function readinessExitCode(report: ReadinessReport): 1 | 2 {
  return report.foundationPassed ? 2 : 1
}
class ConfigurationError extends Error {
  constructor(readonly reason: string) {
    super('Invalid hosted preflight configuration')
  }
}
/** Only the canonical migration directory, never proposals or generated app SQL. */
export function requiredControlVersions(): number[] {
  const versions = readdirSync(new URL('../engine/migrations/', import.meta.url), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && /^\d{4}_[a-z0-9_-]+\.sql$/.test(entry.name))
    .map((entry) => Number(entry.name.slice(0, 4)))
    .sort((a, b) => a - b)
  if (
    !versions.length ||
    new Set(versions).size !== versions.length ||
    versions.some((v, i) => v !== i + 1)
  )
    throw new Error('Canonical migration sequence unavailable')
  return versions
}
/** Installer/runtime inputs only. Migration-owner credentials are not requested or used. */
export function readinessConfig(env: Env): ReadinessConfig {
  const missing = [
    ...Object.values(urlVariables),
    'FORGE_AUTH_DATABASE_HOST',
    'FORGE_CONTROL_DATABASE_HOST',
    'BETTER_AUTH_URL',
    'BETTER_AUTH_SECRET',
    'FORGE_IDENTITY_BRIDGE_KEY',
    'FORGE_CREDENTIAL_KEYS_JSON',
  ].filter((name) => !env[name])
  if (missing.length) throw new ConfigurationError(`MISSING_CONFIGURATION:${missing.join(',')}`)
  if (env.FORGE_AUTH_MODE !== 'hosted') throw new ConfigurationError('HOSTED_AUTH_DISABLED')
  if (
    Object.entries(env).some(
      ([name, value]) =>
        value && /^(NEXT_PUBLIC_|VITE_).*(SECRET|TOKEN|PASSWORD|DATABASE|KEY)/i.test(name)
    )
  )
    throw new ConfigurationError('CLIENT_SECRET_CONFIGURATION_REJECTED')
  const origin = exactHostedOrigin(env.BETTER_AUTH_URL!)
  for (const name of ['FORGE_APP_ORIGIN', 'FORGE_HOSTED_ORIGIN'])
    if (env[name] && env[name] !== origin) throw new ConfigurationError('ORIGIN_MISMATCH')
  if (
    (env.BETTER_AUTH_SECRET?.length ?? 0) < 32 ||
    !/^[a-f0-9]{64}$/.test(env.FORGE_IDENTITY_BRIDGE_KEY!)
  )
    throw new ConfigurationError('INVALID_PRIVATE_KEY_CONFIGURATION')
  const rawKeys = env.FORGE_CREDENTIAL_KEYS_JSON!
  if (rawKeys.length > 16384) throw new ConfigurationError('INVALID_PRIVATE_KEY_CONFIGURATION')
  let keys: unknown
  try {
    keys = JSON.parse(rawKeys)
  } catch {
    throw new ConfigurationError('INVALID_PRIVATE_KEY_CONFIGURATION')
  }
  const keyId = env.FORGE_CREDENTIAL_KEY_ID ?? 'v1'
  if (
    !keys ||
    typeof keys !== 'object' ||
    Array.isArray(keys) ||
    !/^[a-zA-Z0-9._/-]{1,200}$/.test(keyId) ||
    !Object.hasOwn(keys, keyId) ||
    Object.values(keys).some((v) => typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))
  )
    throw new ConfigurationError('INVALID_PRIVATE_KEY_CONFIGURATION')
  const databases = Object.fromEntries(
    runtimes.map((runtime) => [
      runtime,
      hostedPostgresConfig(
        env[urlVariables[runtime]]!,
        env[runtime === 'auth' ? 'FORGE_AUTH_DATABASE_HOST' : 'FORGE_CONTROL_DATABASE_HOST']!
      ),
    ])
  ) as Record<Runtime, PoolConfig>
  const target = (c: PoolConfig) => `${c.host}:${c.port}/${c.database}`
  if (runtimes.some((r) => target(databases[r]) !== target(databases.auth)))
    throw new ConfigurationError('RUNTIME_DATABASE_TARGET_MISMATCH')
  if (new Set(runtimes.map((r) => databases[r].user)).size !== runtimes.length)
    throw new ConfigurationError('RUNTIME_LOGINS_MUST_BE_DISTINCT')
  if (env.FORGE_SIGNUP_POLICY && !['public', 'invite'].includes(env.FORGE_SIGNUP_POLICY))
    throw new ConfigurationError('INVALID_SIGNUP_POLICY')
  return {
    origin,
    databases,
    connectionsEnabled: env.FORGE_HOSTED_CONTROL === 'true',
    publicSignup: (env.FORGE_SIGNUP_POLICY ?? 'public') === 'public',
    googleConfigured: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    githubConfigured: !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
  }
}

/** CLI-only wiring. Reuse runtime validators with an isolated read-only auth pool
 * through their existing injection seam. Never mount this in an application route.
 */
export async function openReadinessProbes(
  config: ReadinessConfig
): Promise<Record<Runtime, ReadinessProbe>> {
  // Missing/invalid configuration must fail before loading database/auth drivers.
  const [{ default: pg }, { ControlDatabase }, { assertAuthDatabase }] = await Promise.all([
    import('pg'),
    import('../engine/control/database.ts'),
    import('../src/server/auth/database.ts'),
  ])
  const state = globalThis as unknown as { forgeAuthPool?: Pool }
  if (state.forgeAuthPool) throw new Error('Fresh CLI process required')
  const options = { max: 1, options: '-c default_transaction_read_only=on', query_timeout: 5000 }
  const auth = new pg.Pool({ ...config.databases.auth, ...options })
  auth.on('error', () => {
    /* No raw transport errors in the report. */
  })
  state.forgeAuthPool = auth
  const control = (runtime: Exclude<Runtime, 'auth'>): ReadinessProbe => {
    const db = new ControlDatabase(
      { ...config.databases[runtime], ...options },
      roles[runtime],
      'hosted'
    )
    return {
      check: () => db.check(),
      query: (sql: string, values?: unknown[]) => db.pool.query(sql, values),
      close: () => db.close(),
    }
  }
  return {
    auth: {
      check: assertAuthDatabase,
      query: (sql, values) => auth.query(sql, values),
      async close() {
        try {
          await auth.end()
        } finally {
          delete state.forgeAuthPool
        }
      },
    },
    api: control('api'),
    worker: control('worker'),
    maintenance: control('maintenance'),
  }
}

/** Fixed catalog/settings SELECTs only. Never queries user records or contacts a
 * model, mail sender, OAuth service, sandbox, deployment API or localhost worker.
 */
export async function runHostedReadiness(
  env: Env = process.env,
  open: (
    config: ReadinessConfig
  ) =>
    Record<Runtime, ReadinessProbe> | Promise<Record<Runtime, ReadinessProbe>> = openReadinessProbes
): Promise<ReadinessReport> {
  const report: ReadinessReport = {
    schemaVersion: 1,
    scope: 'hosted-foundation-only',
    foundationPassed: false,
    releaseReady: false,
    liveAcceptance: 'not-evaluated',
    checks: [],
    blockers: ['LIVE_BETA_ACCEPTANCE_NOT_EVALUATED'],
    gates: {
      enrollment: 'unconfigured',
      admission: 'unconfigured',
      worker: 'unconfigured',
      freeAllowances: 'unverified',
      keyRecovery: 'unverified',
      restoreDrill: 'unverified',
      providerGeneration: 'unverified',
      sandboxIsolation: 'unverified',
      privatePreview: 'unverified',
      publication: 'unverified',
      selfHosting: 'unverified',
      socialCallbacks: 'unverified',
      migrationHashReceipts: 'unverified',
    },
  }
  let config: ReadinessConfig
  try {
    config = readinessConfig(env)
  } catch (error) {
    report.blockers.push(
      error instanceof ConfigurationError ? error.reason : 'HOSTED_CONFIGURATION_REJECTED'
    )
    return report
  }
  report.gates.hostedConnections = config.connectionsEnabled
  report.gates.publicSignup = config.publicSignup
  report.gates.googleConfigured = config.googleConfigured
  report.gates.githubConfigured = config.githubConfigured
  if (!config.connectionsEnabled) report.blockers.push('HOSTED_CONNECTIONS_DISABLED')
  if (!config.publicSignup) report.blockers.push('PUBLIC_SIGNUP_DISABLED')
  if (!config.googleConfigured || !config.githubConfigured)
    report.blockers.push('SOCIAL_OAUTH_CONFIGURATION_INCOMPLETE')
  let probes: Record<Runtime, ReadinessProbe>
  try {
    probes = await open(config)
  } catch {
    report.blockers.push('DATABASE_PROBES_UNAVAILABLE')
    return report
  }
  const check = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn()
      report.checks.push({ name, passed: true })
    } catch {
      report.checks.push({ name, passed: false })
      report.blockers.push(`${name}_FAILED`)
    }
  }
  try {
    for (const runtime of runtimes)
      await check(`${runtime.toUpperCase()}_RUNTIME`, async () => {
        await probes[runtime].check()
        const {
          rows: [safety],
        } = await probes[runtime].query(
          `SELECT
        EXISTS(SELECT 1 FROM pg_roles r WHERE pg_has_role(current_user,r.oid,'MEMBER') AND
          (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR
           r.rolname IN ('pg_read_server_files','pg_write_server_files','pg_execute_server_program','forge_control_guard') OR
           (r.rolname=ANY($1::text[]) AND r.rolname<>$2))) AS privileged,
        has_database_privilege(current_user,current_database(),'TEMP') AS temporary_access,
        has_schema_privilege(current_user,'public','CREATE') AS public_create,
        pg_has_role(current_user,$2,'MEMBER') AS expected_member`,
          [Object.values(roles), roles[runtime]]
        )
        if (
          !safety ||
          safety.privileged !== false ||
          safety.temporary_access !== false ||
          safety.public_create !== false ||
          safety.expected_member !== true
        )
          throw new Error('Unsafe runtime role')
      })
    await check('AUTH_SCHEMA', async () => {
      const {
        rows: [row],
      } = await probes.auth.query(
        `SELECT bool_and(has_table_privilege(current_user,format('public.%I',t),p)) AS permitted
        FROM unnest($1::text[]) t CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p`,
        [authTables]
      )
      if (row?.permitted !== true) throw new Error('Auth table privileges missing')
      await probes.auth.query('SELECT id,email_verified,disabled_at FROM public.forge_user LIMIT 0')
      await probes.auth.query(
        'SELECT id,token,user_id,created_at,expires_at FROM public.forge_session LIMIT 0'
      )
    })
    await check('CONTROL_SCHEMA', async () => {
      const expectedVersions = requiredControlVersions()
      const { rows: versions } = await probes.api.query(
        'SELECT version FROM forge_control.schema_migrations WHERE version=ANY($1::integer[]) ORDER BY version',
        [expectedVersions]
      )
      if (versions.map((r) => r.version).join(',') !== expectedVersions.join(','))
        throw new Error('Required migrations missing')
      const { rows: tables } = await probes.api.query(
        `SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='forge_control' AND c.relname=ANY($1::text[]) AND c.relkind='r'`,
        [tenantTables]
      )
      for (const name of tenantTables) {
        const table = tables.find((t) => t.relname === name)
        if (table?.relrowsecurity !== true || table.relforcerowsecurity !== true)
          throw new Error('Tenant RLS missing')
      }
    })
    await check('CONTROL_SETTINGS', async () => {
      const {
        rows: [settings],
      } = await probes.api.query(
        `SELECT environment,admission_enabled,worker_enabled,security_shutdown,max_running,max_previews FROM forge_control.control_settings WHERE singleton`
      )
      if (
        settings?.environment !== 'hosted' ||
        typeof settings.admission_enabled !== 'boolean' ||
        typeof settings.worker_enabled !== 'boolean' ||
        typeof settings.security_shutdown !== 'boolean'
      )
        throw new Error('Invalid settings')
      report.gates.admission = settings.admission_enabled
      report.gates.worker = settings.worker_enabled
      if (!settings.admission_enabled) report.blockers.push('ADMISSION_DISABLED')
      if (!settings.worker_enabled) report.blockers.push('WORKER_DISABLED')
      if (settings.security_shutdown) report.blockers.push('SECURITY_SHUTDOWN_ACTIVE')
      if (
        settings.max_running !== 1 ||
        !Number.isInteger(settings.max_previews) ||
        Number(settings.max_previews) < 0 ||
        Number(settings.max_previews) > 2
      )
        report.blockers.push('BETA_GLOBAL_CAP_CONFIGURATION_MISMATCH')
    })
    await check('HOSTED_ENROLLMENT', async () => {
      const {
        rows: [identity],
      } = await probes.api.query(
        'SELECT issuer,enabled FROM forge_control.hosted_identity_settings WHERE singleton'
      )
      if (!identity) {
        report.blockers.push('HOSTED_ENROLLMENT_UNCONFIGURED')
        return
      }
      if (identity.issuer !== `${config.origin}/api/auth` || typeof identity.enabled !== 'boolean')
        throw new Error('Issuer mismatch')
      report.gates.enrollment = identity.enabled
      if (!identity.enabled) report.blockers.push('HOSTED_ENROLLMENT_DISABLED')
    })
  } finally {
    for (const runtime of runtimes) {
      try {
        await probes[runtime].close()
      } catch {
        report.checks.push({ name: `${runtime.toUpperCase()}_CLEANUP`, passed: false })
        report.blockers.push('PROBE_CLEANUP_FAILED')
      }
    }
  }
  report.foundationPassed = report.checks.length > 0 && report.checks.every((c) => c.passed)
  return report
}

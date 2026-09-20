import { isIP } from 'node:net'
import type { PoolConfig } from 'pg'

function publicHostname(hostname: string) {
  return (
    !isIP(hostname.replace(/^\[|\]$/g, '')) &&
    hostname.includes('.') &&
    !/(^|\.)(localhost|local|internal|test|invalid)$/.test(hostname) &&
    /^[a-z0-9.-]+$/.test(hostname) &&
    !hostname.includes('..')
  )
}
export function exactHostedOrigin(value: string): string {
  let u: URL
  try {
    u = new URL(value)
  } catch {
    throw new Error('Exact HTTPS origin required')
  }
  if (
    u.protocol !== 'https:' ||
    u.origin !== value ||
    u.username ||
    u.password ||
    u.port ||
    !publicHostname(u.hostname)
  )
    throw new Error('Exact HTTPS origin required')
  return u.origin
}

/** Explicit administrator-selected host, not a browser destination. TLS hostname
 * verification cannot be overridden by DSN query options. No migration identity.
 * This is configuration only; login grants, schema and network still need probes. */
export function hostedPostgresConfig(value: string, expectedHost: string): PoolConfig {
  try {
    const u = new URL(value)
    if (
      !['postgres:', 'postgresql:'].includes(u.protocol) ||
      u.hostname !== expectedHost ||
      !publicHostname(u.hostname) ||
      u.hash ||
      !u.username ||
      !u.password ||
      !/^\/[A-Za-z0-9_-]+$/.test(u.pathname) ||
      [...u.searchParams].some(
        ([k, v]) => k !== 'sslmode' || !['require', 'verify-full'].includes(v)
      ) ||
      u.searchParams.getAll('sslmode').length > 1
    )
      throw new Error('Invalid DSN')
    const port = u.port ? Number(u.port) : 5432
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port')
    return {
      host: u.hostname,
      port,
      database: u.pathname.slice(1),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      ssl: { rejectUnauthorized: true, servername: u.hostname },
      max: 2,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      idle_in_transaction_session_timeout: 10000,
    }
  } catch {
    throw new Error('Hosted PostgreSQL configuration rejected')
  }
}

export const persistenceChecks = [
  'databaseRoles',
  'schemaVersion',
  'objectVersions',
  'keyRecovery',
  'identity',
  'workerLeaseRecovery',
  'artifactAdoption',
  'sharedSseLimit',
  'hostedRouting',
  'deployedRestore',
] as const
export type PersistenceCheck = (typeof persistenceChecks)[number]
export type PersistenceObservations = Partial<
  Record<PersistenceCheck, 'passed' | 'failed' | 'unverified'>
>

/** Read-only preflight. Observations must come from trusted probes/review, not
 * browser JSON or env booleans. Passing this does not authorize spend/dispatch. */
export function persistencePlan(
  env: Readonly<Record<string, string | undefined>>,
  observations: PersistenceObservations = {}
) {
  const origin = exactHostedOrigin(env.FORGE_HOSTED_ORIGIN ?? '')
  for (const [name, value] of Object.entries(env)) {
    if (value && /^(NEXT_PUBLIC_|VITE_).*(DATABASE|SECRET|TOKEN|PASSWORD|KEY)/i.test(name))
      throw new Error('Persistence credentials must be server-only')
  }
  if (env.FORGE_BROWSER_API_BASE && env.FORGE_BROWSER_API_BASE !== '/api')
    throw new Error('Hosted browser API must use same-origin /api')
  if (env.BETTER_AUTH_URL && env.BETTER_AUTH_URL !== origin)
    throw new Error('Authentication origin mismatch')
  const worker = env.FORGE_DURABLE_WORKER ?? 'unavailable'
  if (!['unavailable', 'external-process'].includes(worker))
    throw new Error('Durable workflow service is not selected; use an external worker')
  const storage = env.FORGE_OBJECT_BACKEND ?? 'unavailable'
  if (!['unavailable', 'postgres-encrypted-v1'].includes(storage))
    throw new Error('Object storage adapter unavailable')
  const mode = env.FORGE_HOSTED_MODE ?? 'website-only'
  if (!['website-only', 'control'].includes(mode)) throw new Error('Invalid hosted mode')
  const blockers: string[] = []
  if (mode === 'website-only') blockers.push('CONTROL_NOT_ENABLED')
  if (worker === 'unavailable') blockers.push('WORKER_NOT_CONFIGURED')
  if (storage === 'unavailable') blockers.push('OBJECT_STORAGE_NOT_CONFIGURED')
  for (const key of persistenceChecks) if (observations[key] !== 'passed') blockers.push(key)
  return {
    schemaVersion: 1 as const,
    origin,
    apiBase: '/api',
    worker,
    storage,
    controlReady: blockers.length === 0,
    blockers,
    // A bounded stream rotates before invocation expiry and reconnects from PG.
    sseRotationMs: 20000,
    functionMaxDurationSeconds: 30,
  }
}

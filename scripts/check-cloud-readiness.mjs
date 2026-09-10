/* global AbortSignal */
import pg from 'pg'

// Read-only preflight. Never print connection strings, provider keys, or user records.
const required = [
  'DATABASE_URL',
  'DATABASE_MIGRATION_URL',
  'NEON_AUTH_BASE_URL',
  'FORGE_APP_ORIGIN',
]
const missing = required.filter((name) => !process.env[name])
if (missing.length) {
  console.error(`Not ready: configure server secrets/settings for ${missing.join(', ')}.`)
  process.exitCode = 1
} else {
  let pool
  try {
    const origin = new URL(process.env.FORGE_APP_ORIGIN)
    const auth = new URL(process.env.NEON_AUTH_BASE_URL)
    if (
      origin.protocol !== 'https:' ||
      origin.origin !== process.env.FORGE_APP_ORIGIN ||
      auth.protocol !== 'https:'
    )
      throw new Error('HTTPS staging origin and auth URL are required.')
    if (process.env.DATABASE_URL === process.env.DATABASE_MIGRATION_URL)
      throw new Error('Use different runtime and migration credentials.')
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 5000,
      max: 1,
    })
    const {
      rows: [role],
    } = await pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
    if (role.rolsuper || role.rolbypassrls) throw new Error('Runtime role bypasses row security.')
    const { rows } = await pool.query(
      "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='forge' AND relkind='r'"
    )
    for (const table of ['profiles', 'workspaces', 'memberships', 'projects']) {
      const found = rows.find((r) => r.relname === table)
      if (!found?.relrowsecurity || !found?.relforcerowsecurity)
        throw new Error(`Missing migration or forced RLS: ${table}.`)
    }
    await pool.query('SELECT id,"emailVerified",banned FROM neon_auth."user" LIMIT 0')
    await pool.query('SELECT id,token,"userId","expiresAt" FROM neon_auth.session LIMIT 0')
    const response = await fetch(auth.href.replace(/\/$/, '') + '/.well-known/jwks.json', {
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok || !Array.isArray((await response.json()).keys))
      throw new Error('Auth signing keys unavailable.')
    console.log(
      'Read-only preflight passed. Live identity journeys, isolation and restore drills still required; this is not release approval.'
    )
  } catch {
    console.error(
      'Preflight failed: check HTTPS configuration, runtime role, reviewed migrations, Neon auth schema/grants and connectivity. Credentials are intentionally omitted.'
    )
    process.exitCode = 1
  } finally {
    await pool?.end()
  }
}

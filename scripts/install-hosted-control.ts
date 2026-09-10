/** Explicit operator migration command. Never imported by an HTTP route or worker.
 * Credentials are supplied through protected server/CLI configuration, not argv.
 * Installs reviewed Forge SQL only; never generated application migrations.
 */
import { readFile, writeFile, open } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import pg from 'pg'
import { hostedPostgresConfig } from '../engine/hosting/persistence-config.ts'

const raw = process.env.FORGE_MIGRATION_DATABASE_URL ?? ''
const expectedDatabase = process.env.FORGE_MIGRATION_DATABASE_NAME ?? ''
const config = hostedPostgresConfig(raw, process.env.FORGE_MIGRATION_DATABASE_HOST ?? '')
if (!expectedDatabase || config.database !== expectedDatabase)
  throw new Error('Explicit dedicated database name confirmation required')
const output = process.env.FORGE_INSTALL_SECRET_OUTPUT
const schemaOnly = process.env.FORGE_INSTALL_SCHEMA_ONLY === 'true'
if (!schemaOnly) {
  if (!output || !resolve(output).includes('/.private/'))
    throw new Error('An ignored .private output path is required')
  // Reserve private output before any mutation. Never overwrite existing secrets.
  const handle = await open(output, 'wx', 0o600)
  await handle.close()
}
const db = new pg.Client({ ...config, statement_timeout: 30000 })
let stage = 'connect'
const credentials: Record<string, string> = {}
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`
function body(sql: string) {
  // Existing engine/role SQL owns explicit outer transactions. Move that boundary
  // around its hash receipt too, without changing the checked-in migration.
  return sql.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '')
}
async function transaction(fn: () => Promise<void>) {
  await db.query('BEGIN')
  try {
    await fn()
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  }
}
try {
  await db.connect()
  await db.query('SELECT pg_advisory_lock(7100123099)')
  stage = 'migration receipts'
  await db.query(`CREATE TABLE IF NOT EXISTS public.forge_hosted_migrations(
    path text PRIMARY KEY, sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
    applied_at timestamptz NOT NULL DEFAULT now())`)
  for (const name of [
    '0001_initial.sql',
    '0002_runtime_version.sql',
    '0003_unified.sql',
    '0005_public_auth.sql',
  ]) {
    stage = `drizzle/${name}`
    const sql = await readFile(stage, 'utf8'),
      hash = createHash('sha256').update(sql).digest('hex')
    await transaction(async () => {
      await db.query(
        'CREATE TABLE IF NOT EXISTS public.forge_migrations(id text PRIMARY KEY,hash text NOT NULL)'
      )
      const id = name.split('_')[0]
      const existing = await db.query('SELECT hash FROM public.forge_migrations WHERE id=$1', [id])
      if (existing.rowCount) {
        if (existing.rows[0].hash !== hash) throw new Error('Migration hash drift')
      } else {
        await db.query(sql)
        await db.query('INSERT INTO public.forge_migrations(id,hash) VALUES($1,$2)', [id, hash])
      }
    })
    console.log(`Verified ${stage}`)
  }
  stage = 'restricted group roles'
  await transaction(async () => {
    const {
      rows: [who],
    } = await db.query('SELECT current_user AS name')
    for (const role of [
      'forge_auth_api',
      'forge_control_api',
      'forge_control_worker',
      'forge_control_maintenance',
      'forge_control_guard',
    ]) {
      const found = await db.query(
        'SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=$1',
        [role]
      )
      if (!found.rowCount)
        await db.query(
          `CREATE ROLE ${quote(role)} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`
        )
      else if (Object.values(found.rows[0]).some(Boolean))
        throw new Error('Unsafe preexisting group role')
      // Needed for ALTER FUNCTION OWNER on a non-superuser migration owner.
      // Runtime logins never inherit this owner or guard membership.
      await db.query(`GRANT ${quote(role)} TO ${quote(who.name)}`)
    }
  })
  for (const path of [
    'engine/migrations/0001_control.sql',
    'engine/migrations/0002_durable_control.sql',
    'engine/migrations/0003_immutable_source_bridge.sql',
    'docs/examples/public-auth-grants.sql',
    'engine/migrations/0004_hosted_identity.sql',
    'engine/migrations/0005_hosted_byok.sql',
    'docs/examples/hosted-control-database-grants.sql',
  ]) {
    stage = path
    const sql = await readFile(path, 'utf8'),
      hash = createHash('sha256').update(sql).digest('hex')
    await transaction(async () => {
      const existing = await db.query(
        'SELECT sha256 FROM public.forge_hosted_migrations WHERE path=$1',
        [path]
      )
      if (existing.rowCount) {
        if (existing.rows[0].sha256 !== hash) throw new Error('Migration hash drift')
        return
      }
      await db.query(body(sql))
      await db.query('INSERT INTO public.forge_hosted_migrations(path,sha256) VALUES($1,$2)', [
        path,
        hash,
      ])
    })
    console.log(`Verified ${path}`)
  }
  stage = 'disabled hosted settings'
  await db.query(`INSERT INTO forge_control.control_settings(singleton,environment,admission_enabled,worker_enabled,max_job_micros,max_queued,max_running,max_previews,max_pending_reviews)
    VALUES(true,'hosted',false,false,0,5,1,1,2) ON CONFLICT(singleton) DO NOTHING`)
  if (!schemaOnly) {
    stage = 'separate runtime logins'
    await transaction(async () => {
      for (const [name, role, variable] of [
        ['forge_hosted_auth', 'forge_auth_api', 'FORGE_AUTH_DATABASE_URL'],
        ['forge_hosted_api', 'forge_control_api', 'FORGE_CONTROL_API_DATABASE_URL'],
        ['forge_hosted_worker', 'forge_control_worker', 'FORGE_CONTROL_WORKER_DATABASE_URL'],
        [
          'forge_hosted_maintenance',
          'forge_control_maintenance',
          'FORGE_CONTROL_MAINTENANCE_DATABASE_URL',
        ],
      ]) {
        if ((await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [name])).rowCount)
          throw new Error(
            'Existing runtime login requires explicit credential reuse or rotation; installer does not reset it'
          )
        const password = randomBytes(32).toString('base64url')
        await db.query(
          `CREATE ROLE ${quote(name)} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE CONNECTION LIMIT 4 PASSWORD ${literal(password)}`
        )
        await db.query(`GRANT ${quote(role)} TO ${quote(name)}`)
        const url = new URL(raw)
        url.username = name
        url.password = password
        credentials[variable] = url.href
      }
      // Persist before COMMIT: credentials are never lost if the process exits just
      // after PostgreSQL commits. A failed transaction leaves a private unusable file.
      await writeFile(output!, JSON.stringify(credentials, null, 2) + '\n', { mode: 0o600 })
    })
  }
  console.log(
    schemaOnly
      ? 'Hosted schema receipts verified; existing runtime secrets preserved.'
      : 'Hosted schema and restricted logins installed. Admission, worker and enrollment remain disabled.'
  )
} catch (error) {
  const code =
    typeof error === 'object' && error && 'code' in error
      ? String(error.code)
      : 'INSTALLATION_FAILED'
  console.error(
    `Installation stopped at ${stage}: ${code}. Completed migration receipts are preserved; no automatic retry or secret reset.`
  )
  process.exitCode = 1
} finally {
  await db.end()
}

// Source-export reference drill only. Forge uses its external validated SQL runner.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
const files = ['0001_tasks.sql', '0002_priority.sql']
const mode = process.argv[2]
if (!['initial', 'all'].includes(mode)) throw Error('Use initial or all')
const client = new pg.Client({ connectionString: process.env.APP_MIGRATION_DATABASE_URL })
if (!process.env.APP_MIGRATION_DATABASE_URL) throw Error('APP_MIGRATION_DATABASE_URL required (never app runtime credentials)')
try {
  await client.connect()
  const identity = (await client.query('SELECT current_database() AS db, current_user AS role')).rows[0]
  if (identity.db !== 'forge_app' || identity.role !== 'forge_migrator') throw Error('Reference database boundary mismatch')
  await client.query('BEGIN')
  await client.query("SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='3s'")
  await client.query('SELECT pg_advisory_xact_lock(736031)')
  await client.query('CREATE TABLE IF NOT EXISTS app._forge_reference_migrations (name text PRIMARY KEY, sha256 text NOT NULL)')
  await client.query('REVOKE ALL ON app._forge_reference_migrations FROM forge_app')
  const applied = (await client.query('SELECT name, sha256 FROM app._forge_reference_migrations ORDER BY name')).rows
  if (applied.some((row, i) => row.name !== files[i])) throw Error('Unexpected prior reference schema')
  for (const name of files) {
    const sql = await readFile(new URL(`../reference/migrations/${name}`, import.meta.url), 'utf8')
    const digest = createHash('sha256').update(sql).digest('hex')
    const previous = applied.find(row => row.name === name)
    if (previous && previous.sha256 !== digest) throw Error('Applied reference migration changed')
    if (previous || mode === 'initial' && name !== files[0]) continue
    await client.query(sql)
    await client.query('INSERT INTO app._forge_reference_migrations(name,sha256) VALUES ($1,$2)', [name, digest])
  }
  await client.query('COMMIT')
} catch {
  // Do not reflect DSNs, SQL, parameters, or server errors into export logs.
  await client.query('ROLLBACK').catch(() => {})
  process.exitCode = 1
  console.error('Reference migration failed; transaction rolled back. Check private database diagnostics.')
} finally { await client.end() }

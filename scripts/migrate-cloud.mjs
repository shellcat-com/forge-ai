import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import pg from 'pg'
if (!process.env.DATABASE_MIGRATION_URL) throw new Error('DATABASE_MIGRATION_URL is required.')
if (process.env.DATABASE_MIGRATION_URL === process.env.DATABASE_URL)
  throw new Error('Use a separate migration role.')
const client = new pg.Client({ connectionString: process.env.DATABASE_MIGRATION_URL })
await client.connect()
try {
  await client.query('BEGIN')
  await client.query('SELECT pg_advisory_xact_lock(748921)')
  await client.query(
    'CREATE TABLE IF NOT EXISTS public.forge_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())'
  )
  const name = '0001_workspace.sql'
  const sql = await readFile(new URL('../server/cloud/migrations/' + name, import.meta.url), 'utf8')
  const checksum = createHash('sha256').update(sql).digest('hex')
  const previous = await client.query(
    'SELECT checksum FROM public.forge_migrations WHERE name=$1',
    [name]
  )
  if (previous.rowCount && previous.rows[0].checksum !== checksum)
    throw new Error('Applied migration checksum mismatch.')
  if (!previous.rowCount) {
    await client.query(sql)
    await client.query('INSERT INTO public.forge_migrations(name,checksum) VALUES($1,$2)', [
      name,
      checksum,
    ])
  }
  await client.query('COMMIT')
  console.log('Cloud schema migration verified.')
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  await client.end()
}

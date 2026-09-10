import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Isolated native PostgreSQL check. No .env/DSN or existing database is read.
const root = mkdtempSync(join(tmpdir(), 'forge-e0-pg-'))
const data = join(root, 'data')
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000 })
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error?.message ?? result.stderr}`)
  return result.stdout
}
let started = false
let failure
try {
  console.log(run('postgres', ['--version']).trim())
  run('initdb', ['-D', data, '-A', 'trust', '--no-locale', '-E', 'UTF8', '-U', 'e0_migration_owner'])
  run('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-k ${root} -h '' -p 55439`, '-w', 'start'])
  started = true
  const args = ['-X', '-h', root, '-p', '55439', '-U', 'e0_migration_owner', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
  run('psql', [...args, '-f', resolve('engine/migrations/0001_control.sql')])
  const assertions = resolve('tests/engine/control-constraints.sql')
  run('psql', [...args, '-f', assertions])
  const count = (readFileSync(assertions, 'utf8').match(/SELECT pg_temp\.(expect_error|assert_true)/g) ?? []).length
  console.log(`PASS: migration from empty native PostgreSQL; ${count} constraint/RLS assertions; fixtures rolled back.`)
} catch (error) {
  failure = error
  console.error(error.message)
  process.exitCode = 1
} finally {
  if (started) {
    try { run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']) }
    catch (error) { console.error(`Cleanup failed: ${error.message}. Data retained at ${root}`); process.exitCode = 1; failure = error; started = false }
  }
  // Do not remove a cluster if stop failed.
  if (!failure || started || !readFileSyncSafe(join(data, 'postmaster.pid'))) rmSync(root, { recursive: true, force: true })
}
function readFileSyncSafe(path) { try { return readFileSync(path, 'utf8') } catch { return null } }

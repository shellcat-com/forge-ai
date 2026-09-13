import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateMigrationSql } from '../../engine/validation/migrations.ts'
import { taskMigration, priorityMigration } from './synthetic-migrations.ts'

/** Native PostgreSQL compatibility and privilege drill for reviewed synthetic
 * SQL only. Never takes SQL, connection strings or credentials from callers.
 * Unix socket/private fresh cluster only; cannot connect to an existing DB. */
export function runNativeMigrationDrill(): { origin: 'native-postgres-synthetic'; version: string; fresh: true; priorSeeded: true; limitedRole: true; cleanup: true } {
  const root = mkdtempSync(join(tmpdir(), 'forge-validation-pg-'))
  const data = join(root, 'data')
  let started = false; let stopped = true
  const run = (command: string, args: string[]): string => {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000,
      env: { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' } })
    if (result.error || result.status !== 0) throw new Error(`Native synthetic PostgreSQL drill failed (${command}): ${result.error?.message ?? result.stderr}`)
    return result.stdout
  }
  try {
    const version = run('postgres', ['--version']).trim()
    run('initdb', ['-D', data, '-A', 'trust', '--no-locale', '-E', 'UTF8', '-U', 'forge_validation_admin'])
    run('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-k ${root} -h '' -p 55438`, '-w', 'start'])
    started = true; stopped = false
    const args = ['-X', '-h', root, '-p', '55438', '-U', 'forge_validation_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
    const sql = (statement: string) => run('psql', [...args, '-c', statement])
    sql('CREATE ROLE app_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;')
    const initial = validateMigrationSql(taskMigration).statements.join('\n')
    const additive = validateMigrationSql(priorityMigration).statements.join('\n')
    for (const seeded of [false, true]) {
      sql('CREATE SCHEMA app AUTHORIZATION app_migrator;')
      sql(`SET ROLE app_migrator; SET statement_timeout = '3s'; ${initial}`)
      if (seeded) sql("SET ROLE app_migrator; INSERT INTO app.tasks(id,title) VALUES ('00000000-0000-4000-8000-000000000001','Reviewed prior seed');")
      sql(`SET ROLE app_migrator; SET statement_timeout = '3s'; ${additive}`)
      const rows = sql('SELECT count(*) FROM app.tasks WHERE priority=\'medium\';')
      if (!new RegExp(`\\n\\s*${seeded ? 1 : 0}\\s*\\n`).test(rows)) throw new Error('Native seeded migration assertion failed')
      sql('SET ROLE app_migrator; GRANT USAGE ON SCHEMA app TO app_runtime; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_runtime;')
      sql(`SET ROLE app_runtime;
        DO $$ BEGIN
          BEGIN CREATE TABLE app.denied(id integer); RAISE EXCEPTION 'runtime created table'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
          BEGIN CREATE ROLE forbidden; RAISE EXCEPTION 'runtime created role'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
          BEGIN PERFORM pg_read_file('/etc/passwd'); RAISE EXCEPTION 'runtime read server file'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
          BEGIN INSERT INTO app.tasks(id,title,priority) VALUES ('00000000-0000-4000-8000-000000000002','bad','urgent'); RAISE EXCEPTION 'invalid priority admitted'; EXCEPTION WHEN check_violation THEN NULL; END;
        END $$;`)
      sql('DROP SCHEMA app CASCADE;')
    }
    run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']); stopped = true
    return { origin: 'native-postgres-synthetic', version, fresh: true, priorSeeded: true, limitedRole: true, cleanup: true }
  } finally {
    if (started && !stopped) {
      try { run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']); stopped = true }
      catch { cleanupFailure(root) }
    }
    if (stopped) rmSync(root, { recursive: true, force: true })
  }
}

function cleanupFailure(root: string): never { throw new Error(`Native PostgreSQL cleanup unconfirmed; cluster retained: ${root}`) }

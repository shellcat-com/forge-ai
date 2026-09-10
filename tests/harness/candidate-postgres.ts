import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256 } from '../../engine/contracts/canonical.ts'
import { validateMigrationSql } from '../../engine/validation/migrations.ts'
import { taskMigration, priorityMigration } from './synthetic-migrations.ts'

/** Trusted candidate compatibility drill only. No caller SQL/DSN, no provider
 * files, no TCP listener, no global installation and no sandbox acceptance. */
export function checkCandidatePostgres() {
  const root = mkdtempSync(join(tmpdir(), 'forge-candidate-db-')), data = join(root, 'data')
  let started = false
  const run = (command: string, args: string[]) => {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60_000,
      env: { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' } })
    if (result.error || result.status !== 0) throw new Error(`Candidate PostgreSQL command failed: ${command}: ${result.stderr}`)
    return result.stdout.trim()
  }
  const stop = () => { run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']); started = false }
  const start = () => {
    run('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-k ${root} -h '' -p 55439`, '-w', 'start'])
    started = true
  }
  try {
    const version = run('postgres', ['--version'])
    if (version !== 'postgres (PostgreSQL) 18.6') throw new Error('Exact PostgreSQL18.6 candidate required')
    run('initdb', ['-D', data, '-A', 'trust', '--no-locale', '-E', 'UTF8', '-U', 'forge_candidate_admin'])
    start()
    const sql = (query: string, database = 'forge_app') => run('psql', ['-X', '-t', '-A', '-h', root, '-p', '55439',
      '-U', 'forge_candidate_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-c', query])
    sql('CREATE DATABASE forge_app;', 'postgres')
    const bootstrap = readFileSync(new URL('../../templates/next-postgres-v1/app-database.sql', import.meta.url), 'utf8')
    sql(bootstrap)
    const roles = sql("SELECT rolname||':'||rolcanlogin||':'||rolsuper||':'||rolcreatedb||':'||rolcreaterole||':'||rolbypassrls||':'||rolconnlimit FROM pg_roles WHERE rolname IN ('forge_app','forge_migrator') ORDER BY rolname;")
    if (roles !== 'forge_app:false:false:false:false:false:5\nforge_migrator:false:false:false:false:false:1') throw new Error('Candidate role boundary mismatch')
    const initial = validateMigrationSql(taskMigration).statements.join('\n')
    const additive = validateMigrationSql(priorityMigration).statements.join('\n')
    for (const seeded of [false, true]) {
      sql(`SET ROLE forge_migrator; ${initial}`)
      if (seeded) sql("SET ROLE forge_app; INSERT INTO app.tasks(id,title) VALUES ('00000000-0000-4000-8000-000000000001','Reviewed prior fixture');")
      sql(`SET ROLE forge_migrator; ${additive}`)
      if (sql("SELECT count(*) FROM app.tasks WHERE priority='medium'") !== (seeded ? '1' : '0')) throw new Error('Candidate additive migration mismatch')
      // Default privileges from the actual bootstrap, without a test GRANT.
      sql("SET ROLE forge_app; INSERT INTO app.tasks(id,title,priority) VALUES ('00000000-0000-4000-8000-000000000002','Reviewed fixture','high'); UPDATE app.tasks SET title='Updated fixture' WHERE priority='high'; DELETE FROM app.tasks WHERE priority='high';")
      sql(`SET ROLE forge_app; DO $$ BEGIN
        BEGIN CREATE TABLE app.denied(id integer); RAISE EXCEPTION 'runtime created table'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        BEGIN CREATE ROLE denied; RAISE EXCEPTION 'runtime created role'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        BEGIN PERFORM pg_read_file('/etc/passwd'); RAISE EXCEPTION 'runtime read host file'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      END $$;`)
      if (!seeded) sql('SET ROLE forge_migrator; DROP TABLE app.tasks;')
    }
    stop(); start()
    if (sql("SELECT title||':'||priority FROM app.tasks") !== 'Reviewed prior fixture:medium') throw new Error('Candidate database restart lost data')
    sql('SET ROLE forge_migrator; DROP TABLE app.tasks;')
    sql('ALTER ROLE forge_migrator LOGIN;')
    const migrationUrl = new URL('postgresql://forge_migrator@localhost/forge_app')
    migrationUrl.searchParams.set('host', root); migrationUrl.searchParams.set('port', '55439')
    const exportedMigration = (mode: string) => spawnSync(process.execPath,
      [fileURLToPath(new URL('../../templates/next-postgres-v1/platform/reference-migrate.mjs', import.meta.url)), mode],
      { encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH, APP_MIGRATION_DATABASE_URL: migrationUrl.toString() } })
    if (exportedMigration('initial').status !== 0) throw new Error('Export initial migration failed')
    sql("SET ROLE forge_app; INSERT INTO app.tasks(id,title) VALUES ('00000000-0000-4000-8000-000000000003','Export prior fixture');")
    if (exportedMigration('all').status !== 0 || exportedMigration('all').status !== 0
      || sql("SELECT title||':'||priority FROM app.tasks") !== 'Export prior fixture:medium') throw new Error('Export additive/replay failed')
    if (sql("SELECT has_table_privilege('forge_app','app._forge_reference_migrations','UPDATE')") !== 'f') throw new Error('Runtime can alter migration history')
    sql("UPDATE app._forge_reference_migrations SET sha256='tampered' WHERE name='0001_tasks.sql'")
    if (exportedMigration('all').status !== 1) throw new Error('Export accepted changed applied migration')
    stop()
    return { schemaVersion: 1, origin: 'platform-authored-candidate-host', version, bootstrapSha256: sha256(bootstrap),
      initialMigrationSha256: sha256(taskMigration), additiveMigrationSha256: sha256(priorityMigration),
      fresh: true, priorSeeded: true, defaultPrivileges: true, restrictedRoles: true, databaseRestart: true,
      exportMigrationReplay: true, exportAppliedHashRejection: true, cleanup: true, guestExecution: false, providerGeneration: false, isolationAcceptance: false }
  } finally {
    if (started) stop()
    // Preserve the cluster if shutdown throws; never hide unconfirmed cleanup.
    rmSync(root, { recursive: true, force: true })
  }
}

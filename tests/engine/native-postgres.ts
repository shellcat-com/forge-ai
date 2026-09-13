import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { ControlDatabase } from '../../engine/control/database.ts'
export async function startNativePostgres() {
  const root = mkdtempSync(join(tmpdir(), 'forge-e1-pg-')),
    data = join(root, 'data')
  const run = (cmd: string, args: string[]) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000 })
    if (r.error || r.status !== 0) throw new Error(`${cmd}: ${r.error?.message ?? r.stderr}`)
    return r.stdout
  }
  let started = false
  const stop = () => {
    if (started) {
      run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop'])
      started = false
    }
    rmSync(root, { recursive: true, force: true })
  }
  try {
    const version = run('postgres', ['--version']).trim()
    run('initdb', [
      '-D',
      data,
      '-A',
      'trust',
      '--no-locale',
      '-E',
      'UTF8',
      '-U',
      'e1_migration_owner',
    ])
    const quote = (v: string) => `'${v.replaceAll("'", "'\\''")}'`
    run('pg_ctl', [
      '-D',
      data,
      '-l',
      join(root, 'postgres.log'),
      '-o',
      `-k ${quote(root)} -h '' -p 55440`,
      '-w',
      'start',
    ])
    started = true
    const config = { host: root, port: 55440, database: 'postgres' }
    const admin = new pg.Pool({ ...config, user: 'e1_migration_owner' })
    for (const name of ['0001_control.sql', '0002_durable_control.sql'])
      await admin.query(
        readFileSync(new URL(`../../engine/migrations/${name}`, import.meta.url), 'utf8')
      )
    await admin.query(`CREATE ROLE e1_api LOGIN NOSUPERUSER NOBYPASSRLS; GRANT forge_control_api TO e1_api;
      CREATE ROLE e1_worker LOGIN NOSUPERUSER NOBYPASSRLS; GRANT forge_control_worker TO e1_worker;
      CREATE ROLE e1_maintenance LOGIN NOSUPERUSER NOBYPASSRLS; GRANT forge_control_maintenance TO e1_maintenance;
      INSERT INTO forge_control.control_settings(singleton,environment,admission_enabled,worker_enabled,max_job_micros,max_queued,max_running) VALUES(true,'synthetic',true,true,100,50,10)`)
    const api = new ControlDatabase({ ...config, user: 'e1_api' }, 'forge_control_api')
    const worker = new ControlDatabase({ ...config, user: 'e1_worker' }, 'forge_control_worker')
    const maintenance = new ControlDatabase(
      { ...config, user: 'e1_maintenance' },
      'forge_control_maintenance'
    )
    await Promise.all([api.check(), worker.check(), maintenance.check()])
    return {
      admin,
      api,
      worker,
      maintenance,
      version,
      config,
      async close() {
        await Promise.all([api.close(), worker.close(), maintenance.close(), admin.end()])
        stop()
      },
    }
  } catch (error) {
    stop()
    throw error
  }
}

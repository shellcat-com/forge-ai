import { setTimeout as sleep } from 'node:timers/promises'
import { readControlConfig } from './config.ts'
import { ControlDatabase } from './database.ts'
import { FixtureIdentityAdapter, SessionService } from './identity.ts'
import { ControlService } from './service.ts'
import { createControlServer } from './http.ts'
import { ControlWorker } from './worker.ts'
import { FixtureStageAdapter } from './fixture-stage.ts'
import { ControlReconciler, FixtureCleanupAdapter } from './reconciler.ts'

async function main() {
  const config = readControlConfig(process.env)
  if (!config.enabled) {
    console.info('Forge control disabled. No listener, database or worker started.')
    return
  }
  const mode = process.argv[2] ?? 'api'
  if (mode !== 'api' && mode !== 'worker') throw new Error('Use api or worker')
  const stop = new AbortController()
  process.once('SIGINT', () => stop.abort())
  process.once('SIGTERM', () => stop.abort())
  if (mode === 'api') {
    const db = new ControlDatabase({ connectionString: config.databaseUrl }, 'forge_control_api')
    await db.check()
    const sessions = new SessionService(
      db,
      await FixtureIdentityAdapter.create(),
      config.sessionKey,
      config.origin
    )
    const server = createControlServer(new ControlService(db, sessions, config.admission), {
      enabled: true,
      origin: config.origin,
    })
    await new Promise<void>((resolve) => server.listen(config.port, '127.0.0.1', resolve))
    console.info(
      'Forge fixture control listening on loopback. No live identity, provider, execution or preview.'
    )
    await new Promise<void>((resolve) =>
      stop.signal.addEventListener('abort', () => resolve(), { once: true })
    )
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await db.close()
  } else {
    if (!config.workers) {
      console.info('Forge fixture worker disabled.')
      return
    }
    if (
      !process.env.FORGE_CONTROL_WORKER_DATABASE_URL ||
      !process.env.FORGE_CONTROL_MAINTENANCE_DATABASE_URL
    )
      throw new Error('Separate worker and maintenance database identities required')
    // Apply the same loopback/mode validation to every independently held DSN.
    for (const databaseUrl of [
      process.env.FORGE_CONTROL_WORKER_DATABASE_URL,
      process.env.FORGE_CONTROL_MAINTENANCE_DATABASE_URL,
    ])
      readControlConfig({ ...process.env, FORGE_CONTROL_DATABASE_URL: databaseUrl })
    const db = new ControlDatabase(
      { connectionString: process.env.FORGE_CONTROL_WORKER_DATABASE_URL },
      'forge_control_worker'
    )
    const maintenance = new ControlDatabase(
      { connectionString: process.env.FORGE_CONTROL_MAINTENANCE_DATABASE_URL },
      'forge_control_maintenance'
    )
    await db.check()
    await maintenance.check()
    const worker = new ControlWorker(db, new FixtureStageAdapter()),
      reconciler = new ControlReconciler(maintenance, new FixtureCleanupAdapter())
    try {
      while (!stop.signal.aborted) {
        await reconciler.runOnce()
        await worker.runOnce()
        await sleep(1000, undefined, { signal: stop.signal }).catch(() => {})
      }
    } finally {
      await db.close()
      await maintenance.close()
    }
  }
}
main().catch(() => {
  console.error(
    'Forge control failed safely. Check explicit fixture configuration, migration version and runtime role grants.'
  )
  process.exitCode = 1
})

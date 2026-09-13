import process from 'node:process'
import { setInterval } from 'node:timers'
// Test-only process. Uses compiled trusted control code and synthetic PostgreSQL.
import { ControlDatabase } from '../../dist-engine/control/database.js'
import { ControlWorker } from '../../dist-engine/control/worker.js'
import { FixtureStageAdapter } from '../../dist-engine/control/fixture-stage.js'
const db = new ControlDatabase(
  { host: process.env.FORGE_E1_TEST_SOCKET, port: 55440, database: 'postgres', user: 'e1_worker' },
  'forge_control_worker'
)
await db.check()
const worker = new ControlWorker(db, new FixtureStageAdapter(), {
  afterDispatch: async () => {
    process.send?.({ type: 'fixture-dispatched' })
    await new Promise(() => {
      setInterval(() => {}, 1000)
    })
  },
})
await worker.runOnce()
await db.close()

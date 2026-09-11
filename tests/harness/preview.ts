import { readFile } from 'node:fs/promises'
import { PreviewControl } from '../../engine/preview/control.ts'
import { createE2ControlHarness } from './e2-control.ts'
/** Native canonical DB, fixture identity/source/execution. Never live runtime evidence. */
export async function createPreviewHarness() {
  const h = await createE2ControlHarness()
  try {
    await h.db.admin.query(
      await readFile(
        new URL('../../engine/migrations/0007_preview.sql', import.meta.url),
        'utf8'
      )
    )
    const preview = new PreviewControl(h.db.api)
    async function ready(host = 'p1.vercel.app', register = true) {
      const actor = await h.actor(),
        job = await h.job(actor)
      await h.reach(actor, job.id, 'AWAITING_PROMOTION')
      const {
        rows: [route],
      } = await h.db.admin.query(
        `SELECT p.id,p.environment_id,p.generation,e.broker_operation_id,e.lease_epoch FROM forge_control.previews p JOIN forge_control.environments e ON e.id=p.environment_id WHERE p.project_id=$1`,
        [job.projectId]
      )
      if (register)
        await h.db.worker.scoped(actor.workspace, (c) =>
          c.query('SELECT register_preview_route($1,$2,$3,$4,$5,$6)', [
            route.id,
            host,
            route.environment_id,
            route.generation,
            route.broker_operation_id,
            route.lease_epoch,
          ])
        )
      return {
        actor,
        job,
        route,
        host,
        issue: () => preview.issue(actor.token, actor.csrf, route.id, host),
      }
    }
    return { ...h, preview, ready }
  } catch (error) {
    await h.close()
    throw error
  }
}

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../../../../server/db'
import { jobs } from '../../../../../server/db/schema'
import { actor, projectAccess, apiError, AccessError } from '../../../../../server/auth/access'
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const who = await actor(request, true)
    const { id } = await context.params
    const job = await db().query.jobs.findFirst({ where: eq(jobs.id, id) })
    if (!job) throw new AccessError(404, 'Job not found.')
    await projectAccess(who, job.projectId, 'owner')
    const changed = await db()
      .update(jobs)
      .set({ cancelled: true, ...(job.status === 'queued' ? { status: 'cancelled' } : {}) })
      .where(and(eq(jobs.id, id), inArray(jobs.status, ['queued', 'running'])))
      .returning({ status: jobs.status })
    if (changed.length)
      return Response.json({
        cancelled: true,
        status: changed[0].status === 'cancelled' ? 'cancelled' : 'cancelling',
      })
    const current = await db().query.jobs.findFirst({ where: eq(jobs.id, id) })
    return Response.json({
      cancelled: current?.status === 'cancelled',
      status: current?.status ?? 'missing',
    })
  } catch (e) {
    return apiError(e)
  }
}

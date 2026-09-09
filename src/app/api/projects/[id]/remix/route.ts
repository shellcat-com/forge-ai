import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { actor, projectAccess, apiError, AccessError } from '../../../../../server/auth/access'
import { db } from '../../../../../server/db'
import { projects, revisions } from '../../../../../server/db/schema'
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const who = await actor(request, true)
    const { id } = await context.params
    const source = await projectAccess(who, id, 'owner')
    const nextId = randomUUID()
    await db().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${who.id}))`)
      const count = await tx.execute(
        sql`select count(*)::int as count from forge_projects where owner_id=${who.id} and not archived`
      )
      if (Number(count.rows[0].count) >= 5)
        throw new AccessError(429, 'Archive a project before remixing.')
      await tx
        .insert(projects)
        .values({
          id: nextId,
          name: (source.name + ' · Remix').slice(0, 100),
          ownerId: who.id,
          brief: source.brief,
          design: source.design,
        })
      if (source.activeRevision) {
        const revision = await tx.query.revisions.findFirst({
          where: eq(revisions.id, source.activeRevision),
        })
        if (revision) {
          const revisionId = randomUUID()
          await tx
            .insert(revisions)
            .values({
              id: revisionId,
              projectId: nextId,
              files: revision.files,
              database: null,
              runtimeVersion: revision.runtimeVersion,
              summary: 'Independent remix; live data and secrets excluded.',
            })
          await tx
            .update(projects)
            .set({ activeRevision: revisionId })
            .where(eq(projects.id, nextId))
        }
      }
    })
    return Response.json({ id: nextId }, { status: 201 })
  } catch (e) {
    return apiError(e)
  }
}

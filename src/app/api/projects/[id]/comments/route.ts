import { randomUUID } from 'node:crypto'
import { and, eq, asc } from 'drizzle-orm'
import { z } from 'zod'
import { actor, projectAccess, apiError, AccessError } from '../../../../../server/auth/access'
import { smallJson } from '../../../../../server/http/local'
import { db } from '../../../../../server/db'
import { comments, revisions } from '../../../../../server/db/schema'
type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) {
  try {
    const who = await actor(request)
    const { id } = await context.params
    await projectAccess(who, id)
    return Response.json(
      await db()
        .select()
        .from(comments)
        .where(eq(comments.projectId, id))
        .orderBy(asc(comments.createdAt))
        .limit(200)
    )
  } catch (e) {
    return apiError(e)
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const who = await actor(request, true)
    const { id } = await context.params
    await projectAccess(who, id, 'comment')
    const parsed = z
      .object({
        content: z.string().trim().min(1).max(4000),
        revisionId: z.uuid(),
        page: z.string().startsWith('/').max(300).default('/'),
      })
      .strict()
      .safeParse(await smallJson(request))
    if (!parsed.success) throw new AccessError(400, 'Provide a comment and revision.')
    if (
      !(await db().query.revisions.findFirst({
        where: and(eq(revisions.id, parsed.data.revisionId), eq(revisions.projectId, id)),
      }))
    )
      throw new AccessError(404, 'Revision not found.')
    await db()
      .insert(comments)
      .values({ id: randomUUID(), projectId: id, userId: who.id, ...parsed.data })
    return Response.json({ saved: true })
  } catch (e) {
    return apiError(e)
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const who = await actor(request, true)
    const { id } = await context.params
    await projectAccess(who, id, 'owner')
    const parsed = z
      .object({ id: z.uuid(), resolved: z.boolean() })
      .strict()
      .safeParse(await smallJson(request))
    if (!parsed.success) throw new AccessError(400, 'Invalid comment update.')
    await db()
      .update(comments)
      .set({ resolved: parsed.data.resolved })
      .where(and(eq(comments.projectId, id), eq(comments.id, parsed.data.id)))
    return Response.json({ saved: true })
  } catch (e) {
    return apiError(e)
  }
}

import 'server-only'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { actor, projectAccess, apiError, AccessError } from '../../../../server/auth/access'
import { projectDetail } from '../../../../server/projects/service'
import { db } from '../../../../server/db'
import { projects, memberships } from '../../../../server/db/schema'
import { smallJson } from '../../../../server/http/local'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) {
  try {
    const who = await actor(request)
    const { id } = await context.params
    const project = await projectAccess(who, id)
    const detail = await projectDetail(id)
    if (detail && project.ownerId !== who.id) {
      detail.files = {}
      detail.protectedFiles = {}
      detail.jobs = []
      detail.messages = []
    }
    if (detail && !who.local) detail.previewReady = false
    const owner = project.ownerId === who.id
    const member = owner
      ? undefined
      : await db().query.memberships.findFirst({
          where: and(eq(memberships.projectId, id), eq(memberships.userId, who.id)),
        })
    return Response.json(
      { ...detail, permissions: { build: owner, comment: owner || member?.role === 'commenter' } },
      { headers: { 'Cache-Control': 'no-store' } }
    )
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
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        archived: z.boolean().optional(),
        starred: z.boolean().optional(),
        opened: z.boolean().optional(),
        design: z
          .object({
            style: z.string().max(4000),
            preserve: z.string().max(2000),
            exampleId: z.string().max(80).optional(),
          })
          .optional(),
      })
      .strict()
      .safeParse(await smallJson(request))
    if (!parsed.success) throw new AccessError(400, 'Invalid project update.')
    const { opened, ...patch } = parsed.data
    await db()
      .update(projects)
      .set({ ...patch, ...(opened ? { lastOpenedAt: new Date() } : { updatedAt: new Date() }) })
      .where(eq(projects.id, id))
    return Response.json({ saved: true })
  } catch (e) {
    return apiError(e)
  }
}

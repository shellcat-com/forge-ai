import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { actor, projectAccess, apiError, AccessError } from '../../../../../server/auth/access'
import { smallJson } from '../../../../../server/http/local'
import { db } from '../../../../../server/db'
import { memberships, user } from '../../../../../server/db/schema'
type Context = { params: Promise<{ id: string }> }
export async function GET(request: Request, context: Context) {
  try {
    const who = await actor(request)
    const { id } = await context.params
    await projectAccess(who, id, 'owner')
    return Response.json(
      await db()
        .select({
          id: memberships.id,
          userId: memberships.userId,
          role: memberships.role,
          email: user.email,
        })
        .from(memberships)
        .leftJoin(user, eq(memberships.userId, user.id))
        .where(eq(memberships.projectId, id))
    )
  } catch (e) {
    return apiError(e)
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const who = await actor(request, true)
    const { id } = await context.params
    await projectAccess(who, id, 'owner')
    const parsed = z
      .object({ email: z.email(), role: z.enum(['viewer', 'commenter']) })
      .strict()
      .safeParse(await smallJson(request))
    if (!parsed.success) throw new AccessError(400, 'Provide an email and review role.')
    const target = await db().query.user.findFirst({
      where: eq(user.email, parsed.data.email.toLowerCase()),
    })
    if (!target || !target.emailVerified)
      throw new AccessError(400, 'The reviewer must first join Forge and verify their email.')
    if (target.id === who.id) throw new AccessError(400, 'You already own this project.')
    await db()
      .insert(memberships)
      .values({ id: randomUUID(), projectId: id, userId: target.id, role: parsed.data.role })
      .onConflictDoUpdate({
        target: [memberships.projectId, memberships.userId],
        set: { role: parsed.data.role },
      })
    return Response.json({ shared: true })
  } catch (e) {
    return apiError(e)
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const who = await actor(request, true)
    const { id } = await context.params
    await projectAccess(who, id, 'owner')
    const parsed = z
      .object({ membershipId: z.uuid() })
      .strict()
      .safeParse(await smallJson(request))
    if (!parsed.success) throw new AccessError(400, 'Select a reviewer.')
    await db()
      .delete(memberships)
      .where(and(eq(memberships.id, parsed.data.membershipId), eq(memberships.projectId, id)))
    return Response.json({ revoked: true })
  } catch (e) {
    return apiError(e)
  }
}

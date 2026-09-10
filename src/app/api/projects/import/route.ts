import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { decodeWorkspace } from '../../../../storage'
import { smallJson } from '../../../../server/http/local'
import { actor, apiError, AccessError } from '../../../../server/auth/access'
import { db } from '../../../../server/db'
import { projects } from '../../../../server/db/schema'
export async function POST(request: Request) {
  try {
    const who = await actor(request, true)
    let decoded
    try {
      decoded = decodeWorkspace(JSON.stringify(await smallJson(request, 2_000_000)))
    } catch {
      throw new AccessError(
        400,
        'Unsupported or damaged Forge backup. Preserve your original file.'
      )
    }
    if (decoded.projects.length > 500)
      throw new AccessError(400, 'Import at most 500 drafts at a time.')
    let count = 0
    await db().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${who.id}))`)
      for (const p of decoded.projects) {
        const hex = createHash('sha256').update(`${who.id}:${p.id}`).digest('hex')
        const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
        if (await tx.query.projects.findFirst({ where: eq(projects.id, id) })) continue
        await tx
          .insert(projects)
          .values({
            id,
            ownerId: who.id,
            name: p.name,
            brief: p.prompt,
            design: { style: '', preserve: '', exampleId: p.presetId },
            archived: true,
            createdAt: new Date(p.createdAt),
            updatedAt: new Date(p.updatedAt),
          })
        count++
      }
    })
    return Response.json({ count, archived: true })
  } catch (e) {
    return apiError(e)
  }
}

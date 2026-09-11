import 'server-only'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../../../server/db'
import { projects } from '../../../server/db/schema'
import { smallJson } from '../../../server/http/local'
import { actor, apiError, requireBuilder, AccessError } from '../../../server/auth/access'
import { createProject, requireGenerationAvailable } from '../../../server/projects/service'
import { creationSchema } from '../../../shared/creation'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  try {
    const who = await actor(request)
    const url = new URL(request.url)
    const q = (url.searchParams.get('q') ?? '').slice(0, 200)
    const filter = url.searchParams.get('filter') ?? 'owned'
    const page = Math.max(0, Math.min(10000, Number(url.searchParams.get('page')) || 0))
    const owned = eq(projects.ownerId, who.id)
    const shared = sql`exists(select 1 from forge_memberships m where m.project_id=${projects.id} and m.user_id=${who.id})`
    const where = and(
      filter === 'shared' ? shared : owned,
      eq(projects.archived, filter === 'archived'),
      filter === 'starred' ? eq(projects.starred, true) : undefined,
      q
        ? sql`to_tsvector('simple',${projects.name} || ' ' || ${projects.brief}) @@ plainto_tsquery('simple',${q})`
        : undefined
    )
    return Response.json(
      await db()
        .select()
        .from(projects)
        .where(where)
        .orderBy(
          url.searchParams.get('sort') === 'name'
            ? projects.name
            : desc(
                url.searchParams.get('sort') === 'updated'
                  ? projects.updatedAt
                  : projects.lastOpenedAt
              )
        )
        .limit(24)
        .offset(page * 24),
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (e) {
    return apiError(e)
  }
}
export async function POST(request: Request) {
  try {
    const who = await actor(request, true)
    requireBuilder(who)
    await requireGenerationAvailable()
    const raw = await smallJson(request, 50000)
    const parsed = creationSchema.safeParse(raw)
    if (!parsed.success)
      throw new AccessError(
        400,
        'Provide a prompt of 20–12,000 characters, a valid mode and model.'
      )
    return Response.json(await createProject(parsed.data, who.id), { status: 201 })
  } catch (e) {
    return apiError(e)
  }
}

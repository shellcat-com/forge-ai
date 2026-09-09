import { sql } from 'drizzle-orm'
import { actor, apiError } from '../../../server/auth/access'
import { db } from '../../../server/db'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  try {
    const who = await actor(request)
    const result = await db().execute(
      sql`select count(*)::int as used from forge_jobs where owner_id=${who.id} and kind <> 'restore' and created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'`
    )
    const used = Number(result.rows[0].used)
    return Response.json(
      {
        used,
        limit: 10,
        remaining: Math.max(0, 10 - used),
        resetsAt: new Date(
          Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            new Date().getUTCDate() + 1
          )
        ).toISOString(),
        reset: 'Daily at 00:00 UTC',
        hostedEnabled: false,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (e) {
    return apiError(e)
  }
}

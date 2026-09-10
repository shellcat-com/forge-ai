import 'server-only'
import { actor, apiError } from '../../../server/auth/access'
import { readiness } from '../../../server/projects/service'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  try {
    await actor(request)
  } catch (error) {
    return apiError(error)
  }
  try {
    return Response.json(await readiness(), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return Response.json(
      {
        database: false,
        worker: false,
        message:
          process.env.FORGE_AUTH_MODE === 'hosted'
            ? 'The workspace database is unavailable. Please retry later.'
            : 'Run npm run setup:local and npm run db:migrate to prepare PostgreSQL.',
      },
      { status: 503 }
    )
  }
}

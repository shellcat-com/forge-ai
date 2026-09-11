import { hostedActor } from '../../../../server/control/hosted'
import { apiError } from '../../../../server/auth/access'

export const runtime = 'nodejs'
export async function POST(request: Request) {
  try {
    const { userId, workspaceId, expiresAt } = await hostedActor(request, true)
    // Engine/session credentials never leave the trusted backend.
    return Response.json(
      { userId, workspaceId, expiresAt },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    return apiError(error)
  }
}

import { actor, apiError } from '../../../server/auth/access'
import { authCapabilities } from '../../../server/auth/config'
export async function GET(request: Request) {
  try {
    return Response.json(
      { user: await actor(request), ...authCapabilities() },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 401)
      return Response.json({ user: null, ...authCapabilities() })
    return apiError(error)
  }
}

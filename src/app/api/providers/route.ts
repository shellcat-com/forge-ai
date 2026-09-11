import 'server-only'
import { providerStatuses } from '../../../server/providers/registry'
import { actor, apiError } from '../../../server/auth/access'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  try {
    await actor(request)
  } catch (error) {
    return apiError(error)
  }
  if (process.env.FORGE_AUTH_MODE === 'hosted')
    return Response.json([], { headers: { 'Cache-Control': 'no-store' } })
  return Response.json(await providerStatuses(request.signal), {
    headers: { 'Cache-Control': 'no-store' },
  })
}

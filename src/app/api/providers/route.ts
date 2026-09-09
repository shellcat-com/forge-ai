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
  return Response.json(await providerStatuses(request.signal), {
    headers: { 'Cache-Control': 'no-store' },
  })
}

import 'server-only'
import { assertLocalRequest } from '../../../../server/http/local'
export async function POST(request: Request) {
  try {
    assertLocalRequest(request, true)
  } catch {
    return Response.json({ error: 'Forbidden origin' }, { status: 403 })
  }
  return Response.json(
    { error: 'Save a user-owned connection and test its capabilities in Connections.' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  )
}

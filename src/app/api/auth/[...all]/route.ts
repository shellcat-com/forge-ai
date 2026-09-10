import { auth } from '../../../../server/auth/config'
export const dynamic = 'force-dynamic'
async function handle(request: Request) {
  try {
    return await auth().handler(request)
  } catch {
    return Response.json({ error: 'Authentication is not configured.' }, { status: 503 })
  }
}
export const GET = handle
export const POST = handle

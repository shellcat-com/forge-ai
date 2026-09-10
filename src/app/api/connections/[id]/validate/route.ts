import { validateConnection } from '../../../../../server/control/connections'
import { connectionError } from '../../../../../server/control/connections'
export const runtime = 'nodejs'
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await validateConnection(request, (await context.params).id), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return connectionError(error)
  }
}

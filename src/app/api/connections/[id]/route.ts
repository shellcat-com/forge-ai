import { mutateConnection } from '../../../../server/control/connections'
import { connectionError } from '../../../../server/control/connections'
export const runtime = 'nodejs'
type Context = { params: Promise<{ id: string }> }
export async function PATCH(request: Request, context: Context) {
  try {
    return Response.json(await mutateConnection(request, 'rotate', (await context.params).id), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return connectionError(error)
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    return Response.json(await mutateConnection(request, 'delete', (await context.params).id), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return connectionError(error)
  }
}

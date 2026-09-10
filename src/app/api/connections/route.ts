import { listConnections, mutateConnection } from '../../../server/control/connections'
import { connectionError } from '../../../server/control/connections'
export const runtime = 'nodejs'
export async function GET(request: Request) {
  try {
    return Response.json(await listConnections(request), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return connectionError(error)
  }
}
export async function POST(request: Request) {
  try {
    return Response.json(await mutateConnection(request, 'connect'), {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return connectionError(error)
  }
}

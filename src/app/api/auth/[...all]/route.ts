import { auth } from '../../../../server/auth/config'
import { assertAuthRequest } from '../../../../server/auth/policy'
import { admitAuthRequest } from '../../../../server/auth/rate-limit'
import { withAuthDelivery } from '../../../../server/auth/delivery'
import { assertAuthDatabase } from '../../../../server/auth/database'
export const dynamic = 'force-dynamic'
export const maxDuration = 15
async function handle(request: Request) {
  try {
    assertAuthRequest(request)
  } catch {
    return Response.json(
      { error: 'Authentication requires the configured HTTPS origin.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    )
  }
  try {
    await assertAuthDatabase()
    const retry = await admitAuthRequest(new URL(request.url).pathname)
    if (retry)
      return Response.json(
        { error: 'Too many account requests. Please retry later.' },
        { status: 429, headers: { 'Retry-After': String(retry), 'Cache-Control': 'no-store' } }
      )
    let forwarded = request
    if (request.method === 'POST') {
      if (
        request.headers.get('content-encoding') &&
        request.headers.get('content-encoding') !== 'identity'
      )
        return new Response(null, { status: 415 })
      const reader = request.body?.getReader(),
        chunks: Uint8Array[] = []
      let size = 0
      if (reader)
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > 16384) return new Response(null, { status: 413 })
            chunks.push(value)
          }
        } finally {
          await reader.cancel().catch(() => {})
        }
      forwarded = new Request(request.url, {
        method: 'POST',
        headers: request.headers,
        body: Buffer.concat(chunks),
      })
    }
    const response = await withAuthDelivery(() => auth().handler(forwarded))
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch {
    return Response.json({ error: 'Authentication is not configured.' }, { status: 503 })
  }
}
export const GET = handle
export const POST = handle

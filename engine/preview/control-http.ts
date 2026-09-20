import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { PreviewControl } from './control.ts'
import { boundedBody } from './gateway.ts'
import { tokenSchema } from '../control/contracts.ts'
const bodySchema = z.strictObject({
  hostname: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-z0-9.-]+$/),
})
/** Task 01 mounts only on the canonical authenticated control origin. The host in
 * the body must match the immutable registered route; it never creates a route. */
export function previewControlRoutes(control: PreviewControl, forgeOrigin: string) {
  const forge = new URL(forgeOrigin)
  if (forge.protocol !== 'https:' || forge.origin !== forgeOrigin)
    throw new Error('TLS_ORIGIN_REQUIRED')
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const match = /^\/api\/v1\/previews\/([0-9a-f-]{36})\/(tickets|revoke)$/.exec(req.url ?? '')
    if (!match) return false
    const safe = {
      'cache-control': 'no-store',
      'content-type': 'application/json',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    }
    try {
      const names = req.rawHeaders.filter((_, i) => i % 2 === 0).map((h) => h.toLowerCase())
      if (
        new Set(names).size !== names.length ||
        names.some((h) => h === 'forwarded' || h.startsWith('x-forwarded-')) ||
        req.headers.host !== forge.host ||
        req.headers.origin !== forgeOrigin ||
        req.method !== 'POST' ||
        req.headers['content-type'] !== 'application/json'
      )
        throw new Error('INVALID_REQUEST')
      const cookies = (req.headers.cookie ?? '')
        .split(';')
        .map((c) => c.trim())
        .filter((c) => c.startsWith('__Host-forge-control='))
      if (cookies.length !== 1) throw new Error('UNAUTHENTICATED')
      const parent = tokenSchema.parse(cookies[0].slice('__Host-forge-control='.length))
      const csrf = tokenSchema.parse(req.headers['x-csrf-token'])
      const body = bodySchema.parse(
        JSON.parse(Buffer.from(await boundedBody(req, 1024)).toString('utf8'))
      )
      if (match[2] === 'tickets') {
        const result = await control.issue(parent, csrf, match[1], body.hostname)
        res.writeHead(200, safe)
        res.end(JSON.stringify(result))
      } else {
        await control.revoke(parent, csrf, match[1], body.hostname)
        res.writeHead(204, safe)
        res.end()
      }
    } catch {
      res.writeHead(403, safe)
      res.end('{"error":"PREVIEW_UNAVAILABLE"}')
    }
    return true
  }
}

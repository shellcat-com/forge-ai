import type { IncomingMessage, ServerResponse } from 'node:http'
import type { TLSSocket } from 'node:tls'
import { validateDefaultHostnameBoundary } from './hostnames.ts'
import { createServer } from 'node:https'
import type { ServerOptions } from 'node:https'
import type { PreviewAuthority, PreviewGrant } from './control.ts'
import {
  guestRequestHeaders,
  guestResponseHeaders,
  parseLaunchRequest,
  parsePreviewSession,
  previewSessionCookie,
  validateGuestRequest,
} from './policy.ts'

export interface RuntimeRequest {
  method: string
  path: string
  headers: Record<string, string>
  body: Uint8Array
}
export interface RuntimeResponse {
  status: number
  headers: Record<string, string | string[]>
  body: Uint8Array
}
export interface PreviewRuntime {
  /** Authenticated exact generation lookup, fresh health, private RPC to fixed app
   * port; no caller-selected upstream URL. Reject redirects and stale receipts. */
  request(
    grant: PreviewGrant,
    request: RuntimeRequest,
    signal: AbortSignal
  ): Promise<RuntimeResponse>
}
export interface GatewayOptions {
  forgeOrigin: string
  /** One immutable issued hostname per generation, never a branch/production alias. */
  hostname: string
  authority: PreviewAuthority
  runtime: PreviewRuntime
  timeoutMs?: number
}
const closedHeaders = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'content-security-policy':
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'x-content-type-options': 'nosniff',
}

export async function boundedBody(req: IncomingMessage, limit: number): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk as Uint8Array)
    size += bytes.length
    if (size > limit) throw new Error('REQUEST_TOO_LARGE')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks)
}
function exactHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {}
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i].toLowerCase()
    if (name in headers) throw new Error('DUPLICATE_HEADER')
    headers[name] = req.rawHeaders[i + 1]
  }
  // Forwarding headers are never routing authority, even behind a TLS proxy.
  if (Object.keys(headers).some((h) => h === 'forwarded' || h.startsWith('x-forwarded-')))
    throw new Error('INVALID_HOST')
  return headers
}
export function previewGateway(options: GatewayOptions) {
  const { hostname, forgeOrigin, authority, runtime } = options
  validateDefaultHostnameBoundary(forgeOrigin, hostname)
  if (
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname) ||
    hostname.length > 253 ||
    new URL(forgeOrigin).origin !== forgeOrigin ||
    !forgeOrigin.startsWith('https://') ||
    new URL(forgeOrigin).hostname === hostname
  )
    throw new Error('INVALID_GATEWAY_CONFIGURATION')
  const timeoutMs = options.timeoutMs ?? 10_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000)
    throw new Error('INVALID_TIMEOUT')
  return async (req: IncomingMessage, res: ServerResponse) => {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), timeoutMs)
    const disconnected = () => {
      if (!res.writableEnded) abort.abort()
    }
    res.on('close', disconnected)
    try {
      // Race all work, including a stalled body/control RPC, against total deadline.
      await Promise.race([
        (async () => {
          if (!(req.socket as TLSSocket).encrypted) throw new Error('TLS_REQUIRED')
          const headers = exactHeaders(req)
          if (headers.host !== hostname) throw new Error('INVALID_HOST')
          const path = req.url ?? '',
            method = req.method ?? ''
          if (path === '/__forge/launch') {
            const body = Buffer.from(await boundedBody(req, 1024)).toString('utf8')
            const ticket = parseLaunchRequest({
              method,
              path,
              origin: headers.origin,
              expectedForgeOrigin: forgeOrigin,
              contentType: headers['content-type'],
              body,
            })
            const session = await authority.consume(ticket, hostname)
            if (abort.signal.aborted) return
            res.writeHead(200, {
              ...closedHeaders,
              'content-type': 'text/html; charset=utf-8',
              'set-cookie': previewSessionCookie(
                session.token,
                session.grant.sessionExpiresAt,
                Date.now()
              ),
            })
            // An explicit same-site navigation avoids Strict-cookie loss through a
            // cross-site 303 redirect chain. Ticket never enters URL/history/referrer.
            res.end(
              '<!doctype html><html lang="en"><meta charset="utf-8"><title>Private preview ready</title><a href="/">Open private preview</a></html>'
            )
            return
          }
          const token = parsePreviewSession(headers.cookie)
          if (path === '/__forge/renew') {
            if (
              method !== 'POST' ||
              headers.origin !== `https://${hostname}` ||
              (await boundedBody(req, 0)).length
            )
              throw new Error('PREVIEW_CSRF')
            const session = await authority.renew(token, hostname)
            if (abort.signal.aborted) return
            res.writeHead(204, {
              ...closedHeaders,
              'set-cookie': previewSessionCookie(
                session.token,
                session.grant.sessionExpiresAt,
                Date.now()
              ),
            })
            res.end()
            return
          }
          validateGuestRequest(method, path, headers.origin, hostname)
          // Safe methods cannot tunnel a body to the app.
          const body = await boundedBody(req, ['GET', 'HEAD'].includes(method) ? 0 : 1_048_576)
          const grant = await authority.authorize(token, hostname)
          const requestHeaders = guestRequestHeaders(headers)
          delete requestHeaders['content-length']
          delete requestHeaders['accept-encoding']
          const response = await runtime.request(
            grant,
            { method, path, headers: requestHeaders, body },
            abort.signal
          )
          if (
            !Number.isInteger(response.status) ||
            response.status < 200 ||
            response.status > 599 ||
            (response.status >= 300 && response.status < 400) ||
            response.body.byteLength > 4_194_304
          )
            throw new Error('UPSTREAM_REJECTED')
          const safe = guestResponseHeaders(response.headers)
          delete safe['content-length']
          // Buffer and reauthorize before releasing guest bytes: logout/revocation
          // during the upstream request cannot leak the response after it completes.
          const current = await authority.authorize(token, hostname)
          if (
            current.generation !== grant.generation ||
            current.environmentId !== grant.environmentId ||
            current.leaseEpoch !== grant.leaseEpoch
          )
            throw new Error('STALE_ROUTE')
          if (abort.signal.aborted) return
          res.writeHead(response.status, safe)
          res.end(method === 'HEAD' ? undefined : response.body)
        })(),
        new Promise<never>((_, reject) =>
          abort.signal.addEventListener('abort', () => reject(new Error('PREVIEW_TIMEOUT')), {
            once: true,
          })
        ),
      ])
    } catch {
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(abort.signal.aborted ? 504 : 403, {
          ...closedHeaders,
          'content-type': 'text/plain; charset=utf-8',
        })
        res.end(abort.signal.aborted ? 'Preview timed out.' : 'Private preview unavailable.')
      }
    } finally {
      clearTimeout(timer)
      res.off('close', disconnected)
    }
  }
}
/** No HTTP listener or public bind default. Caller supplies TLS material and an
 * explicit private listen address; no automatic environment credential loading. */
export function createPreviewServer(tls: ServerOptions, options: GatewayOptions) {
  const server = createServer(tls, previewGateway(options))
  server.requestTimeout = 10_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 1000
  return server
}

import { z } from 'zod'
import { timestamp, uuid } from '../contracts/primitives.ts'

export const gatewayCookie = '__Host-forge-preview'
const hostname = z.string().min(1).max(253).regex(/^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/)
const viewSchema = z.strictObject({ schemaVersion: z.literal(1), previewId: uuid, generation: uuid,
  workspaceId: uuid, projectId: uuid, userId: uuid, hostname,
  state: z.literal('READY'), authorized: z.literal(true),
  authorizedAt: timestamp, sessionExpiresAt: timestamp, idleExpiresAt: timestamp, absoluteExpiresAt: timestamp })
export type AuthorizedPreview = z.infer<typeof viewSchema>

/** Data returned ONLY by the authenticated control authorization adapter. A
 * request host, random hostname or a client-side login never supplies this grant. */
export function validatePreviewGrant(input: unknown, requestHost: string, now: number): AuthorizedPreview {
  const grant = viewSchema.parse(input)
  if (!Number.isSafeInteger(now) || requestHost !== grant.hostname
    || now < Date.parse(grant.authorizedAt) || now - Date.parse(grant.authorizedAt) > 30_000
    || [grant.sessionExpiresAt, grant.idleExpiresAt, grant.absoluteExpiresAt].some(t => Date.parse(t) <= now))
    throw new Error('PREVIEW_UNAUTHORIZED')
  return grant
}

export function parsePreviewSession(cookieHeader: string | undefined): string {
  if (!cookieHeader || cookieHeader.length > 8192 || /[\r\n\0]/.test(cookieHeader)) throw new Error('PREVIEW_UNAUTHORIZED')
  const reserved = cookieHeader.split(';').map(s => s.trim()).filter(s => s.split('=', 1)[0] === gatewayCookie)
  if (reserved.length !== 1) throw new Error('PREVIEW_UNAUTHORIZED')
  const value = reserved[0].slice(gatewayCookie.length + 1)
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('PREVIEW_UNAUTHORIZED')
  return value
}

export function previewSessionCookie(token: string, expiresAt: string, now: number): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('INVALID_SESSION')
  const expiry = Date.parse(timestamp.parse(expiresAt))
  if (!Number.isSafeInteger(now) || expiry <= now || expiry - now > 1_800_000) throw new Error('INVALID_SESSION')
  return `${gatewayCookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor((expiry - now) / 1000)}`
}

/** Ticket consumption and session creation must be one durable control operation.
 * This parser never consumes a ticket or treats its presence as authorization. */
export function parseLaunchRequest(input: { method: string; path: string; origin: string | undefined;
  expectedForgeOrigin: string; contentType: string | undefined; body: string }) {
  const expected = new URL(input.expectedForgeOrigin)
  if (expected.protocol !== 'https:' || expected.origin !== input.expectedForgeOrigin || expected.username || expected.password
    || input.method !== 'POST' || input.path !== '/__forge/launch' || input.origin !== input.expectedForgeOrigin
    || input.contentType?.split(';')[0].trim() !== 'application/x-www-form-urlencoded' || input.body.length > 1024)
    throw new Error('INVALID_PREVIEW_LAUNCH')
  const fields = new URLSearchParams(input.body)
  if (Array.from(fields.keys()).length !== 1 || fields.getAll('ticket').length !== 1) throw new Error('INVALID_PREVIEW_LAUNCH')
  const ticket = fields.get('ticket')
  if (!ticket || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error('INVALID_PREVIEW_LAUNCH')
  return ticket
}

export function validateGuestRequest(method: string, path: string, origin: string | undefined, exactHostname: string) {
  hostname.parse(exactHostname)
  const parsed = new URL(path, `https://${exactHostname}`)
  if (parsed.origin !== `https://${exactHostname}` || parsed.pathname + parsed.search !== path || /%2e/i.test(parsed.pathname)) throw new Error('INVALID_PREVIEW_REQUEST')
  let decodedPath: string
  try { decodedPath = decodeURIComponent(parsed.pathname) } catch { throw new Error('INVALID_PREVIEW_REQUEST') }
  if (decodedPath.includes('%') || /^\/__forge(?:\/|$)/i.test(decodedPath)) throw new Error('INVALID_PREVIEW_REQUEST')
  if (!path.startsWith('/') || path.startsWith('//') || /[\r\n\0\\]/.test(path)
    || /^\/__forge(?:\/|\?|$)/i.test(path) || /%2f|%5c|%00/i.test(path)
    || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) throw new Error('INVALID_PREVIEW_REQUEST')
  if (!['GET', 'HEAD'].includes(method) && origin !== `https://${exactHostname}`) throw new Error('PREVIEW_CSRF')
}

const blockedRequestHeaders = new Set(['authorization', 'proxy-authorization', 'host', 'connection', 'upgrade', 'transfer-encoding',
  'te', 'trailer', 'keep-alive', 'proxy-connection', 'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'x-forge-session', 'x-csrf-token', 'cookie'])
export function guestRequestHeaders(raw: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {}
  const nominated = new Set(Object.entries(raw).filter(([name]) => name.toLowerCase() === 'connection').flatMap(([, value]) => value.toLowerCase().split(',').map(v => v.trim())))
  for (const [name, value] of Object.entries(raw)) {
    const lower = name.toLowerCase()
    if (!/^[a-z0-9-]+$/.test(lower) || /[\r\n\0]/.test(value)) throw new Error('INVALID_HEADER')
    if (nominated.has(lower) || blockedRequestHeaders.has(lower) || lower.startsWith('x-forge-') || lower.startsWith('sec-websocket-')) continue
    output[lower] = value
  }
  // All cookies are withheld in v1: generated application authentication is deferred.
  return output
}

export function guestResponseHeaders(raw: Record<string, string | string[]>): Record<string, string | string[]> {
  const output: Record<string, string | string[]> = {}
  for (const [name, rawValue] of Object.entries(raw)) {
    const lower = name.toLowerCase()
    const values = typeof rawValue === 'string' ? [rawValue] : rawValue
    if (!/^[a-z0-9-]+$/.test(lower) || values.some(v => /[\r\n\0]/.test(v))) throw new Error('INVALID_HEADER')
    if (lower === 'set-cookie') {
      const names = new Set<string>()
      for (const value of values) {
        const cookieName = value.split('=', 1)[0].trim()
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(cookieName) || cookieName.toLowerCase() === gatewayCookie.toLowerCase()
          || /(?:^|;)\s*domain\s*=/i.test(value) || names.has(cookieName)) throw new Error('RESERVED_PREVIEW_COOKIE')
        names.add(cookieName)
      }
      // No guest cookies forwarded in this first template; reject unsafe ones rather than silently trusting them.
      continue
    }
    if (['connection', 'upgrade', 'transfer-encoding', 'content-security-policy', 'set-cookie2', 'refresh', 'clear-site-data'].includes(lower)
      || lower.startsWith('access-control-') || lower.startsWith('x-forge-')) continue
    if (lower === 'location' && values.some(v => !v.startsWith('/') || v.startsWith('//') || /\\|%5c|%2f|\/__forge/i.test(v))) throw new Error('INVALID_PREVIEW_REDIRECT')
    if (!['content-type', 'content-length', 'content-encoding', 'etag', 'last-modified', 'vary', 'location', 'accept-ranges', 'content-range'].includes(lower)) continue
    if (lower === 'location') for (const value of values) validateGuestRequest('GET', value, undefined, 'preview.invalid')
    output[lower] = rawValue
  }
  return { ...output,
    'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; worker-src 'none'",
    'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin',
  }
}

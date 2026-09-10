import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { gatewayCookie, parsePreviewSession, previewSessionCookie, parseLaunchRequest, validateGuestRequest,
  validatePreviewGrant, guestRequestHeaders, guestResponseHeaders } from '../../engine/preview/policy.ts'
const token = 'a'.repeat(43), now = Date.parse('2026-09-10T00:00:00Z')
const grant = () => ({ schemaVersion: 1, previewId: randomUUID(), generation: randomUUID(), workspaceId: randomUUID(),
  projectId: randomUUID(), userId: randomUUID(), hostname: 'p1.preview.example', state: 'READY', authorized: true,
  authorizedAt: new Date(now).toISOString(), sessionExpiresAt: new Date(now + 60_000).toISOString(),
  idleExpiresAt: new Date(now + 60_000).toISOString(), absoluteExpiresAt: new Date(now + 60_000).toISOString() })
describe('preview gateway policy (synthetic grants, no gateway deployment)', () => {
  it('requires exact host, fresh control grant and all expiries', () => {
    expect(validatePreviewGrant(grant(), 'p1.preview.example', now).state).toBe('READY')
    for (const [g, host, time] of [[grant(), 'p2.preview.example', now], [grant(), 'p1.preview.example:443', now],
      [grant(), 'p1.preview.example', now + 30_001], [{ ...grant(), authorized: false }, 'p1.preview.example', now]] as const)
      expect(() => validatePreviewGrant(g, host, time)).toThrow()
  })
  it('rejects duplicate, malformed and absent gateway cookies', () => {
    expect(parsePreviewSession(`app=x; ${gatewayCookie}=${token}`)).toBe(token)
    for (const cookie of [undefined, `${gatewayCookie}=${token}; ${gatewayCookie}=${token}`, `${gatewayCookie}=short`, `${gatewayCookie}=${token}\r\n`])
      expect(() => parsePreviewSession(cookie)).toThrow()
    expect(previewSessionCookie(token, new Date(now + 60_000).toISOString(), now)).toContain('HttpOnly; Secure; SameSite=Strict')
  })
  it('keeps launch tokens out of URL and requires exact Forge origin POST', () => {
    const request = { method: 'POST', path: '/__forge/launch', origin: 'https://forge.example', expectedForgeOrigin: 'https://forge.example',
      contentType: 'application/x-www-form-urlencoded', body: `ticket=${token}` }
    expect(parseLaunchRequest(request)).toBe(token)
    for (const change of [{ method: 'GET' }, { origin: 'https://evil.example' }, { path: `/__forge/launch?ticket=${token}` },
      { body: `ticket=${token}&ticket=${token}` }, { body: `ticket=${token}&next=evil` }]) expect(() => parseLaunchRequest({ ...request, ...change })).toThrow()
  })
  it('enforces mutation origin and reserved namespace', () => {
    expect(() => validateGuestRequest('POST', '/api/tasks', 'https://p1.preview.example', 'p1.preview.example')).not.toThrow()
    for (const path of ['/__forge/launch', '/__FORGE/foo', '//evil.example', '/%2f__forge', '/%5f%5fforge/launch', '/%255f%255fforge/launch'])
      expect(() => validateGuestRequest('GET', path, undefined, 'p1.preview.example')).toThrow()
    expect(() => validateGuestRequest('POST', '/api/tasks', undefined, 'p1.preview.example')).toThrow()
  })
  it('withholds platform credentials, cookies and caller routing headers', () => {
    expect(guestRequestHeaders({ Authorization: 'secret', Cookie: 'secret', 'X-Forge-Session': 'secret',
      'X-Forwarded-Host': 'evil', Host: 'evil', Accept: 'application/json', Connection: 'x-nominated', 'X-Nominated': 'secret', TE: 'trailers', Trailer: 'secret', 'Keep-Alive': 'timeout=100', 'Proxy-Connection': 'keep-alive' })).toEqual({ accept: 'application/json' })
  })
  it('rejects reserved/domain/duplicate cookies and external redirects', () => {
    for (const cookies of [[`${gatewayCookie}=value`], ['a=x; Domain=example'], ['a=x', 'a=y']])
      expect(() => guestResponseHeaders({ 'Set-Cookie': cookies })).toThrow()
    expect(() => guestResponseHeaders({ location: 'https://evil.example' })).toThrow()
    expect(() => guestResponseHeaders({ location: '//evil.example' })).toThrow()
    expect(() => guestResponseHeaders({ location: '/%5f%5fforge/launch' })).toThrow()
    const headers = guestResponseHeaders({ 'Content-Security-Policy-Report-Only': 'report-uri https://evil.example', 'Reporting-Endpoints': 'evil', 'Alt-Svc': 'evil' })
    expect(headers).not.toHaveProperty('content-security-policy-report-only')
    expect(headers).not.toHaveProperty('reporting-endpoints')
    expect(headers).not.toHaveProperty('alt-svc')
    expect(guestResponseHeaders({ 'Access-Control-Allow-Origin': '*', 'Content-Security-Policy': '*', 'Set-Cookie': 'a=x', 'content-type': 'text/html' }))
      .toMatchObject({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' })
  })
})

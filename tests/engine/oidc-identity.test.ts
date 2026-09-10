import { beforeAll, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { OidcIdentityAdapter } from '../../engine/control/oidc-identity.ts'
import { opaqueToken, secureEqual } from '../../engine/control/identity.ts'
import { sha256 } from '../../engine/contracts/canonical.ts'

export const oidcConfig = {
  issuer: 'https://identity.example.invalid/api/auth',
  clientId: 'forge-control',
  clientSecret: 'placeholder-test-secret',
  authorizationEndpoint: 'https://identity.example.invalid/api/auth/oauth2/authorize',
  tokenEndpoint: 'https://identity.example.invalid/api/auth/oauth2/token',
  jwksUri: 'https://identity.example.invalid/api/auth/jwks',
  redirectUri: 'https://forge.example.invalid/api/v1/auth/callback',
  algorithm: 'RS256' as const,
}
let keys: Awaited<ReturnType<typeof generateKeyPair>>
let publicJwk: Awaited<ReturnType<typeof exportJWK>>
beforeAll(async () => {
  keys = await generateKeyPair('RS256')
  publicJwk = await exportJWK(keys.publicKey)
})
async function harness(overrides: Record<string, unknown> = {}) {
  const nonce = opaqueToken(),
    verifier = opaqueToken()
  const now = Math.floor(Date.now() / 1000)
  const jwt = await new SignJWT({
    iss: oidcConfig.issuer,
    aud: oidcConfig.clientId,
    sub: 'synthetic-owner',
    iat: now,
    exp: now + 120,
    nonce,
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .sign(keys.privateKey)
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    expect(init?.redirect).toBe('error')
    expect(init?.credentials).toBe('omit')
    if (String(input) === oidcConfig.jwksUri)
      return Response.json({ keys: [{ ...publicJwk, kid: 'test-key' }] })
    expect(String(input)).toBe(oidcConfig.tokenEndpoint)
    const body = new URLSearchParams(String(init?.body))
    expect(body.get('code_verifier')).toBe(verifier)
    expect(body.get('redirect_uri')).toBe(oidcConfig.redirectUri)
    expect(body.get('grant_type')).toBe('authorization_code')
    return Response.json({ id_token: jwt })
  })
  return { adapter: new OidcIdentityAdapter(oidcConfig, transport), nonce, verifier, transport }
}
it('uses pinned OIDC endpoints, exclusive audience, PKCE S256 and no userinfo/account creation', async () => {
  const h = await harness()
  const state = opaqueToken()
  const url = new URL(
    h.adapter.authorizationUrl({
      state,
      nonce: h.nonce,
      challenge: 'challenge',
      redirectUri: oidcConfig.redirectUri,
    })
  )
  expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  expect(url.searchParams.get('state')).toBe(state)
  expect(url.searchParams.get('response_type')).toBe('code')
  expect(url.searchParams.get('scope')).toBe('openid')
  expect(
    await h.adapter.exchange(
      'provider/code+not-fixture',
      h.verifier,
      sha256(h.nonce),
      oidcConfig.redirectUri
    )
  ).toEqual({ origin: 'oidc', issuer: oidcConfig.issuer, subject: 'synthetic-owner' })
  expect(h.transport).toHaveBeenCalledTimes(2)
})
it.each([
  { iss: 'https://foreign.example.invalid' },
  { iss: `${oidcConfig.issuer}/` },
  { aud: 'foreign-client' },
  { aud: [oidcConfig.clientId, 'other'] },
  { azp: 'other' },
  { nonce: 'wrong' },
  { nonce: null },
  { sub: '' },
  { exp: 1 },
  { exp: null },
  { iat: 9999999999 },
  { iat: 1 },
])('rejects exact-claim mismatch or stale token %j', async (overrides) => {
  const h = await harness(overrides)
  await expect(
    h.adapter.exchange('code', h.verifier, sha256(h.nonce), oidcConfig.redirectUri)
  ).rejects.toMatchObject({ code: 'INVALID_AUTH_TRANSACTION' })
})
it('rejects wrong nonce/redirect and malformed code without secret-bearing errors', async () => {
  const h = await harness()
  for (const [code, redirect] of [
    ['code', 'https://evil.invalid/callback'],
    ['x\n', oidcConfig.redirectUri],
    ['a'.repeat(4097), oidcConfig.redirectUri],
  ])
    await expect(
      h.adapter.exchange(code, h.verifier, sha256(h.nonce), redirect)
    ).rejects.toMatchObject({ code: 'INVALID_AUTH_TRANSACTION' })
  expect(h.transport).not.toHaveBeenCalled()
  await expect(
    h.adapter.exchange('code', h.verifier, sha256('wrong'), oidcConfig.redirectUri)
  ).rejects.toThrow()
})
it.each([
  { tokenEndpoint: 'https://foreign.invalid/token' },
  { issuer: 'http://identity.invalid' },
  { jwksUri: 'https://identity.example.invalid/keys?x=1' },
  { redirectUri: 'http://forge.invalid/cb' },
  { clientSecret: '' },
])('rejects unconfigured/unsafe OIDC endpoints %j', (changes) => {
  expect(() => new OidcIdentityAdapter({ ...oidcConfig, ...changes })).toThrow()
})
it.each([302, 400, 429, 500])('rejects HTTP status %d without retry/fallback', async (status) => {
  const transport = vi.fn<typeof fetch>(async () => new Response('private response', { status }))
  const adapter = new OidcIdentityAdapter(oidcConfig, transport)
  await expect(
    adapter.exchange('private-code', opaqueToken(), sha256('nonce'), oidcConfig.redirectUri)
  ).rejects.toMatchObject({ message: 'INVALID_AUTH_TRANSACTION' })
  expect(transport).toHaveBeenCalledTimes(1)
})
it('bounds streamed responses and rejects missing/bad signatures', async () => {
  for (const response of [
    Response.json({ id_token: 'bad.signature' }),
    Response.json({ access_token: 'not-an-id-token' }),
    new Response('x'.repeat(65537), { headers: { 'Content-Type': 'application/json' } }),
  ]) {
    const adapter = new OidcIdentityAdapter(oidcConfig, async () => response)
    await expect(
      adapter.exchange('code', opaqueToken(), sha256('nonce'), oidcConfig.redirectUri)
    ).rejects.toThrow('INVALID_AUTH_TRANSACTION')
  }
})
it('constant comparison handles Unicode byte lengths without throwing', () => {
  expect(secureEqual('é', 'a')).toBe(false)
})

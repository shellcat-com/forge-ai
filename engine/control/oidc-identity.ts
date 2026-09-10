import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose'
import { sha256 } from '../contracts/canonical.ts'
import { ControlError } from './contracts.ts'
import { secureEqual, validateAuthorizationCode } from './identity.ts'
import type { IdentityAdapter, IdentityClaims, IdentityTransaction } from './identity.ts'

export interface OidcConfiguration {
  issuer: string
  clientId: string
  clientSecret: string
  authorizationEndpoint: string
  tokenEndpoint: string
  jwksUri: string
  redirectUri: string
  algorithm: 'RS256' | 'ES256' | 'EdDSA'
}
export function exactHttps(value: string): URL {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.href !== value ||
    value.length > 2048
  )
    throw new Error('An exact administrator-configured HTTPS URL is required')
  return url
}
/** Pinned OIDC relying party. Configuration is server-owned, never request input.
 * No discovery, userinfo, refresh token persistence or account creation authority. */
export class OidcIdentityAdapter implements IdentityAdapter {
  readonly origin = 'oidc' as const
  get issuer() {
    return this.config.issuer
  }
  private readonly config: Readonly<OidcConfiguration>
  private readonly keys: ReturnType<typeof createRemoteJWKSet>
  constructor(
    config: OidcConfiguration,
    private readonly transport: typeof fetch = fetch
  ) {
    const issuer = exactHttps(config.issuer)
    for (const endpoint of [config.authorizationEndpoint, config.tokenEndpoint, config.jwksUri]) {
      if (exactHttps(endpoint).origin !== issuer.origin)
        throw new Error('OIDC endpoints must belong to the pinned issuer origin')
    }
    exactHttps(config.redirectUri)
    if (
      !config.clientId ||
      config.clientId.length > 255 ||
      !config.clientSecret ||
      config.clientSecret.length > 4096 ||
      !['RS256', 'ES256', 'EdDSA'].includes(config.algorithm)
    )
      throw new Error('Explicit OIDC client and signing algorithm required')
    this.config = Object.freeze({ ...config })
    this.keys = createRemoteJWKSet(new URL(config.jwksUri), {
      timeoutDuration: 5000,
      cooldownDuration: 30000,
      cacheMaxAge: 300000,
      [customFetch]: async (url, init) => this.request(String(url), init),
    })
  }
  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    if (![this.config.tokenEndpoint, this.config.jwksUri].includes(url))
      throw new Error('Unconfigured OIDC destination')
    const timeout = AbortSignal.timeout(5000)
    const response = await this.transport(url, {
      ...init,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    })
    if (
      !response.ok ||
      response.redirected ||
      !/^application\/(?:[a-z.+-]*\+)?json(?:;|$)/i.test(
        response.headers.get('content-type') ?? ''
      ) ||
      Number(response.headers.get('content-length') ?? 0) > 65536
    )
      throw new Error('Invalid OIDC response')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Missing OIDC response')
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > 65536) throw new Error('Oversized OIDC response')
        chunks.push(value)
      }
    } finally {
      await reader.cancel()
    }
    return new Response(Buffer.concat(chunks), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  authorizationUrl(t: IdentityTransaction) {
    if (t.redirectUri !== this.config.redirectUri) throw new Error('Redirect URI mismatch')
    const url = new URL(this.config.authorizationEndpoint)
    url.search = new URLSearchParams({
      response_type: 'code',
      response_mode: 'query',
      scope: 'openid',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      state: t.state,
      nonce: t.nonce,
      code_challenge: t.challenge,
      code_challenge_method: 'S256',
      prompt: 'login',
    }).toString()
    return url.href
  }
  async exchange(
    code: string,
    verifier: string,
    nonceHash: string,
    redirectUri: string
  ): Promise<IdentityClaims> {
    try {
      validateAuthorizationCode(code)
      if (redirectUri !== this.config.redirectUri || !/^[A-Za-z0-9_-]{43}$/.test(verifier))
        throw new Error('Invalid exchange binding')
      const encode = (value: string) => new URLSearchParams({ v: value }).toString().slice(2)
      const response = await this.request(this.config.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`${encode(this.config.clientId)}:${encode(this.config.clientSecret)}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          redirect_uri: this.config.redirectUri,
        }).toString(),
      })
      const body: unknown = await response.json()
      if (
        !body ||
        typeof body !== 'object' ||
        !('id_token' in body) ||
        typeof body.id_token !== 'string'
      )
        throw new Error('ID token required')
      const { payload } = await jwtVerify(body.id_token, this.keys, {
        issuer: this.config.issuer,
        audience: this.config.clientId,
        algorithms: [this.config.algorithm],
        requiredClaims: ['sub', 'nonce', 'iat', 'exp', 'iss', 'aud'],
        maxTokenAge: '5m',
        clockTolerance: 0,
      })
      // No additional audiences: this ID token is exclusively for this relying party.
      const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
      if (
        audiences.length !== 1 ||
        audiences[0] !== this.config.clientId ||
        (payload.azp !== undefined && payload.azp !== this.config.clientId) ||
        !payload.sub ||
        payload.sub.length > 255 ||
        typeof payload.nonce !== 'string' ||
        !secureEqual(sha256(payload.nonce), nonceHash) ||
        typeof payload.iat !== 'number' ||
        typeof payload.exp !== 'number' ||
        payload.exp <= payload.iat
      )
        throw new Error('Invalid ID token claims')
      return { origin: 'oidc', issuer: this.config.issuer, subject: payload.sub }
    } catch {
      // Never expose OAuth codes, JWTs, secrets, response bodies or provider errors.
      throw new ControlError(401, 'INVALID_AUTH_TRANSACTION')
    }
  }
}

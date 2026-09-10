import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { generateKeyPair, jwtVerify, SignJWT } from 'jose'
import { sha256, canonicalHash } from '../contracts/canonical.ts'
import type { ControlDatabase } from './database.ts'
import { clock, one } from './database.ts'
import { ControlError, keySchema, loginSchema, tokenSchema } from './contracts.ts'

export const opaqueToken = () => randomBytes(32).toString('base64url')
export const secureEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
export interface IdentityTransaction {
  state: string
  nonce: string
  challenge: string
  redirectUri: string
}
export interface IdentityClaims {
  issuer: string
  subject: string
  origin: 'fixture'
}
export interface IdentityAdapter {
  readonly origin: 'fixture'
  authorizationUrl(transaction: IdentityTransaction): string
  exchange(
    code: string,
    verifier: string,
    nonceHash: string,
    redirectUri: string
  ): Promise<IdentityClaims>
}
/** Local test issuer, not authentication for real people. No HTTP minting endpoint.
 * Tests/operators explicitly supply fixture authorization codes to the callback. */
export class FixtureIdentityAdapter implements IdentityAdapter {
  readonly origin = 'fixture' as const
  readonly issuer = 'https://fixture-identity.invalid'
  readonly audience = 'forge-control-fixture'
  private keys!: { publicKey: CryptoKey; privateKey: CryptoKey }
  private codes = new Map<
    string,
    { token: string; challenge: string; redirectUri: string; expiresAt: number }
  >()
  static async create() {
    const adapter = new FixtureIdentityAdapter()
    adapter.keys = await generateKeyPair('EdDSA')
    return adapter
  }
  authorizationUrl(t: IdentityTransaction) {
    const u = new URL('/authorize', this.issuer)
    for (const [key, value] of Object.entries({
      response_type: 'code',
      client_id: this.audience,
      redirect_uri: t.redirectUri,
      state: t.state,
      nonce: t.nonce,
      code_challenge: t.challenge,
      code_challenge_method: 'S256',
    }))
      u.searchParams.set(key, value)
    return u.toString()
  }
  async issueCode(url: string, subject: string, overrides: Record<string, unknown> = {}) {
    const u = new URL(url),
      code = opaqueToken()
    const token = await new SignJWT({ nonce: u.searchParams.get('nonce'), ...overrides })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer(typeof overrides.iss === 'string' ? overrides.iss : this.issuer)
      .setAudience(typeof overrides.aud === 'string' ? overrides.aud : this.audience)
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(this.keys.privateKey)
    this.codes.set(code, {
      token,
      challenge: u.searchParams.get('code_challenge')!,
      redirectUri: u.searchParams.get('redirect_uri')!,
      expiresAt: Date.now() + 120000,
    })
    return { code, state: u.searchParams.get('state')! }
  }
  async exchange(
    code: string,
    verifier: string,
    nonceHash: string,
    redirectUri: string
  ): Promise<IdentityClaims> {
    const item = this.codes.get(code)
    this.codes.delete(code)
    if (
      !item ||
      item.expiresAt <= Date.now() ||
      item.challenge !== Buffer.from(sha256(verifier), 'hex').toString('base64url') ||
      item.redirectUri !== redirectUri
    )
      throw new ControlError(401, 'INVALID_AUTH_TRANSACTION')
    try {
      const { payload } = await jwtVerify(item.token, this.keys.publicKey, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['EdDSA'],
        requiredClaims: ['sub', 'nonce', 'iat', 'exp'],
      })
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.nonce !== 'string' ||
        !secureEqual(sha256(payload.nonce), nonceHash)
      )
        throw new Error('nonce')
      return { issuer: this.issuer, subject: payload.sub, origin: 'fixture' }
    } catch {
      throw new ControlError(401, 'INVALID_AUTH_TRANSACTION')
    }
  }
}
export class SessionService {
  constructor(
    readonly db: ControlDatabase,
    readonly adapter: IdentityAdapter,
    private key: Uint8Array,
    public origin: string
  ) {
    if (key.length !== 32 || adapter.origin !== 'fixture')
      throw new Error('Fixture identity and 32-byte server key required')
  }
  bootstrap() {
    const cookie = opaqueToken()
    return { cookie, nonce: this.csrf(cookie) }
  }
  csrf(token: string) {
    return createHmac('sha256', this.key).update(`forge-csrf-v1:${token}`).digest('base64url')
  }
  encrypt(value: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key, iv)
    return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]).toString(
      'base64url'
    )
  }
  decrypt(value: string) {
    const b = Buffer.from(value, 'base64url'),
      cipher = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12))
    cipher.setAuthTag(b.subarray(-16))
    return Buffer.concat([cipher.update(b.subarray(12, -16)), cipher.final()]).toString()
  }
  async login(bootstrap: string, key: string, input: unknown) {
    tokenSchema.parse(bootstrap)
    keySchema.parse(key)
    const body = loginSchema.parse(input)
    if (!secureEqual(this.csrf(bootstrap), body.bootstrapNonce))
      throw new ControlError(403, 'CSRF_INVALID')
    return this.db.tx(async (c) => {
      const bootstrapHash = sha256(bootstrap),
        requestHash = canonicalHash(body)
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `login:${bootstrapHash}:${key}`,
      ])
      const prior = (
        await c.query(
          'SELECT * FROM auth_login_requests WHERE bootstrap_hash=$1 AND key=$2 AND expires_at>clock_timestamp()',
          [bootstrapHash, key]
        )
      ).rows[0]
      if (prior) {
        if (prior.request_digest !== requestHash)
          throw new ControlError(409, 'IDEMPOTENCY_CONFLICT')
        return prior.response_json
      }
      const state = opaqueToken(),
        nonce = opaqueToken(),
        verifier = opaqueToken(),
        now = await clock(c)
      const expires = new Date(Date.parse(now) + 600000).toISOString()
      const authorizationUrl = this.adapter.authorizationUrl({
        state,
        nonce,
        challenge: Buffer.from(sha256(verifier), 'hex').toString('base64url'),
        redirectUri: `${this.origin}/api/v1/auth/callback`,
      })
      await c.query(
        `INSERT INTO auth_transactions(id_hash,state_hash,nonce_hash,encrypted_pkce_verifier,return_path,expires_at,created_at,bootstrap_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          sha256(opaqueToken()),
          sha256(state),
          sha256(nonce),
          this.encrypt(verifier),
          body.returnPath,
          expires,
          now,
          bootstrapHash,
        ]
      )
      const response = { schemaVersion: 1, origin: 'fixture', authorizationUrl }
      await c.query(
        `INSERT INTO auth_login_requests VALUES($1,$2,$3,$4,$5) ON CONFLICT(bootstrap_hash,key) DO UPDATE SET request_digest=EXCLUDED.request_digest,response_json=EXCLUDED.response_json,expires_at=EXCLUDED.expires_at`,
        [bootstrapHash, key, requestHash, response, expires]
      )
      return response
    })
  }
  async callback(bootstrap: string, state: string, code: string) {
    tokenSchema.parse(bootstrap)
    tokenSchema.parse(state)
    tokenSchema.parse(code)
    // Consume first, then exchange outside the transaction. Ambiguous exchange
    // requires a fresh login, never reuse the authorization code.
    const transaction = await this.db.tx(async (c) => {
      const r = (
        await c.query(
          `UPDATE auth_transactions SET consumed_at=clock_timestamp() WHERE state_hash=$1 AND bootstrap_hash=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING *`,
          [sha256(state), sha256(bootstrap)]
        )
      ).rows[0]
      if (!r) throw new ControlError(401, 'INVALID_AUTH_TRANSACTION')
      return r
    })
    const claims = await this.adapter.exchange(
      code,
      this.decrypt(transaction.encrypted_pkce_verifier),
      transaction.nonce_hash,
      `${this.origin}/api/v1/auth/callback`
    )
    const token = opaqueToken(),
      csrfToken = this.csrf(token)
    await this.db.tx(async (c) => {
      const { id } = await one<{ id: string }>(c, 'SELECT invited_identity($1,$2) AS id', [
        claims.issuer,
        claims.subject,
      ])
      await c.query(
        `INSERT INTO sessions(id_hash,user_id,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')`,
        [sha256(token), id, sha256(csrfToken)]
      )
    })
    return { token, csrfToken, returnPath: transaction.return_path as string }
  }
  async info(token: string) {
    return this.db.session(token, null, 'viewer', async (c, p) => ({
      schemaVersion: 1,
      origin: 'fixture',
      userId: p.user_id,
      csrfToken: this.csrf(token),
      memberships: (await c.query('SELECT * FROM session_memberships($1)', [sha256(token)])).rows,
    }))
  }
  async logout(token: string, csrf: string) {
    tokenSchema.parse(token)
    if (!tokenSchema.safeParse(csrf).success) throw new ControlError(403, 'CSRF_INVALID')
    await this.db.tx(async (c) => {
      await c.query('SELECT logout_session($1,$2)', [sha256(token), sha256(csrf)])
    })
  }
  checkCsrf(expectedHash: string, csrf: string) {
    if (!tokenSchema.safeParse(csrf).success || !secureEqual(expectedHash, sha256(csrf)))
      throw new ControlError(403, 'CSRF_INVALID')
  }
}

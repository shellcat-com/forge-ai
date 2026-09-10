import { createRemoteJWKSet, jwtVerify } from 'jose'
import { HttpError } from './contracts.mjs'
export function createVerifier(baseUrl, pool) {
  const issuer = new URL(baseUrl).origin
  const jwks = createRemoteJWKSet(new URL(baseUrl.replace(/\/$/, '') + '/.well-known/jwks.json'), {
    timeoutDuration: 5000,
  })
  return async (authorization, sessionToken) => {
    if (!authorization?.startsWith('Bearer ') || authorization.length > 12000)
      throw new HttpError(401, 'Sign in to continue.')
    try {
      const { payload } = await jwtVerify(authorization.slice(7), jwks, {
        issuer,
        audience: issuer,
        algorithms: ['EdDSA'],
        requiredClaims: ['sub', 'exp', 'iat'],
        maxTokenAge: '15m',
      })
      if (!payload.sub || payload.emailVerified !== true || payload.banned === true)
        throw new HttpError(403, 'Verify your email before continuing.')
      if (typeof sessionToken !== 'string' || !sessionToken || sessionToken.length > 1024)
        throw new HttpError(401, 'Sign in to continue.')
      // Bind the JWT to a still-live Neon session. A JWT alone survives logout until expiry.
      const active = await pool.query(
        'SELECT id FROM neon_auth.session WHERE token=$1 AND "userId"=$2 AND "expiresAt">now()',
        [sessionToken, payload.sub]
      )
      if (!active.rowCount) throw new HttpError(401, 'Your session expired. Sign in again.')
      return { id: payload.sub, email: payload.email, name: payload.name }
    } catch (error) {
      if (error instanceof HttpError) throw error
      if (
        error.code?.startsWith('ERR_JWT') ||
        [
          'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
          'ERR_JOSE_ALG_NOT_ALLOWED',
          'ERR_JWS_INVALID',
        ].includes(error.code)
      )
        throw new HttpError(401, 'Your session expired. Sign in again.')
      throw new HttpError(503, 'Authentication is temporarily unavailable. Please retry.')
    }
  }
}

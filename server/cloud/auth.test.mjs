import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { createVerifier } from './auth.mjs'
let server, key, origin, verify, pool
beforeAll(async () => {
  const pair = await generateKeyPair('EdDSA')
  key = pair.privateKey
  const jwk = await exportJWK(pair.publicKey)
  jwk.kid = 'test-key'
  server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ keys: [jwk] }))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  origin = `http://127.0.0.1:${server.address().port}`
  pool = { query: vi.fn(async () => ({ rowCount: 1 })) }
  verify = createVerifier(origin + '/auth', pool)
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
})
async function token(claims = {}, expiry = '5m') {
  return new SignJWT({ emailVerified: true, ...claims })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' })
    .setSubject('alice')
    .setIssuer(origin)
    .setAudience(origin)
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(key)
}
it('accepts a verified signed identity bound to an active session', async () => {
  expect(await verify('Bearer ' + (await token()), 'session-secret')).toMatchObject({ id: 'alice' })
  expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('"expiresAt">now()'), [
    'session-secret',
    'alice',
  ])
})
it('rejects expired JWTs and unverified users', async () => {
  await expect(verify('Bearer ' + (await token({}, '0s')), 's')).rejects.toMatchObject({
    status: 401,
  })
  await expect(
    verify('Bearer ' + (await token({ emailVerified: false })), 's')
  ).rejects.toMatchObject({ status: 403 })
})
it('rejects revoked sessions even while the JWT is valid', async () => {
  pool.query.mockResolvedValueOnce({ rowCount: 0 })
  await expect(verify('Bearer ' + (await token()), 'revoked')).rejects.toMatchObject({
    status: 401,
  })
})
it('classifies database failure as unavailable instead of signing the user out', async () => {
  pool.query.mockRejectedValueOnce(new Error('database unavailable'))
  await expect(verify('Bearer ' + (await token()), 's')).rejects.toMatchObject({ status: 503 })
})

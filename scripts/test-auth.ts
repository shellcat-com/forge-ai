import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, pool } from '../src/server/db'
import { betaInvites, user } from '../src/server/auth/schema'
import { auth } from '../src/server/auth/config'
process.env.FORGE_EMAIL_ENDPOINT = 'https://mail.test.invalid/send'
process.env.FORGE_EMAIL_TOKEN = 'test-only-delivery'
const email = `forge-test-${randomUUID()}@example.invalid`,
  password = randomBytes(24).toString('base64url')
const base = process.env.BETTER_AUTH_URL!
const original = globalThis.fetch
let verificationUrl = ''
globalThis.fetch = async (input, init) => {
  if (String(input) === 'https://mail.test.invalid/send') {
    const mail = JSON.parse(String(init?.body))
    verificationUrl = mail.url
    return new Response('{}', { status: 200 })
  }
  return original(input, init)
}
async function request(path: string, body?: object, cookie?: string) {
  return auth().handler(
    new Request(base + '/api/auth/' + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        origin: base,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  )
}
try {
  const denied = await request('sign-up/email', { email, password, name: 'Test builder' })
  assert.ok([200, 403].includes(denied.status))
  assert.equal(
    (await db().select().from(user).where(eq(user.email, email))).length,
    0,
    'Uninvited registrations must not persist users'
  )
  await db()
    .insert(betaInvites)
    .values({ email, expiresAt: new Date(Date.now() + 600000) })
  const signup = await request('sign-up/email', { email, password, name: 'Test builder' })
  assert.equal(signup.status, 200, JSON.stringify(await signup.clone().json()))
  assert.ok(verificationUrl, 'Verification delivery should be requested')
  assert.ok(new URL(verificationUrl).origin === base)
  const verified = await auth().handler(new Request(verificationUrl, { headers: { origin: base } }))
  assert.ok(verified.status < 400)
  const signin = await request('sign-in/email', { email, password })
  assert.equal(signin.status, 200)
  const cookie = signin.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  assert.ok(cookie)
  const session = await request('get-session', undefined, cookie)
  const sessionData = await session.json()
  assert.equal(sessionData.user.email, email)
  const logout = await request('sign-out', {}, cookie)
  assert.equal(logout.status, 200)
  const after = await request('get-session', undefined, cookie)
  assert.equal(await after.json(), null)
  console.log(
    'PASS: real Better Auth invite gate, registration, verification, sign-in, persisted session and sign-out. Email delivery was intercepted by a local test stub; no external message sent.'
  )
} finally {
  globalThis.fetch = original
  await db().delete(user).where(eq(user.email, email))
  await db().delete(betaInvites).where(eq(betaInvites.email, email))
  await pool().end()
}

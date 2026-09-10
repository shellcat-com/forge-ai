import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { authPool, assertAuthDatabase } from '../../src/server/auth/database'
import { startNativePostgres } from '../engine/native-postgres'
import { pool } from '../../src/server/db'
import { POST, GET } from '../../src/app/api/auth/[...all]/route'
import { actor, projectAccess } from '../../src/server/auth/access'
import { admitAuthRequest } from '../../src/server/auth/rate-limit'
import { authMode, assertAuthRequest, signupPolicy } from '../../src/server/auth/policy'
import { createAuth, auth } from '../../src/server/auth/config'
import { sendAuthMail } from '../../src/server/auth/delivery'
import { POST as createProjectRequest } from '../../src/app/api/projects/route'
import { POST as projectJobRequest } from '../../src/app/api/projects/[id]/jobs/route'
import { createProject, queueJob, readiness } from '../../src/server/projects/service'
import { hostedGenerationUnavailable } from '../../src/shared/availability'
import { ControlDatabase } from '../../engine/control/database'
import { HostedIdentityBridge } from '../../engine/control/hosted-identity'
import { POST as bridgeRequest } from '../../src/app/api/control/session/route'
import { POST as connectKey, GET as listKeys } from '../../src/app/api/connections/route'
import { PATCH as rotateKey, DELETE as removeKey } from '../../src/app/api/connections/[id]/route'

vi.mock('server-only', () => ({}))

const origin = 'https://forge.example.com'
const mails: { to: string; subject: string; url: string }[] = []
const password = `Synthetic-${randomBytes(20).toString('hex')}`
let cluster: Awaited<ReturnType<typeof startNativePostgres>>
let mailFailure = false
let hostedApi: ControlDatabase
let identityBridge: HostedIdentityBridge
beforeAll(async () => {
  cluster = await startNativePostgres()
  for (const name of [
    '0001_initial.sql',
    '0002_runtime_version.sql',
    '0003_unified.sql',
    '0005_public_auth.sql',
  ])
    await cluster.admin.query(
      await readFile(new URL(`../../drizzle/${name}`, import.meta.url), 'utf8')
    )
  for (const name of [
    '0003_immutable_source_bridge.sql',
    '0004_hosted_identity.sql',
    '0005_hosted_byok.sql',
  ])
    await cluster.admin.query(
      await readFile(new URL(`../../engine/migrations/${name}`, import.meta.url), 'utf8')
    )
  await cluster.admin.query(
    "UPDATE forge_control.control_settings SET environment='hosted',admission_enabled=false,worker_enabled=false"
  )
  await cluster.admin.query(
    'INSERT INTO forge_control.hosted_identity_settings(issuer,enabled,max_users) VALUES($1,true,100)',
    [`${origin}/api/auth`]
  )
  hostedApi = new ControlDatabase(
    { ...cluster.config, user: 'e1_api' },
    'forge_control_api',
    'hosted'
  )
  identityBridge = new HostedIdentityBridge(hostedApi, randomBytes(32))
  ;(globalThis as { forgeHostedControl?: unknown }).forgeHostedControl = {
    db: hostedApi,
    bridge: identityBridge,
  }
  vi.stubEnv('FORGE_CREDENTIAL_KEYS_JSON', JSON.stringify({ v1: randomBytes(32).toString('hex') }))
  await cluster.admin
    .query(`CREATE ROLE public_auth_test LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    GRANT USAGE ON SCHEMA public TO public_auth_test;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO public_auth_test;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO public_auth_test`)
  await cluster.admin
    .query(`CREATE ROLE auth_only_test LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO auth_only_test;
    GRANT SELECT,INSERT,UPDATE,DELETE ON forge_user,forge_session,forge_account,forge_verification,forge_beta_invites,forge_auth_admission TO auth_only_test`)
  // Test-only socket transport injection; this is not Neon/TLS acceptance.
  ;(globalThis as { forgeAuthPool?: Pool }).forgeAuthPool = new Pool({
    ...cluster.config,
    user: 'auth_only_test',
  })
  vi.stubEnv(
    'DATABASE_URL',
    `postgresql://public_auth_test@localhost/postgres?host=${cluster.config.host}&port=${cluster.config.port}`
  )
  vi.stubEnv('FORGE_AUTH_MODE', 'hosted')
  vi.stubEnv('BETTER_AUTH_URL', origin)
  vi.stubEnv('BETTER_AUTH_SECRET', randomBytes(32).toString('hex'))
  vi.stubEnv('FORGE_EMAIL_ENDPOINT', 'https://mail.example.com/send')
  vi.stubEnv('FORGE_EMAIL_TOKEN', randomBytes(32).toString('hex'))
  for (const key of [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'BETTER_AUTH_API_KEY',
  ])
    vi.stubEnv(key, '')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit) => {
      expect(url).toBe('https://mail.example.com/send')
      expect(options.redirect).toBe('error')
      if (mailFailure) return new Response(null, { status: 503 })
      mails.push(JSON.parse(String(options.body)))
      return new Response(null, { status: 202 })
    })
  )
}, 30000)
beforeEach(async () => {
  vi.stubEnv('FORGE_HOSTED_CONTROL', 'false')
  vi.stubEnv('FORGE_AUTH_MODE', 'hosted')
  vi.stubEnv('BETTER_AUTH_URL', origin)
  vi.stubEnv('FORGE_SIGNUP_POLICY', 'public')
  mailFailure = false
  mails.length = 0
  await cluster.admin.query('TRUNCATE forge_auth_admission, forge_user, forge_beta_invites CASCADE')
})
afterAll(async () => {
  await hostedApi?.close()
  delete (globalThis as { forgeHostedControl?: unknown }).forgeHostedControl
  await pool().end()
  await authPool().end()
  delete (globalThis as { forgeAuthPool?: unknown }).forgeAuthPool
  delete (globalThis as { forgePool?: unknown }).forgePool
  await cluster?.close()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
function req(path: string, body?: unknown, cookie = '') {
  return new Request(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      host: new URL(origin).host,
      origin,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
const post = (path: string, body: unknown, cookie = '') =>
  POST(req(`/api/auth/${path}`, body, cookie))
async function signup(email = 'alice@example.invalid') {
  const r = await post('sign-up/email', {
    email,
    name: 'Synthetic test',
    password,
    callbackURL: '/app',
  })
  expect(r.status, await r.clone().text()).toBe(200)
  const row = await cluster.admin.query('SELECT * FROM forge_user WHERE email=$1', [email])
  expect(row.rows[0].email_verified).toBe(false)
  expect(mails.at(-1)?.to).toBe(email)
  return row.rows[0].id as string
}
async function verified(email = 'alice@example.invalid') {
  const id = await signup(email)
  const url = mails.at(-1)!.url
  const r = await GET(
    new Request(url, { headers: { host: new URL(origin).host, 'sec-fetch-site': 'cross-site' } })
  )
  expect(r.status).toBe(302)
  const signed = await post('sign-in/email', { email, password })
  expect(signed.status, await signed.clone().text()).toBe(200)
  const setCookies = signed.headers.getSetCookie()
  expect(
    setCookies.some((c) => /httponly/i.test(c) && /secure/i.test(c) && /samesite=lax/i.test(c))
  ).toBe(true)
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ')
  return { id, cookie }
}
it('creates and verifies an ordinary account without an administrator or invite', async () => {
  const id = await signup()
  const blocked = await post('sign-in/email', { email: 'alice@example.invalid', password })
  expect(blocked.status).toBe(403)
  expect((await cluster.admin.query('SELECT count(*) FROM forge_session')).rows[0].count).toBe('0')
  const url = mails[0].url
  const r = await GET(
    new Request(url, { headers: { host: new URL(origin).host, 'sec-fetch-site': 'cross-site' } })
  )
  expect(r.status).toBe(302)
  expect(
    (
      await cluster.admin.query('SELECT email_verified,disabled_at FROM forge_user WHERE id=$1', [
        id,
      ])
    ).rows[0]
  ).toEqual({ email_verified: true, disabled_at: null })
  expect(
    (await cluster.admin.query('SELECT count(*) FROM forge_control.memberships')).rows[0].count
  ).toBe('0')
})
it('logs out, expires sessions and rejects suspended accounts without cached authority', async () => {
  const a = await verified()
  expect((await actor(req('/api/account', undefined, a.cookie))).canBuild).toBe(true)
  await cluster.admin.query("UPDATE forge_session SET expires_at=now()-interval '1 second'")
  await expect(actor(req('/api/account', undefined, a.cookie))).rejects.toMatchObject({
    status: 401,
  })
  const signed = await post('sign-in/email', { email: 'alice@example.invalid', password })
  const cookie = signed.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  expect((await post('sign-out', {}, cookie)).status).toBe(200)
  await expect(actor(req('/api/account', undefined, cookie))).rejects.toMatchObject({ status: 401 })
  await cluster.admin.query('UPDATE forge_user SET disabled_at=now() WHERE id=$1', [a.id])
  expect((await post('sign-in/email', { email: 'alice@example.invalid', password })).status).toBe(
    403
  )
})
it('delivers recovery through the configured adapter and revokes existing sessions after reset', async () => {
  const a = await verified()
  expect(
    (
      await post('request-password-reset', {
        email: 'alice@example.invalid',
        redirectTo: '/reset-password',
      })
    ).status
  ).toBe(200)
  const mail = mails.at(-1)!
  expect(mail.subject).toContain('Reset')
  const next = await GET(
    new Request(mail.url, {
      headers: { host: new URL(origin).host, 'sec-fetch-site': 'cross-site' },
    })
  )
  expect(next.status).toBe(302)
  const token = new URL(next.headers.get('location')!, origin).searchParams.get('token')
  expect(token).toBeTruthy()
  const newPassword = `Replacement-${randomBytes(20).toString('hex')}`
  expect((await post('reset-password', { token, newPassword })).status).toBe(200)
  expect((await post('reset-password', { token, newPassword })).status).toBeGreaterThanOrEqual(400)
  await expect(actor(req('/api/account', undefined, a.cookie))).rejects.toMatchObject({
    status: 401,
  })
  expect((await post('sign-in/email', { email: 'alice@example.invalid', password })).status).toBe(
    401
  )
  expect(
    (await post('sign-in/email', { email: 'alice@example.invalid', password: newPassword })).status
  ).toBe(200)
})
it('preserves optional invite-only signup and server-enforced password length', async () => {
  vi.stubEnv('FORGE_SIGNUP_POLICY', 'invite')
  // Better Auth deliberately returns a generic response for signup denial to
  // avoid account enumeration. Assert authority was actually withheld.
  await post('sign-up/email', { name: 'Test', email: 'nobody@example.invalid', password })
  expect((await cluster.admin.query('SELECT count(*) FROM forge_user')).rows[0].count).toBe('0')
  expect(mails).toHaveLength(0)
  vi.stubEnv('FORGE_SIGNUP_POLICY', 'public')
  expect(
    (
      await post('sign-up/email', {
        name: 'Test',
        email: 'nobody@example.invalid',
        password: 'short',
      })
    ).status
  ).toBe(400)
})
it('rejects foreign project access for two real Better Auth sessions over synthetic local data', async () => {
  const a = await verified('alice@example.invalid'),
    b = await verified('bob@example.invalid')
  const project = randomUUID()
  await cluster.admin.query('INSERT INTO forge_projects(id,name,owner_id) VALUES($1,$2,$3)', [
    project,
    'Synthetic private project',
    a.id,
  ])
  expect(
    (await projectAccess(await actor(req('/api/account', undefined, a.cookie)), project)).id
  ).toBe(project)
  await expect(
    projectAccess(await actor(req('/api/account', undefined, b.cookie)), project)
  ).rejects.toMatchObject({ status: 404 })
})
it('bounds concurrent signup admission atomically across independent database connections', async () => {
  const results = await Promise.all(
    Array.from({ length: 35 }, () => admitAuthRequest('/api/auth/sign-up/email'))
  )
  expect(results.filter((x) => x === null)).toHaveLength(20)
  expect(results.filter((x) => x === 3600)).toHaveLength(15)
  const denied = await post('sign-up/email', {
    name: 'Test',
    email: 'nobody@example.invalid',
    password,
  })
  expect(denied.status).toBe(429)
  expect(denied.headers.get('retry-after')).toBe('3600')
  await cluster.admin.query("UPDATE forge_auth_admission SET window_start=now()-interval '2 hours'")
  expect(await admitAuthRequest('/api/auth/sign-up/email')).toBeNull()
})
it('fails closed for mail failure and never follows delivery redirects', async () => {
  await verified()
  mailFailure = true
  await expect(sendAuthMail('alice@example.invalid', `${origin}/redacted`, 'Test')).rejects.toThrow(
    'Email delivery failed'
  )
  expect(
    (
      await post('request-password-reset', {
        email: 'unknown@example.invalid',
        redirectTo: '/reset-password',
      })
    ).status
  ).toBe(200)
  expect(
    (
      await post('request-password-reset', {
        email: 'alice@example.invalid',
        redirectTo: '/reset-password',
      })
    ).status
  ).toBeGreaterThanOrEqual(500)
  expect(
    (await post('sign-up/email', { email: 'new@example.invalid', name: 'Synthetic', password }))
      .status
  ).toBeGreaterThanOrEqual(500)
})
it('rejects wrong host, missing/foreign origin, oversized and compressed requests', async () => {
  const invalidHeaders: Record<string, string>[] = [
    { host: 'evil.example', origin },
    { host: new URL(origin).host },
    { host: new URL(origin).host, origin: 'https://evil.example' },
  ]
  for (const headers of invalidHeaders) {
    expect(
      (
        await POST(
          new Request(`${origin}/api/auth/sign-up/email`, { method: 'POST', headers, body: '{}' })
        )
      ).status
    ).toBe(403)
  }
  expect((await POST(req('/api/auth/sign-up/email', { name: 'x'.repeat(17000) }))).status).toBe(413)
  const compressed = req('/api/auth/sign-up/email', {})
  compressed.headers.set('content-encoding', 'gzip')
  expect((await POST(compressed)).status).toBe(415)
  expect(() =>
    assertAuthRequest(
      new Request(`${origin}/api/auth/get-session`, {
        headers: { host: new URL(origin).host, 'sec-fetch-site': 'cross-site' },
      })
    )
  ).toThrow()
})
it('refuses ambiguous deployment modes, invalid origins and local auth activation', () => {
  expect(() => authMode({ VERCEL: '1' })).toThrow()
  expect(() => authMode({ VERCEL: '1', FORGE_AUTH_MODE: 'local' })).toThrow()
  expect(() => authMode({ FORGE_AUTH_MODE: 'typo' })).toThrow()
  expect(() => signupPolicy({ FORGE_SIGNUP_POLICY: 'typo' })).toThrow()
  vi.stubEnv('BETTER_AUTH_URL', 'http://forge.example.com')
  expect(() => createAuth()).toThrow()
  vi.stubEnv('BETTER_AUTH_URL', origin)
  vi.stubEnv('FORGE_AUTH_MODE', 'local')
  expect(() => createAuth()).toThrow()
})

it('checks narrow auth database authority and refuses accidental project grants', async () => {
  await expect(assertAuthDatabase()).resolves.toBeUndefined()
  await expect(authPool().query('SELECT * FROM forge_projects')).rejects.toMatchObject({
    code: '42501',
  })
  await cluster.admin.query('GRANT SELECT ON forge_projects TO auth_only_test')
  try {
    await expect(assertAuthDatabase()).rejects.toThrow('least-privilege')
  } finally {
    await cluster.admin.query('REVOKE SELECT ON forge_projects FROM auth_only_test')
  }
  await expect(assertAuthDatabase()).resolves.toBeUndefined()
})

it('reports the actual hosted build dependency after login and creates no jobs on retries', async () => {
  const a = await verified()
  const body = {
    prompt: 'Build a simple one-page bakery website with opening hours and a contact section.',
    mode: 'build',
    provider: 'groq',
    model: 'synthetic-unavailable',
    idempotencyKey: randomUUID(),
  }
  // A live legacy heartbeat cannot authorize hosted execution.
  await cluster.admin.query(
    'INSERT INTO forge_runtime(id,heartbeat) VALUES(1,now()) ON CONFLICT(id) DO UPDATE SET heartbeat=now()'
  )
  try {
    expect(await readiness()).toMatchObject({ worker: false, message: hostedGenerationUnavailable })
    expect((await createProjectRequest(req('/api/projects', body))).status).toBe(401)
    for (let i = 0; i < 2; i++) {
      const response = await createProjectRequest(req('/api/projects', body, a.cookie))
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: hostedGenerationUnavailable })
    }
    await expect(createProject(body, a.id)).rejects.toMatchObject({
      status: 503,
      message: hostedGenerationUnavailable,
    })
    expect(
      (await cluster.admin.query('SELECT count(*) FROM forge_projects WHERE owner_id=$1', [a.id]))
        .rows[0].count
    ).toBe('0')
    expect(
      (await cluster.admin.query('SELECT count(*) FROM forge_jobs WHERE owner_id=$1', [a.id]))
        .rows[0].count
    ).toBe('0')
  } finally {
    await cluster.admin.query('DELETE FROM forge_runtime WHERE id=1')
  }
})

it('uses the same hosted error for existing-project changes while preserving owner authorization', async () => {
  const a = await verified(),
    b = await verified('bob@example.invalid')
  const projectId = randomUUID()
  await cluster.admin.query('INSERT INTO forge_projects(id,name,owner_id) VALUES($1,$2,$3)', [
    projectId,
    'Synthetic existing website',
    a.id,
  ])
  const body = {
    kind: 'generate' as const,
    prompt: 'Add a contact section to the bakery website.',
    provider: 'groq',
    model: 'synthetic-unavailable',
    baseRevision: null,
    idempotencyKey: randomUUID(),
  }
  const context = { params: Promise.resolve({ id: projectId }) }
  const url = `/api/projects/${projectId}/jobs`
  const owner = await projectJobRequest(req(url, body, a.cookie), context)
  expect(owner.status).toBe(503)
  expect(await owner.json()).toEqual({ error: hostedGenerationUnavailable })
  expect((await projectJobRequest(req(url, body, b.cookie), context)).status).toBe(404)
  await expect(queueJob(projectId, body, a.id)).rejects.toMatchObject({
    status: 503,
    message: hostedGenerationUnavailable,
  })
  expect(
    (await cluster.admin.query('SELECT count(*) FROM forge_jobs WHERE project_id=$1', [projectId]))
      .rows[0].count
  ).toBe('0')
})

it('does not describe an expired local heartbeat as a connected runtime', async () => {
  vi.stubEnv('FORGE_AUTH_MODE', 'local')
  await cluster.admin.query(
    "INSERT INTO forge_runtime(id,heartbeat) VALUES(1,now()-interval '1 minute') ON CONFLICT(id) DO UPDATE SET heartbeat=now()-interval '1 minute'"
  )
  try {
    const status = await readiness()
    expect(status.worker).toBe(false)
    expect(status.message).toContain('Generation is unavailable')
    await cluster.admin.query('UPDATE forge_runtime SET heartbeat=now() WHERE id=1')
    expect((await readiness()).worker).toBe(true)
  } finally {
    await cluster.admin.query('DELETE FROM forge_runtime WHERE id=1')
  }
})

it('bridges a real Better Auth login into private key CRUD and revokes engine access on logout', async () => {
  vi.stubEnv('FORGE_HOSTED_CONTROL', 'true')
  const alice = await verified('alice-key@example.invalid')
  const bob = await verified('bob-key@example.invalid')
  expect((await bridgeRequest(req('/api/control/session', {}, alice.cookie))).status).toBe(200)
  const parent = await auth().api.getSession({
    headers: req('/api/account', undefined, alice.cookie).headers,
  })
  const identity = await identityBridge.connect(parent!.session.token)
  const key = `synthetic-${randomBytes(20).toString('hex')}`
  const saved = await connectKey(req('/api/connections', { provider: 'groq', key }, alice.cookie))
  expect(saved.status, await saved.clone().text()).toBe(201)
  const connection = await saved.json()
  expect(JSON.stringify(connection)).not.toContain(key)
  const list = await listKeys(req('/api/connections', undefined, alice.cookie))
  expect(list.status).toBe(200)
  expect(await list.text()).not.toContain(key)
  const foreign = await listKeys(req('/api/connections', undefined, bob.cookie))
  expect((await foreign.json()).connections).toEqual([])
  const context = { params: Promise.resolve({ id: connection.id }) }
  const freshKey = `synthetic-${randomBytes(20).toString('hex')}`
  expect(
    (
      await rotateKey(
        req(
          `/api/connections/${connection.id}`,
          { expectedRevision: 1, key: freshKey },
          bob.cookie
        ),
        context
      )
    ).status
  ).toBe(422)
  const rotated = await rotateKey(
    req(`/api/connections/${connection.id}`, { expectedRevision: 1, key: freshKey }, alice.cookie),
    context
  )
  expect(rotated.status, await rotated.clone().text()).toBe(200)
  expect((await rotated.json()).revision).toBe(2)
  const removed = await removeKey(
    req(`/api/connections/${connection.id}`, { expectedRevision: 2 }, alice.cookie),
    context
  )
  expect(removed.status, await removed.clone().text()).toBe(200)
  expect((await removed.json()).status).toBe('deleted')
  expect((await post('sign-out', {}, alice.cookie)).status).toBe(200)
  await expect(
    hostedApi.session(identity.sessionToken, identity.workspaceId, 'owner', async () => true)
  ).rejects.toThrow('UNAUTHENTICATED')
  expect((await listKeys(req('/api/connections', undefined, alice.cookie))).status).toBe(401)
})

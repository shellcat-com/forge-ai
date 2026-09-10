import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { request as httpRequest } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { startNativePostgres } from './native-postgres.ts'
import { OidcIdentityAdapter } from '../../engine/control/oidc-identity.ts'
import { SessionService, opaqueToken } from '../../engine/control/identity.ts'
import { IdentityOperator } from '../../engine/control/identity-operator.ts'
import { CredentialConnectionAuthorizer } from '../../engine/control/credential-authorization.ts'
import { ControlDatabase } from '../../engine/control/database.ts'
import { ControlService } from '../../engine/control/service.ts'
import { createControlServer } from '../../engine/control/http.ts'
import { sha256 } from '../../engine/contracts/canonical.ts'

// Real PostgreSQL + cryptographic protocol, synthetic users and simulated IdP transport.
const origin = 'https://forge.example.invalid',
  issuer = 'https://identity.example.invalid/api/auth'
let db: Awaited<ReturnType<typeof startNativePostgres>>,
  sessions: SessionService,
  operator: IdentityOperator,
  keys: Awaited<ReturnType<typeof generateKeyPair>>,
  adapter: OidcIdentityAdapter,
  pool: ControlDatabase,
  server: ReturnType<typeof createControlServer>,
  endpoint: string
const codes = new Map<string, { nonce: string; subject: string; challenge: string }>()
const workspaceId = randomUUID(),
  foreignWorkspace = randomUUID(),
  operatorId = randomUUID()
let owner: Awaited<ReturnType<typeof login>>, foreign: Awaited<ReturnType<typeof login>>
async function login(subject: string) {
  const bootstrap = sessions.bootstrap()
  const result = await sessions.login(bootstrap.cookie, randomUUID(), {
    schemaVersion: 1,
    bootstrapNonce: bootstrap.nonce,
    returnPath: '/workspace',
  })
  const url = new URL(result.authorizationUrl),
    code = `synthetic/provider-code/${opaqueToken()}`
  codes.set(code, {
    subject,
    nonce: url.searchParams.get('nonce')!,
    challenge: url.searchParams.get('code_challenge')!,
  })
  const state = url.searchParams.get('state')!
  const callback = await sessions.callback(bootstrap.cookie, state, code)
  return { ...callback, code, state, bootstrap: bootstrap.cookie }
}
beforeAll(async () => {
  db = await startNativePostgres()
  keys = await generateKeyPair('RS256')
  const jwk = await exportJWK(keys.publicKey)
  adapter = new OidcIdentityAdapter(
    {
      issuer,
      clientId: 'forge',
      clientSecret: 'synthetic-secret',
      authorizationEndpoint: `${issuer}/oauth2/authorize`,
      tokenEndpoint: `${issuer}/oauth2/token`,
      jwksUri: `${issuer}/jwks`,
      redirectUri: `${origin}/api/v1/auth/callback`,
      algorithm: 'RS256',
    },
    async (input, init) => {
      if (String(input).endsWith('/jwks'))
        return Response.json({ keys: [{ ...jwk, kid: 'synthetic' }] })
      const form = new URLSearchParams(String(init?.body)),
        code = form.get('code')!
      const entry = codes.get(code)
      codes.delete(code)
      if (
        !entry ||
        Buffer.from(sha256(form.get('code_verifier')!), 'hex').toString('base64url') !==
          entry.challenge
      )
        return Response.json({ error: 'invalid_grant' }, { status: 400 })
      const token = await new SignJWT({ nonce: entry.nonce })
        .setIssuer(issuer)
        .setAudience('forge')
        .setSubject(entry.subject)
        .setIssuedAt()
        .setExpirationTime('2m')
        .setProtectedHeader({ alg: 'RS256', kid: 'synthetic' })
        .sign(keys.privateKey)
      return Response.json({ id_token: token })
    }
  )
  sessions = new SessionService(db.api, adapter, randomBytes(32), origin)
  operator = new IdentityOperator(db.admin, issuer)
  for (const w of [workspaceId, foreignWorkspace])
    await db.admin.query('INSERT INTO forge_control.workspaces(id,name) VALUES($1,$2)', [
      w,
      'Synthetic identity test',
    ])
  for (const [subject, w, role] of [
    ['owner', workspaceId, 'owner'],
    ['foreign', foreignWorkspace, 'owner'],
    ['viewer', workspaceId, 'viewer'],
    ['editor', workspaceId, 'editor'],
  ] as const)
    await operator.admit({
      issuer,
      subject,
      workspaceId: w,
      role,
      operatorId,
      requestId: randomUUID(),
    })
  owner = await login('owner')
  foreign = await login('foreign')
  pool = new ControlDatabase({ ...db.config, user: 'e1_api', max: 1 }, 'forge_control_api')
  server = createControlServer(new ControlService(db.api, sessions, false), {
    enabled: true,
    origin,
    pollMs: 20,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`
}, 30000)
afterAll(async () => {
  server?.closeAllConnections()
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  await pool?.close()
  await db?.close()
})
it('admits exact invited subjects only, stores hashes/encrypted verifier, and consumes state once', async () => {
  expect((await sessions.info(owner.token)).origin).toBe('oidc')
  await expect(login('uninvited')).rejects.toThrow()
  await expect(sessions.callback(owner.bootstrap, owner.state, owner.code)).rejects.toThrow()
  const { rows } = await db.admin.query(
    'SELECT id_hash,csrf_hash FROM forge_control.sessions WHERE id_hash=$1',
    [sha256(owner.token)]
  )
  expect(rows[0]).toEqual({ id_hash: sha256(owner.token), csrf_hash: sha256(owner.csrfToken) })
  const transactions = await db.admin.query(
    'SELECT encrypted_pkce_verifier FROM forge_control.auth_transactions'
  )
  expect(transactions.rows.every((r) => r.encrypted_pkce_verifier.length > 43)).toBe(true)
})
it('rejects server-expired bootstrap and unbound state without relying on browser cookie expiry', async () => {
  const now = Date.now()
  const mock = vi.spyOn(Date, 'now').mockReturnValue(now - 610000)
  const stale = sessions.bootstrap()
  mock.mockRestore()
  await expect(
    sessions.login(stale.cookie, randomUUID(), {
      schemaVersion: 1,
      returnPath: '/workspace',
      bootstrapNonce: stale.nonce,
    })
  ).rejects.toThrow('INVALID_AUTH_TRANSACTION')
  await expect(sessions.callback(opaqueToken(), owner.state, owner.code)).rejects.toThrow()
})
it('enforces roles, foreign workspace/key denial, exact HTTPS Origin, CSRF and fresh credential connection sessions', async () => {
  const guard = new CredentialConnectionAuthorizer(db.api, sessions, origin)
  const request = {
    sessionToken: owner.token,
    workspaceId,
    csrfToken: owner.csrfToken,
    origin,
    operation: 'connect' as const,
  }
  expect((await guard.authorize(request)).role).toBe('owner')
  for (const change of [
    { sessionToken: foreign.token, csrfToken: foreign.csrfToken },
    { origin: 'https://foreign.invalid' },
    { csrfToken: opaqueToken() },
    { sessionToken: opaqueToken() },
  ])
    await expect(guard.authorize({ ...request, ...change })).rejects.toThrow()
  for (const subject of ['editor', 'viewer']) {
    const member = await login(subject)
    await expect(
      guard.authorize({ ...request, sessionToken: member.token, csrfToken: member.csrfToken })
    ).rejects.toThrow()
    await expect(
      db.api.session(member.token, workspaceId, 'viewer', async () => true)
    ).resolves.toBe(true)
    if (subject === 'viewer')
      await expect(
        db.api.session(member.token, workspaceId, 'editor', async () => true)
      ).rejects.toThrow()
  }
  const stale = await login('owner')
  await db.admin.query(
    "UPDATE forge_control.sessions SET created_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()+interval '1 hour' WHERE id_hash=$1",
    [sha256(stale.token)]
  )
  await expect(
    guard.authorize({ ...request, sessionToken: stale.token, csrfToken: stale.csrfToken })
  ).rejects.toThrow('REAUTHENTICATION_REQUIRED')
})
it('isolates native pooled connections after success, failure and concurrent foreign requests', async () => {
  const pid = await pool.session(
    owner.token,
    workspaceId,
    'viewer',
    async (tx) => (await tx.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
  )
  await expect(
    pool.session(owner.token, workspaceId, 'owner', async () => {
      throw new Error('rollback')
    })
  ).rejects.toThrow('rollback')
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      pool.session(
        i % 2 ? owner.token : foreign.token,
        i % 2 ? workspaceId : foreignWorkspace,
        'viewer',
        async (tx) => {
          const { rows } = await tx.query(
            "SELECT pg_backend_pid() AS pid,current_setting('forge.workspace_id') AS workspace"
          )
          expect(rows[0]).toEqual({ pid, workspace: i % 2 ? workspaceId : foreignWorkspace })
          expect((await tx.query('SELECT id FROM workspaces')).rows).toEqual([
            { id: i % 2 ? workspaceId : foreignWorkspace },
          ])
        }
      )
    )
  )
  const client = await pool.pool.connect()
  try {
    const {
      rows: [row],
    } = await client.query(
      "SELECT current_setting('forge.workspace_id',true) AS workspace,current_user AS role"
    )
    expect(row.workspace).toBe('')
    expect(row.role).toBe('e1_api')
  } finally {
    client.release()
  }
})
it('protects last owner, audits membership change, revokes sessions and fails foreign project reads', async () => {
  const viewer = await login('viewer'),
    info = await sessions.info(viewer.token)
  await operator.revoke({ workspaceId, userId: info.userId, operatorId, requestId: randomUUID() })
  await expect(sessions.info(viewer.token)).rejects.toThrow()
  await expect(login('viewer')).rejects.toThrow()
  await expect(
    operator.revoke({
      workspaceId,
      userId: (await sessions.info(owner.token)).userId,
      operatorId,
      requestId: randomUUID(),
    })
  ).rejects.toThrow('last owner')
  const service = new ControlService(db.api, sessions, false)
  const created = await service.createProject(
    owner.token,
    workspaceId,
    owner.csrfToken,
    randomUUID(),
    {
      schemaVersion: 1,
      name: 'Identity fixture project',
      brief: 'Synthetic identity authorization test project only.',
      presetId: 'editorial-product',
      presetVersion: 1,
      templateId: 'next-postgres-v1',
    }
  )
  await expect(
    service.getProject(foreign.token, (created.body.project as { id: string }).id)
  ).rejects.toThrow()
  expect(
    (
      await db.admin.query(
        "SELECT 1 FROM forge_control.audit_events WHERE action='identity.membership.revoked'"
      )
    ).rowCount
  ).toBe(1)
})
it('rejects expired sessions and logs out idempotently without exposing tokens', async () => {
  const current = await login('owner')
  await expect(sessions.logout(current.token, opaqueToken())).rejects.toThrow()
  await sessions.logout(current.token, current.csrfToken)
  await sessions.logout(current.token, current.csrfToken)
  await expect(sessions.info(current.token)).rejects.toThrow()
  const expired = await login('owner')
  await db.admin.query(
    "UPDATE forge_control.sessions SET created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE id_hash=$1",
    [sha256(expired.token)]
  )
  await expect(sessions.info(expired.token)).rejects.toThrow()
})
it('accepts only exact top-level cross-site callback, rejecting duplicate state/issuer and anonymous control access', async () => {
  const bootstrap = sessions.bootstrap()
  const result = await sessions.login(bootstrap.cookie, randomUUID(), {
    schemaVersion: 1,
    bootstrapNonce: bootstrap.nonce,
    returnPath: '/workspace',
  })
  const url = new URL(result.authorizationUrl),
    state = url.searchParams.get('state')!,
    code = 'synthetic-provider-code'
  codes.set(code, {
    subject: 'owner',
    nonce: url.searchParams.get('nonce')!,
    challenge: url.searchParams.get('code_challenge')!,
  })
  const headers = {
    Host: new URL(origin).host,
    Cookie: `__Host-forge-bootstrap=${bootstrap.cookie}`,
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document',
  }
  const callback = `/api/v1/auth/callback?code=${code}&state=${state}`
  for (const suffix of ['&state=duplicate', '&iss=https://foreign.invalid'])
    expect((await wire(endpoint + callback + suffix, { headers, redirect: 'manual' })).status).toBe(
      401
    )
  expect(
    (
      await wire(endpoint + callback, {
        headers: { ...headers, 'Sec-Fetch-Mode': 'cors' },
        redirect: 'manual',
      })
    ).status
  ).toBe(403)
  const response = await wire(endpoint + callback + `&iss=${encodeURIComponent(issuer)}`, {
    headers,
    redirect: 'manual',
  })
  expect(response.status).toBe(303)
  expect(response.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Lax')
  for (const path of [
    '/api/v1/session',
    '/api/v1/capabilities',
    '/api/v1/auth/fixture',
    '/api/v1/auth/mint',
  ])
    expect((await wire(endpoint + path, { headers: { Host: new URL(origin).host } })).status).toBe(
      401
    )
})

async function wire(url: string, options: { headers: Record<string, string>; redirect?: string }) {
  return new Promise<{ status: number; headers: Headers }>((resolve, reject) => {
    const request = httpRequest(url, { headers: options.headers }, (response) => {
      response.resume()
      const headers = new Headers()
      for (const [key, value] of Object.entries(response.headers))
        if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
      response.on('end', () => resolve({ status: response.statusCode!, headers }))
    })
    request.on('error', reject)
    request.end()
  })
}

it.runIf(process.env.FORGE_IDENTITY_BROWSER === 'true')(
  'browser: Secure bootstrap survives external top-level OIDC return, then logout removes control access',
  async () => {
    const { chromium } = await import('@playwright/test')
    const { createServer: tlsServer } = await import('node:https')
    const { mkdtempSync, readFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { execFileSync } = await import('node:child_process')
    const dir = mkdtempSync(join(tmpdir(), 'forge-identity-browser-'))
    const keyPath = join(dir, 'key.pem'),
      certPath = join(dir, 'cert.pem')
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-subj',
        '/CN=localhost',
        '-days',
        '1',
      ],
      { stdio: 'ignore' }
    )
    let control: ReturnType<typeof createControlServer> | undefined
    let browserOrigin = '',
      browserIssuer = ''
    const transactions = new Map<string, { nonce: string; challenge: string }>()
    const https = tlsServer(
      { key: readFileSync(keyPath), cert: readFileSync(certPath) },
      (req, res) => {
        const url = new URL(req.url!, browserOrigin)
        if (req.headers.host === new URL(browserIssuer).host) {
          if (url.pathname !== '/api/auth/authorize') {
            res.writeHead(404)
            res.end()
            return
          }
          const code = opaqueToken()
          transactions.set(code, {
            nonce: url.searchParams.get('nonce')!,
            challenge: url.searchParams.get('code_challenge')!,
          })
          const callback = new URL('/api/v1/auth/callback', browserOrigin)
          callback.search = new URLSearchParams({
            code,
            state: url.searchParams.get('state')!,
            iss: browserIssuer,
          }).toString()
          res.setHeader('Content-Type', 'text/html')
          res.end(
            `<a href="${callback.href.replaceAll('&', '&amp;')}">Continue as synthetic owner</a>`
          )
        } else if (
          url.pathname === '/api/v1/auth/callback' ||
          url.pathname.startsWith('/api/v1/')
        ) {
          control!.emit('request', req, res)
        } else {
          res.setHeader('Content-Type', 'text/html')
          res.end(`<button id="login">Synthetic OIDC login</button><script>
        document.querySelector('#login').onclick=async()=>{
          const b=await fetch('/api/v1/auth/bootstrap').then(r=>r.json());
          const r=await fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},
          body:JSON.stringify({schemaVersion:1,bootstrapNonce:b.bootstrapNonce,returnPath:'/workspace'})}).then(r=>r.json());
          location.href=r.authorizationUrl;
        };</script>`)
        }
      }
    )
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
    try {
      await new Promise<void>((resolve) => https.listen(0, '127.0.0.1', resolve))
      const port = (https.address() as { port: number }).port
      browserOrigin = `https://forge.localhost:${port}`
      browserIssuer = `https://identity.localhost:${port}/api/auth`
      const publicKey = await exportJWK(keys.publicKey)
      const browserAdapter = new OidcIdentityAdapter(
        {
          issuer: browserIssuer,
          clientId: 'browser-fixture',
          clientSecret: 'fixture-only',
          authorizationEndpoint: `${browserIssuer}/authorize`,
          tokenEndpoint: `${browserIssuer}/token`,
          jwksUri: `${browserIssuer}/jwks`,
          redirectUri: `${browserOrigin}/api/v1/auth/callback`,
          algorithm: 'RS256',
        },
        async (input, init) => {
          if (String(input).endsWith('/jwks'))
            return Response.json({ keys: [{ ...publicKey, kid: 'browser' }] })
          const form = new URLSearchParams(String(init?.body)),
            code = form.get('code')!,
            transaction = transactions.get(code)
          transactions.delete(code)
          if (
            !transaction ||
            transaction.challenge !==
              Buffer.from(sha256(form.get('code_verifier')!), 'hex').toString('base64url')
          )
            return Response.json({ error: 'invalid_grant' }, { status: 400 })
          return Response.json({
            id_token: await new SignJWT({ nonce: transaction.nonce })
              .setIssuer(browserIssuer)
              .setSubject('synthetic-browser-owner')
              .setAudience('browser-fixture')
              .setIssuedAt()
              .setExpirationTime('2m')
              .setProtectedHeader({ alg: 'RS256', kid: 'browser' })
              .sign(keys.privateKey),
          })
        }
      )
      await new IdentityOperator(db.admin, browserIssuer).admit({
        issuer: browserIssuer,
        subject: 'synthetic-browser-owner',
        workspaceId,
        operatorId,
        requestId: randomUUID(),
        role: 'owner',
      })
      const browserSessions = new SessionService(
        db.api,
        browserAdapter,
        randomBytes(32),
        browserOrigin
      )
      control = createControlServer(new ControlService(db.api, browserSessions, false), {
        enabled: true,
        origin: browserOrigin,
      })
      browser = await chromium.launch({
        headless: true,
        executablePath: process.env.FORGE_IDENTITY_BROWSER_EXECUTABLE,
      })
      const context = await browser.newContext({ ignoreHTTPSErrors: true })
      const page = await context.newPage()
      await page.goto(browserOrigin)
      expect(await page.evaluate(async () => (await fetch('/api/v1/session')).status)).toBe(401)
      await page.getByRole('button', { name: 'Synthetic OIDC login' }).click()
      await page.getByRole('link', { name: 'Continue as synthetic owner' }).click()
      await page.waitForURL(`${browserOrigin}/workspace`)
      const sessionInfo = await page.evaluate(async () => (await fetch('/api/v1/session')).json())
      expect(sessionInfo.origin).toBe('oidc')
      expect(await page.evaluate(() => document.cookie)).toBe('')
      const cookies = await context.cookies(browserOrigin)
      expect(cookies.find((c) => c.name === '__Host-forge-control')).toMatchObject({
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      })
      expect(cookies.find((c) => c.name === '__Host-forge-bootstrap')).toBeUndefined()
      const logout = await page.evaluate(
        async (csrfToken: string) =>
          (
            await fetch('/api/v1/auth/logout', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
                'Idempotency-Key': crypto.randomUUID(),
              },
              body: JSON.stringify({ schemaVersion: 1 }),
            })
          ).status,
        sessionInfo.csrfToken
      )
      expect(logout).toBe(204)
      expect(await page.evaluate(async () => (await fetch('/api/v1/session')).status)).toBe(401)
    } finally {
      await browser?.close()
      https.closeAllConnections()
      await new Promise<void>((resolve) => https.close(() => resolve()))
      control?.closeAllConnections()
      rmSync(dir, { recursive: true, force: true })
    }
  },
  30000
)

it.each(['admit', 'revoke'] as const)(
  'operator %s rolls back NOWAIT contention without deadlocking session-first control admission',
  async (operation) => {
    const subject = `race-${operation}`
    const admitted = await operator.admit({
      issuer,
      subject,
      workspaceId,
      role: 'editor',
      operatorId,
      requestId: randomUUID(),
    })
    const current = await login(subject)
    let locked!: () => void, proceed!: () => void
    const held = new Promise<void>((r) => {
      locked = r
    })
    const continuation = new Promise<void>((r) => {
      proceed = r
    })
    const controlRequest = db.api.session(current.token, workspaceId, 'editor', async (tx) => {
      locked()
      await continuation
      // Canonical request ordering (also used by Task 07 preview grants).
      await tx.query('SELECT singleton FROM control_settings FOR SHARE')
      return true
    })
    await held
    const op =
      operation === 'admit'
        ? operator.admit({
            issuer,
            subject,
            workspaceId,
            role: 'viewer',
            operatorId,
            requestId: randomUUID(),
          })
        : operator.revoke({
            workspaceId,
            userId: admitted.userId,
            operatorId,
            requestId: randomUUID(),
          })
    const busy = await db.admin.query('SELECT 1')
    expect(busy.rowCount).toBe(1)
    // Let the operator observe the held membership/workspace before advancing.
    await new Promise((r) => setTimeout(r, 60))
    proceed()
    await expect(controlRequest).resolves.toBe(true)
    await op
    await expect(sessions.info(current.token)).rejects.toThrow()
  }
)

it('exhausted operator retries return safe busy with no partial membership, session or audit changes', async () => {
  const subject = 'race-busy'
  const admitted = await operator.admit({
    issuer,
    subject,
    workspaceId,
    role: 'editor',
    operatorId,
    requestId: randomUUID(),
  })
  const current = await login(subject)
  let locked!: () => void, release!: () => void
  const held = new Promise<void>((r) => {
    locked = r
  })
  const continuation = new Promise<void>((r) => {
    release = r
  })
  const active = db.api.session(current.token, workspaceId, 'editor', async () => {
    locked()
    await continuation
  })
  await held
  const requestId = randomUUID()
  try {
    await expect(
      operator.revoke({ workspaceId, userId: admitted.userId, operatorId, requestId })
    ).rejects.toThrow('IDENTITY_OPERATOR_BUSY_RETRY')
    expect(
      (
        await db.admin.query(
          'SELECT role FROM forge_control.memberships WHERE workspace_id=$1 AND user_id=$2',
          [workspaceId, admitted.userId]
        )
      ).rows
    ).toEqual([{ role: 'editor' }])
    expect(
      (
        await db.admin.query('SELECT revoked_at FROM forge_control.sessions WHERE id_hash=$1', [
          sha256(current.token),
        ])
      ).rows
    ).toEqual([{ revoked_at: null }])
    expect(
      (
        await db.admin.query('SELECT 1 FROM forge_control.audit_events WHERE request_id=$1', [
          requestId,
        ])
      ).rowCount
    ).toBe(0)
  } finally {
    release()
    await active
  }
  await operator.revoke({ workspaceId, userId: admitted.userId, operatorId, requestId })
  await expect(sessions.info(current.token)).rejects.toThrow()
})

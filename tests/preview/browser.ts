/** Real Chromium + local TLS + native PostgreSQL. App, identity, provider and
 * Vercel routing are explicitly local fixtures. No external deployment is made. */
import assert from 'node:assert/strict'
import { createServer } from 'node:https'
import { createServer as httpServer } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { chromium } from '@playwright/test'
import { createPreviewHarness } from '../harness/preview.ts'
import { previewGateway } from '../../engine/preview/gateway.ts'
import type { RuntimeRequest } from '../../engine/preview/gateway.ts'
import { previewControlRoutes } from '../../engine/preview/control-http.ts'
import { sha256 } from '../../engine/contracts/canonical.ts'

const h = await createPreviewHarness(),
  root = await mkdtemp(join(tmpdir(), 'forge-preview-browser-'))
const forgeHost = 'forge-task07.vercel.app',
  previewHost = 'preview-task07.vercel.app',
  otherHost = 'foreign-task07.vercel.app'
const sameSiteHost = 'child.forge-task07.vercel.app'
const forgeOrigin = `https://${forgeHost}`,
  origin = `https://${previewHost}`
const evidence: { name: string; result: string }[] = []
let received: RuntimeRequest | undefined,
  mode = 'normal',
  hold: (() => void) | undefined
let calls = 0
let completed = false
const app = httpServer((req, res) => {
  calls++
  if (req.url === '/redirect') {
    res.writeHead(302, { location: 'https://metadata.invalid/' })
    res.end()
    return
  }
  if (req.url === '/cookie') {
    res.writeHead(200, { 'set-cookie': '__Host-forge-preview=attacker; Secure; Path=/' })
    res.end('collision')
    return
  }
  if (req.url === '/hold') {
    hold = () => res.end('revoked-secret-body')
    return
  }
  if (req.url === '/timeout') return
  res.writeHead(200, {
    'content-type': 'text/html',
    'x-vercel-protection-bypass': 'fixture-deploy-canary',
    'set-cookie': 'guest=ignored; Secure; Path=/',
  })
  res.end(
    '<!doctype html><html><title>Fixture app</title><h1>Private fixture app</h1><script>window.fixtureReady=true</script></html>'
  )
})
await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve))
const appOrigin = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    join(root, 'key.pem'),
    '-out',
    join(root, 'cert.pem'),
    '-days',
    '1',
    '-subj',
    '/CN=task07-local-browser-fixture',
  ],
  { stdio: 'ignore' }
)
const tls = {
  key: await readFile(join(root, 'key.pem')),
  cert: await readFile(join(root, 'cert.pem')),
}
const p = await h.ready(previewHost),
  other = await h.ready(otherHost)
const controlRoute = previewControlRoutes(h.preview, forgeOrigin)
const gateway = previewGateway({
  hostname: previewHost,
  forgeOrigin,
  authority: h.preview,
  timeoutMs: 600,
  runtime: {
    async request(grant, request, signal) {
      assert.equal(grant.environmentId, p.route.environment_id)
      assert.equal(grant.generation, p.route.generation)
      assert.equal(String(grant.leaseEpoch), String(p.route.lease_epoch))
      if (mode === 'unhealthy') throw new Error('UNHEALTHY_FIXTURE')
      received = request
      const r = await fetch(appOrigin + request.path, {
        method: request.method,
        headers: request.headers,
        body: request.body.length ? Buffer.from(request.body) : undefined,
        redirect: 'manual',
        signal,
      })
      return {
        status: r.status,
        headers: Object.fromEntries(r.headers),
        body: new Uint8Array(await r.arrayBuffer()),
      }
    },
  },
})
const observations: { host: string; site?: string; cookie?: string }[] = []
const server = createServer(tls, async (req, res) => {
  if (![forgeHost, otherHost, sameSiteHost].includes(req.headers.host ?? '')) {
    await gateway(req, res)
    return
  }
  if (req.headers['sec-fetch-dest'] === 'document')
    observations.push({
      host: req.headers.host ?? '',
      site: req.headers['sec-fetch-site'] as string | undefined,
      cookie: req.headers.cookie,
    })
  if (await controlRoute(req, res)) return
  res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
  res.end('<!doctype html><title>Local platform fixture</title><h1>Local platform fixture</h1>')
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as AddressInfo).port
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
  args: ['--no-proxy-server', `--host-resolver-rules=MAP *.vercel.app 127.0.0.1:${port}`],
})
const context = await browser.newContext({ ignoreHTTPSErrors: true }),
  page = await context.newPage()
const record = (name: string) => evidence.push({ name, result: 'PASS' })
async function launch() {
  await page.goto(forgeOrigin)
  const ticket = await page.evaluate(
    async ({ pid, host, csrf }) => {
      const r = await fetch(`/api/v1/previews/${pid}/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ hostname: host }),
      })
      if (r.status !== 200) throw new Error('ticket HTTP issue failed')
      return (await r.json()) as { ticket: string }
    },
    { pid: p.route.id, host: previewHost, csrf: p.actor.csrf }
  )
  await page.evaluate(
    ({ origin, ticket }) => {
      const f = document.createElement('form')
      f.method = 'POST'
      f.action = origin + '/__forge/launch'
      const i = document.createElement('input')
      i.name = 'ticket'
      i.value = ticket
      f.append(i)
      document.body.append(f)
      f.submit()
    },
    { origin, ticket: ticket.ticket }
  )
  await page.waitForURL(origin + '/__forge/launch')
  await page.getByRole('link', { name: 'Open private preview' }).click()
  await page.waitForURL(origin + '/')
  assert.equal(await page.title(), 'Fixture app')
  return ticket.ticket
}
function raw(path: string, headers: Record<string, string> = {}, method = 'GET', body = '') {
  return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>(
    (resolve, reject) => {
      const req = httpsRequest(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          rejectUnauthorized: false,
          headers: { host: previewHost, ...headers },
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () =>
            resolve({
              status: res.statusCode!,
              body: Buffer.concat(chunks).toString(),
              headers: res.headers,
            })
          )
        }
      )
      req.on('error', reject)
      req.end(body)
    }
  )
}
try {
  assert.equal((await page.goto(origin))!.status(), 403)
  record('anonymous browser denied')
  await context.addCookies([
    {
      name: '__Host-forge-control',
      value: p.actor.token,
      url: forgeOrigin,
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ])
  // Real renderer and network behavior, including positive same-site control.
  await page.goto(forgeOrigin)
  await page.evaluate(() => {
    document.cookie = 'parent=collision; Domain=vercel.app; Secure; Path=/'
  })
  assert(!(await context.cookies()).some((c) => c.name === 'parent'))
  record('browser rejects Domain=vercel.app public-suffix cookie')
  await page.evaluate((host) => {
    location.href = `https://${host}`
  }, sameSiteHost)
  await page.waitForURL(`https://${sameSiteHost}/`)
  assert.equal(observations.at(-1)!.site, 'same-site')
  assert(!observations.at(-1)!.cookie?.includes('__Host-forge-control'))
  record('different origin under same registrable site is same-site; host cookie withheld')
  await page.goto(forgeOrigin)
  await page.evaluate((host) => {
    location.href = `https://${host}`
  }, otherHost)
  await page.waitForURL(`https://${otherHost}/`)
  assert.equal(observations.at(-1)!.site, 'cross-site')
  assert(!observations.at(-1)!.cookie?.includes(p.actor.token))
  record('sibling vercel.app domains are cross-site in real Chromium')
  await page.goto(forgeOrigin)
  const isolated = await page.evaluate(
    (host) =>
      new Promise<boolean>((resolve) => {
        const frame = document.createElement('iframe')
        frame.src = `https://${host}`
        frame.onload = () => {
          try {
            void frame.contentWindow!.document
            resolve(false)
          } catch {
            resolve(true)
          }
        }
        document.body.append(frame)
      }),
    otherHost
  )
  assert(isolated)
  record('same-origin policy blocks cross-host iframe document access')
  const csrfDenied = await page.evaluate(
    async ({ pid, host }) =>
      (
        await fetch(`/api/v1/previews/${pid}/tickets`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ hostname: host }),
        })
      ).status,
    { pid: p.route.id, host: previewHost }
  )
  assert.equal(csrfDenied, 403)
  record('canonical ticket HTTP endpoint requires CSRF proof')
  const ticket = await launch()
  record('cross-site POST launch, Strict cookie and explicit same-site continuation work')
  const session = (await context.cookies(origin)).find((c) => c.name === '__Host-forge-preview')!
  assert(
    session.httpOnly &&
      session.secure &&
      session.sameSite === 'Strict' &&
      session.domain === previewHost
  )
  assert(
    !(await page.evaluate(() => document.cookie).then((s) => s.includes('__Host-forge-preview')))
  )
  await page.evaluate(() => {
    document.cookie = '__Host-forge-preview=attacker; Secure; Path=/'
  })
  assert.equal(
    (await context.cookies(origin)).find((c) => c.name === '__Host-forge-preview')!.value,
    session.value
  )
  record('HttpOnly host-only gateway cookie resists guest JavaScript overwrite')
  assert(!Object.keys(received!.headers).some((k) => /cookie|authorization|forge|vercel/i.test(k)))
  assert(!(await page.content()).includes(p.actor.token))
  record('Forge and provider cookies/credentials withheld from fixture guest')
  const cookie = `__Host-forge-preview=${session.value}`
  assert.equal(
    (
      await raw(
        '/__forge/launch',
        { origin: forgeOrigin, 'content-type': 'application/x-www-form-urlencoded' },
        'POST',
        `ticket=${ticket}`
      )
    ).status,
    403
  )
  record('replayed launch denied through TLS gateway')
  for (const change of [{ origin: 'https://attacker.invalid' }, { origin: 'null' }])
    assert.equal(
      (
        await raw(
          '/__forge/launch',
          { ...change, 'content-type': 'application/x-www-form-urlencoded' },
          'POST',
          `ticket=${(await p.issue()).ticket}`
        )
      ).status,
      403
    )
  record('foreign and null launch origins denied')
  assert.equal((await raw('/', { cookie: `${cookie}; ${cookie}` })).status, 403)
  assert.equal((await raw('/', { cookie, 'x-forwarded-host': previewHost })).status, 403)
  assert.equal((await raw('/', { cookie, host: previewHost + ':443' })).status, 403) // dispatcher fallback checked separately below
  record('cookie collision and forwarded host rejected')
  for (const path of ['/redirect', '/cookie', '/%5f%5fforge/launch'])
    assert.equal((await raw(path, { cookie })).status, 403)
  record('upstream redirect, reserved Set-Cookie and encoded gateway namespace rejected')
  assert.equal((await raw('/api/tasks', { cookie, origin: forgeOrigin }, 'POST', 'x')).status, 403)
  assert.equal((await raw('/api/tasks', { cookie, origin }, 'POST', 'x')).status, 200)
  record('guest mutation requires exact preview origin')
  const expiredTicket = await p.issue()
  await h.db.admin.query(
    "UPDATE forge_control.preview_tickets SET created_at=now()-interval '2 minutes',expires_at=now()-interval '1 minute' WHERE token_hash=$1",
    [sha256(expiredTicket.ticket)]
  )
  assert.equal(
    (
      await raw(
        '/__forge/launch',
        { origin: forgeOrigin, 'content-type': 'application/x-www-form-urlencoded' },
        'POST',
        `ticket=${expiredTicket.ticket}`
      )
    ).status,
    403
  )
  const foreignSession = await h.preview.consume((await other.issue()).ticket, other.host)
  assert.equal(
    (await raw('/', { cookie: `__Host-forge-preview=${foreignSession.token}` })).status,
    403
  )
  record('expired ticket and cross-tenant session denied by actual TLS gateway')
  await h.db.admin.query(
    'UPDATE forge_control.environments SET lease_epoch=lease_epoch+1 WHERE id=$1',
    [p.route.environment_id]
  )
  assert.equal((await page.reload())!.status(), 403)
  await h.db.admin.query(
    'UPDATE forge_control.environments SET lease_epoch=lease_epoch-1 WHERE id=$1',
    [p.route.environment_id]
  )
  await page.goto(origin)
  record('browser denies stale environment epoch before any guest routing')
  mode = 'unhealthy'
  assert.equal((await raw('/', { cookie })).status, 403)
  mode = 'normal'
  record('unhealthy runtime denied')
  assert.equal((await raw('/timeout', { cookie })).status, 504)
  record('total preview timeout aborts stalled upstream')
  const renewed = await page.evaluate(
    async () => (await fetch('/__forge/renew', { method: 'POST' })).status
  )
  assert.equal(renewed, 204)
  assert.equal((await raw('/', { cookie })).status, 403)
  record('browser renewal rotates session and revokes old credential')
  const current = (await context.cookies(origin)).find((c) => c.name === '__Host-forge-preview')!
  const pending = raw('/hold', { cookie: `__Host-forge-preview=${current.value}` })
  for (let i = 0; !hold && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 5))
  assert(hold)
  await h.db.admin.query('DELETE FROM forge_control.memberships WHERE user_id=$1', [p.actor.id])
  hold()
  const denied = await pending
  assert.equal(denied.status, 403)
  assert(!denied.body.includes('revoked-secret-body'))
  assert.equal((await page.reload())!.status(), 403)
  record('membership revocation during in-flight response withholds body and denies browser reload')
  assert.equal(
    (await h.preview.consume((await other.issue()).ticket, other.host)).grant.hostname,
    otherHost
  )
  await h.db.maintenance.tx((c) => c.query('SELECT cleanup_preview_credentials()'))
  const dead = await h.db.admin.query(
    'SELECT revoked_at FROM forge_control.preview_tickets WHERE token_hash=$1',
    [sha256(current.value)]
  )
  assert(dead.rows[0].revoked_at)
  record('maintenance invalidates revoked viewer credential')
  completed = true
} finally {
  await browser.close()
  server.closeAllConnections()
  app.closeAllConnections()
  await Promise.all([
    new Promise<void>((r) => server.close(() => r())),
    new Promise<void>((r) => app.close(() => r())),
  ])
  await h.close()
  await rm(root, { recursive: true, force: true })
  const result = {
    recordedAt: new Date().toISOString(),
    outcome: completed ? 'PASS' : 'FAIL',
    browser: browser.version(),
    database: h.db.version,
    evidence:
      'real browser/TLS/native PostgreSQL; synthetic identity/app/runtime and local hostname mapping',
    trust:
      'self-signed local TLS with ignoreHTTPSErrors; not public DNS/TLS or Vercel protection evidence',
    tests: evidence,
    fixtureAppRequests: calls,
    blocked: [
      'live Vercel protection authorized/unauthorized browsers',
      'generated-app readiness/restart on Task 02 runtime',
      'public DNS/TLS and issued immutable deployment host',
    ],
  }
  await mkdir('docs/reports/demo-delivery/evidence-task-07', { recursive: true })
  await writeFile(
    'docs/reports/demo-delivery/evidence-task-07/browser.json',
    JSON.stringify(result, null, 2) + '\n'
  )
  console.log(JSON.stringify(result, null, 2))
}

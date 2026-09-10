/** Local regression only: real Next.js/Better Auth/PostgreSQL, synthetic mail.
 * No generated-code execution, external account, provider call or deployment.
 * Uses test-only local TLS trust and an injected socket-only auth pool.
 */
import next from 'next'
import { chromium, firefox, expect } from '@playwright/test'
import { createServer } from 'node:https'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Pool } from 'pg'
import { startNativePostgres } from '../engine/native-postgres'
import { ControlDatabase } from '../../engine/control/database'
import { HostedIdentityBridge } from '../../engine/control/hosted-identity'

for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  if (
    await access(name).then(
      () => true,
      () => false
    )
  )
    throw new Error('Use a clean clone without private environment files')
}
const output = resolve(
  process.env.FORGE_AUTH_BROWSER_OUTPUT || '/tmp/forge-production-auth-browser'
)
const connectionsMode = process.env.FORGE_AUTH_BROWSER_CONNECTIONS === 'true'
const browserName = process.env.FORGE_AUTH_BROWSER === 'firefox' ? 'firefox' : 'chromium'
for (const key of Object.keys(process.env)) {
  if (
    /^(FORGE_|BETTER_AUTH_|DATABASE_|GOOGLE_|GITHUB_|GEMINI_|GROQ_|OPENROUTER_|NVIDIA_|OLLAMA_|VERCEL)/.test(
      key
    )
  )
    delete process.env[key]
}
process.env.NEXT_TELEMETRY_DISABLED = '1'
const lock = join(tmpdir(), 'forge-native-verification.lock')
await mkdir(lock) // Fails if another verifier owns the lock; never remove its lock.
const temp = await mkdtemp(join(tmpdir(), 'forge-auth-browser-'))
let cluster: Awaited<ReturnType<typeof startNativePostgres>> | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let application: ReturnType<typeof next> | undefined
let server: ReturnType<typeof createServer> | undefined
let authConnection: Pool | undefined
let controlConnection: ControlDatabase | undefined
const mail: { to: string; url: string; subject: string }[] = []
const observed: string[] = []
const password = randomBytes(24).toString('base64url')
const realFetch = globalThis.fetch
try {
  await mkdir(output, { recursive: true })
  const key = join(temp, 'key.pem'),
    cert = join(temp, 'cert.pem')
  const openssl = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
    ],
    { encoding: 'utf8' }
  )
  if (openssl.status !== 0) throw new Error('Temporary test TLS setup failed')
  cluster = await startNativePostgres()
  for (const name of [
    '0001_initial.sql',
    '0002_runtime_version.sql',
    '0003_unified.sql',
    '0005_public_auth.sql',
  ])
    await cluster.admin.query(await readFile(join('drizzle', name), 'utf8'))
  await cluster.admin.query(await readFile('docs/examples/public-auth-grants.sql', 'utf8'))
  await cluster.admin
    .query(`CREATE ROLE browser_auth LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    GRANT forge_auth_api TO browser_auth;
    CREATE ROLE browser_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    GRANT USAGE ON SCHEMA public TO browser_app;
    GRANT SELECT,INSERT,UPDATE,DELETE ON forge_projects,forge_jobs,forge_events,forge_runtime,forge_revisions,forge_messages,forge_memberships,forge_comments TO browser_app;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO browser_app`)
  authConnection = new Pool({ ...cluster.config, user: 'browser_auth' })
  ;(globalThis as { forgeAuthPool?: Pool }).forgeAuthPool = authConnection
  process.env.DATABASE_URL = `postgresql://browser_app@localhost/postgres?host=${cluster.config.host}&port=${cluster.config.port}`
  process.env.FORGE_AUTH_MODE = 'hosted'
  process.env.FORGE_SIGNUP_POLICY = 'public'
  process.env.BETTER_AUTH_SECRET = randomBytes(32).toString('hex')
  process.env.FORGE_EMAIL_ENDPOINT = 'https://synthetic-mail.example.invalid/send'
  process.env.FORGE_EMAIL_TOKEN = randomBytes(32).toString('hex')
  globalThis.fetch = async (input, init) => {
    if (String(input) !== process.env.FORGE_EMAIL_ENDPOINT) return realFetch(input, init)
    mail.push(JSON.parse(String(init?.body)))
    return new Response(null, { status: 202 })
  }
  server = createServer({ key: await readFile(key), cert: await readFile(cert) }, (req, res) => {
    void application!.getRequestHandler()(req, res)
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const origin = `https://127.0.0.1:${port}`
  process.env.BETTER_AUTH_URL = origin
  if (connectionsMode) {
    for (const name of [
      '0003_immutable_source_bridge.sql',
      '0004_hosted_identity.sql',
      '0005_hosted_byok.sql',
    ])
      await cluster.admin.query(await readFile(join('engine/migrations', name), 'utf8'))
    await cluster.admin.query(
      "UPDATE forge_control.control_settings SET environment='hosted',admission_enabled=false,worker_enabled=false"
    )
    await cluster.admin.query(
      'INSERT INTO forge_control.hosted_identity_settings(issuer,enabled) VALUES($1,true)',
      [`${origin}/api/auth`]
    )
    controlConnection = new ControlDatabase(
      { ...cluster.config, user: 'e1_api' },
      'forge_control_api',
      'hosted'
    )
    ;(globalThis as { forgeHostedControl?: unknown }).forgeHostedControl = {
      db: controlConnection,
      bridge: new HostedIdentityBridge(controlConnection, randomBytes(32)),
    }
    process.env.FORGE_HOSTED_CONTROL = 'true'
    process.env.FORGE_CREDENTIAL_KEYS_JSON = JSON.stringify({ v1: randomBytes(32).toString('hex') })
  }
  application = next({ dev: false, hostname: '127.0.0.1', port })
  await application.prepare()
  browser = await (browserName === 'firefox'
    ? firefox.launch()
    : chromium.launch({ channel: 'chrome' }))
  const check = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await check.newPage()
  for (const theme of ['light', 'dark'] as const)
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
      await page.goto(`${origin}/login`)
      await expect(
        page.getByRole('button', { name: 'Create an account', exact: true })
      ).toBeVisible()
      await page.getByRole('button', { name: 'Create an account', exact: true }).click()
      await expect(
        page.getByRole('button', { name: 'Create account →', exact: true })
      ).toBeVisible()
      const reflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
      if (!reflow) throw new Error(`Horizontal overflow at ${width} ${theme}`)
      await page.screenshot({ path: join(output, `signup-${theme}-${width}.png`), fullPage: true })
      await page.keyboard.press('Tab')
      const focused = await page.evaluate(() => document.activeElement !== document.body)
      if (!focused) throw new Error('Keyboard focus is missing')
      await page.evaluate(() => {
        document.body.style.zoom = '2'
      })
      if (!(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)))
        throw new Error(`CSS zoom overflow at ${width} ${theme}`)
      observed.push(
        `signup ${theme} ${width}: reflow, keyboard, CSS 200% zoom; reduced-motion emulation`
      )
    }
  await check.close()
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
    recordVideo: { dir: output, size: { width: 1280, height: 900 } },
  })
  await context.addInitScript((keys: boolean) => {
    document.addEventListener('DOMContentLoaded', () => {
      const note = document.createElement('div')
      note.textContent = keys
        ? 'LOCAL CONNECTIONS REGRESSION · synthetic account/mail/keys · no website build'
        : 'LOCAL WORKFLOW REGRESSION · synthetic account/mail · website build unavailable'
      note.style.cssText =
        'position:fixed;bottom:0;left:0;right:0;z-index:999999;background:#141111;color:#fff;padding:8px;font:12px monospace;text-align:center'
      document.body.append(note)
    })
  }, connectionsMode)
  const demo = await context.newPage()
  await demo.goto(`${origin}/login`)
  await demo.getByRole('button', { name: 'Create an account', exact: true }).click()
  await demo.getByLabel('Your name').fill('Synthetic Forge account')
  await demo.getByLabel('Email', { exact: true }).fill('synthetic-demo@example.invalid')
  await demo.getByLabel('Password', { exact: true }).fill(password)
  await demo.waitForTimeout(1200) // Hold the masked form long enough to review the recording.
  await demo.getByRole('button', { name: 'Create account →', exact: true }).click()
  await expect(demo.getByRole('status')).toContainText('verify your account')
  await demo.waitForTimeout(1200)
  observed.push('real public signup route accepts synthetic account without invite')
  if (mail.length !== 1) throw new Error('Synthetic verification mail was not captured')
  await demo.goto(mail[0].url)
  await demo.goto(`${origin}/login`)
  await demo.getByLabel('Email', { exact: true }).fill('synthetic-demo@example.invalid')
  await demo.getByLabel('Password', { exact: true }).fill(password)
  await demo.getByRole('button', { name: 'Sign in →', exact: true }).click()
  await expect(demo).toHaveURL(`${origin}/app`)
  await expect(
    demo.getByRole('status').filter({ hasText: 'Website generation is not connected' })
  ).toBeVisible()
  await demo.waitForTimeout(1800)
  observed.push('verified account signs in; hosted runtime accurately unavailable')
  const websitePrompt =
    'Build a simple one-page website for a neighborhood bakery, with an introduction, opening hours and a contact section.'
  await demo.getByLabel('Describe your project').fill(websitePrompt)
  await demo.waitForTimeout(1600)
  await demo.getByRole('button', { name: 'Build project ↗', exact: true }).click()
  await expect(demo.locator('.form-error[role="alert"]')).toContainText(
    'Website generation is not connected'
  )
  await demo.screenshot({ path: join(output, 'website-attempt.png'), fullPage: true })
  await demo.waitForTimeout(2500)
  await demo.getByRole('link', { name: 'Connections', exact: true }).click()
  if (connectionsMode) {
    await expect(demo.getByRole('heading', { name: 'Your model keys' })).toBeVisible()
    await demo.getByLabel('Provider', { exact: true }).selectOption('groq')
    const syntheticKey = `synthetic-${randomBytes(24).toString('hex')}`
    await demo.getByLabel('API key', { exact: true }).fill(syntheticKey)
    await demo.getByRole('button', { name: 'Save key', exact: true }).click()
    await expect(demo.getByRole('status').filter({ hasText: 'Key saved.' })).toBeVisible()
    await expect(demo.getByLabel('API key', { exact: true })).toHaveValue('')
    const stored = await cluster.admin.query(
      'SELECT envelope_json FROM forge_control.provider_credentials'
    )
    expect(stored.rowCount).toBe(1)
    expect(JSON.stringify(stored.rows)).not.toContain(syntheticKey)
    await demo.reload()
    await expect(demo.getByRole('heading', { name: 'Groq', exact: true })).toBeVisible()
    await demo.locator('summary').filter({ hasText: 'Replace key' }).click()
    await demo
      .getByLabel('Replacement API key')
      .fill(`synthetic-replacement-${randomBytes(24).toString('hex')}`)
    await demo.getByRole('button', { name: 'Replace key', exact: true }).click()
    await expect(demo.getByRole('status').filter({ hasText: 'Key replaced.' })).toBeVisible()
    await demo.getByRole('button', { name: 'Remove key', exact: true }).click()
    await demo.getByRole('button', { name: 'Confirm removal', exact: true }).click()
    await expect(demo.getByText('No keys connected yet.', { exact: true })).toBeVisible()
    const removed = await cluster.admin.query(
      'SELECT envelope_json,deleted,revision FROM forge_control.provider_credentials'
    )
    expect(removed.rows).toEqual([{ envelope_json: null, deleted: true, revision: '3' }])
    observed.push(
      'real authenticated key save/reload/replace/remove routes; ciphertext-only persistence; no external provider request'
    )
  } else {
    await expect(
      demo.getByRole('heading', { name: 'Model connections are not available yet' })
    ).toBeVisible()
  }
  await demo.screenshot({ path: join(output, 'hosted-connections.png'), fullPage: true })
  await demo.waitForTimeout(2500)
  await demo.getByRole('link', { name: 'Home', exact: true }).click()
  await expect(demo.getByLabel('Describe your project')).toHaveValue(websitePrompt)
  await demo.reload()
  await expect(demo.getByLabel('Describe your project')).toHaveValue(websitePrompt)
  const attempted = await demo.request.post(`${origin}/api/projects`, {
    headers: { origin },
    data: {
      prompt: websitePrompt,
      mode: 'build',
      provider: 'groq',
      model: 'synthetic-unavailable',
      idempotencyKey: randomUUID(),
    },
  })
  expect(attempted.status()).toBe(503)
  expect((await attempted.json()).error).toContain('Website generation is not connected')
  const counts = await cluster.admin.query(
    'SELECT (SELECT count(*) FROM forge_projects) AS projects, (SELECT count(*) FROM forge_jobs) AS jobs'
  )
  expect(counts.rows[0]).toEqual({ projects: '0', jobs: '0' })
  observed.push(
    'simple website request reports unavailable runtime; prompt survives navigation and reload; direct API creates no job or project'
  )
  await demo.goto(`${origin}/login`)
  await demo.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(demo.getByRole('button', { name: 'Sign in →', exact: true })).toBeVisible()
  await demo.waitForTimeout(1200)
  observed.push('logout removes session')
  await demo.getByLabel('Email', { exact: true }).fill('synthetic-demo@example.invalid')
  await demo.getByRole('button', { name: 'Forgot password', exact: true }).click()
  await expect(demo.getByRole('status')).toContainText('recovery instructions')
  const recovery = mail.at(-1)!
  if (!recovery.subject.includes('Reset')) throw new Error('Synthetic recovery mail missing')
  await demo.goto(recovery.url)
  await demo.getByLabel('New password').fill(`${password}new`)
  await demo.waitForTimeout(1200)
  await demo.getByRole('button', { name: 'Reset password', exact: true }).click()
  await expect(demo.getByRole('status')).toContainText('Password updated')
  await demo.waitForTimeout(1800)
  observed.push(
    'single-use recovery link updates password through real route; mailbox is simulated'
  )
  await demo.goto(`${origin}/login`)
  await demo.getByLabel('Email', { exact: true }).fill('synthetic-demo@example.invalid')
  await demo.getByLabel('Password', { exact: true }).fill(`${password}new`)
  await demo.getByRole('button', { name: 'Sign in →', exact: true }).click()
  await expect(demo).toHaveURL(`${origin}/app`)
  await demo.waitForTimeout(1800)
  const video = demo.video()!
  const visualContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    storageState: await context.storageState(),
  })
  await context.close()
  await video.saveAs(
    join(output, connectionsMode ? 'local-account-connections.webm' : 'local-website-attempt.webm')
  )
  const visual = await visualContext.newPage()
  for (const theme of ['light', 'dark'] as const)
    for (const width of [390, 768, 1440])
      for (const route of ['home', 'connections']) {
        await visual.setViewportSize({ width, height: 1000 })
        await visual.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        await visual.goto(`${origin}/app${route === 'home' ? '' : '/connections'}`)
        if (connectionsMode && route === 'connections')
          await expect(visual.getByRole('heading', { name: 'Your model keys' })).toBeVisible()
        else
          await expect(
            visual.getByRole('status').filter({
              hasText:
                route === 'home'
                  ? 'Website generation is not connected'
                  : 'This installation has not connected',
            })
          ).toBeVisible()
        if (!(await visual.evaluate(() => document.documentElement.scrollWidth <= innerWidth)))
          throw new Error(`Workspace overflow at ${route} ${width} ${theme}`)
        await visual.keyboard.press('Tab')
        const focus = await visual.evaluate(() => {
          const element = document.activeElement
          return (
            element !== document.body &&
            element &&
            getComputedStyle(element).outlineStyle !== 'none'
          )
        })
        if (!focus) throw new Error(`Visible keyboard focus missing at ${route} ${width} ${theme}`)
        await visual.screenshot({
          path: join(output, `${route}-${theme}-${width}.png`),
          fullPage: true,
        })
        await visual.evaluate(() => {
          document.body.style.zoom = '2'
        })
        if (!(await visual.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) {
          await visual.screenshot({
            path: join(output, `zoom-failure-${route}-${theme}-${width}.png`),
            fullPage: true,
          })
          throw new Error(`Workspace CSS zoom overflow at ${route} ${width} ${theme}`)
        }
        observed.push(
          `${route} ${theme} ${width}: reflow, visible keyboard focus, CSS 200% zoom; reduced-motion emulation`
        )
      }
  await visualContext.close()
  await writeFile(
    join(output, 'results.json'),
    JSON.stringify(
      {
        classification: connectionsMode
          ? 'local-native-synthetic-mail-keys'
          : 'local-native-synthetic-mail',
        browser: browserName,
        passed: observed,
        publicDeployment: false,
        externalEmailDelivery: false,
        generatedApp: false,
        nativeZoom: 'not run',
        osReducedMotion: 'not run',
        secretsRecorded: false,
      },
      null,
      2
    ) + '\n'
  )
  console.log(
    `PASS: ${observed.length} local auth/browser checks. Synthetic inbox only. Evidence: ${output}`
  )
} catch (error) {
  const safe = String(error)
    .split(password)
    .join('[redacted synthetic password]')
    .replace(/(token=)[^\s&"']+/g, '$1[redacted]')
  await writeFile(join(output, 'failure.txt'), safe)
  console.error(safe)
  process.exitCode = 1
} finally {
  await browser?.close()
  server?.closeAllConnections()
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
  await application?.close()
  await authConnection?.end()
  await controlConnection?.close()
  delete (globalThis as { forgeHostedControl?: unknown }).forgeHostedControl
  await (globalThis as { forgePool?: Pool }).forgePool?.end()
  await cluster?.close()
  globalThis.fetch = realFetch
  await rm(temp, { recursive: true, force: true })
  await rm(lock, { recursive: true })
  console.log(
    'Cleanup: owned browser, application, PostgreSQL, TLS material and verifier lock removed.'
  )
}

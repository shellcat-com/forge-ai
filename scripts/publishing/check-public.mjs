/* global document, window, getComputedStyle */
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'

// Fresh browser contexts, no owner session, no bypass headers or cookies.
// Usage: node scripts/publishing/check-public.mjs OUTPUT_DIRECTORY --stage STAGE
//    or: node scripts/publishing/check-public.mjs OUTPUT_DIRECTORY --url HTTPS_URL
const [evidencePath, mode, input] = process.argv.slice(2)
if (!evidencePath || !['--stage', '--url'].includes(mode) || !input || process.argv.length !== 5)
  throw new Error('Expected evidence directory and --stage directory or --url URL')
const evidence = resolve(evidencePath)
await mkdir(evidence, { recursive: true })
let server
let url
if (mode === '--stage') {
  const stage = resolve(input)
  const receipt = JSON.parse(await readFile(join(stage, 'publication-receipt.json'), 'utf8'))
  const config = JSON.parse(await readFile(join(stage, '.vercel/output/config.json'), 'utf8'))
  const files = new Map(
    await Promise.all(
      receipt.files.map(async (f) => [
        '/' + f.path,
        await readFile(join(stage, '.vercel/output/static', f.path)),
      ])
    )
  )
  const types = {
    html: 'text/html',
    js: 'text/javascript',
    css: 'text/css',
    woff: 'font/woff',
    woff2: 'font/woff2',
  }
  server = createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname
    const file = files.get(path === '/' ? '/index.html' : path)
    res.writeHead(file ? 200 : 404, {
      ...config.routes[0].headers,
      'Content-Type':
        types[(path === '/' ? 'index.html' : path).split('.').at(-1)] || 'application/octet-stream',
    })
    res.end(file || 'Not found')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${server.address().port}`
} else {
  const parsed = new URL(input)
  assert.equal(parsed.protocol, 'https:')
  assert.ok(parsed.hostname.endsWith('.vercel.app'))
  assert.equal(parsed.origin, input)
  url = input
}
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const cases = []
try {
  for (const theme of ['light', 'dark'])
    for (const width of [390, 768, 1440]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        colorScheme: theme,
        serviceWorkers: 'block',
      })
      const page = await context.newPage()
      const requests = [],
        errors = [],
        failedResponses = []
      page.on('request', (req) => requests.push({ url: req.url(), method: req.method() }))
      page.on('pageerror', (err) => errors.push(err.message))
      page.on('response', (res) => {
        if (res.status() >= 400) failedResponses.push({ url: res.url(), status: res.status() })
      })
      const response = await page.goto(url, { waitUntil: 'networkidle' })
      assert.equal(response.status(), 200)
      assert.match(response.headers()['content-security-policy'], /connect-src 'none'/)
      await page.getByRole('heading', { name: 'The hosted builder is unavailable.' }).waitFor()
      assert.equal(await page.locator('form, input, iframe').count(), 0)
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme)
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true
      )
      assert.equal(await page.evaluate(() => document.fonts.check('16px "IBM Plex Mono"')), true)
      await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Skip to content')
      await page.keyboard.press('Enter')
      assert.equal(await page.evaluate(() => document.activeElement.id), 'main')
      await page.getByRole('link', { name: 'Workflow', exact: true }).click()
      assert.equal(new URL(page.url()).hash, '#workflow')
      await page.getByRole('link', { name: 'Back to top' }).click()
      await page.screenshot({ path: join(evidence, `${theme}-${width}.png`), fullPage: true })
      const zoom = await page.evaluate(() => {
        document.documentElement.style.zoom = '2'
        const fits = document.documentElement.scrollWidth <= window.innerWidth
        document.documentElement.style.zoom = ''
        return fits
      })
      assert.equal(zoom, true)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      assert.equal(
        await page
          .locator('.hosted-action')
          .first()
          .evaluate((el) => getComputedStyle(el).transitionDuration),
        '0s'
      )
      assert.equal(errors.length, 0)
      assert.equal(failedResponses.length, 0)
      assert.equal(
        requests.every((r) => new URL(r.url).origin === url && r.method === 'GET'),
        true
      )
      assert.equal(
        requests.some((r) => /\/api(?:\/|$)/.test(new URL(r.url).pathname)),
        false
      )
      const api = await context.request.get(`${url}/api/status`)
      assert.equal(api.status(), 404)
      cases.push({
        theme,
        width,
        publicAccess: 'passed',
        assets: 'passed',
        internalNavigation: 'passed',
        keyboard: 'passed',
        overflow: 'passed',
        css200PercentZoomSimulation: zoom ? 'passed' : 'failed',
        nativeBrowserZoom: 'not-run',
        reducedMotionMediaEmulation: 'passed',
        nativeOSReducedMotion: 'not-run',
        sameOriginOnly: true,
        apiStatus: api.status(),
        requestCount: requests.length,
        cookies: (await context.cookies()).map((c) => c.name),
      })
      await context.close()
    }
  await writeFile(
    join(evidence, 'browser.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: 'platform-unavailable-frontend',
        origin: mode === '--stage' ? 'local-static-artifact' : 'live-vercel-unauthenticated',
        url,
        checkedAt: new Date().toISOString(),
        cases,
        generatedPortfolio: false,
        liveBuilder: false,
      },
      null,
      2
    ) + '\n'
  )
  console.info(
    JSON.stringify({
      passed: cases.length,
      evidence,
      generatedPortfolio: false,
      liveBuilder: false,
    })
  )
} finally {
  await browser.close()
  if (server) await new Promise((resolve) => server.close(resolve))
}

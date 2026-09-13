/* global URL, process, document, innerWidth, getComputedStyle, matchMedia */
// Only the reviewed platform scaffold may run on this host; no provider source.
import { chromium } from '../templates/next-postgres-v1/node_modules/@playwright/test/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { platform, release } from 'node:os'
const output = fileURLToPath(new URL('./evidence/candidate/', import.meta.url))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.FORGE_CANDIDATE_CHROMIUM, headless: true })
const results = []
try {
  for (const colorScheme of ['light', 'dark']) {
    for (const width of [390, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme, reducedMotion: 'reduce' })
      await page.goto('http://127.0.0.1:3103', { waitUntil: 'networkidle' })
      const heading = await page.getByRole('heading', { name: 'Your application starts here' }).count()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
      await page.keyboard.press('Tab')
      const focused = await page.getByRole('link', { name: 'Check template process' }).evaluate(element => element === document.activeElement && getComputedStyle(element).outlineStyle !== 'none')
      await page.screenshot({ path: `${output}/${colorScheme}-${width}.png`, fullPage: true })
      await page.evaluate(() => { document.documentElement.style.zoom = '2' })
      const zoomOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
      const reducedMotion = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
      const passed = heading === 1 && !overflow && focused && !zoomOverflow && reducedMotion
      results.push({ colorScheme, width, heading, overflow, focused, zoomOverflow, reducedMotion, passed })
      await page.close()
    }
  }
  const page = await browser.newPage()
  const health = await page.request.get('http://127.0.0.1:3103/api/health')
  const body = await health.json()
  results.push({ processHealth: health.ok() && body.database === 'not-probed', passed: health.ok() && body.database === 'not-probed' })
  await page.close()
} finally { await browser.close() }
const report = { schemaVersion: 1, origin: 'platform-authored-candidate-host-browser', isolationAcceptance: false, providerGeneration: false,
  testedAt: new Date().toISOString(), node: process.version, host: `${platform()} ${release()}`, browser: 'operator-supplied cached Chromium', results }
await writeFile(`${output}/browser.json`, JSON.stringify(report, null, 2))
if (results.some(result => !result.passed)) process.exitCode = 1

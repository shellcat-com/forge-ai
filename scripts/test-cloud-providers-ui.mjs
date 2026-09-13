/* global document, innerWidth */
const { chromium } = await import(process.env.FORGE_PLAYWRIGHT_MODULE || 'playwright')
import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const failures = []
page.on('pageerror', error => failures.push(error.message))
const reports = []
const origin = process.env.FORGE_FIXTURE_ORIGIN || 'http://127.0.0.1:5174'
try {
await page.goto(origin + '/#/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.getByLabel('Email address', { exact: true }).fill('qa@example.test')
await page.getByLabel('Password', { exact: true }).fill('synthetic-password')
await page.getByRole('button', { name: 'Sign in', exact: true }).click()
await page.getByRole('heading', { name: 'Your projects.' }).waitFor()
await page.getByRole('link', { name: 'Settings', exact: true }).click()
await page.getByRole('heading', { name: 'Your AI providers' }).waitFor()
await page.getByLabel('New DeepSeek API key').fill('invalid-test-key')
await page.getByRole('button', { name: 'Check and save key', exact: true }).click()
await page.getByText('Provider rejected the synthetic test key.', { exact: true }).waitFor()
assert.equal(await page.getByLabel('New DeepSeek API key').inputValue(), '')
await page.getByLabel('New DeepSeek API key').fill('synthetic-valid-key')
await page.getByRole('button', { name: 'Check and save key', exact: true }).click()
await page.getByText('Connected · Key fingerprint synthetic123', { exact: true }).waitFor()
assert.equal(await page.locator('body').innerHTML().then(html => html.includes('synthetic-valid-key')), false)
for (const width of [390, 768, 1440]) {
  await page.setViewportSize({ width, height: 900 })
  for (const theme of ['light', 'dark']) {
    await page.locator('[data-theme-choice="' + theme + '"]').click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: `output/provider-connections/settings-${theme}-${width}.png`, fullPage: true, animations: 'disabled' })
    reports.push({ screen: 'settings', theme, width, overflow: false })
  }
}
await page.getByRole('link', { name: 'Projects', exact: true }).click()
await page.getByRole('link', { name: 'Synthetic customer portal', exact: true }).click()
await page.getByRole('button', { name: 'Send brief and generate', exact: true }).click()
await page.getByText('Synthetic text plan. No provider was called.', { exact: true }).waitFor()
await page.getByLabel('Output', { exact: true }).selectOption('website')
await page.getByRole('button', { name: 'Send brief and generate', exact: true }).click()
const frame = page.frameLocator('iframe[title="Generated frontend preview"]')
await frame.getByRole('heading', { name: 'Synthetic frontend' }).waitFor()
await frame.getByRole('button', { name: 'Try interaction' }).click()
await frame.getByRole('button', { name: 'Clicked' }).waitFor()
assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts')
const download = page.waitForEvent('download')
await page.getByRole('button', { name: 'Download frontend HTML' }).click()
assert.equal((await download).suggestedFilename(), 'forge-website.html')
assert.equal(await page.getByLabel('Output', { exact: true }).inputValue(), 'website')
await frame.getByRole('button', { name: 'Clicked' }).waitFor()
await frame.locator('body').screenshot({ path: 'output/provider-connections/frontend-preview.png' })
for (const width of [390, 768, 1440]) {
  await page.setViewportSize({ width, height: 900 })
  for (const theme of ['light', 'dark']) {
    await page.locator('[data-theme-choice="' + theme + '"]').click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.locator('iframe').scrollIntoViewIfNeeded()
    await frame.getByRole('heading', { name: 'Synthetic frontend' }).waitFor()
    await page.screenshot({ path: `output/provider-connections/generate-${theme}-${width}.png`, fullPage: true, animations: 'disabled' })
    reports.push({ screen: 'generation', theme, width, overflow: false })
  }
}
await page.emulateMedia({ reducedMotion: 'reduce' })
await page.getByLabel('Provider and model').focus()
assert.equal(await page.getByLabel('Provider and model').evaluate(el => el.matches(':focus-visible')), true)
await page.keyboard.press('Tab')
assert.equal(await page.getByLabel('Output', { exact: true }).evaluate(el => el === document.activeElement), true)
await page.screenshot({ path: 'output/provider-connections/keyboard-focus.png', fullPage: true, animations: 'disabled' })
await page.evaluate(() => { document.documentElement.style.zoom = '2' })
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
await page.screenshot({ path: 'output/provider-connections/zoom-200.png', fullPage: true, animations: 'disabled' })
await page.evaluate(() => { document.documentElement.style.zoom = '' })
await page.getByRole('link', { name: 'Settings', exact: true }).click()
await page.getByRole('button', { name: 'Remove DeepSeek key', exact: true }).click()
await page.getByText('No key connected', { exact: true }).waitFor()
await page.getByRole('button', { name: 'Sign out', exact: true }).click()
await page.getByRole('heading', { name: 'Welcome to Forge.' }).waitFor()
assert.equal((await page.locator('body').innerText()).includes('Synthetic frontend'), false)
assert.deepEqual(failures, [])
await writeFile('output/provider-connections/browser-checks.json', JSON.stringify({ synthetic: true, reports, keyboard: 'passed', reducedMotion: 'emulated', zoom: 'CSS 200%; native browser zoom not checked', flow: 'login, rejected key, checked key, text, frontend interaction and download, remove, logout', failures }, null, 2))
console.log('Synthetic provider browser journey and 12 viewport/theme checks passed.')

} catch (error) {
  console.log(await page.locator('body').innerText())
  await page.screenshot({ path: 'output/provider-connections/failure.png', fullPage: true, animations: 'disabled' })
  throw error
} finally { await browser.close() }

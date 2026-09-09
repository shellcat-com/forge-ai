import { test, expect } from '@playwright/test'
import { demoPrompt } from '../../src/public-renderers/documentation'

test('chapters navigate in place and the complete demo copies without changing the composer', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/docs')
  await page.evaluate(() =>
    localStorage.setItem(
      'forge.composer.v2',
      JSON.stringify({
        prompt: 'Keep my existing draft',
        mode: 'plan',
        style: 'original',
        example: '',
      })
    )
  )
  const submissions: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST') submissions.push(r.url())
  })
  await expect(page).toHaveTitle('Documentation — Forge AI')
  await expect(page.locator('main h1')).toContainText('Describe your product well.')
  await page
    .getByRole('navigation', { name: 'Guide chapters', exact: true })
    .getByRole('link', { name: 'Copy a complete prompt' })
    .click()
  await expect(page).toHaveURL(/\/docs#guide-demo-prompt$/)
  await expect(page.getByLabel('Complete demo prompt')).toHaveValue(demoPrompt)
  expect(demoPrompt.startsWith('Your own, describe your product well.')).toBe(true)
  expect(demoPrompt.length).toBeLessThanOrEqual(12000)
  await page.getByRole('button', { name: 'Copy demo prompt' }).click()
  await expect(page.locator('#guide-copy-status')).toContainText('Demo prompt copied.')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(demoPrompt)
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('forge.composer.v2')!).prompt)
  ).toBe('Keep my existing draft')
  expect(submissions).toEqual([])
  await page.getByRole('link', { name: 'Return to the demo prompt' }).click()
  await expect(page).toHaveURL(/#guide-demo-prompt$/)
})

test('clipboard failure leaves the whole prompt selected for manual copying', async ({ page }) => {
  await page.goto('/docs#guide-demo-prompt')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('Denied')) },
    })
  })
  await page.getByRole('button', { name: 'Copy demo prompt' }).click()
  await expect(page.locator('#guide-copy-status')).toContainText('The prompt is selected')
  await expect(page.getByLabel('Complete demo prompt')).toBeFocused()
  const length = await page
    .getByLabel('Complete demo prompt')
    .evaluate((node: HTMLTextAreaElement) => node.selectionEnd - node.selectionStart)
  expect(length).toBe(demoPrompt.length)
})

for (const theme of ['light', 'dark'] as const)
  for (const width of [390, 768, 1440])
    test(`documentation fits ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
      await page.goto('/docs')
      await page.evaluate(() => document.fonts.ready)
      await expect(page.locator('main h1')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width
      )
      await page.screenshot({
        path: `docs/evidence/documentation/overview-${theme}-${width}.png`,
        animations: 'disabled',
      })
      if (width <= 800) {
        await page.getByText('On this page', { exact: true }).click()
        await page
          .getByRole('navigation', { name: 'Guide chapters on mobile' })
          .getByRole('link', { name: 'Copy a complete prompt' })
          .click()
      } else
        await page
          .getByRole('navigation', { name: 'Guide chapters', exact: true })
          .getByRole('link', { name: 'Copy a complete prompt' })
          .click()
      await page.screenshot({
        path: `docs/evidence/documentation/prompt-${theme}-${width}.png`,
        animations: 'disabled',
      })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width
      )
      for (const id of ['modes', 'history', 'availability', 'help']) {
        await page.goto(`/docs#guide-${id}`)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width
        )
      }
    })

test('keyboard anchors, troubleshooting, and 200 percent reflow work', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/docs')
  const skip = page.getByRole('link', { name: 'Skip to guide' })
  await skip.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#guide-content')).toBeFocused()
  await page.evaluate(() => {
    document.body.style.zoom = '2'
  })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
  await page.goto('/docs#guide-help')
  const item = page.getByText('The daily request limit is reached', { exact: true })
  await item.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/The current allowance resets at 00:00 UTC/)).toBeVisible()
  await page.screenshot({
    path: 'docs/evidence/documentation/zoom-200.png',
    animations: 'disabled',
  })
})

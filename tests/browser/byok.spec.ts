import { test, expect } from '@playwright/test'
test.skip(
  !process.env.BYOK_BROWSER_FIXTURE,
  'Run scripts/test-byok-browser.ts with its isolated PostgreSQL and synthetic provider.'
)
const base = process.env.BYOK_BROWSER_FIXTURE!
test('user-owned connection creation, capability tests, task routing, reload and revocation', async ({
  page,
  request,
}) => {
  await page.goto('/app/connections')
  await page.getByLabel('Name', { exact: true }).fill('My private model')
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('custom')
  await page.getByLabel('API base URL', { exact: true }).fill(base)
  await page.getByLabel('API key', { exact: true }).fill('synthetic-browser-key-12345')
  await page.getByRole('button', { name: 'Save connection', exact: true }).click()
  const card = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'My private model' }) })
  await expect(card).toBeVisible()
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('')
  await card.getByRole('button', { name: 'Discover models' }).click()
  await expect(card.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue(
    'fixture-model'
  )
  await card
    .getByLabel(
      'I understand tests use my API key and token limits do not guarantee a dollar cost.'
    )
    .check()
  await card.getByRole('button', { name: 'Test text', exact: true }).click()
  await expect(card.getByRole('status')).toContainText('text test passed')
  await card.getByRole('button', { name: 'Test structured', exact: true }).click()
  await expect(card.getByRole('status')).toContainText('structured test passed')
  const routing = page.locator('.byok-routing')
  for (const role of ['Planning', 'Coding', 'Review', 'Repair'])
    await routing
      .getByRole('combobox', { name: role, exact: true })
      .selectOption({ label: 'My private model / fixture-model' })
  await routing
    .getByLabel('I understand tokens and calls are limited, but the dollar cost can be unknown.')
    .check()
  await routing.getByRole('button', { name: 'Save task assignments' }).click()
  await expect(routing.getByRole('status')).toContainText('saved')
  await page.getByLabel('Name', { exact: true }).fill('Second key, same provider')
  await page.getByLabel('API key', { exact: true }).fill('synthetic-second-key-12345')
  await page.getByRole('button', { name: 'Save connection', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Second key, same provider' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'My private model' })).toBeVisible()
  await expect(routing.getByRole('combobox', { name: 'Coding', exact: true })).toHaveValue(
    /fixture-model/
  )
  const response = await request.get('/api/byok/connections')
  const json = await response.json()
  expect(JSON.stringify(json)).not.toContain('synthetic-browser-key')
  expect(JSON.stringify(json)).not.toContain('ciphertext')
  expect(json.connections).toHaveLength(2)
  expect(
    JSON.stringify(
      await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))
    )
  ).not.toContain('synthetic-')
  const denied = await request.post('/api/byok/connections', {
    headers: { Origin: 'https://foreign.example' },
    data: { key: 'synthetic' },
  })
  expect(denied.status()).toBe(403)
  await page.goto('/app')
  await expect(page.getByText('Models and limits for this request', { exact: true })).toBeVisible()
  await page.goto('/app/connections')
  await card.getByText('Replace key or delete connection', { exact: true }).click()
  await card.getByRole('button', { name: 'Delete connection', exact: true }).click()
  await card.getByRole('button', { name: 'Confirm deletion' }).click()
  await expect(card).toHaveCount(0)
  const available = await (await request.get('/api/providers')).json()
  expect(available[0].available).toBe(false)
})
for (const theme of ['light', 'dark'] as const)
  for (const width of [390, 768, 1440])
    test(`connections ${theme} ${width}: reflow and keyboard`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
      await page.goto('/app/connections')
      await expect(page.getByRole('heading', { name: 'Add a connection' })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width
      )
      await page.getByLabel('Name', { exact: true }).focus()
      await page.keyboard.press('Tab')
      await expect(page.getByRole('combobox', { name: 'Provider', exact: true })).toBeFocused()
      await expect(page.getByRole('heading', { name: 'Default task assignments' })).toBeVisible()
      await page.screenshot({ path: `.private/byok-browser/${theme}-${width}.png`, fullPage: true })
    })
test('connections reflow at 200% CSS zoom simulation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/app/connections')
  await page.locator('.byok-panel').evaluate((el) => ((el as HTMLElement).style.zoom = '2'))
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
})

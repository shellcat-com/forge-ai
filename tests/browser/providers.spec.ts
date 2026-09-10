import { test, expect } from '@playwright/test'
for (const width of [390, 768, 1440]) {
  test(`user-owned provider setup fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/app/connections')
    await expect(page.getByRole('heading', { name: 'Add a connection' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Provider', exact: true })).toBeVisible()
    await expect(page.getByLabel('API key', { exact: true })).toHaveValue('')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width
    )
  })
}
test('provider API blocks foreign origins', async ({ request }) => {
  const denied = await request.post('/api/providers/test', {
    headers: { Origin: 'http://untrusted.test' },
    data: { provider: 'ollama', model: 'anything' },
  })
  expect(denied.status()).toBe(403)
})

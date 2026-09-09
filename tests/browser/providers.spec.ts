import { test, expect } from '@playwright/test';
test('provider panel reports real discovery and blocks foreign origins', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Providers/ }).click();
  await expect(page.getByRole('heading', { name: 'Local Ollama' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Google Gemini' })).toBeVisible();
  const denied = await request.post('/api/providers/test', { headers: { Origin: 'http://untrusted.test' }, data: { provider: 'ollama', model: 'anything' } });
  expect(denied.status()).toBe(403);
  await page.screenshot({ path: 'docs/evidence/providers.png', fullPage: true });
});
test('live Ollama streaming through the UI', async ({ page }) => {
  test.skip(process.env.LIVE_PROVIDER_TEST !== '1', 'Explicit opt-in for a real local inference request.');
  test.setTimeout(200000);
  await page.goto('/'); await page.getByRole('button', { name: /Providers/ }).click();
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Local Ollama' }) });
  await card.getByRole('button', { name: 'Test streaming' }).click();
  await expect(card.getByRole('status')).toContainText('Streaming verified:', { timeout: 180000 });
  await page.screenshot({ path: 'docs/evidence/ollama-streaming.png', fullPage: true });
});

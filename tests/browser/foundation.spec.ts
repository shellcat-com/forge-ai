import { test, expect } from "@playwright/test";
test("prompt starters and provider navigation work", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "What will you make possible?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /A quieter team inbox/ }).click();
  await expect(page.getByLabel("Describe your application")).toHaveValue(
    /customer support inbox/,
  );
  await page.getByRole("button", { name: /Providers/ }).click();
  await expect(
    page.getByRole("heading", { name: "Google Gemini" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Back to workspace/ }).click();
  await expect(page.getByLabel("Describe your application")).toHaveValue(
    /customer support inbox/,
  );
});
for (const width of [375, 768, 1440]) {
  test(`layout fits ${width}px and captures actual interface`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `test-results/foundation-${width}.png`,
      fullPage: true,
    });
  });
}
test("keyboard skip link reaches workspace", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to workspace" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

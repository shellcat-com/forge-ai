import { test, expect } from "@playwright/test";
const projectId = process.env.FORGE_WORKFLOW_PROJECT;
test.describe("verified local project", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(
    !projectId,
    "Set FORGE_WORKFLOW_PROJECT to a real, generated project with Field Notes preview.",
  );
  test("preview, keyboard tabs, local Monaco, history and responsive layouts", async ({
    page,
  }) => {
    const editorBundle = await (
      await page.request.get("/monaco/editor.js")
    ).text();
    expect(editorBundle).toContain("DOMPurify 3.4.15");
    expect(editorBundle).not.toContain("DOMPurify 3.4.8");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/?project=${projectId}`);
    await expect(page.getByText("Preview live", { exact: true })).toBeVisible({
      timeout: 60000,
    });
    const preview = page.frameLocator(
      'iframe[title="Generated application preview"]',
    );
    await expect(
      preview.getByRole("heading", { name: "Field Notes", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Code", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Source editor for app/page.tsx")).toBeVisible(
      { timeout: 30000 },
    );
    await page.screenshot({
      path: "docs/evidence/workflow-editor-1440.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Every working version, kept." }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Restore", exact: true }).first(),
    ).toBeEnabled();
    await page.screenshot({
      path: "docs/evidence/workflow-history-1440.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await page.getByRole("button", { name: "Mobile", exact: true }).click();
    expect(
      await page
        .locator("iframe")
        .evaluate((el) => el.getBoundingClientRect().width),
    ).toBeLessThanOrEqual(375);
    await page.getByRole("button", { name: "Desktop", exact: true }).click();
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await expect(
        preview.getByRole("heading", { name: "Field Notes", exact: true }),
      ).toBeVisible();
      await page.locator("iframe").scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise(requestAnimationFrame));
      await page.screenshot({
        path: `docs/evidence/workflow-preview-${width}.png`,
        fullPage: true,
      });
    }
  });
  test("Monaco edit saves a staged revision and rebuilds a real preview", async ({
    page,
  }) => {
    test.setTimeout(240000);
    await page.goto(`/?project=${projectId}`);
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await page
      .getByRole("button", { name: "app/globals.css", exact: true })
      .click();
    const editor = page.getByLabel("Source editor for app/globals.css");
    await expect(editor).toBeVisible();
    await editor.focus();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.insertText(
      "\n/* Edited and rebuilt through the Forge interface. */\n",
    );
    await page
      .getByRole("button", { name: "Save & rebuild", exact: true })
      .click();
    await expect(page.getByText("Working", { exact: true })).toBeVisible();
    await expect(page.getByText("Preview live", { exact: true })).toBeVisible({
      timeout: 210000,
    });
    await expect(
      page.getByRole("button", { name: "Saved", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(
      page
        .frameLocator("iframe")
        .getByRole("heading", { name: "Field Notes", exact: true }),
    ).toBeVisible();
  });
});

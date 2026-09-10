import { expect, test } from "@playwright/test";

const projectId = process.env.GROQ_WORKFLOW_PROJECT;

test("verified Groq project survives reload with its provider and preview", async ({
  page,
}) => {
  test.skip(
    !projectId,
    "Set GROQ_WORKFLOW_PROJECT to a generated Groq project.",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/?project=${projectId}`);
  await expect(page.getByText("Preview live", { exact: true })).toBeVisible({
    timeout: 60000,
  });
  await expect(
    page.getByText(/Next change: groq \/ openai\/gpt-oss-20b/),
  ).toBeVisible();
  const preview = page.frameLocator(
    'iframe[title="Generated application preview"]',
  );
  await expect(
    preview.getByRole("heading", { name: "Capture your ideas", exact: true }),
  ).toBeVisible();
  await preview.getByLabel("Title").fill("Groq workflow verified");
  await preview
    .getByLabel("Note")
    .fill("Saved through the isolated SQLite-backed items API.");
  await preview.getByRole("button", { name: "Add Idea" }).click();
  await expect(preview.getByText("Groq workflow verified")).toBeVisible();
  await preview.getByRole("button", { name: "Remove" }).click();
  await expect(preview.getByText("Groq workflow verified")).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1440);
  await page.screenshot({
    path: "docs/evidence/groq-workflow-1440.png",
    fullPage: true,
  });
});

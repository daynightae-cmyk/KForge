import { expect, test, type Page } from "@playwright/test";

const chunkPatterns = {
  online: /\/assets\/onlineSurface-[^/]+\.js$/,
  quality: /\/assets\/qualitySurface-[^/]+\.js$/,
  system: /\/assets\/systemSurface-[^/]+\.js$/,
  ai: /\/assets\/aiSurface-[^/]+\.js$/,
  developer: /\/assets\/developerSurface-[^/]+\.js$/,
  remote: /\/assets\/remoteSurface-[^/]+\.js$/,
  release: /\/assets\/releaseSurface-[^/]+\.js$/,
  intelligence: /\/assets\/intelligenceSurface-[^/]+\.js$/,
} as const;

async function hasLoadedChunk(page: Page, pattern: RegExp) {
  return page.evaluate((source) => {
    const matcher = new RegExp(source);
    return performance
      .getEntriesByType("resource")
      .some((entry) => matcher.test(new URL(entry.name).pathname));
  }, pattern.source);
}

async function openActivity(page: Page, name: string) {
  await page.locator(".kw-activity-bar").getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("complementary", { name: `${name} Explorer`, exact: true })).toBeVisible();
}

test("Workbench defers Activity chunks until their Activity is opened", async ({ page }) => {
  const reset = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
  expect(reset.ok(), await reset.text()).toBeTruthy();

  await page.goto("/workspace", { waitUntil: "networkidle" });
  await expect(page.locator(".kw-activity-bar")).toBeVisible();
  await expect(page.locator(".kw-workbench h1")).toHaveText("Workspace");

  for (const pattern of Object.values(chunkPatterns)) {
    expect(await hasLoadedChunk(page, pattern)).toBe(false);
  }

  await openActivity(page, "Online");
  await expect.poll(() => hasLoadedChunk(page, chunkPatterns.online)).toBe(true);
  expect(await hasLoadedChunk(page, chunkPatterns.quality)).toBe(false);
  expect(await hasLoadedChunk(page, chunkPatterns.system)).toBe(false);

  await openActivity(page, "Quality");
  await expect.poll(() => hasLoadedChunk(page, chunkPatterns.quality)).toBe(true);
  expect(await hasLoadedChunk(page, chunkPatterns.system)).toBe(false);

  await openActivity(page, "System");
  await expect.poll(() => hasLoadedChunk(page, chunkPatterns.system)).toBe(true);
});

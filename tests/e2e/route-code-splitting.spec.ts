import { expect, test } from "@playwright/test";

const workbenchChunk = /\/assets\/KForgeWorkbench-[^/]+\.js$/;

async function hasLoadedWorkbenchChunk(page: Parameters<typeof test>[0]["page"]) {
  return page.evaluate((pattern) => {
    const matcher = new RegExp(pattern);
    return performance
      .getEntriesByType("resource")
      .some((entry) => matcher.test(new URL(entry.name).pathname));
  }, workbenchChunk.source);
}

test("startup defers the Workbench route chunk until workspace navigation", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  await expect(page.getByRole("img", { name: "Knoux Forge official logo" })).toBeVisible();
  expect(await hasLoadedWorkbenchChunk(page)).toBe(false);

  await page.getByRole("button", { name: /Skip/i }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  await expect.poll(() => hasLoadedWorkbenchChunk(page)).toBe(true);
  await expect(page.locator("main")).toBeVisible();
});

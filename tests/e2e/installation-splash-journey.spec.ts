import { expect, test } from "@playwright/test";

// The installed desktop product must exercise the canonical "/" installation
// reveal before reaching the workbench. These specs prove the splash journey
// end to end against the production build instead of trusting the route map.
test.describe("installation splash journey", () => {
  test("first launch reveals the splash and Skip routes into the workbench", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const splash = page.locator("main.kf-splash");
    await expect(splash).toBeVisible();
    await expect(page.locator("#splash-title")).toHaveText("Knoux Forge");
    await expect(splash).toHaveClass(/kf-splash--reveal/);

    await page.locator(".kf-splash-skip").click();
    await page.waitForURL("**/workspace", { timeout: 10_000 });
    await expect(page.locator(".kw-activity-bar button").first()).toBeVisible();
    await expect(splash).toHaveCount(0);
  });

  test("Escape also leaves the splash into the workbench", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main.kf-splash")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.waitForURL("**/workspace", { timeout: 10_000 });
    await expect(page.locator(".kw-activity-bar button").first()).toBeVisible();
  });

  test("returning launch auto-enters the workbench without a click", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("knoux-forge-installation-complete", "true");
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main.kf-splash")).toBeVisible();
    await page.waitForURL("**/workspace", { timeout: 6_000 });
    await expect(page.locator(".kw-activity-bar button").first()).toBeVisible();
  });
});

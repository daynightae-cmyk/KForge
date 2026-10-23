import { expect, test } from "@playwright/test";

/**
 * The Living Mark brand layer is an ambient backdrop behind real workbench content and the
 * native controls belong to the product theme, not to the host operating system. Both
 * contracts were broken and are locked here:
 *
 * 1. In the light theme the brand layer must not paint its own dark canvas. It used to
 *    paint a dark radial gradient behind a 78% opaque surface, which flattened the whole
 *    light workbench into grey.
 * 2. `color-scheme` must follow the product theme so native controls (the "Select all"
 *    checkbox, selects, scrollbars) never render with the host's light face inside the
 *    dark workbench.
 */

async function setTheme(page: import("@playwright/test").Page, theme: "light" | "dark") {
  const current = await (await page.request.get("/api/workspace/settings")).json() as { settings: Record<string, unknown> };
  const next = { ...current.settings, appearance: { ...(current.settings.appearance as Record<string, unknown>), theme } };
  const saved = await (await page.request.patch("/api/workspace/settings", { data: next })).json() as { settings: { appearance: { theme: string } } };
  expect(saved.settings.appearance.theme).toBe(theme);
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".kw-shell")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("html")).toHaveClass(new RegExp(`(^|\\s)${theme}(\\s|$)`));
}

test.describe("KForge brand layer and native control theming", () => {
  test.setTimeout(60_000);

  test("keeps the light workbench free of a dark brand canvas", async ({ page }) => {
    await setTheme(page, "light");
    await expect(page.locator("html")).toHaveClass(/light/);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("light");

    const fallback = page.locator(".knoux-living-mark-fallback[data-mode='workspace']");
    if (await fallback.count()) {
      const background = await fallback.evaluate((node) => getComputedStyle(node).backgroundColor);
      const alpha = Number((background.match(/rgba?\([^)]*?,\s*([\d.]+)\)/)?.[1] ?? "1"));
      expect(alpha, `the workspace brand layer must stay transparent, got ${background}`).toBe(0);
    }

    const surface = await page.locator(".kw-workbench").evaluate((node) => getComputedStyle(node).backgroundColor);
    const channels = (surface.match(/[\d.]+/g) ?? []).map(Number);
    expect(channels.length, `unexpected surface color ${surface}`).toBeGreaterThanOrEqual(3);
    // Chromium may report `color(srgb r g b / a)` with 0-1 channels or `rgb()` with 0-255.
    const scale = channels.slice(0, 3).every((channel) => channel <= 1) ? 255 : 1;
    const luminance = (channels[0] + channels[1] + channels[2]) / 3 * scale;
    expect(luminance, `the light workbench surface must stay light, got ${surface}`).toBeGreaterThan(140);
  });

  test("keeps the dark workbench on the product colour scheme", async ({ page }) => {
    await setTheme(page, "dark");
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");

    const selectAll = page.locator(".kw-table-toolbar .kw-select-all input[type='checkbox']");
    if (await selectAll.count()) {
      const accent = await selectAll.evaluate((node) => getComputedStyle(node).accentColor);
      expect(accent, "the select-all control must use the product accent colour").not.toBe("auto");
    }
  });
});

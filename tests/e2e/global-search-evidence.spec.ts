import path from "node:path";
import { expect, test } from "@playwright/test";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

test.describe("KForge global search evidence in production", () => {
  test.beforeEach(async ({ page }) => {
    const settings = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(settings.ok(), await settings.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
  });

  test("searches bounded local entities, exposes coverage, and opens the selected evidence surface", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });

    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Control+K");
    const palette = page.getByRole("dialog", { name: "KForge command palette" });
    await expect(palette).toBeVisible();
    const searchRequest = page.waitForResponse((response) => response.url().includes("/api/workspace/search?") && response.request().method() === "GET");
    await palette.getByLabel("Search commands and local workspace").fill("KForgeWorkspace");
    expect((await searchRequest).ok()).toBeTruthy();
    const coverage = palette.locator(".kf-command-search-coverage");
    await expect(coverage).toBeVisible();
    await palette.locator(".kf-command-list").hover();
    await page.mouse.wheel(0, 1_600);
    await expect(coverage.locator("summary")).toBeInViewport();
    await coverage.locator("summary").click();
    await expect(coverage).toContainText(/Files|Symbols|Problems|Tasks/);
    const result = palette.locator(".kf-command-list > button").filter({ hasText: /KForgeWorkspace.*open/i }).first();
    await expect(result).toBeVisible();
    await result.click();
    await expect(palette).toHaveCount(0);
    await expect(page.locator(".kf-active-surface")).toHaveCount(1);
    await expect(page.getByLabel("Selected global search entity")).toContainText("KForgeWorkspace");
    expect(externalRequests, `Unexpected external requests in global search:\n${externalRequests.join("\n")}`).toEqual([]);
  });
});

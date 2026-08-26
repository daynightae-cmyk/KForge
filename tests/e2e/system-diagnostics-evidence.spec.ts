import path from "node:path";
import { expect, test } from "@playwright/test";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

test.describe("KForge system diagnostics in production", () => {
  test.beforeEach(async ({ page }) => {
    const settings = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(settings.ok(), await settings.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
  });

  test("shows measured local capability states and refreshes only local workspace evidence", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });

    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await page.locator(".kf-nav").getByRole("button", { name: "System diagnostics", exact: true }).click();
    const diagnostics = page.locator('.kf-active-surface[aria-label="System diagnostics capability"]');
    await expect(diagnostics.getByRole("heading", { name: "System Diagnostics", exact: true })).toBeVisible();
    await expect(diagnostics).toContainText("Missing tools remain unavailable rather than being represented as successful.");
    await expect(diagnostics).toContainText("Projects & repositories");
    await expect(diagnostics).toContainText("Search & file inspection");
    await expect(diagnostics).toContainText("Tests, build & terminal");
    await expect(diagnostics).toContainText("Local models");
    const beforeRefreshCards = await diagnostics.locator(".kf-provider-card").count();
    expect(beforeRefreshCards).toBeGreaterThanOrEqual(10);

    const refreshed = page.waitForResponse((response) => response.url().endsWith("/api/workspace/projects") && response.request().method() === "GET");
    await diagnostics.getByRole("button", { name: "Refresh diagnostics", exact: true }).click();
    expect((await refreshed).ok()).toBeTruthy();
    await expect(diagnostics.locator(".kf-provider-card")).toHaveCount(beforeRefreshCards);
    expect(externalRequests, `Unexpected external requests in system diagnostics:\n${externalRequests.join("\n")}`).toEqual([]);
  });
});

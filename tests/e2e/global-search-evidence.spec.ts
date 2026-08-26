import path from "node:path";
import { expect, test } from "@playwright/test";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

test.describe("KForge global search evidence in contextual workbench", () => {
  test.beforeEach(async ({ page }) => {
    const settings = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(settings.ok(), await settings.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
  });

  test("searches bounded local entities, exposes API coverage, and deep-navigates through hierarchical workbench targets", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });

    const evidence = await page.request.get("/api/workspace/search?q=KForgeWorkbench");
    expect(evidence.ok(), await evidence.text()).toBeTruthy();
    const payload = await evidence.json() as { results: Array<{ title: string; target: string }>; coverage: Record<string, { state: string; searchedCount: number; source: string }> };
    expect(payload.results.some((result) => /KForgeWorkbench/i.test(result.title))).toBeTruthy();
    expect(payload.coverage.Files).toBeTruthy();
    expect(payload.coverage.Results).toBeTruthy();
    expect(payload.coverage.Files.source).toMatch(/graph|local/i);

    await page.keyboard.press("Control+K");
    const palette = page.getByRole("dialog", { name: "KForge command palette" });
    await expect(palette).toBeVisible();
    const searchRequest = page.waitForResponse((response) => response.url().includes("/api/workspace/search?") && response.request().method() === "GET");
    await palette.getByPlaceholder("Projects, files, symbols, problems, tasks, models…").fill("KForgeWorkbench");
    expect((await searchRequest).ok()).toBeTruthy();
    const result = palette.getByRole("button").filter({ hasText: /KForgeWorkbench/i }).first();
    await expect(result).toBeVisible({ timeout: 30_000 });
    await result.click();
    await expect(palette).toHaveCount(0);
    await expect(page.locator(".kw-workbench h1")).not.toHaveText("");
    await expect(page.locator(".kw-breadcrumb")).toContainText(/Projects|Intelligence|Quality|Developer Tools|Online|Remote|Release|System|AI/);
    await expect(page.locator(".kw-workbench h1")).toHaveCount(1);

    expect(externalRequests, `Unexpected external requests in global search:\n${externalRequests.join("\n")}`).toEqual([]);
  });
});

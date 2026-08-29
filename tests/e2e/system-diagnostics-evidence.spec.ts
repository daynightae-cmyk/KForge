import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView } from "./helpers/workbench";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);
const external = (raw: string) => /^https?:$/i.test(new URL(raw).protocol) && !LOCAL_ORIGINS.has(new URL(raw).origin);

test.describe("KForge System Diagnostics evidence", () => {
  test("shows measured capability states and never converts missing tools into success", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (external(request.url())) externalRequests.push(request.url()); });
    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    await openWorkbench(page);
    await selectExplorerView(page, "System", "System Diagnostics");
    const diagnostics = page.locator(".kw-workbench-scroll");
    await expect(diagnostics).toContainText("Missing tools remain UNAVAILABLE / NOT_DETECTED");
    await expect(diagnostics).toContainText("Projects & repositories");
    await expect(diagnostics).toContainText("Search & file inspection");
    await expect(diagnostics).toContainText("Tests, build & terminal");
    await expect(diagnostics).toContainText("Local models");
    const cards = diagnostics.locator(".kw-system-grid article");
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    expect(await cards.count()).toBeGreaterThanOrEqual(7);
    const refresh = page.waitForResponse((response) => response.url().endsWith("/api/workspace/projects") && response.request().method() === "GET");
    await diagnostics.getByRole("button", { name: "Refresh diagnostics", exact: true }).click();
    expect((await refresh).ok()).toBeTruthy();
    await expect(diagnostics).toContainText(/NOT_DETECTED|UNAVAILABLE|EVIDENCE_DEPENDENT|AVAILABLE/i);
    expect(externalRequests).toEqual([]);
  });
});

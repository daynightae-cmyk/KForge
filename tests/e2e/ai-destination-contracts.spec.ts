import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView } from "./helpers/workbench";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);
const external = (raw: string) => /^https?:$/i.test(new URL(raw).protocol) && !LOCAL_ORIGINS.has(new URL(raw).origin);

/**
 * The AI domain's service directory promises distinct intents: "Configure
 * provider" (AI / Providers) and "Review models" (AI / Models). Both render
 * ProviderStudio at the same tree position, so the destination must select
 * the promised tab instead of retaining the previous destination's tab.
 * The Tasks view must expose a failed ledger read honestly, never as an
 * invented empty ledger.
 */
test.describe("KForge AI destination contracts", () => {
  test.setTimeout(120_000);
  test.beforeEach(async ({ page }) => {
    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    await openWorkbench(page);
  });

  test("Providers opens environment configuration and Models opens the catalogue, in both navigation orders", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (external(request.url())) externalRequests.push(request.url()); });

    const tabs = page.getByRole("navigation", { name: "Provider tabs" });

    await selectExplorerView(page, "AI", "Providers");
    await expect(page.getByTestId("provider-studio")).toBeVisible({ timeout: 30_000 });
    await expect(tabs.getByRole("button", { name: "ENVIRONMENT", exact: true })).toHaveClass(/is-active/);
    await expect(page.getByRole("region", { name: "Provider environment and model linking" })).toBeVisible();

    // The provider hero (identity, credential line, test actions) must render
    // at its natural height: as a flex item inside the bounded main pane it
    // once shrank to a 22px sliver with overflow:hidden, clipping the header.
    const hero = page.locator(".kw-provider-hero");
    await expect(hero).toBeVisible();
    const clipped = await hero.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(clipped, "provider hero must not clip its content").toBeLessThanOrEqual(1);
    const tabClip = await tabs.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(tabClip, "provider tab row must not clip its pills").toBeLessThanOrEqual(1);

    // Providers -> Models at the same tree position must switch the tab.
    await selectExplorerView(page, "AI", "Models");
    await expect(tabs.getByRole("button", { name: "MODELS", exact: true })).toHaveClass(/is-active/);
    await expect(page.getByLabel("Search models", { exact: true })).toBeVisible();

    // And back again: Models -> Providers must not retain the catalogue tab.
    await selectExplorerView(page, "AI", "Providers");
    await expect(tabs.getByRole("button", { name: "ENVIRONMENT", exact: true })).toHaveClass(/is-active/);

    // A user's deliberate tab choice inside one destination still works.
    await tabs.getByRole("button", { name: "SECURITY", exact: true }).click();
    await expect(tabs.getByRole("button", { name: "SECURITY", exact: true })).toHaveClass(/is-active/);

    expect(externalRequests, "tab navigation must not contact any provider").toEqual([]);
  });

  test("Tasks renders the persisted ledger and reports a failed read instead of an empty ledger", async ({ page }) => {
    // Create one real persisted agent task through the canonical mission
    // service so the ledger is provably non-empty regardless of suite order.
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: process.cwd() } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const { project } = await opened.json() as { project: { id: string } };
    expect((await page.request.post(`/api/workspace/projects/${project.id}/trust`, { data: { confirmed: true } })).ok()).toBeTruthy();
    const mission = await page.request.post(`/api/workspace/projects/${project.id}/agent/missions`, { data: { mission: "audit" } });
    expect(mission.status(), await mission.text()).toBe(202);
    const { task } = await mission.json() as { task: { id: string } };

    await selectExplorerView(page, "AI", "Tasks");
    const center = page.getByRole("region", { name: "Task Center", exact: true });
    await expect(center).toBeVisible({ timeout: 30_000 });
    await expect(center).toContainText(task.id, { timeout: 60_000 });

    // Force the real ledger route to fail; the surface must state the refusal
    // rather than silently rendering "no tasks" or freezing stale rows as live.
    await page.route("**/api/workspace/tasks", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Ledger read refused for evidence test." }) }));
    await expect(center.getByRole("alert")).toContainText("Task ledger unavailable", { timeout: 15_000 });
    await expect(center.getByRole("alert")).toContainText("does not treat a failed read as an empty ledger");

    // Recovery: once reads succeed again the error clears and the ledger returns.
    await page.unroute("**/api/workspace/tasks");
    await expect(center.getByRole("alert")).toHaveCount(0, { timeout: 15_000 });
    await expect(center).toContainText(task.id, { timeout: 15_000 });
  });
});

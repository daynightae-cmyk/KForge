import path from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView } from "./helpers/workbench";

const PACKAGE_ID = "package:kforge:json-inspector";
const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);
const external = (raw: string) => /^https?:$/i.test(new URL(raw).protocol) && !LOCAL_ORIGINS.has(new URL(raw).origin);

test.describe("KForge Marketplace verified local lifecycle", () => {
  test.setTimeout(150_000);
  test.beforeEach(async ({ page }) => {
    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    const cleanup = await page.request.post(`/api/workspace/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/uninstall`, { data: { confirmed: true } });
    expect([200, 409]).toContain(cleanup.status());
    expect((await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } })).ok()).toBeTruthy();
    await openWorkbench(page);
  });

  test("inspects, installs, verifies, runs, updates and uninstalls the bundled first-party extension through Online → Extensions", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (external(request.url())) externalRequests.push(request.url()); });
    await selectExplorerView(page, "Online", "Extensions");
    const item = page.locator(".kw-online-results").getByRole("button", { name: /kforge-json-inspector/i });
    await expect(item).toBeVisible({ timeout: 30_000 });
    await item.click();
    const details = page.getByLabel("Online item details");
    await expect(details).toContainText("kforge-json-inspector");
    await expect(details).toContainText(/Integrity|Permissions|Lifecycle/i);

    page.once("dialog", (dialog) => dialog.accept());
    const install = page.waitForResponse((response) => response.url().includes(`/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/install`) && response.request().method() === "POST");
    await details.getByRole("button", { name: "Install local package", exact: true }).click();
    expect((await install).ok()).toBeTruthy();
    await expect(details.getByRole("button", { name: "Health check", exact: true })).toBeVisible({ timeout: 30_000 });

    const health = page.waitForResponse((response) => response.url().includes(`/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/health`) && response.request().method() === "GET");
    await details.getByRole("button", { name: "Health check", exact: true }).click();
    expect((await health).ok()).toBeTruthy();
    await expect(details).toContainText(/Health check passed|manifest|SHA-256/i);

    page.once("dialog", (dialog) => dialog.accept());
    const run = page.waitForResponse((response) => response.url().includes(`/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/run`) && response.request().method() === "POST");
    await details.getByRole("button", { name: "Run local package", exact: true }).click();
    expect((await run).ok()).toBeTruthy();
    await expect(details).toContainText(/JSON|result|ok/i);

    page.once("dialog", (dialog) => dialog.accept());
    const update = page.waitForResponse((response) => response.url().includes(`/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/update`) && response.request().method() === "POST");
    await details.getByRole("button", { name: "Update local package", exact: true }).click();
    expect((await update).ok()).toBeTruthy();
    await expect(details).toContainText("1.1.0", { timeout: 30_000 });

    page.once("dialog", (dialog) => dialog.accept());
    const uninstall = page.waitForResponse((response) => response.url().includes(`/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/uninstall`) && response.request().method() === "POST");
    await details.getByRole("button", { name: "Uninstall local package", exact: true }).click();
    expect((await uninstall).ok()).toBeTruthy();
    await expect(details.getByRole("button", { name: "Install local package", exact: true })).toBeVisible({ timeout: 30_000 });
    expect(externalRequests).toEqual([]);
  });
});

import path from "node:path";
import { expect, test } from "@playwright/test";

const PACKAGE_ID = "package:kforge:json-inspector";
const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

test.describe("KForge Marketplace local package lifecycle in production", () => {
  test.setTimeout(300_000);

  test.beforeEach(async ({ page }) => {
    const settings = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(settings.ok(), await settings.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const cleanup = await page.request.post(`/api/workspace/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/uninstall`, { data: { confirmed: true } });
    expect([200, 409]).toContain(cleanup.status());
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
  });

  test("inspects, installs, health-checks, runs, updates, and uninstalls the verified bundled extension through the product surface", async ({ page }) => {
    const externalRequests: string[] = [];
    const apiFailures: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });
    page.on("response", (response) => {
      if (response.url().includes("/api/") && response.status() >= 400) apiFailures.push(`${response.status()} ${response.url()}`);
    });

    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await page.locator(".kf-nav").getByRole("button", { name: "Extensions", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Extensions", exact: true })).toBeVisible();

    const extension = page.locator(".kf-online-list").getByRole("button", { name: /kforge-json-inspector/i });
    await expect(extension).toBeVisible({ timeout: 30_000 });
    await extension.click();
    const details = page.getByLabel("Online item details");
    await expect(details.getByRole("heading", { name: "kforge-json-inspector", exact: true })).toBeVisible();
    await expect(details).toContainText("Integrity / checksum");
    await expect(details).toContainText("Permissions");
    await expect(details).toContainText("Bundled first-party fixture; no network source is contacted.");

    const installResponse = page.waitForResponse((response) => response.url().includes(`/api/workspace/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/install`) && response.request().method() === "POST");
    page.once("dialog", (dialog) => dialog.accept());
    await details.getByRole("button", { name: "Install local package", exact: true }).click();
    expect((await installResponse).ok()).toBeTruthy();
    await expect(details.getByRole("button", { name: "Health check", exact: true })).toBeVisible({ timeout: 30_000 });

    const healthResponse = page.waitForResponse((response) => response.url().includes(`/api/workspace/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/health`) && response.request().method() === "GET");
    await details.getByRole("button", { name: "Health check", exact: true }).click();
    expect((await healthResponse).ok()).toBeTruthy();
    await expect(page.locator(".kf-active-surface")).toContainText(/Health check passed|Local package health verified/i, { timeout: 30_000 });

    const runResponse = page.waitForResponse((response) => response.url().includes(`/api/workspace/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/run`) && response.request().method() === "POST");
    page.once("dialog", (dialog) => dialog.accept());
    await expect(details.getByRole("button", { name: "Run local package", exact: true })).toBeVisible({ timeout: 30_000 });
    await details.getByRole("button", { name: "Run local package", exact: true }).click();
    expect((await runResponse).ok()).toBeTruthy();
    await expect(page.locator(".kf-active-surface")).toContainText(/Local package run verified|JSON Inspector/i, { timeout: 30_000 });

    const updateResponse = page.waitForResponse((response) => response.url().includes(`/api/workspace/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/update`) && response.request().method() === "POST");
    page.once("dialog", (dialog) => dialog.accept());
    await expect(details.getByRole("button", { name: "Update local package", exact: true })).toBeVisible({ timeout: 30_000 });
    await details.getByRole("button", { name: "Update local package", exact: true }).click();
    expect((await updateResponse).ok()).toBeTruthy();
    await expect(details).toContainText("1.1.0");

    const uninstallResponse = page.waitForResponse((response) => response.url().includes(`/api/workspace/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/uninstall`) && response.request().method() === "POST");
    page.once("dialog", (dialog) => dialog.accept());
    await expect(details.getByRole("button", { name: "Uninstall local package", exact: true })).toBeVisible({ timeout: 30_000 });
    await details.getByRole("button", { name: "Uninstall local package", exact: true }).click();
    expect((await uninstallResponse).ok()).toBeTruthy();
    await expect(details.getByRole("button", { name: "Install local package", exact: true })).toBeVisible({ timeout: 30_000 });

    expect(externalRequests, `Unexpected external requests in local Marketplace lifecycle:\n${externalRequests.join("\n")}`).toEqual([]);
    expect(apiFailures, `Unexpected Marketplace API failures:\n${apiFailures.join("\n")}`).toEqual([]);
  });
});

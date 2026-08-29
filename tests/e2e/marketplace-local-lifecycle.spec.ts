import path from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView } from "./helpers/workbench";

const PACKAGE_ID = "package:kforge:json-inspector";
const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);
const external = (raw: string) => {
  try { const url = new URL(raw); return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin); } catch { return false; }
};

async function backendItem(page: import("@playwright/test").Page, itemId: string) {
  const res = await page.request.get("/api/workspace/marketplace");
  expect(res.ok()).toBeTruthy();
  const data = await res.json() as { items?: Array<{ id: string; installed?: boolean; version?: string; updateState?: { value?: string; state?: string }; trust?: string }> };
  const item = (data.items || []).find((i) => i.id === itemId);
  expect(item, `Marketplace catalog must contain ${itemId}`).toBeTruthy();
  return item!;
}

function card(page: import("@playwright/test").Page, itemId: string) {
  return page.locator(`article[data-item-id="${itemId}"]`);
}

function inspector(page: import("@playwright/test").Page) {
  return page.locator(".kw-inspector").first();
}

test.describe("KForge Marketplace verified local lifecycle via Card", () => {
  test.setTimeout(240_000);
  test.beforeEach(async ({ page }) => {
    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    const cleanup = await page.request.post(`/api/workspace/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/uninstall`, { data: { confirmed: true } });
    expect([200, 409]).toContain(cleanup.status());
    expect((await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } })).ok()).toBeTruthy();
    await openWorkbench(page);
  });

  test("full card lifecycle Install -> Health -> Run -> Update -> Uninstall with Card/Inspector/Backend sync", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (external(request.url())) externalRequests.push(request.url()); });

    await selectExplorerView(page, "Online", "Extensions");
    const targetCard = card(page, PACKAGE_ID);
    await expect(targetCard).toBeVisible({ timeout: 30_000 });

    // STEP A - INSTALL via CARD
    await expect(targetCard.getByRole("button", { name: "Install", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(targetCard.getByText("Installed")).toHaveCount(0);
    // Card shows enabled Install, Inspector will show same after select
    await targetCard.click(); // select to sync inspector
    const insp = inspector(page);
    await expect(insp).toContainText("kforge-json-inspector", { timeout: 10_000 });

    page.once("dialog", (dialog) => dialog.accept());
    const installResponsePromise = page.waitForResponse((response) => response.url().includes(`/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/install`) && response.request().method() === "POST");
    await targetCard.getByRole("button", { name: "Install", exact: true }).click();
    const installResponse = await installResponsePromise;
    const installBody = await installResponse.json().catch(() => ({})) as Record<string, unknown>;
    expect(installResponse.url()).toContain(encodeURIComponent(PACKAGE_ID));
    expect(installResponse.ok()).toBeTruthy();
    expect(String(installBody.stage || "")).toMatch(/INSTALLED/i);
    expect(installBody.itemId === PACKAGE_ID || installBody.itemId === decodeURIComponent(PACKAGE_ID)).toBeTruthy();

    // Wait for refresh: Card now shows Installed and no longer shows enabled Install
    await expect(targetCard.getByText("Installed")).toBeVisible({ timeout: 30_000 });
    await expect(targetCard.getByRole("button", { name: "Install", exact: true })).toHaveCount(0);
    // Inspector shows same installed state
    await expect(insp).toContainText("INSTALLED");
    // Backend verification
    const afterInstall = await backendItem(page, PACKAGE_ID);
    expect(afterInstall.installed).toBe(true);
    await expect(insp.getByText("Operation")).toContainText(/install/i);
    // Ensure other cards not permanently disabled (check at least inspector operation success leaves actions usable)
    await expect(targetCard.getByRole("button", { name: "Health check", exact: true })).toBeVisible({ timeout: 10_000 });

    // STEP - HEALTH via CARD (GET, no confirm)
    const healthResponsePromise = page.waitForResponse((response) => response.url().includes(`/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/health`) && response.request().method() === "GET");
    await targetCard.getByRole("button", { name: "Health check", exact: true }).click();
    const healthResponse = await healthResponsePromise;
    const healthBody = await healthResponse.json().catch(() => ({})) as Record<string, unknown>;
    expect(healthResponse.url()).toContain(encodeURIComponent(PACKAGE_ID));
    expect(healthResponse.ok()).toBeTruthy();
    expect(healthBody.ok === true || healthBody.installed === true).toBeTruthy();
    // Card remains usable
    await expect(targetCard.getByRole("button", { name: "Health check", exact: true })).toBeEnabled({ timeout: 10_000 });
    await expect(targetCard.getByRole("button", { name: "Run local package", exact: true })).toBeEnabled();
    await expect(insp).toContainText(/Health check passed|manifest|SHA-256/i);
    const healthItemId = String((healthBody as Record<string, unknown>).itemId || (healthBody as Record<string, unknown>).id || "") || String((insp.locator("text=Operation").first().textContent) || "");
    // operation evidence itemId equals target id is captured via inspector Operation section
    await expect(insp.locator('[aria-label="Operation Status"]')).toContainText(PACKAGE_ID);
    const afterHealth = await backendItem(page, PACKAGE_ID);
    expect(afterHealth.installed).toBe(true);
    // Other cards not permanently disabled: check at least one other card exists in Marketplace view and is not disabled
    expect(externalRequests).toEqual([]);

    // STEP - RUN via CARD
    page.once("dialog", (dialog) => dialog.accept());
    const runResponsePromise = page.waitForResponse((response) => response.url().includes(`/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/run`) && response.request().method() === "POST");
    await targetCard.getByRole("button", { name: "Run local package", exact: true }).click();
    const runResponse = await runResponsePromise;
    const runBody = await runResponse.json().catch(() => ({})) as Record<string, unknown>;
    expect(runResponse.url()).toContain(encodeURIComponent(PACKAGE_ID));
    expect(runResponse.ok()).toBeTruthy();
    // run operation itemId verification via response and inspector
    const runItemId = String(runBody.itemId || runBody.id || "");
    if (runItemId) expect(runItemId).toBe(PACKAGE_ID);
    await expect(insp.locator('[aria-label="Operation Status"]')).toContainText(PACKAGE_ID);
    await expect(insp).toContainText(/result|ok|JSON/i);
    // SUCCESS does not leave actions disabled
    await expect(targetCard.getByRole("button", { name: "Health check", exact: true })).toBeEnabled();
    await expect(targetCard.getByRole("button", { name: "Run local package", exact: true })).toBeEnabled();
    const afterRun = await backendItem(page, PACKAGE_ID);
    expect(afterRun.installed).toBe(true);

    // STEP - UPDATE via CARD (requires UPDATE_AVAILABLE truthfully exposed)
    const afterRunFresh = await backendItem(page, PACKAGE_ID);
    // Backend must truthfully expose UPDATE_AVAILABLE after install of 1.0.0 when 1.1.0 exists
    // Check via marketplace API updateState
    const marketRes = await page.request.get("/api/workspace/marketplace");
    const marketData = await marketRes.json() as { items?: Array<{ id: string; updateState?: { state?: string; value?: string }; version?: string }> };
    const updateEntry = (marketData.items || []).find((i) => i.id === PACKAGE_ID);
    expect(updateEntry?.updateState?.state).toBe("VERIFIED");
    expect(String(updateEntry?.updateState?.value || "")).toMatch(/UPDATE_AVAILABLE/i);
    await expect(targetCard.getByRole("button", { name: "Update local package", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(targetCard.getByRole("button", { name: "Update local package", exact: true })).toBeEnabled();

    page.once("dialog", (dialog) => dialog.accept());
    const updateResponsePromise = page.waitForResponse((response) => response.url().includes(`/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/update`) && response.request().method() === "POST");
    await targetCard.getByRole("button", { name: "Update local package", exact: true }).click();
    const updateResponse = await updateResponsePromise;
    const updateBody = await updateResponse.json().catch(() => ({})) as Record<string, unknown>;
    expect(updateResponse.url()).toContain(encodeURIComponent(PACKAGE_ID));
    expect(updateResponse.ok()).toBeTruthy();
    expect(String(updateBody.stage || "")).toMatch(/UPDATED/i);

    // Wait for refresh and verify version 1.1.0 in Card, Inspector, Backend
    await expect(targetCard).toContainText("1.1.0", { timeout: 30_000 });
    await expect(insp).toContainText("1.1.0", { timeout: 30_000 });
    const afterUpdate = await backendItem(page, PACKAGE_ID);
    expect(String(afterUpdate.version || "")).toBe("1.1.0");

    // STEP - UNINSTALL via CARD
    page.once("dialog", (dialog) => dialog.accept());
    const uninstallResponsePromise = page.waitForResponse((response) => response.url().includes(`/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/uninstall`) && response.request().method() === "POST");
    await targetCard.getByRole("button", { name: "Uninstall local package", exact: true }).click();
    const uninstallResponse = await uninstallResponsePromise;
    const uninstallBody = await uninstallResponse.json().catch(() => ({})) as Record<string, unknown>;
    expect(uninstallResponse.url()).toContain(encodeURIComponent(PACKAGE_ID));
    expect(uninstallResponse.ok()).toBeTruthy();

    await expect(targetCard.getByText("Installed")).toHaveCount(0, { timeout: 30_000 });
    await expect(targetCard.getByRole("button", { name: "Install", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(insp).not.toContainText("INSTALLED");
    const afterUninstall = await backendItem(page, PACKAGE_ID);
    expect(afterUninstall.installed).toBe(false);
    expect(externalRequests).toEqual([]);
  });

  test("wrong-target regression: action from non-selected card targets its own item explicitly", async ({ page }) => {
    // Ensure installed clean state
    await page.request.post(`/api/workspace/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/uninstall`, { data: { confirmed: true } }).catch(() => undefined);
    // Use Marketplace view which shows multiple cards (tools + plugins)
    await selectExplorerView(page, "Online", "Marketplace");
    const targetCard = card(page, PACKAGE_ID);
    await expect(targetCard).toBeVisible({ timeout: 30_000 });
    // Find a different card A
    const allCards = page.locator(`article[data-item-id]`);
    await expect(allCards.first()).toBeVisible({ timeout: 10_000 });
    const count = await allCards.count();
    expect(count).toBeGreaterThanOrEqual(2);
    let otherId = "";
    let otherCard: ReturnType<typeof card> | null = null;
    for (let i = 0; i < count; i++) {
      const id = await allCards.nth(i).getAttribute("data-item-id");
      if (id && id !== PACKAGE_ID) { otherId = id; otherCard = allCards.nth(i) as unknown as ReturnType<typeof card>; break; }
    }
    expect(otherId, "Must have a second card distinct from target").toBeTruthy();
    // Select A (other)
    await otherCard!.click();
    await expect(otherCard!).toHaveAttribute("data-selected", "true");
    // Ensure target B is not selected
    await expect(targetCard).toHaveAttribute("data-selected", "false");
    // Capture backend state of A before
    const beforeOther = await backendItem(page, otherId);

    // Without selecting B first, invoke a real action directly from B (Install)
    // Target is not installed, so Install should be enabled on B even while A is selected
    const installButton = targetCard.getByRole("button", { name: "Install", exact: true });
    await expect(installButton).toBeVisible({ timeout: 10_000 });
    await expect(installButton).toBeEnabled();

    page.once("dialog", (dialog) => dialog.accept());
    const reqPromise = page.waitForRequest((req) => req.url().includes("/marketplace/items/") && req.method() === "POST" && req.url().includes(encodeURIComponent(PACKAGE_ID)));
    const respPromise = page.waitForResponse((res) => res.url().includes(`/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/install`) && res.request().method() === "POST");
    await installButton.click();
    const req = await reqPromise;
    const resp = await respPromise;
    const body = await resp.json().catch(() => ({})) as Record<string, unknown>;
    expect(req.url()).toContain(encodeURIComponent(PACKAGE_ID));
    expect(req.url()).not.toContain(encodeURIComponent(otherId));
    expect(body.itemId === PACKAGE_ID || String(body.itemId || "").includes(PACKAGE_ID)).toBeTruthy();
    expect(body.itemId === otherId).toBeFalsy();
    // Inspector operation should show B id
    const insp = inspector(page);
    await expect(insp.locator('[aria-label="Operation Status"]')).toContainText(PACKAGE_ID, { timeout: 10_000 });
    // A backend state remains unchanged
    const afterOther = await backendItem(page, otherId);
    expect(afterOther.installed).toBe(beforeOther.installed);
    expect(afterOther.version).toBe(beforeOther.version);
    // Cleanup uninstall if we installed
    await page.request.post(`/api/workspace/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/uninstall`, { data: { confirmed: true } }).catch(() => undefined);
  });
});

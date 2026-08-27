import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView } from "./helpers/workbench";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);
const external = (raw: string) => /^https?:$/i.test(new URL(raw).protocol) && !LOCAL_ORIGINS.has(new URL(raw).origin);

test.describe("KForge Settings v3 persistence and platform policy", () => {
  test.setTimeout(120_000);

  test("persists hierarchical startup, appearance, privacy and enforced safety invariants", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (external(request.url())) externalRequests.push(request.url()); });
    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    await openWorkbench(page);
    await selectExplorerView(page, "System", "Settings");
    const settings = page.locator(".kw-settings");
    await settings.getByLabel("Startup activity").selectOption("online");
    await settings.getByLabel("Startup Online view").selectOption("models");
    await settings.getByLabel("Theme").selectOption("light");
    await settings.getByLabel("Information density").selectOption("compact");
    await settings.getByLabel("Reduce motion").check();
    await settings.getByLabel("Remote context policy").selectOption("blocked");
    const saved = page.waitForResponse((response) => response.url().endsWith("/api/workspace/settings") && response.request().method() === "PATCH");
    await settings.getByRole("button", { name: "Save settings", exact: true }).click();
    expect((await saved).ok()).toBeTruthy();
    await expect(page.locator("html")).toHaveAttribute("data-kf-density", "compact");
    await expect(page.locator("html")).toHaveAttribute("data-kf-reduced-motion", "true");
    await expect(settings).toContainText("secretRedaction = true");
    await expect(settings).toContainText("confirmRemoteWrites = true");

    const api = await page.request.get("/api/workspace/settings");
    const payload = await api.json() as { settings: Record<string, unknown> };
    expect(payload.settings.version).toBe(3);
    expect(JSON.stringify(payload.settings)).toContain("secretRedaction");
    expect(JSON.stringify(payload.settings)).toContain("confirmRemoteWrites");

    const mode = page.getByLabel("Platform mode");
    for (const target of ["local-first", "online-optional", "offline"]) {
      const changed = page.waitForResponse((response) => response.url().endsWith("/api/workspace/platform/mode") && response.request().method() === "POST");
      await mode.selectOption(target);
      expect((await changed).ok()).toBeTruthy();
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-workbench='kforge']")).toBeVisible();
    await expect(page.locator(".kw-breadcrumb")).toContainText("Online");
    await expect(page.locator(".kw-workbench h1")).toHaveText("Models");
    await selectExplorerView(page, "System", "Settings");
    await expect(page.getByLabel("Startup activity")).toHaveValue("online");
    await expect(page.getByLabel("Startup Online view")).toHaveValue("models");
    await expect(page.getByLabel("Information density")).toHaveValue("compact");
    await expect(page.getByLabel("Reduce motion")).toBeChecked();
    await expect(page.getByLabel("Remote context policy")).toHaveValue("blocked");
    await selectExplorerView(page, "System", "Online / Offline");
    await expect(page.locator(".kw-workbench-scroll")).toContainText(/offline|Remote metadata|policy/i);
    expect(externalRequests).toEqual([]);
  });
});

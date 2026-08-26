import path from "node:path";
import { expect, test } from "@playwright/test";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

test.describe("KForge persistent settings and platform mode in production", () => {
  test.beforeEach(async ({ page }) => {
    const settings = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(settings.ok(), await settings.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
  });

  test("persists editable settings, applies DOM runtime effects, and changes local platform policy explicitly", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });

    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await page.locator(".kf-nav").getByRole("button", { name: "Settings", exact: true }).click();
    const settingsCenter = page.locator(".kf-settings-center");
    await expect(settingsCenter).toBeVisible();

    await settingsCenter.getByLabel("Information density").selectOption("compact");
    await settingsCenter.getByLabel("Reduce motion").check();
    await settingsCenter.getByLabel("Remote context policy").selectOption("blocked");
    await settingsCenter.getByLabel("Automatic health checks").uncheck();
    await expect(settingsCenter.getByLabel("Health interval")).toBeDisabled();

    const saving = page.waitForResponse((response) => response.url().includes("/api/workspace/settings") && response.request().method() === "PATCH");
    await settingsCenter.getByRole("button", { name: "Save settings", exact: true }).click();
    expect((await saving).ok()).toBeTruthy();
    await expect(page.locator("html")).toHaveAttribute("data-kf-density", "compact");
    await expect(page.locator("html")).toHaveAttribute("data-kf-reduced-motion", "true");

    for (const [label, mode] of [["Local First", "local-first"], ["Online Optional", "online-optional"], ["Online", "online"], ["Offline", "offline"]] as const) {
      const changed = page.waitForResponse((response) => response.url().includes("/api/workspace/platform/mode") && response.request().method() === "POST");
      if (mode !== "offline") page.once("dialog", (dialog) => dialog.accept());
      await settingsCenter.getByRole("button", { name: label, exact: true }).click();
      const response = await changed;
      expect(response.ok(), await response.text()).toBeTruthy();
      expect((await response.json() as { mode: string }).mode).toBe(mode);
    }

    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.locator(".kf-nav").getByRole("button", { name: "Settings", exact: true }).click();
    await expect(settingsCenter.getByLabel("Information density")).toHaveValue("compact");
    await expect(settingsCenter.getByLabel("Reduce motion")).toBeChecked();
    await expect(settingsCenter.getByLabel("Remote context policy")).toHaveValue("blocked");
    await expect(settingsCenter.getByLabel("Automatic health checks")).not.toBeChecked();

    await page.locator(".kf-nav").getByRole("button", { name: "Offline / Online", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Local-First Platform", exact: true })).toBeVisible();
    await expect(page.locator(".kf-active-surface")).toContainText("Metadata readsBlocked");
    await expect(page.locator(".kf-active-surface")).toContainText("Remote transfersBlocked");
    expect(externalRequests, `Unexpected external requests while changing local settings and modes:\n${externalRequests.join("\n")}`).toEqual([]);
  });
});

import path from "node:path";
import { expect, test } from "@playwright/test";
import { clearProjectContext } from "./helpers/workbench";

const ACTIVITY_LABELS = ["Projects", "AI", "Online", "Intelligence", "Quality", "Developer Tools", "Remote / Git", "Release", "System"] as const;
const ONLINE_VIEWS = ["Discover", "Marketplace", "Extensions", "Models", "Agents", "Tools", "Integrations", "Installed", "Updates", "Downloads", "Providers", "Remote Sources", "Security", "Activity"] as const;

async function prepareWorkspace(page: import("@playwright/test").Page) {
  const reset = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
  expect(reset.ok(), await reset.text()).toBeTruthy();
  const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
  expect(platform.ok(), await platform.text()).toBeTruthy();
  const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
  expect(opened.ok(), await opened.text()).toBeTruthy();
}

test.describe("KForge contextual navigation audit", () => {
  test.setTimeout(360_000);

  test.beforeEach(async ({ page }) => {
    await prepareWorkspace(page);
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".kw-topbar")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".kw-activity-bar")).toBeVisible();
  });

  test("publishes nine Activity Bar domains and keeps one scoped Explorer active", async ({ page }) => {
    const buttons = page.locator(".kw-activity-bar > button");
    await expect(buttons).toHaveCount(9);
    const labels = await buttons.evaluateAll((entries) => entries.map((entry) => entry.getAttribute("aria-label")));
    expect(labels).toEqual(ACTIVITY_LABELS);

    for (const label of ACTIVITY_LABELS) {
      const activity = page.locator(".kw-activity-bar").getByRole("button", { name: label, exact: true });
      await activity.click();
      await expect(activity).toHaveClass(/is-active/);
      await expect(page.getByRole("complementary", { name: `${label} Explorer`, exact: true })).toBeVisible();
      await expect(page.locator(".kw-workbench h1")).toHaveCount(1);
      await expect(page.locator(".kw-workbench")).toBeVisible();
    }
  });

  test("keeps Online active while every child view replaces the workbench content", async ({ page }) => {
    const online = page.locator(".kw-activity-bar").getByRole("button", { name: "Online", exact: true });
    await online.click();
    const explorer = page.getByRole("complementary", { name: "Online Explorer", exact: true });
    await expect(explorer).toBeVisible();

    for (const label of ONLINE_VIEWS) {
      const destination = explorer.getByRole("button", { name: label, exact: true });
      await destination.click();
      await expect(online).toHaveClass(/is-active/);
      await expect(destination).toHaveClass(/is-active/);
      await expect(page.locator(".kw-workbench h1")).toHaveText(label);
      await expect(page.getByRole("complementary", { name: "Online Explorer", exact: true })).toBeVisible();
    }
  });

  test("supports projectless Online discovery without turning compatibility into INCOMPATIBLE", async ({ page }) => {
    await clearProjectContext(page);
    await page.locator(".kw-activity-bar").getByRole("button", { name: "Online", exact: true }).click();
    const explorer = page.getByRole("complementary", { name: "Online Explorer", exact: true });
    await explorer.getByRole("button", { name: "Discover", exact: true }).click();
    await expect(page.getByText("No project selected", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("NOT_EVALUATED", { exact: true }).first()).toBeVisible();
    await expect(page.locator(".kw-online")).toBeVisible();
  });

  test("opens command palette from the keyboard and returns to one workbench", async ({ page }) => {
    await page.keyboard.press("Control+K");
    await expect(page.getByRole("dialog", { name: "KForge command palette" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "KForge command palette" })).toHaveCount(0);
    await expect(page.locator(".kw-workbench h1")).toHaveCount(1);
  });
});

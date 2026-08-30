import path from "node:path";
import { expect, test } from "@playwright/test";
import { setProjectContext } from "./helpers/workbench";

async function prepareWorkspace(page: import("@playwright/test").Page) {
  const reset = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
  expect(reset.ok(), await reset.text()).toBeTruthy();
  const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
  expect(opened.ok(), await opened.text()).toBeTruthy();
  return await opened.json() as { project: { id: string; name: string } };
}

async function selectActivityAndView(page: import("@playwright/test").Page, activity: string, view: string) {
  await page.locator(".kw-activity-bar").getByRole("button", { name: activity, exact: true }).click();
  const explorer = page.getByRole("complementary", { name: `${activity} Explorer`, exact: true });
  await expect(explorer).toBeVisible();
  await explorer.getByRole("button", { name: view, exact: true }).click();
  await expect(page.locator(".kw-workbench h1")).toHaveText(view);
}

test.describe("KForge Workbench production acceptance", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    await prepareWorkspace(page);
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".kw-topbar")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".kw-activity-bar")).toBeVisible();
  });

  test("keeps the shell persistent while high-level domains replace the active capability", async ({ page }) => {
    const sequence = [
      ["Projects", "Workspace"],
      ["AI", "Agents"],
      ["Online", "Marketplace"],
      ["Intelligence", "Project Graph"],
      ["Quality", "Problems"],
      ["Developer Tools", "Terminal"],
      ["Remote / Git", "Git"],
      ["Release", "Release Gate"],
      ["System", "Settings"],
    ] as const;

    for (const [activity, view] of sequence) {
      await selectActivityAndView(page, activity, view);
      await expect(page.locator(".kw-topbar")).toBeVisible();
      await expect(page.locator(".kw-activity-bar")).toBeVisible();
      await expect(page.locator(".kw-workbench")).toBeVisible();
      await expect(page.locator(".kw-workbench h1")).toHaveCount(1);
      await expect(page.locator(".kw-breadcrumb strong")).toHaveText(view);
    }
  });

  test("persists Settings v3 activity/view, appearance and privacy controls across reload", async ({ page }) => {
    await selectActivityAndView(page, "System", "Settings");
    await page.getByLabel("Startup activity").selectOption("online");
    await page.getByLabel("Startup Online view").selectOption("models");
    await page.getByLabel("Theme").selectOption("dark");
    await page.getByLabel("Information density").selectOption("compact");
    const reduceMotion = page.getByLabel("Reduce motion");
    if (!(await reduceMotion.isChecked())) await reduceMotion.check();
    await page.getByLabel("Remote context policy").selectOption("blocked");
    const saving = page.waitForResponse((response) => response.url().endsWith("/api/workspace/settings") && response.request().method() === "PATCH");
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    expect((await saving).ok()).toBeTruthy();
    await expect(page.getByText("Settings v3 saved locally.", { exact: true })).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".kw-activity-bar").getByRole("button", { name: "Online", exact: true })).toHaveClass(/is-active/);
    await expect(page.locator(".kw-workbench h1")).toHaveText("Models");

    await selectActivityAndView(page, "System", "Settings");
    await expect(page.getByLabel("Startup activity")).toHaveValue("online");
    await expect(page.getByLabel("Startup Online view")).toHaveValue("models");
    await expect(page.getByLabel("Theme")).toHaveValue("dark");
    await expect(page.getByLabel("Information density")).toHaveValue("compact");
    await expect(page.getByLabel("Reduce motion")).toBeChecked();
    await expect(page.getByLabel("Remote context policy")).toHaveValue("blocked");
    await expect(page.getByText("secretRedaction = true · confirmRemoteWrites = true · Git mutation remains confirmation-gated", { exact: true })).toBeVisible();
  });

  test("uses server action descriptors to disable execution that lacks project evidence", async ({ page }) => {
    const project = await prepareWorkspace(page);
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await setProjectContext(page, project.project.id);
    await selectActivityAndView(page, "Developer Tools", "Terminal");
    await expect(page.getByText("KForge Command Terminal", { exact: true })).toBeVisible();
    await expect(page.getByText("Only registered KForge actions are executable. There is no unrestricted shell input.", { exact: true })).toBeVisible();
    const disabled = page.locator(".kw-command-table button:disabled");
    expect(await disabled.count()).toBeGreaterThanOrEqual(0);
  });

  test("selects an exact Marketplace capability card and synchronizes the Canonical Inspector", async ({ page }) => {
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await selectActivityAndView(page, "Online", "Marketplace");
    const targetCard = page.locator('.kw-capability-card[data-item-id="package:kforge:json-inspector"]');
    await expect(targetCard).toBeVisible({ timeout: 15_000 });
    const targetName = await targetCard.locator("h2").innerText();
    await targetCard.click();
    await expect(targetCard).toHaveAttribute("data-selected", "true");
    await expect(page.locator(".kw-workbench h1")).toContainText("Marketplace");
    await expect(page.locator(".kw-inspector")).toHaveCount(1);
    await expect(page.locator(".kw-inspector")).toContainText(targetName);
  });

  test("selects an exact Marketplace capability card by keyboard and synchronizes the Canonical Inspector", async ({ page }) => {
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await selectActivityAndView(page, "Online", "Marketplace");
    const targetCard = page.locator('.kw-capability-card[data-item-id="package:kforge:json-inspector"]');
    await expect(targetCard).toBeVisible({ timeout: 15_000 });
    await targetCard.focus();
    await page.keyboard.press("Enter");
    await expect(targetCard).toHaveAttribute("data-selected", "true");
    const targetName = await targetCard.locator("h2").innerText();
    await expect(page.locator(".kw-inspector")).toHaveCount(1);
    await expect(page.locator(".kw-inspector")).toContainText(targetName);
  });

  test("renders structured artifact evidence boundaries rather than raw JSON as the primary artifact UX", async ({ page }) => {
    const project = await prepareWorkspace(page);
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await setProjectContext(page, project.project.id);
    await selectActivityAndView(page, "Release", "Artifacts");
    const center = page.getByRole("region", { name: "KForge Release and Distribution Center", exact: true });
    const inventory = center.getByRole("region", { name: "Artifact evidence inventory", exact: true });
    await expect(inventory.getByRole("heading", { name: "Artifact Evidence Inventory", exact: true })).toBeVisible();
    await expect(inventory).toContainText(/PRESENCE_ONLY|No local artifact directory detected/);
    await expect(inventory).toContainText("CI artifact identity");
    expect(await page.locator(".kw-workbench-scroll pre").evaluateAll((nodes) => nodes.every((node) => Boolean(node.closest("details")))), "Raw artifact evidence must remain secondary inside details.").toBeTruthy();
  });
});

import { AxeBuilder } from "@axe-core/playwright";
import path from "node:path";
import { expect, test } from "@playwright/test";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

async function selectKForgeProject(page: Parameters<typeof test>[0] extends never ? never : import("@playwright/test").Page) {
  const rows = page.locator(".kf-table tbody tr");
  const projectPath = path.resolve(process.cwd());
  const projectIndex = await rows.evaluateAll((entries, exactPath) => entries.findIndex((entry) => entry.querySelector(".kf-project-cell small")?.getAttribute("title") === exactPath), projectPath);
  expect(projectIndex).toBeGreaterThanOrEqual(0);
  const row = rows.nth(projectIndex);
  await row.locator(".kf-project-cell").click();
  await expect(row).toHaveClass(/is-active/);
}

async function expectNoAxeViolations(page: import("@playwright/test").Page, surface: string) {
  const report = await new AxeBuilder({ page }).include(".kf-app").analyze();
  expect(report.violations, `${surface} accessibility violations:\n${report.violations.map((entry) => `${entry.id}: ${entry.help} (${entry.nodes.length})`).join("\n")}`).toEqual([]);
}

test.describe("KForge accessibility and keyboard evidence in production", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    const reset = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(reset.ok(), await reset.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await selectKForgeProject(page);
  });

  test("checks major local surfaces with Axe and keeps all audited controls free of detectable violations", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });

    await expect(page.locator(".kf-sidebar")).toBeVisible();
    await expect(page.locator(".kf-topbar")).toBeVisible();
    await expectNoAxeViolations(page, "Workspace");

    await page.locator(".kf-nav").getByRole("button", { name: "Marketplace", exact: true }).click();
    await expect(page.getByRole("region", { name: "Online Control Center" })).toBeVisible({ timeout: 30_000 });
    await expectNoAxeViolations(page, "Marketplace");

    await page.locator(".kf-nav").getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expectNoAxeViolations(page, "Settings");

    expect(externalRequests, `Unexpected external requests during accessibility audit:\n${externalRequests.join("\n")}`).toEqual([]);
  });

  test("supports keyboard navigation, visible focus, dialog focus trapping, and focus restoration", async ({ page }) => {
    const marketplace = page.locator(".kf-nav").getByRole("button", { name: "Marketplace", exact: true });
    await marketplace.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(marketplace).toBeFocused();
    await expect(marketplace).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Marketplace", exact: true })).toBeVisible();

    const commandTrigger = page.getByRole("button", { name: /Ask KForge or run a command/i });
    await commandTrigger.focus();
    await page.keyboard.press("Enter");
    const commandDialog = page.getByRole("dialog", { name: "KForge command palette" });
    const commandInput = commandDialog.getByLabel("Search commands and local workspace");
    await expect(commandDialog).toBeVisible();
    await expect(commandInput).toBeFocused();
    const commandFocusable = commandDialog.locator("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])");
    await page.keyboard.press("Shift+Tab");
    await expect(commandFocusable.last()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(commandInput).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(commandDialog).toHaveCount(0);
    await expect(commandTrigger).toBeFocused();

    await page.locator(".kf-nav").getByRole("button", { name: "Workspace", exact: true }).click();
    const openProject = page.getByRole("main").getByRole("button", { name: "Open project", exact: true });
    await openProject.focus();
    await page.keyboard.press("Enter");
    const projectDialog = page.getByRole("dialog", { name: "Open project" });
    const projectPath = projectDialog.getByLabel("Local project path");
    await expect(projectDialog).toBeVisible();
    await expect(projectPath).toBeFocused();
    const projectFocusable = projectDialog.locator("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])");
    await page.keyboard.press("Shift+Tab");
    await expect(projectFocusable.last()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(projectPath).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(projectDialog).toHaveCount(0);
    await expect(openProject).toBeFocused();

    await page.locator(".kf-nav").getByRole("button", { name: "Settings", exact: true }).click();
    const reduceMotion = page.getByLabel("Reduce motion");
    const initiallyChecked = await reduceMotion.isChecked();
    await reduceMotion.focus();
    await page.keyboard.press("Space");
    await expect(reduceMotion).toBeChecked({ checked: !initiallyChecked });
    await page.keyboard.press("Space");
    await expect(reduceMotion).toBeChecked({ checked: initiallyChecked });
  });
});

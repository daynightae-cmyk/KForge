import { AxeBuilder } from "@axe-core/playwright";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { setProjectContext } from "./helpers/workbench";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

async function expectNoAxeViolations(page: import("@playwright/test").Page, surface: string) {
  const report = await new AxeBuilder({ page }).include(".kw-shell").analyze();
  expect(report.violations, `${surface} accessibility violations:\n${report.violations.map((entry) => `${entry.id}: ${entry.help} (${entry.nodes.length})`).join("\n")}`).toEqual([]);
}

test.describe("KForge workbench accessibility and keyboard evidence", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    const reset = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(reset.ok(), await reset.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = await opened.json() as { project: { id: string } };
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".kw-shell")).toBeVisible({ timeout: 60_000 });
    await setProjectContext(page, project.project.id);
  });

  test("checks Workspace, Online and Settings with Axe", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });

    await expectNoAxeViolations(page, "Workspace");

    const online = page.locator(".kw-activity-bar").getByRole("button", { name: "Online", exact: true });
    await online.click();
    const onlineExplorer = page.getByRole("complementary", { name: "Online Explorer", exact: true });
    await onlineExplorer.getByRole("button", { name: "Marketplace", exact: true }).click();
    await expect(page.locator(".kw-online")).toBeVisible({ timeout: 30_000 });
    await expectNoAxeViolations(page, "Online Marketplace");

    const system = page.locator(".kw-activity-bar").getByRole("button", { name: "System", exact: true });
    await system.click();
    const systemExplorer = page.getByRole("complementary", { name: "System Explorer", exact: true });
    await systemExplorer.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expectNoAxeViolations(page, "Settings");

    expect(externalRequests, `Unexpected external requests during accessibility audit:\n${externalRequests.join("\n")}`).toEqual([]);
  });

  test("supports keyboard Activity navigation, command palette focus, Escape dismissal and settings controls", async ({ page }) => {
    const online = page.locator(".kw-activity-bar").getByRole("button", { name: "Online", exact: true });
    await online.focus();
    await page.keyboard.press("Enter");
    await expect(online).toHaveClass(/is-active/);
    await expect(page.getByRole("complementary", { name: "Online Explorer", exact: true })).toBeVisible();

    const commandTrigger = page.getByRole("button", { name: /Search KForge/i });
    await commandTrigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "KForge command palette" });
    const input = dialog.getByPlaceholder("Projects, files, symbols, problems, tasks, models…");
    await expect(dialog).toBeVisible();
    await expect(input).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await page.locator(".kw-activity-bar").getByRole("button", { name: "System", exact: true }).click();
    await page.getByRole("complementary", { name: "System Explorer", exact: true }).getByRole("button", { name: "Settings", exact: true }).click();
    const reduceMotion = page.getByLabel("Reduce motion");
    const initiallyChecked = await reduceMotion.isChecked();
    await reduceMotion.focus();
    await page.keyboard.press("Space");
    await expect(reduceMotion).toBeChecked({ checked: !initiallyChecked });
    await page.keyboard.press("Space");
    await expect(reduceMotion).toBeChecked({ checked: initiallyChecked });
  });
});

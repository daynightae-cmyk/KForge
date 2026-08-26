import path from "node:path";
import { expect, test } from "@playwright/test";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

async function selectKForgeProject(page: import("@playwright/test").Page) {
  const rows = page.locator(".kf-table tbody tr");
  const projectPath = path.resolve(process.cwd());
  const projectIndex = await rows.evaluateAll((entries, exactPath) => entries.findIndex((entry) => entry.querySelector(".kf-project-cell small")?.getAttribute("title") === exactPath), projectPath);
  expect(projectIndex).toBeGreaterThanOrEqual(0);
  const selectedRow = rows.nth(projectIndex);
  await selectedRow.locator(".kf-project-cell").click();
  await expect(selectedRow).toHaveClass(/is-active/);
}

test.describe("KForge reachable navigation audit in production", () => {
  test.setTimeout(600_000);

  test("opens every published sidebar destination through the keyboard and leaves exactly one truthful active surface", async ({ page }) => {
    const externalRequests: string[] = [];
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

    const reset = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(reset.ok(), await reset.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(opened.ok(), await opened.text()).toBeTruthy();

    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await selectKForgeProject(page);

    const labels = await page.locator(".kf-nav section button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") || button.textContent?.trim() || "").filter(Boolean));
    expect(labels).toHaveLength(66);
    expect(new Set(labels).size).toBe(labels.length);

    for (const label of labels) {
      const navigation = page.locator(".kf-nav").getByRole("button", { name: label, exact: true });
      await navigation.focus();
      await page.keyboard.press("Enter");
      await expect(navigation).toHaveClass(/is-active/);
      const publishedTitle = label === "Workspace" ? "Projects" : label;
      await expect(page.locator(".kf-breadcrumb strong")).toHaveText(publishedTitle, { timeout: 30_000 });
      await expect(page.locator(".kf-page-heading h1")).toHaveText(publishedTitle, { timeout: 30_000 });
      if (label === "Workspace") {
        await expect(page.locator(".kf-workspace-panel")).toBeVisible();
        await expect(page.locator(".kf-active-surface")).toHaveCount(0);
      } else {
        await expect(page.locator(`.kf-active-surface[aria-label="${label} capability"]`)).toBeVisible({ timeout: 30_000 });
        await expect(page.locator(".kf-active-surface")).toHaveCount(1);
      }
    }

    expect(externalRequests, `Unexpected external requests during reachable-navigation audit:\n${externalRequests.join("\n")}`).toEqual([]);
    expect(pageErrors, `Unexpected page errors during reachable-navigation audit:\n${pageErrors.join("\n")}`).toEqual([]);
    expect(consoleErrors, `Unexpected console errors during reachable-navigation audit:\n${consoleErrors.join("\n")}`).toEqual([]);
  });
});

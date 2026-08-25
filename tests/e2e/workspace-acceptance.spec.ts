import path from "node:path";
import { expect, test } from "@playwright/test";

const sequence = [
  { nav: "Workspace", title: "Projects" },
  { nav: "Agents", title: "Agents" },
  { nav: "KForge Sonar", title: "KForge Sonar" },
  { nav: "Marketplace", title: "Marketplace" },
  { nav: "Project graph", title: "Project graph" },
  { nav: "Release Gate", title: "Release Gate" },
  { nav: "Terminal", title: "Terminal" },
  { nav: "GitHub", title: "GitHub" },
  { nav: "Settings", title: "Settings" },
] as const;

test.describe("KForge Workspace production acceptance", () => {
  test.beforeEach(async ({ page }) => {
    const reset = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(reset.ok(), await reset.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", {
      data: { path: path.resolve(process.cwd()) },
    });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".kf-sidebar")).toBeVisible();
    await expect(page.locator(".kf-topbar")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
  });

  test("keeps a persistent shell while each requested destination replaces the active capability surface", async ({ page }) => {
    const apiFailures: string[] = [];
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/api/") && response.status() >= 400) apiFailures.push(`${response.status()} ${response.url()}`);
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    let previousTitle = "Projects";
    for (const destination of sequence) {
      const navigation = page.locator(".kf-nav").getByRole("button", { name: destination.nav, exact: true });
      await expect(navigation).toBeVisible();
      await navigation.click();

      await expect(page.locator(".kf-sidebar")).toBeVisible();
      await expect(page.locator(".kf-topbar")).toBeVisible();
      await expect(page.locator(".kf-breadcrumb strong")).toHaveText(destination.title);
      await expect(page.locator(".kf-page-heading h1")).toHaveText(destination.title);
      await expect(navigation).toHaveClass(/is-active/);
      await expect(page.locator(".kf-page-subtitle")).not.toHaveText("");

      if (destination.nav === "Workspace") {
        await expect(page.locator(".kf-workspace-panel")).toBeVisible();
        await expect(page.locator(".kf-active-surface")).toHaveCount(0);
      } else {
        await expect(page.locator(`.kf-active-surface[aria-label="${destination.title} capability"]`)).toBeVisible();
        await expect(page.locator(".kf-active-surface")).toHaveCount(1);
      }

      if (previousTitle !== destination.title) await expect(page.locator(".kf-page-heading h1")).not.toHaveText(previousTitle);
      previousTitle = destination.title;
    }

    expect(apiFailures, `Unexpected KForge API failures:\n${apiFailures.join("\n")}`).toEqual([]);
    expect(pageErrors, `React/page errors:\n${pageErrors.join("\n")}`).toEqual([]);
    expect(consoleErrors, `Console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
  });

  test("supports keyboard command-palette opening and Escape dismissal without leaving a stacked surface", async ({ page }) => {
    await page.keyboard.press("Control+K");
    await expect(page.getByRole("dialog", { name: "KForge command palette" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "KForge command palette" })).toHaveCount(0);
    await expect(page.locator(".kf-page-heading h1")).toHaveText("Projects");
  });
});


test.describe("KForge Settings persistence in production", () => {
  test("persists real editable settings across a renderer reload", async ({ page }) => {
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await page.locator(".kf-nav").getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

    await page.getByLabel("Startup capability").selectOption("Agents");
    await page.getByLabel("Information density").selectOption("compact");
    const reduceMotion = page.getByLabel("Reduce motion");
    if (!(await reduceMotion.isChecked())) await reduceMotion.check();
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(page.getByText(/Settings saved locally at/)).toBeVisible();

    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.locator(".kf-nav").getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByLabel("Startup capability")).toHaveValue("Agents");
    await expect(page.getByLabel("Information density")).toHaveValue("compact");
    await expect(reduceMotion).toBeChecked();
  });
});

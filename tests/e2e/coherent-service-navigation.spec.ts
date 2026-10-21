import path from "node:path";
import { expect, test } from "@playwright/test";
import { clearProjectContext, openWorkbench, selectExplorerView } from "./helpers/workbench";

const ACTIVITY_LABELS = ["Projects", "AI", "Online", "Intelligence", "Quality", "Developer Tools", "Remote / Git", "Release", "System"] as const;

async function prepareWorkspace(page: import("@playwright/test").Page) {
  const reset = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
  expect(reset.ok(), await reset.text()).toBeTruthy();
  const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
  expect(platform.ok(), await platform.text()).toBeTruthy();
  const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
  expect(opened.ok(), await opened.text()).toBeTruthy();
}

test.describe("KForge coherent service navigation", () => {
  test.setTimeout(360_000);

  test.beforeEach(async ({ page }) => {
    await prepareWorkspace(page);
    await openWorkbench(page);
  });

  test("gives every domain a stated purpose and groups its services into named sections", async ({ page }) => {
    for (const label of ACTIVITY_LABELS) {
      await page.getByRole("complementary", { name: "KForge activities" }).getByRole("button", { name: label, exact: true }).click();
      const explorer = page.getByRole("complementary", { name: `${label} Explorer`, exact: true });
      await expect(explorer).toBeVisible();
      const purpose = explorer.locator(".kw-explorer-purpose");
      await expect(purpose).toBeVisible();
      await expect(purpose).not.toHaveText("");
      const sections = explorer.locator(".kw-explorer-scroll > div > section > h2");
      await expect(sections.first()).toBeVisible();
      const names = await sections.allInnerTexts();
      expect(new Set(names).size, `section names inside ${label} must be unique`).toBe(names.length);
    }
  });

  test("finds a service by intent in the command palette and opens its owning surface", async ({ page }) => {
    await page.keyboard.press("Control+K");
    const palette = page.getByRole("dialog", { name: "KForge command palette" });
    await expect(palette).toBeVisible();
    await palette.getByRole("textbox").fill("release gate");
    const match = palette.locator("[data-service-target='release:release-gate']");
    await expect(match).toBeVisible();
    await expect(match).toContainText("Evaluate source, local, desktop, installer and remote evidence");
    await match.click();
    await expect(page.locator(".kw-workbench")).toHaveAttribute("data-workbench-surface", "release:release-gate");
    await expect(page.locator(".kw-workbench h1")).toHaveText("Release Gate");
  });

  test("browses the nine domains when the palette query is empty", async ({ page }) => {
    await page.keyboard.press("Control+K");
    const palette = page.getByRole("dialog", { name: "KForge command palette" });
    await expect(palette.getByRole("heading", { name: "Go to a domain" })).toBeVisible();
    await expect(palette.locator("[data-service-target]")).toHaveCount(9);
    await page.keyboard.press("Escape");
  });

  test("returns to the previous view with the breadcrumb back control", async ({ page }) => {
    const back = page.getByRole("button", { name: "Back to previous view" });
    await expect(back).toBeDisabled();
    await selectExplorerView(page, "Quality", "Problems");
    await expect(back).toBeEnabled();
    await back.click();
    await expect(page.locator(".kw-workbench")).toHaveAttribute("data-workbench-surface", "quality:sonar");
    await back.click();
    await expect(page.locator(".kw-workbench")).toHaveAttribute("data-workbench-surface", "projects:workspace");
    await expect(back).toBeDisabled();
  });

  test("presents the project service catalogue with real states and a working primary action", async ({ page }) => {
    await clearProjectContext(page);
    await selectExplorerView(page, "Projects", "Workspace");
    const projectCard = page.locator(".kw-project-card").first();
    await expect(projectCard).toBeVisible({ timeout: 30_000 });
    await projectCard.getByRole("button", { name: "Open", exact: true }).click();

    const catalogue = page.locator(".kw-tool-grid");
    await expect(catalogue).toBeVisible({ timeout: 30_000 });
    const cards = catalogue.locator("[data-service-target]");
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(10);

    for (const card of await cards.all()) {
      const target = await card.getAttribute("data-service-target");
      const state = await card.getAttribute("data-service-state");
      expect(target, "every catalogue card must name the service it owns").toBeTruthy();
      expect(state, "every catalogue card must expose a real availability state").toBeTruthy();
      await expect(card.locator(".kw-service-card__description")).not.toHaveText("");
      await expect(card.locator(".kw-service-card__evidence")).not.toHaveText("");
    }

    const tests = catalogue.locator("[data-service-target='developer-tools:tests']");
    await expect(tests).toBeVisible();
    await tests.getByRole("button").first().click();
    await expect(page.locator(".kw-workbench")).toHaveAttribute("data-workbench-surface", "developer-tools:tests");
    await expect(page.locator(".kw-workbench h1")).toHaveText("Tests");
  });
});

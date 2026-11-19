import path from "node:path";
import { expect, test } from "@playwright/test";
import { clearProjectContext, selectExplorerView } from "./helpers/workbench";

/**
 * The customization surfaces are only accepted when they render real contracts:
 * a Get Started path derived from evidence, a Brand surface whose assets really
 * load, and a Capabilities inventory that matches the registered navigation.
 * No test here claims provider connectivity, signing or a clean-machine result.
 */

async function prepareWorkspace(page: import("@playwright/test").Page) {
  const reset = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
  expect(reset.ok(), await reset.text()).toBeTruthy();
  const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
  expect(platform.ok(), await platform.text()).toBeTruthy();
  const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
  expect(opened.ok(), await opened.text()).toBeTruthy();
  const { project } = await opened.json() as { project: { id: string } };
  return project.id;
}

test.describe("KForge brand, onboarding and capability surfaces", () => {
  test.setTimeout(240_000);

  test.beforeEach(async ({ page }) => {
    const projectId = await prepareWorkspace(page);
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".kw-topbar")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("combobox", { name: "Project context", exact: true }).selectOption(projectId);
  });

  test("derives Get Started from evidence and deep-links to the owning surfaces", async ({ page }) => {
    await selectExplorerView(page, "Projects", "Get Started");
    await expect(page.locator(".kw-getting-started")).toBeVisible();
    await expect(page.getByText("EVIDENCE-BASED ONBOARDING", { exact: true })).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Core setup progress" })).toBeVisible();
    await expect(page.getByText("Reading setup evidence…", { exact: true })).toHaveCount(0, { timeout: 30_000 });

    const tracks = page.locator(".kw-getting-started__track");
    await expect(tracks).toHaveCount(2);
    await expect(tracks.first().locator("li")).toHaveCount(4);
    await expect(tracks.nth(1).locator("li")).toHaveCount(3);

    await page.getByRole("button", { name: "Review trust", exact: true }).click();
    await expect(page.locator(".kw-workbench")).toHaveAttribute("data-workbench-surface", "system:trust");
    await expect(page.locator(".kw-workbench h1")).toHaveText("Trust");
  });

  test("keeps the projectless Get Started path actionable instead of inventing progress", async ({ page }) => {
    await clearProjectContext(page);
    await selectExplorerView(page, "Projects", "Get Started");
    await expect(page.getByText("No project is active yet", { exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Open local project", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Clone repository", exact: true })).toBeVisible();
    const progress = page.getByRole("progressbar", { name: "Core setup progress" });
    await expect(progress).toHaveAttribute("aria-valuemax", "4");
    const value = Number(await progress.getAttribute("aria-valuenow"));
    expect(value, "selecting no active project cannot satisfy the trust step").toBeLessThan(4);
    await expect(page.getByText("BLOCKED", { exact: true }).first()).toBeVisible();
  });

  test("renders every canonical swatch and loads the public brand assets", async ({ page }) => {
    await selectExplorerView(page, "System", "Brand & Identity");
    await expect(page.locator(".kw-brand-center")).toBeVisible();

    const hexes = await page.locator(".kw-brand-center__swatch-face code").allInnerTexts();
    expect(hexes).toHaveLength(10);
    for (const hex of ["#8958FF", "#6F31EE", "#5122B8", "#07070B", "#0D0A14", "#F7F5FF", "#F0EBF8", "#C8AFFF", "#2AD9C8", "#E6E1D2"]) {
      expect(hexes, `missing canonical token ${hex}`).toContain(hex);
    }

    const assets = page.locator(".kw-brand-center__asset");
    await expect(assets).toHaveCount(3);
    await expect(assets.locator("a[download]")).toHaveCount(3);
    // Public SVG assets must finish decoding before naturalWidth is trustworthy.
    await page.waitForFunction(() => {
      const images = document.querySelectorAll(".kw-brand-center__asset img");
      return images.length === 3 && Array.from(images).every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0);
    }, { timeout: 15_000 });
    const loaded = await assets.locator("img").evaluateAll((images) => images.map((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0));
    expect(loaded, "each declared brand asset must resolve from public/brand").toEqual([true, true, true]);
    await expect(page.getByRole("img", { name: "KNOuX Forge wordmark artwork" })).toBeVisible();

    await page.getByRole("button", { name: "Appearance settings", exact: true }).click();
    await expect(page.locator(".kw-workbench")).toHaveAttribute("data-workbench-surface", "system:settings");
  });

  test("projects the registered navigation into a searchable contract inventory", async ({ page }) => {
    await selectExplorerView(page, "System", "Capabilities");
    await expect(page.locator(".kw-capabilities")).toBeVisible();
    await expect(page.getByText("Contract inventory, not a readiness claim.")).toBeVisible();
    await expect(page.locator(".kw-capabilities__stats > span").first().locator("strong")).toHaveText("71");
    const rows = page.locator(".kw-capabilities__row");
    await expect(rows).toHaveCount(71);
    await expect(rows.filter({ hasText: "quality:snapshots" })).toHaveCount(1);

    const search = page.getByRole("textbox", { name: "Search capabilities" });
    await search.fill("snapshot restore");
    await expect(page.locator(".kw-capabilities__row")).toHaveCount(1);
    await expect(page.locator(".kw-capabilities__row")).toContainText("Snapshots");

    await page.getByRole("button", { name: "Open Snapshots in Quality" }).click();
    await expect(page.locator(".kw-workbench")).toHaveAttribute("data-workbench-surface", "quality:snapshots");
    await expect(page.locator(".kw-workbench h1")).toHaveText("Snapshots");
  });
});

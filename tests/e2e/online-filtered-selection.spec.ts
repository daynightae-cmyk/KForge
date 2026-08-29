import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView } from "./helpers/workbench";

function selectedOnlineRow(page: import("@playwright/test").Page) {
  return page.locator('.kw-capability-card[data-selected="true"]');
}

test.describe("KForge Online semantic selection", () => {
  test.beforeEach(async ({ page }) => {
    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    await openWorkbench(page);
  });

  test("keeps the canonical Inspector synchronized with the visible semantic view", async ({ page }) => {
    await selectExplorerView(page, "Online", "Extensions");
    const card = page.locator('.kw-capability-card[data-item-id="package:kforge:json-inspector"]');
    await expect(card).toBeVisible();
    await card.click();
    const inspector = page.locator(".kw-inspector");
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText("kforge-json-inspector");

    await selectExplorerView(page, "Online", "Models");
    const modelRow = await selectedOnlineRow(page);
    await expect(modelRow).toHaveCount(1);
    await expect(modelRow).toBeVisible();
    const modelName = await modelRow.locator("h2").innerText();
    await expect(inspector).toContainText(modelName);
    await expect(inspector).not.toContainText("kforge-json-inspector");
  });

  test("clears Marketplace inspector authority when search hides the selected item", async ({ page }) => {
    await selectExplorerView(page, "Online", "Marketplace");
    const card = page.locator('.kw-capability-card[data-item-id="package:kforge:json-inspector"]');
    await expect(card).toBeVisible();
    await card.click();
    const inspector = page.locator(".kw-inspector");
    await expect(inspector).toContainText("kforge-json-inspector");

    await page.getByRole("textbox", { name: "Search Online catalog", exact: true }).fill("no-matching-kforge-catalog-entry");
    await expect(page.locator(".kw-capability-card")).toHaveCount(0);
    await expect(inspector).toHaveCount(0);
    await expect(page.locator('.kw-capability-card[data-selected="true"]')).toHaveCount(0);
  });
});

import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView } from "./helpers/workbench";

async function selectedOnlineRow(page: import("@playwright/test").Page) {
  const row = page.locator(".kw-online-results > button.is-selected");
  await expect(row).toHaveCount(1);
  await expect(row).toBeVisible();
  return row;
}

test.describe("KForge Online semantic selection", () => {
  test.beforeEach(async ({ page }) => {
    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    await openWorkbench(page);
  });

  test("keeps the canonical Inspector synchronized with the visible semantic view", async ({ page }) => {
    await selectExplorerView(page, "Online", "Extensions");
    const extension = page.locator(".kw-online-results").getByRole("button", { name: /kforge-json-inspector/i });
    await expect(extension).toBeVisible();
    await extension.click();
    const details = page.getByLabel("Online item details");
    await expect(details).toContainText("kforge-json-inspector");

    await selectExplorerView(page, "Online", "Models");
    const model = await selectedOnlineRow(page);
    const modelName = await model.locator("strong").innerText();
    await expect(details).toContainText(modelName);
    await expect(details).not.toContainText("kforge-json-inspector");
  });

  test("clears Marketplace inspector authority when search hides the selected item", async ({ page }) => {
    await selectExplorerView(page, "Online", "Marketplace");
    const item = page.locator(".kw-online-results").getByRole("button", { name: /kforge-json-inspector/i });
    await expect(item).toBeVisible();
    await item.click();
    const details = page.getByLabel("Online item details");
    await expect(details).toContainText("kforge-json-inspector");

    await page.getByRole("textbox", { name: "Search Online catalog", exact: true }).fill("no-matching-kforge-catalog-entry");
    await expect(page.locator(".kw-online-results > button")).toHaveCount(0);
    await expect(page.getByLabel("Online item details")).toHaveCount(0);
    await expect(page.locator(".kw-online-results > button.is-selected")).toHaveCount(0);
  });
});

import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView } from "./helpers/workbench";

test("defers specialized Inspector JS and Activity CSS until the owning surface needs them", async ({ page }) => {
  expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
  const assets: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes("/assets/")) assets.push(url.pathname);
  });

  await openWorkbench(page);
  await expect(page.locator(".kw-inspector")).toBeVisible();
  expect(assets.some((path) => /CanonicalInspector-.*\.js$/.test(path))).toBeTruthy();
  expect(assets.some((path) => /KForgeInspector-.*\.js$/.test(path))).toBeFalsy();
  expect(assets.some((path) => /PreviewRuntimeInspector-.*\.js$/.test(path))).toBeFalsy();
  expect(assets.some((path) => /onlineSurface-.*\.css$/.test(path))).toBeFalsy();
  expect(assets.some((path) => /PreviewStudioWorkbench-.*\.css$/.test(path))).toBeFalsy();

  await selectExplorerView(page, "Online", "Extensions");
  const item = page.locator('.kw-capability-card[data-item-id="package:kforge:json-inspector"]');
  await expect(item).toBeVisible();
  await expect(page.locator(".kw-inspector")).toContainText("kforge-json-inspector");
  expect(assets.some((path) => /onlineSurface-.*\.css$/.test(path))).toBeTruthy();
  expect(assets.some((path) => /KForgeInspector-.*\.js$/.test(path))).toBeTruthy();
  expect(assets.some((path) => /PreviewRuntimeInspector-.*\.js$/.test(path))).toBeFalsy();

  await item.click();
  await expect(page.locator(".kw-inspector")).toContainText("kforge-json-inspector");
  expect(assets.some((path) => /PreviewRuntimeInspector-.*\.js$/.test(path))).toBeFalsy();
});
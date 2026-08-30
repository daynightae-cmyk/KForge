import { AxeBuilder } from "@axe-core/playwright";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView, setProjectContext } from "./helpers/workbench";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);
function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

test.describe("KForge Release & Distribution Center accessibility", () => {
  test.setTimeout(120_000);

  test("keeps preparation, artifact inventory and versioning accessible without external contact", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });

    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = (await opened.json() as { project: { id: string } }).project;

    await openWorkbench(page);
    await setProjectContext(page, project.id);

    for (const view of ["Release Preparation", "Artifacts", "Versioning"]) {
      await selectExplorerView(page, "Release", view);
      await expect(page.getByRole("region", { name: "KForge Release and Distribution Center", exact: true })).toBeVisible();
      const report = await new AxeBuilder({ page }).include(".kw-shell").analyze();
      expect(report.violations, `${view} accessibility violations:\n${report.violations.map((entry) => `${entry.id}: ${entry.help} (${entry.nodes.length})`).join("\n")}`).toEqual([]);
    }

    expect(externalRequests, `Release distribution accessibility audit contacted an external origin:\n${externalRequests.join("\n")}`).toEqual([]);
  });
});

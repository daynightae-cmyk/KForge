import path from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView, selectProjectByPath } from "./helpers/workbench";

test.describe("KForge release evidence in contextual workbench", () => {
  test.setTimeout(300_000);

  test("keeps local desktop, Windows package, installer, GitHub, CI and remote evidence independent", async ({ page }) => {
    const projectPath = path.resolve(process.cwd());
    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectPath } });
    const project = (await opened.json() as { project: { id: string } }).project;
    expect((await page.request.post(`/api/workspace/projects/${project.id}/trust`, { data: { confirmed: true } })).ok()).toBeTruthy();

    const preparation = await page.request.get(`/api/workspace/projects/${encodeURIComponent(project.id)}/release/preparation`);
    expect(preparation.ok(), await preparation.text()).toBeTruthy();
    const prep = await preparation.json() as { preparation: { localEvidence: Record<string, { state: string; evidence?: string[] }> } };
    expect(prep.preparation.localEvidence).toMatchObject({
      DESKTOP: { state: expect.stringMatching(/READY|UNAVAILABLE|ERROR/) },
      WINDOWS_PACKAGE: { state: expect.stringMatching(/READY|UNAVAILABLE|ERROR/) },
      INSTALLER: { state: expect.stringMatching(/READY|UNAVAILABLE|ERROR/) },
    });

    await openWorkbench(page);
    await selectProjectByPath(page, projectPath);
    await selectExplorerView(page, "Release", "Release Gate");
    const response = page.waitForResponse((entry) => entry.url().endsWith(`/api/workspace/projects/${project.id}/release-gate`) && entry.request().method() === "POST", { timeout: 240_000 });
    await page.getByRole("button", { name: "Run Release Gate", exact: true }).click();
    const gate = await response;
    expect([200, 422]).toContain(gate.status());
    const grid = page.locator(".kw-release-grid");
    await expect(grid).toBeVisible({ timeout: 30_000 });
    for (const domain of ["SOURCE", "LOCAL", "PREVIEW", "DESKTOP", "WINDOWS_PACKAGE", "INSTALLER", "GITHUB", "CI", "REMOTE"]) await expect(grid).toContainText(domain);
    await expect(grid.locator("article")).toHaveCount(9);
    await selectExplorerView(page, "Release", "Artifacts");
    await expect(page.locator(".kw-workbench-scroll")).toContainText(/Structured artifacts|No release artifacts detected|SHA-256/i);
  });
});

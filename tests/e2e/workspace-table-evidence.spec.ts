import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.describe("KForge Workspace project table in production", () => {
  let projectRoot = "";

  test.afterEach(async () => {
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true, maxRetries: 24, retryDelay: 250 });
    projectRoot = "";
  });

  test("filters, sorts, and clears bulk selection through the visible local projects table", async ({ page }) => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "kforge-table-evidence-"));
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: path.basename(projectRoot), private: true, version: "1.0.0" }), "utf8");
    const reset = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(reset.ok(), await reset.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectRoot } });
    expect(opened.ok(), await opened.text()).toBeTruthy();

    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    const rows = page.locator(".kf-table tbody tr");
    const search = page.getByLabel("Search local projects");
    await search.fill(path.basename(projectRoot));
    await expect(rows).toHaveCount(1);
    const projectName = (await rows.first().locator(".kf-project-cell strong").textContent())?.trim();
    expect(projectName).toBe(path.basename(projectRoot));

    const projectSort = page.getByRole("button", { name: "Project", exact: true });
    await projectSort.click();
    await expect(projectSort).toHaveClass(/is-active/);

    const selectAll = page.getByLabel("Select all filtered projects");
    await selectAll.check();
    await expect(page.locator(".kf-bulk-bar")).toContainText("1 selected");
    await expect(page.getByRole("button", { name: "Clear", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page.locator(".kf-bulk-bar")).toHaveCount(0);
    await expect(selectAll).not.toBeChecked();
  });
});

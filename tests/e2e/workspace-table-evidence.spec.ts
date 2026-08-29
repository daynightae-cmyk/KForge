import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkbench, projectContext, selectProjectByPath } from "./helpers/workbench";

test.describe("KForge Workspace engineering table", () => {
  let projectRoot = "";
  test.afterEach(async () => { if (projectRoot) await rm(projectRoot, { recursive: true, force: true, maxRetries: 24, retryDelay: 250 }); projectRoot = ""; });

  test("filters, sorts, selects, clears bulk selection and exposes project health/trust/Git evidence", async ({ page }) => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "kforge-table-evidence-"));
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: path.basename(projectRoot), private: true, version: "1.0.0" }), "utf8");
    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/projects/open", { data: { path: projectRoot } })).ok()).toBeTruthy();
    await openWorkbench(page);

    const search = page.getByLabel("Search local projects");
    await search.fill(path.basename(projectRoot));
    const table = page.getByTestId("project-table");
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(table).toContainText(path.basename(projectRoot));
    await expect(table).toContainText(/Trust|Health|changed|ahead|behind/i);

    await page.getByLabel("Sort projects").selectOption("name");
    await expect(page.getByLabel("Sort projects")).toHaveValue("name");
    const selectAll = page.getByLabel("Select all filtered projects");
    await selectAll.check();
    await expect(page.locator(".kw-bulk-bar")).toContainText("1 selected");
    await page.getByRole("button", { name: "Clear selection", exact: true }).click();
    await expect(page.locator(".kw-bulk-bar")).toHaveCount(0);
    await expect(selectAll).not.toBeChecked();

    await search.fill("");
    await selectProjectByPath(page, projectRoot);
    await expect(projectContext(page)).not.toHaveValue("");
    const selectedRow = page.locator("[data-project-path]").filter({ hasText: projectRoot }).first();
    await expect(selectedRow).toHaveClass(/is-selected/);
  });
});

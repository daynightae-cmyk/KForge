import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView, setProjectContext } from "./helpers/workbench";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);
const external = (raw: string) => /^https?:$/i.test(new URL(raw).protocol) && !LOCAL_ORIGINS.has(new URL(raw).origin);

test.describe("KForge Project Health Workbench", () => {
  test.setTimeout(120_000);
  let projectPath = "";

  test.afterEach(async () => {
    if (projectPath) await rm(projectPath, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    projectPath = "";
  });

  test("reads persisted evidence without scanning and persists a new summary only after explicit execution", async ({ page }) => {
    projectPath = await mkdtemp(path.join(os.tmpdir(), "kforge-project-health-"));
    await writeFile(path.join(projectPath, "package.json"), JSON.stringify({ name: "health-fixture", private: true, version: "1.0.0" }, null, 2), "utf8");
    await writeFile(path.join(projectPath, "index.js"), "export const healthFixture = true;\n", "utf8");

    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectPath } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = (await opened.json() as { project: { id: string } }).project;

    const externalRequests: string[] = [];
    let healthScanPosts = 0;
    let healthEvidenceReads = 0;
    page.on("request", (request) => {
      if (external(request.url())) externalRequests.push(request.url());
      const url = new URL(request.url());
      if (url.pathname === `/api/workspace/projects/${project.id}/health/scan` && request.method() === "POST") healthScanPosts += 1;
      if (url.pathname === "/api/workspace/projects/health-evidence" && request.method() === "GET") healthEvidenceReads += 1;
    });

    await openWorkbench(page);
    await setProjectContext(page, project.id);
    await selectExplorerView(page, "Projects", "Project Health");
    const workbench = page.getByRole("region", { name: "KForge Project Health Workbench", exact: true });
    await expect(workbench).toBeVisible();
    await expect(workbench).toHaveAttribute("data-health-scan-state", "NOT_RUN_THIS_SESSION");
    await expect(workbench).toContainText("reads persisted local summary evidence only");
    await expect(workbench).toContainText("No current-session health evidence");
    expect(healthScanPosts).toBe(0);
    expect(healthEvidenceReads).toBeGreaterThanOrEqual(1);

    const responsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/health/scan`) && response.request().method() === "POST", { timeout: 90_000 });
    await workbench.getByRole("button", { name: "Run Project Health scan", exact: true }).click();
    const response = await responsePromise;
    expect(response.ok(), await response.text()).toBeTruthy();
    const body = await response.json() as { persistedSummary: { path: string; source: string; scannedAt: string; score: number | null } };
    expect(body.persistedSummary.path).toBe(projectPath);
    expect(body.persistedSummary.source).toBe("persisted-project-health");
    expect(body.persistedSummary.scannedAt).toBeTruthy();

    await expect(workbench).toHaveAttribute("data-health-scan-state", "SCANNED", { timeout: 90_000 });
    await expect(workbench.getByRole("region", { name: "Project health prior evidence", exact: true })).toContainText("persisted-project-health");
    await expect(workbench.getByRole("region", { name: "Project health metrics", exact: true })).toBeVisible();
    await expect(workbench.getByRole("region", { name: "Project health release decision", exact: true })).toBeVisible();
    await expect(workbench.getByRole("region", { name: "Project health evidence sources", exact: true })).toContainText(/LOCAL|CI|GITHUB/i);
    await expect(workbench.getByRole("region", { name: "Project health coverage and tools", exact: true })).toContainText(/COMPLETE|LIMIT_REACHED/);
    expect(healthScanPosts).toBe(1);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-workbench='kforge']")).toBeVisible({ timeout: 60_000 });
    await setProjectContext(page, project.id);
    await selectExplorerView(page, "Projects", "Workspace");
    const row = page.locator(`[data-project-id="${project.id}"]`);
    await expect(row).toBeVisible();
    await expect(row.locator('[data-health-evidence-source="persisted-project-health"]')).toBeVisible();
    await expect(row).toContainText("persisted");

    await selectExplorerView(page, "Projects", "Project Health");
    await expect(workbench).toHaveAttribute("data-health-scan-state", "NOT_RUN_THIS_SESSION");
    await expect(workbench.getByRole("region", { name: "Project health prior evidence", exact: true })).toContainText("persisted-project-health");
    await expect(workbench).toContainText("not promoted to a fresh current-session scan");
    expect(healthScanPosts).toBe(1);
    expect(externalRequests).toEqual([]);
  });
});

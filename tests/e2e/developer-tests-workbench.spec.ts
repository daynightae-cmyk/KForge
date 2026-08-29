import { access, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { selectExplorerView, setProjectContext } from "./helpers/workbench";

async function exists(target: string) {
  try { await access(target); return true; } catch { return false; }
}

test.describe("KForge specialized Developer Tests Workbench", () => {
  test.setTimeout(120_000);
  let projectPath = "";
  let markerPath = "";

  test.afterEach(async () => {
    if (projectPath) await rm(projectPath, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
    if (markerPath) await rm(markerPath, { force: true });
    projectPath = "";
    markerPath = "";
  });

  test("discovers without execution and runs only the explicit local test authority", async ({ page }) => {
    projectPath = await mkdtemp(path.join(os.tmpdir(), "kforge-tests-workbench-"));
    markerPath = path.join(os.tmpdir(), `kforge-test-run-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
    await mkdir(path.join(projectPath, "tests"), { recursive: true });
    const packageContent = JSON.stringify({
      name: "kforge-tests-workbench-fixture",
      private: true,
      version: "1.0.0",
      scripts: { test: "node test-evidence.cjs" },
    }, null, 2);
    const runnerContent = `const fs = require("node:fs");\nfs.writeFileSync(${JSON.stringify(markerPath)}, "EXPLICIT_TEST_RUN\\n", "utf8");\nconsole.log("KFORGE_TEST_SUITE_OK");\n`;
    await writeFile(path.join(projectPath, "package.json"), packageContent, "utf8");
    await writeFile(path.join(projectPath, "test-evidence.cjs"), runnerContent, "utf8");
    await writeFile(path.join(projectPath, "tests", "fixture.test.js"), "// test-root discovery evidence\n", "utf8");

    const reset = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(reset.ok(), await reset.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectPath } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = (await opened.json() as { project: { id: string } }).project;
    const trusted = await page.request.post(`/api/workspace/projects/${encodeURIComponent(project.id)}/trust`, { data: { confirmed: true } });
    expect(trusted.ok(), await trusted.text()).toBeTruthy();

    const packageBefore = await readFile(path.join(projectPath, "package.json"), "utf8");
    const runnerBefore = await readFile(path.join(projectPath, "test-evidence.cjs"), "utf8");
    let actionPosts = 0;
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === `/api/workspace/projects/${project.id}/actions`) actionPosts += 1;
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) externalRequests.push(request.url());
    });

    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await setProjectContext(page, project.id);
    await selectExplorerView(page, "Developer Tools", "Tests");

    const workbench = page.getByRole("region", { name: "KForge Tests Workbench", exact: true });
    await expect(workbench).toBeVisible();
    await expect(workbench).toHaveAttribute("data-test-run-state", "NOT_RUN_THIS_SESSION");
    await expect(workbench.getByText("Tests Workbench", { exact: true })).toBeVisible();
    await expect(workbench.getByRole("region", { name: "Test discovery evidence", exact: true })).toContainText("npm run test");
    await expect(workbench.getByRole("region", { name: "Test discovery evidence", exact: true })).toContainText("package.json");
    await expect(workbench.getByRole("region", { name: "Test discovery evidence", exact: true })).toContainText("tests");
    await expect(workbench.getByRole("region", { name: "Test discovery evidence", exact: true })).toContainText("NOT_REQUIRED");
    expect(await exists(markerPath)).toBe(false);
    expect(actionPosts).toBe(0);

    await workbench.getByRole("button", { name: "Refresh discovery", exact: true }).click();
    await expect(workbench.getByRole("status")).toContainText("Test discovery evidence refreshed");
    expect(await exists(markerPath)).toBe(false);
    expect(actionPosts).toBe(0);

    const responsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/actions`) && response.request().method() === "POST");
    await workbench.getByRole("button", { name: "Run detected tests", exact: true }).click();
    const response = await responsePromise;
    expect(response.ok(), await response.text()).toBeTruthy();
    await expect(workbench).toHaveAttribute("data-test-run-state", "PASSED", { timeout: 60_000 });
    await expect(workbench.getByRole("region", { name: "Test run evidence", exact: true })).toContainText("PASS");
    await expect(workbench.getByRole("region", { name: "Test run evidence", exact: true })).toContainText("KFORGE_TEST_SUITE_OK");
    await expect(workbench.getByRole("region", { name: "Test run evidence", exact: true })).toContainText("LOCAL");
    await expect(workbench.getByRole("region", { name: "Test run evidence", exact: true })).toContainText("NOT_REQUIRED");
    await expect(page.locator(".kw-bottom-panel")).toContainText("KFORGE_TEST_SUITE_OK");

    expect(await exists(markerPath)).toBe(true);
    expect(actionPosts).toBe(1);
    expect(externalRequests).toEqual([]);
    expect(await readFile(path.join(projectPath, "package.json"), "utf8")).toBe(packageBefore);
    expect(await readFile(path.join(projectPath, "test-evidence.cjs"), "utf8")).toBe(runnerBefore);
  });
});
import { access, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { selectExplorerView, setProjectContext } from "./helpers/workbench";

async function exists(target: string) {
  try { await access(target); return true; } catch { return false; }
}

test.describe("KForge specialized Developer Lint Workbench", () => {
  test.setTimeout(120_000);
  let projectPath = "";
  let markerPath = "";

  test.afterEach(async () => {
    if (projectPath) await rm(projectPath, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
    if (markerPath) await rm(markerPath, { force: true });
    projectPath = "";
    markerPath = "";
  });

  test("discovers without execution and lints only through explicit bounded authority", async ({ page }) => {
    projectPath = await mkdtemp(path.join(os.tmpdir(), "kforge-lint-workbench-"));
    markerPath = path.join(os.tmpdir(), `kforge-lint-run-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
    await mkdir(path.join(projectPath, "src"), { recursive: true });
    const packageContent = JSON.stringify({
      name: "kforge-lint-workbench-fixture",
      private: true,
      version: "1.0.0",
      scripts: { lint: "node lint-evidence.cjs" },
    }, null, 2);
    const runnerContent = `const fs = require("node:fs");\nfs.writeFileSync(${JSON.stringify(markerPath)}, "EXPLICIT_LINT_RUN\\n", "utf8");\nconsole.log("KFORGE_LINT_SUITE_OK");\n`;
    const sourceContent = "export const fixture = 'lint-source-remains-unchanged';\n";
    await writeFile(path.join(projectPath, "package.json"), packageContent, "utf8");
    await writeFile(path.join(projectPath, "lint-evidence.cjs"), runnerContent, "utf8");
    await writeFile(path.join(projectPath, "src", "index.js"), sourceContent, "utf8");

    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectPath } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = (await opened.json() as { project: { id: string } }).project;
    expect((await page.request.post(`/api/workspace/projects/${project.id}/trust`, { data: { confirmed: true } })).ok()).toBeTruthy();

    const packageBefore = await readFile(path.join(projectPath, "package.json"), "utf8");
    const runnerBefore = await readFile(path.join(projectPath, "lint-evidence.cjs"), "utf8");
    const sourceBefore = await readFile(path.join(projectPath, "src", "index.js"), "utf8");
    let lintPosts = 0;
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === `/api/workspace/projects/${project.id}/agent/tools/lint`) lintPosts += 1;
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) externalRequests.push(request.url());
    });

    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await setProjectContext(page, project.id);
    await selectExplorerView(page, "Developer Tools", "Lint");

    const workbench = page.getByRole("region", { name: "KForge Lint Workbench", exact: true });
    await expect(workbench).toBeVisible();
    await expect(workbench).toHaveAttribute("data-lint-run-state", "NOT_RUN_THIS_SESSION");
    const discovery = workbench.getByRole("region", { name: "Lint discovery evidence", exact: true });
    await expect(discovery).toContainText("npm run lint");
    await expect(discovery).toContainText("package.json#scripts.lint");
    await expect(discovery).toContainText("VERIFIED");
    expect(await exists(markerPath)).toBe(false);
    expect(lintPosts).toBe(0);

    await workbench.getByRole("button", { name: "Refresh discovery", exact: true }).click();
    await expect(workbench.getByRole("status")).toContainText("Lint discovery evidence refreshed");
    expect(await exists(markerPath)).toBe(false);
    expect(lintPosts).toBe(0);

    const responsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/agent/tools/lint`) && response.request().method() === "POST");
    await workbench.getByRole("button", { name: "Run detected lint", exact: true }).click();
    const response = await responsePromise;
    expect(response.ok(), await response.text()).toBeTruthy();
    await expect(workbench).toHaveAttribute("data-lint-run-state", "PASSED", { timeout: 60_000 });
    const evidence = workbench.getByRole("region", { name: "Lint run evidence", exact: true });
    await expect(evidence).toContainText("PASS");
    await expect(evidence).toContainText("KFORGE_LINT_SUITE_OK");
    await expect(page.locator(".kw-bottom-panel")).toContainText("KFORGE_LINT_SUITE_OK");

    expect(await exists(markerPath)).toBe(true);
    expect(lintPosts).toBe(1);
    expect(externalRequests).toEqual([]);
    expect(await readFile(path.join(projectPath, "package.json"), "utf8")).toBe(packageBefore);
    expect(await readFile(path.join(projectPath, "lint-evidence.cjs"), "utf8")).toBe(runnerBefore);
    expect(await readFile(path.join(projectPath, "src", "index.js"), "utf8")).toBe(sourceBefore);
  });
});

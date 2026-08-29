import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { setProjectContext } from "./helpers/workbench";

const execFile = promisify(execFileCallback);

async function git(repository: string, args: string[]) {
  await execFile("git", args, { cwd: repository, windowsHide: true });
}

async function navigate(page: Page, activity: string, view: string) {
  await page.locator(".kw-activity-bar").getByRole("button", { name: activity, exact: true }).click();
  const explorer = page.getByRole("complementary", { name: `${activity} Explorer`, exact: true });
  await explorer.getByRole("button", { name: view, exact: true }).click();
  await expect(page.locator(".kw-workbench h1")).toHaveText(view);
}

test.describe("KForge developer workbench and Git evidence", () => {
  test.setTimeout(150_000);
  let repository = "";

  test.afterEach(async () => {
    if (repository) await rm(repository, { recursive: true, force: true, maxRetries: 60, retryDelay: 500 });
    repository = "";
  });

  test("runs only detected project commands and keeps Git as explicit structured local evidence", async ({ page }) => {
    repository = await mkdtemp(path.join(os.tmpdir(), "kforge-developer-workbench-"));
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "KForge Workbench Acceptance"]);
    await git(repository, ["config", "user.email", "workbench@kforge.local"]);
    await writeFile(path.join(repository, "package.json"), JSON.stringify({
      name: "kforge-developer-workbench-fixture",
      private: true,
      version: "1.0.0",
      scripts: {
        typecheck: "node typecheck-evidence.js",
        test: "node test-evidence.js",
        build: "node build-evidence.js",
        start: "node runtime-server.js",
      },
    }), "utf8");
    await writeFile(path.join(repository, "typecheck-evidence.js"), "console.log('KFORGE_TYPECHECK_OK');\n", "utf8");
    await writeFile(path.join(repository, "test-evidence.js"), "console.log('KFORGE_TEST_OK');\n", "utf8");
    await writeFile(path.join(repository, "build-evidence.js"), "console.log('KFORGE_BUILD_OK');\n", "utf8");
    await writeFile(path.join(repository, "runtime-server.js"), "const http = require('node:http');\nhttp.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('KFORGE_RUNTIME_OK'); }).listen(process.env.PORT || 43123, '127.0.0.1', () => console.log('KFORGE_RUNTIME_READY'));\n", "utf8");
    await writeFile(path.join(repository, "tracked.txt"), "initial\n", "utf8");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "initial fixture"]);
    await writeFile(path.join(repository, "tracked.txt"), "changed\n", "utf8");

    const reset = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(reset.ok(), await reset.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: repository } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = (await opened.json() as { project: { id: string } }).project;
    const trusted = await page.request.post(`/api/workspace/projects/${encodeURIComponent(project.id)}/trust`, { data: { confirmed: true } });
    expect(trusted.ok(), await trusted.text()).toBeTruthy();

    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await setProjectContext(page, project.id);

    await navigate(page, "Developer Tools", "Terminal");
    await expect(page.getByText("KForge Command Terminal", { exact: true })).toBeVisible();
    await expect(page.getByText("Only registered KForge actions are executable. There is no unrestricted shell input.", { exact: true })).toBeVisible();
    const typecheckRow = page.locator(".kw-command-table > div").filter({ hasText: "Run typecheck" });
    await expect(typecheckRow).toContainText("npm run typecheck");
    const typecheckResponse = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/actions`) && response.request().method() === "POST");
    await typecheckRow.getByRole("button", { name: "Run", exact: true }).click();
    expect((await typecheckResponse).ok()).toBeTruthy();
    await expect(page.locator(".kw-bottom-panel")).toContainText("KFORGE_TYPECHECK_OK", { timeout: 60_000 });

    await navigate(page, "Developer Tools", "Tests");
    const testResponse = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/actions`) && response.request().method() === "POST");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    expect((await testResponse).ok()).toBeTruthy();
    await expect(page.locator(".kw-bottom-panel")).toContainText("KFORGE_TEST_OK", { timeout: 60_000 });

    await navigate(page, "Developer Tools", "Build");
    const buildResponse = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/actions`) && response.request().method() === "POST");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    expect((await buildResponse).ok()).toBeTruthy();
    await expect(page.locator(".kw-bottom-panel")).toContainText("KFORGE_BUILD_OK", { timeout: 60_000 });

    await navigate(page, "Developer Tools", "Runtime");
    const runtimeResponse = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/actions`) && response.request().method() === "POST");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    expect((await runtimeResponse).ok()).toBeTruthy();
    await expect(page.locator(".kw-bottom-panel")).toContainText("HTTP 200", { timeout: 60_000 });

    await navigate(page, "Remote / Git", "Git");
    const gitWorkbench = page.locator('section[aria-label="KForge Git Workbench"]');
    await expect(gitWorkbench).toBeVisible({ timeout: 30_000 });
    await expect(gitWorkbench.locator('[data-git-file="tracked.txt"]')).toBeVisible();
    await expect(gitWorkbench).toContainText("Working tree");
    await expect(gitWorkbench).toContainText("TRUSTED");
  });
});

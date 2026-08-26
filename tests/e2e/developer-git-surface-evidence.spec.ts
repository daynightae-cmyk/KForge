import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test, type Locator, type Page } from "@playwright/test";

const execFile = promisify(execFileCallback);
const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

async function git(repository: string, args: string[]) {
  await execFile("git", args, { cwd: repository, windowsHide: true });
}

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

async function runDetectedAction(page: Page, surface: Locator, projectId: string, buttonName: string, action: string, expectedOutput: string) {
  const taskRequest = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${projectId}/tasks`)
    && response.request().method() === "POST"
    && response.request().postData()?.includes(`\"action\":\"${action}\"`) === true);
  await surface.getByRole("button", { name: buttonName, exact: true }).click();
  expect((await taskRequest).status()).toBe(202);
  await expect(surface).toContainText(new RegExp(`${action} · success`, "i"), { timeout: 60_000 });
  await expect(surface).toContainText(expectedOutput, { timeout: 60_000 });
}

test.describe("KForge developer and local Git surfaces in production", () => {
  test.setTimeout(120_000);
  let repository = "";

  test.afterEach(async () => {
    if (repository) await rm(repository, { recursive: true, force: true, maxRetries: 60, retryDelay: 500 });
    repository = "";
  });

  test("runs detected local typecheck, test, build, and runtime commands and changes only an explicitly confirmed local Git index and branch", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });

    repository = await mkdtemp(path.join(os.tmpdir(), "kforge-developer-git-"));
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "KForge Surface Acceptance"]);
    await git(repository, ["config", "user.email", "surface@kforge.local"]);
    await writeFile(path.join(repository, "package.json"), JSON.stringify({
      name: "kforge-developer-git-fixture",
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
    await writeFile(path.join(repository, "runtime-server.js"), "const http = require('node:http');\nhttp.createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('KFORGE_RUNTIME_OK'); }).listen(process.env.PORT || 43123, '127.0.0.1', () => console.log('KFORGE_RUNTIME_READY'));\n", "utf8");
    await writeFile(path.join(repository, "tracked.txt"), "initial\n", "utf8");
    await git(repository, ["add", "--", "package.json", "typecheck-evidence.js", "test-evidence.js", "build-evidence.js", "runtime-server.js", "tracked.txt"]);
    await git(repository, ["commit", "-m", "initial fixture"]);
    await writeFile(path.join(repository, "tracked.txt"), "changed after initial local commit\n", "utf8");

    const settings = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(settings.ok(), await settings.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: repository } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = (await opened.json() as { project: { id: string } }).project;
    const trusted = await page.request.post(`/api/workspace/projects/${project.id}/trust`, { data: { confirmed: true } });
    expect(trusted.ok(), await trusted.text()).toBeTruthy();

    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    const selectedRow = page.locator(".kf-table tbody tr").filter({ hasText: repository }).first();
    await expect(selectedRow).toBeVisible();
    await selectedRow.locator(".kf-project-cell").click();
    await expect(selectedRow).toHaveClass(/is-active/);

    await page.locator(".kf-nav").getByRole("button", { name: "Terminal", exact: true }).click();
    const terminal = page.locator(".kf-active-surface");
    await expect(terminal.getByRole("heading", { name: "Local Command Center", exact: true })).toBeVisible();
    await expect(terminal).toContainText("arbitrary shell input is intentionally not exposed");
    await runDetectedAction(page, terminal, project.id, "Typecheck", "typecheck", "KFORGE_TYPECHECK_OK");

    await page.locator(".kf-nav").getByRole("button", { name: "Tests", exact: true }).click();
    const tests = page.locator(".kf-active-surface");
    await expect(tests.getByRole("heading", { name: "Test Lab", exact: true })).toBeVisible();
    await runDetectedAction(page, tests, project.id, "Run test", "test", "KFORGE_TEST_OK");

    await page.locator(".kf-nav").getByRole("button", { name: "Build", exact: true }).click();
    const build = page.locator(".kf-active-surface");
    await expect(build.getByRole("heading", { name: "Build Center", exact: true })).toBeVisible();
    await runDetectedAction(page, build, project.id, "Run build", "build", "KFORGE_BUILD_OK");

    await page.locator(".kf-nav").getByRole("button", { name: "Runtime", exact: true }).click();
    const runtime = page.locator(".kf-active-surface");
    await expect(runtime.getByRole("heading", { name: "Runtime Verification", exact: true })).toBeVisible();
    await runDetectedAction(page, runtime, project.id, "Run runtime", "runtime", "HTTP 200");

    await page.locator(".kf-nav").getByRole("button", { name: "Logs", exact: true }).click();
    const logs = page.locator(".kf-active-surface");
    await expect(logs).toContainText(/typecheck · success/i);
    await expect(logs).toContainText(/test · success/i);
    await expect(logs).toContainText(/build · success/i);
    await expect(logs).toContainText(/runtime · success/i);
    await expect(logs).toContainText("KFORGE_BUILD_OK");

    await page.locator(".kf-nav").getByRole("button", { name: "Git", exact: true }).click();
    const gitCenter = page.locator(".kf-active-surface");
    await expect(gitCenter.getByRole("heading", { name: "Git Center", exact: true })).toBeVisible();
    await expect(gitCenter).toContainText("Local index controls", { timeout: 30_000 });
    const trackedLabel = gitCenter.locator(".kf-git-file-list label").filter({ hasText: "tracked.txt" });
    await expect(trackedLabel).toBeVisible();
    await trackedLabel.getByRole("checkbox").check();
    page.once("dialog", (dialog) => dialog.accept());
    const stageResponse = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/git/stage`) && response.request().method() === "POST");
    await gitCenter.getByRole("button", { name: "Stage selected", exact: true }).click();
    expect((await stageResponse).ok()).toBeTruthy();
    await expect(gitCenter).toContainText("No remote operation was performed.");

    await gitCenter.getByLabel("New local branch name").fill("feature/surface-evidence");
    page.once("dialog", (dialog) => dialog.accept());
    const branchResponse = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/git/branches`) && response.request().method() === "POST");
    await gitCenter.getByRole("button", { name: "Create branch", exact: true }).click();
    expect((await branchResponse).ok()).toBeTruthy();
    await expect(gitCenter).toContainText("feature/surface-evidence");
    expect(externalRequests, `Unexpected external requests in developer and Git surfaces:\n${externalRequests.join("\n")}`).toEqual([]);
  });
});

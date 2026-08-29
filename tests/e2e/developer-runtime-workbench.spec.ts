import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { selectExplorerView, setProjectContext } from "./helpers/workbench";

async function exists(target: string) {
  try { await access(target); return true; } catch { return false; }
}

test.describe("KForge specialized Developer Runtime Workbench", () => {
  test.setTimeout(150_000);
  let projectPath = "";
  let markerPath = "";
  let projectId = "";

  test.afterEach(async ({ request }) => {
    if (projectId) await request.post(`/api/workspace/projects/${encodeURIComponent(projectId)}/preview/stop`).catch(() => undefined);
    if (projectPath) await rm(projectPath, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
    if (markerPath) await rm(markerPath, { force: true });
    projectPath = "";
    markerPath = "";
    projectId = "";
  });

  test("verifies only through explicit authority and yields process ownership to live Preview", async ({ page }) => {
    projectPath = await mkdtemp(path.join(os.tmpdir(), "kforge-runtime-workbench-"));
    markerPath = path.join(os.tmpdir(), `kforge-runtime-run-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
    await writeFile(path.join(projectPath, "package.json"), JSON.stringify({
      name: "kforge-runtime-workbench-fixture",
      private: true,
      version: "1.0.0",
      scripts: { start: "node runtime-server.cjs" },
    }, null, 2), "utf8");
    const runnerContent = [
      "const fs = require('node:fs');",
      "const http = require('node:http');",
      `fs.writeFileSync(${JSON.stringify(markerPath)}, 'EXPLICIT_RUNTIME_RUN\\n', 'utf8');`,
      "const port = Number(process.env.PORT);",
      "const server = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<main><h1>KFORGE_RUNTIME_READY</h1><a href=\"/health\">Health</a></main>'); });",
      "server.listen(port, '127.0.0.1', () => console.log(`RUNTIME_SERVER_STARTED:${port}`));",
    ].join("\n");
    await writeFile(path.join(projectPath, "runtime-server.cjs"), runnerContent, "utf8");

    const reset = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(reset.ok(), await reset.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectPath } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = (await opened.json() as { project: { id: string } }).project;
    projectId = project.id;
    const trusted = await page.request.post(`/api/workspace/projects/${encodeURIComponent(project.id)}/trust`, { data: { confirmed: true } });
    expect(trusted.ok(), await trusted.text()).toBeTruthy();

    const packageBefore = await readFile(path.join(projectPath, "package.json"), "utf8");
    const runnerBefore = await readFile(path.join(projectPath, "runtime-server.cjs"), "utf8");
    let runtimeActionPosts = 0;
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === `/api/workspace/projects/${project.id}/actions`) runtimeActionPosts += 1;
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) externalRequests.push(request.url());
    });

    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await setProjectContext(page, project.id);
    await selectExplorerView(page, "Developer Tools", "Runtime");

    const runtime = page.getByRole("region", { name: "KForge Runtime Workbench", exact: true });
    await expect(runtime).toBeVisible();
    await expect(runtime).toHaveAttribute("data-runtime-run-state", "NOT_RUN_THIS_SESSION");
    await expect(runtime.getByRole("region", { name: "Runtime discovery evidence", exact: true })).toContainText("npm run start");
    await expect(runtime.getByRole("region", { name: "Runtime discovery evidence", exact: true })).toContainText("package.json#scripts.start");
    await expect(runtime.getByRole("region", { name: "Runtime discovery evidence", exact: true })).toContainText("NOT_REQUIRED");
    expect(await exists(markerPath)).toBe(false);
    expect(runtimeActionPosts).toBe(0);

    await runtime.getByRole("button", { name: "Refresh evidence", exact: true }).click();
    await expect(runtime.getByRole("status").last()).toContainText("No runtime command was executed");
    expect(await exists(markerPath)).toBe(false);
    expect(runtimeActionPosts).toBe(0);

    const verifyResponse = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/actions`) && response.request().method() === "POST");
    await runtime.getByRole("button", { name: "Verify detected runtime", exact: true }).click();
    const verification = await verifyResponse;
    expect(verification.ok(), await verification.text()).toBeTruthy();
    await expect(runtime).toHaveAttribute("data-runtime-run-state", "PASSED", { timeout: 60_000 });
    const evidence = runtime.getByRole("region", { name: "Runtime verification evidence", exact: true });
    await expect(evidence).toContainText("PASS");
    await expect(evidence).toContainText("RUNTIME_SERVER_STARTED");
    await expect(evidence).toContainText("HTTP 200");
    await expect(evidence).toContainText("LOCAL");
    await expect(evidence).toContainText("NOT_REQUIRED");
    expect(await exists(markerPath)).toBe(true);
    expect(runtimeActionPosts).toBe(1);

    await selectExplorerView(page, "Developer Tools", "Preview");
    const preview = page.getByRole("region", { name: "KForge Preview Workbench", exact: true });
    const startResponse = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/preview/start`) && response.request().method() === "POST");
    await preview.getByRole("button", { name: "Run", exact: true }).click();
    expect((await startResponse).status()).toBe(202);
    await expect(preview.locator(".kw-preview-status")).toContainText("RUNNING", { timeout: 30_000 });

    const live = await (await page.request.get(`/api/workspace/projects/${project.id}/preview`)).json() as { preview: { state: string; pid?: number; sessionId?: string } };
    expect(live.preview.state).toBe("running");
    expect(live.preview.pid).toBeTruthy();
    expect(live.preview.sessionId).toBeTruthy();

    await selectExplorerView(page, "Developer Tools", "Runtime");
    const ownedRuntime = page.getByRole("region", { name: "KForge Runtime Workbench", exact: true });
    await expect(ownedRuntime).toHaveAttribute("data-runtime-run-state", "BLOCKED_BY_LIVE_PREVIEW");
    await expect(ownedRuntime.getByRole("complementary", { name: "Live Preview ownership evidence", exact: true })).toContainText(String(live.preview.pid));
    await expect(ownedRuntime.getByRole("button", { name: "Verify detected runtime", exact: true })).toBeDisabled();
    expect(runtimeActionPosts).toBe(1);

    expect(externalRequests).toEqual([]);
    expect(await readFile(path.join(projectPath, "package.json"), "utf8")).toBe(packageBefore);
    expect(await readFile(path.join(projectPath, "runtime-server.cjs"), "utf8")).toBe(runnerBefore);
  });
});

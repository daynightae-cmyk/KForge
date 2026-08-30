import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { selectExplorerView, setProjectContext } from "./helpers/workbench";

test.describe("KForge Preview Studio 3.0 browser and QA evidence", () => {
  test.setTimeout(150_000);
  let projectPath = "";
  let projectId = "";

  test.afterEach(async ({ request }) => {
    if (projectId) await request.post(`/api/workspace/projects/${encodeURIComponent(projectId)}/preview/stop`).catch(() => undefined);
    if (projectPath) await rm(projectPath, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
    projectPath = "";
    projectId = "";
  });

  test("behaves like a bounded local browser studio without inventing browser telemetry", async ({ page }) => {
    projectPath = await mkdtemp(path.join(os.tmpdir(), "kforge-preview-studio-"));
    await writeFile(path.join(projectPath, "package.json"), JSON.stringify({
      name: "kforge-preview-studio-fixture",
      private: true,
      version: "1.0.0",
      scripts: { dev: "node preview-studio-server.cjs" },
    }, null, 2), "utf8");
    await writeFile(path.join(projectPath, "preview-studio-server.cjs"), [
      "const http = require('node:http');",
      "const port = Number(process.env.PORT);",
      "const server = http.createServer((request, response) => {",
      " response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });",
      " response.end(`<!doctype html><html lang=\"en\"><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>KForge fixture</title></head><body><main><h1>KFORGE_PREVIEW_STUDIO_READY</h1><p id=\"route\">${request.url}</p><a href=\"/quality\">Quality</a><a href=\"/settings\">Settings</a></main></body></html>`);",
      "});",
      "server.listen(port, '127.0.0.1', () => console.log(`PREVIEW_STUDIO_READY:${port}`));",
    ].join("\n"), "utf8");

    const reset = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(reset.ok(), await reset.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectPath } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = (await opened.json() as { project: { id: string } }).project;
    projectId = project.id;
    expect((await page.request.post(`/api/workspace/projects/${encodeURIComponent(project.id)}/trust`, { data: { confirmed: true } })).ok()).toBeTruthy();

    const externalRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) externalRequests.push(request.url());
    });

    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await setProjectContext(page, project.id);
    await selectExplorerView(page, "Developer Tools", "Preview");
    const studio = page.getByRole("region", { name: "KForge Preview Workbench", exact: true });
    await expect(studio).toHaveAttribute("data-preview-studio", "3");
    await expect(studio.getByText("App Preview", { exact: true })).toBeVisible();
    await expect(studio.locator('[aria-label="Preview device laboratory"]')).toBeVisible();
    await expect(studio.getByRole("button", { name: /Problems/ })).toBeVisible();
    await expect(studio.getByRole("button", { name: /Network/ })).toBeVisible();
    await expect(studio.getByRole("button", { name: "Visual & A11y QA", exact: true })).toBeVisible();
    expect(externalRequests).toEqual([]);

    const startResponse = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/preview/start`) && response.request().method() === "POST");
    await studio.getByRole("button", { name: "Run", exact: true }).click();
    expect((await startResponse).status()).toBe(202);
    await expect(studio.locator(".kw-preview-status")).toContainText("RUNNING", { timeout: 30_000 });
    await expect(studio.locator(".kw-preview-status")).toContainText("HEALTHY");

    const frame = studio.locator('iframe[aria-label="Preview application frame"]');
    const app = page.frameLocator('iframe[aria-label="Preview application frame"]');
    await expect(app.locator("#route")).toHaveText("/");

    const address = studio.getByLabel("Preview address", { exact: true });
    await address.fill("/quality");
    await address.press("Enter");
    await expect(app.locator("#route")).toHaveText("/quality");
    await studio.getByLabel("Preview back", { exact: true }).click();
    await expect(app.locator("#route")).toHaveText("/");
    await studio.getByLabel("Preview forward", { exact: true }).click();
    await expect(app.locator("#route")).toHaveText("/quality");

    await address.fill("https://example.com/escape");
    await address.press("Enter");
    await expect(studio.getByRole("status").last()).toContainText("limited to the active project loopback origin");
    await expect(app.locator("#route")).toHaveText("/quality");
    expect(externalRequests).toEqual([]);

    await studio.getByLabel("Preview viewport", { exact: true }).selectOption("mobile");
    expect(await frame.evaluate((element) => (element as HTMLIFrameElement).clientWidth)).toBe(390);
    await studio.getByLabel("Rotate viewport", { exact: true }).click();
    expect(await frame.evaluate((element) => (element as HTMLIFrameElement).clientWidth)).toBe(844);
    await studio.getByLabel("Preview zoom", { exact: true }).selectOption("75");
    await expect(frame).toHaveAttribute("style", /scale\(0\.75\)/);

    await studio.getByRole("button", { name: /Routes/ }).click();
    const routes = studio.locator('[aria-label="Preview discovered routes"]');
    await expect(routes).toContainText("/quality");
    await expect(routes).toContainText("/settings");
    await expect(routes).toContainText("same-origin links");

    await studio.getByRole("button", { name: /Health timeline/ }).click();
    const health = studio.locator('[aria-label="Preview health history"]');
    await expect(health).toContainText("HEALTHY");
    await expect(health).toContainText("HTTP 200");

    const inspectResponse = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/preview/inspect`) && response.request().method() === "POST");
    await studio.getByLabel("Inspect delivered Preview document", { exact: true }).click();
    expect((await inspectResponse).ok()).toBeTruthy();
    const qa = studio.locator('[aria-label="Preview visual and accessibility QA"]');
    await expect(qa).toContainText("COMPLETED");
    await expect(qa).toContainText("A non-empty document title was delivered");
    await expect(qa).toContainText("Browser console, request waterfalls, screenshots");

    await studio.getByRole("button", { name: /Network/ }).click();
    await expect(studio.locator('[aria-label="Preview network observations"]')).toContainText("loopback health probes only");
    await expect(studio.locator('[aria-label="Preview network observations"]')).toContainText("does not claim application request waterfalls");

    await studio.getByRole("button", { name: "Session", exact: true }).click();
    const session = studio.locator('[aria-label="Preview session evidence"]');
    const backend = await (await page.request.get(`/api/workspace/projects/${project.id}/preview`)).json() as { preview: { sessionId?: string; pid?: number; port?: number; state: string } };
    expect(backend.preview.state).toBe("running");
    await expect(session).toContainText(String(backend.preview.sessionId));
    await expect(session).toContainText(String(backend.preview.pid));
    await expect(session.locator('[aria-label="Runtime verification integration"]').getByRole("button", { name: "Verify runtime", exact: true })).toBeDisabled();
    await expect(session).toContainText("owns PID");
    await expect(session).toContainText("allocated");
    await expect(session).toContainText("spawned");
    await expect(session).toContainText("healthy");

    await studio.getByRole("button", { name: /Console/ }).click();
    const consoleOutput = studio.locator('[aria-label="Preview console output"]');
    await expect(consoleOutput).toContainText("PREVIEW_STUDIO_READY");
    await expect(consoleOutput).toContainText("Browser console is NOT_CAPTURED");

    await expect(page.getByRole("complementary", { name: "Preview runtime Inspector", exact: true })).toContainText(String(backend.preview.sessionId));
    await expect(page.getByRole("complementary", { name: "Preview runtime Inspector", exact: true })).toContainText("loopback-health-probe-only");
    expect(externalRequests).toEqual([]);
  });
});

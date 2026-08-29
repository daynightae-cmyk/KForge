import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { clearProjectContext, selectExplorerView, setProjectContext } from "./helpers/workbench";

test.describe("KForge canonical Preview Workbench", () => {
  test.setTimeout(150_000);
  let roots: string[] = [];
  let activeProjectId = "";

  test.afterEach(async ({ request }) => {
    if (activeProjectId) await request.post(`/api/workspace/projects/${encodeURIComponent(activeProjectId)}/preview/stop`).catch(() => undefined);
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 250 })));
    roots = [];
    activeProjectId = "";
  });

  async function createProject(page: import("@playwright/test").Page, name: string, runnable: boolean) {
    const root = await mkdtemp(path.join(os.tmpdir(), `${name}-`));
    roots.push(root);
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name,
      private: true,
      version: "1.0.0",
      type: "commonjs",
      scripts: runnable ? { dev: "node preview-server.cjs" } : {},
    }), "utf8");
    if (runnable) await writeFile(path.join(root, "preview-server.cjs"), [
      "const http = require('node:http');",
      "const port = Number(process.env.PORT);",
      "const server = http.createServer((request, response) => {",
      " response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });",
      " response.end(`<main><h1>KFORGE_PREVIEW_READY</h1><p>${request.url}</p><a href=\"/quality\">Quality route</a></main>`);",
      "});",
      "server.listen(port, '127.0.0.1', () => console.log(`PREVIEW_LISTENING:${port}`));",
    ].join("\n"), "utf8");
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: root } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    return (await opened.json() as { project: { id: string } }).project;
  }

  test("runs, embeds, resizes, preserves ownership, restarts and stops the real detected runtime", async ({ page }) => {
    const reset = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(reset.ok(), await reset.text()).toBeTruthy();
    const projectA = await createProject(page, "kforge-preview-a", true);
    const projectB = await createProject(page, "kforge-preview-b", false);
    activeProjectId = projectA.id;
    expect((await page.request.post(`/api/workspace/projects/${encodeURIComponent(projectA.id)}/trust`, { data: { confirmed: true } })).ok()).toBeTruthy();

    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await setProjectContext(page, projectA.id);
    await selectExplorerView(page, "Developer Tools", "Preview");
    const preview = page.getByRole("region", { name: "KForge Preview Workbench" });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("npm run dev -- --port <allocated>");
    await page.keyboard.press("Control+K");
    const palette = page.getByRole("dialog", { name: "KForge command palette" });
    await palette.getByPlaceholder("Projects, files, symbols, problems, tasks, models…").fill("preview");
    await expect(palette.getByRole("button", { name: /Preview: Start/ })).toBeVisible();
    await page.keyboard.press("Escape");

    const startResponse = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${projectA.id}/preview/start`) && response.request().method() === "POST");
    await preview.getByRole("button", { name: "Run", exact: true }).click();
    expect((await startResponse).status()).toBe(202);
    await expect(preview.locator(".kw-preview-status")).toContainText("RUNNING", { timeout: 30_000 });
    await expect(preview.locator(".kw-preview-status")).toContainText("HEALTHY");
    const frame = preview.locator('iframe[aria-label="Preview application frame"]');
    await expect(frame).toBeVisible();
    await expect(preview.locator(".kw-preview-logs")).toContainText("PREVIEW_LISTENING");
    await expect(page.getByRole("complementary", { name: "Preview runtime Inspector" })).toContainText("package.json#scripts.dev", { timeout: 30_000 });

    const before = await (await page.request.get(`/api/workspace/projects/${projectA.id}/preview`)).json() as { preview: { sessionId: string; pid: number; state: string } };
    expect(before.preview.state).toBe("running");
    await preview.getByLabel("Preview viewport").selectOption("mobile");
    expect(await frame.evaluate((element) => (element as HTMLIFrameElement).clientWidth)).toBe(390);
    await preview.getByLabel("Reload preview frame").click();
    await expect(frame).toBeVisible();

    await selectExplorerView(page, "Developer Tools", "Terminal");
    await selectExplorerView(page, "Developer Tools", "Preview");
    const afterNavigation = await (await page.request.get(`/api/workspace/projects/${projectA.id}/preview`)).json() as { preview: { sessionId: string; pid: number; state: string } };
    expect(afterNavigation.preview).toMatchObject({ sessionId: before.preview.sessionId, pid: before.preview.pid, state: "running" });

    await setProjectContext(page, projectB.id);
    await expect(page.getByRole("region", { name: "KForge Preview Workbench" })).toContainText("PREVIEW_NOT_AVAILABLE");
    await expect(page.locator('iframe[aria-label="Preview application frame"]')).toHaveCount(0);
    const projectAStillRunning = await (await page.request.get(`/api/workspace/projects/${projectA.id}/preview`)).json() as { preview: { sessionId: string; state: string } };
    expect(projectAStillRunning.preview).toMatchObject({ sessionId: before.preview.sessionId, state: "running" });

    await setProjectContext(page, projectA.id);
    const restartResponse = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${projectA.id}/preview/restart`) && response.request().method() === "POST");
    await page.getByRole("region", { name: "KForge Preview Workbench" }).getByRole("button", { name: "Restart", exact: true }).click();
    expect((await restartResponse).status()).toBe(202);
    await expect(page.getByRole("region", { name: "KForge Preview Workbench" }).locator(".kw-preview-status")).toContainText("RUNNING", { timeout: 30_000 });
    const afterRestart = await (await page.request.get(`/api/workspace/projects/${projectA.id}/preview`)).json() as { preview: { sessionId: string; state: string } };
    expect(afterRestart.preview.state).toBe("running");
    expect(afterRestart.preview.sessionId).not.toBe(before.preview.sessionId);

    const visualRoot = path.join(process.cwd(), "verification");
    await mkdir(visualRoot, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: path.join(visualRoot, "preview-workbench-dark-1440x900.png"), fullPage: true });

    await selectExplorerView(page, "System", "Settings");
    await page.getByLabel("Theme").selectOption("light");
    const settingsSaved = page.waitForResponse((response) => response.url().endsWith("/api/workspace/settings") && response.request().method() === "PATCH");
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    expect((await settingsSaved).ok()).toBeTruthy();
    await selectExplorerView(page, "Developer Tools", "Preview");
    await page.getByLabel("Preview viewport").selectOption("mobile");
    await page.screenshot({ path: path.join(visualRoot, "preview-workbench-light-mobile.png"), fullPage: true });

    const axe = await new AxeBuilder({ page }).include(".kw-shell").analyze();
    expect(axe.violations, axe.violations.map((entry) => `${entry.id}: ${entry.help}`).join("\n")).toEqual([]);
    for (const size of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(size);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `Preview shell overflow at ${size.width}x${size.height}`).toBe(0);
    }

    const stopResponse = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${projectA.id}/preview/stop`) && response.request().method() === "POST");
    await page.getByRole("region", { name: "KForge Preview Workbench" }).getByRole("button", { name: "Stop", exact: true }).click();
    expect((await stopResponse).ok()).toBeTruthy();
    await expect(page.getByRole("region", { name: "KForge Preview Workbench" })).toContainText("Preview is stopped");
    await expect(page.locator('iframe[aria-label="Preview application frame"]')).toHaveCount(0);

    await clearProjectContext(page);
    await expect(page.getByText("Developer execution requires explicit project context.", { exact: true })).toBeVisible();
  });
});

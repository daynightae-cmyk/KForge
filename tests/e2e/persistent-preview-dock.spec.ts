import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { selectExplorerView, setProjectContext } from "./helpers/workbench";

test.describe("KForge shell-owned Persistent Preview", () => {
  test.setTimeout(150_000);
  let projectPath = "";
  let projectId = "";

  test.afterEach(async ({ request }) => {
    if (projectId) await request.post(`/api/workspace/projects/${encodeURIComponent(projectId)}/preview/stop`).catch(() => undefined);
    if (projectPath) await rm(projectPath, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
    projectPath = "";
    projectId = "";
  });

  test("keeps one live project session and route context visible across every capability", async ({ page }) => {
    projectPath = await mkdtemp(path.join(os.tmpdir(), "kforge-persistent-preview-"));
    await writeFile(path.join(projectPath, "package.json"), JSON.stringify({
      name: "kforge-persistent-preview-fixture",
      private: true,
      version: "1.0.0",
      scripts: { dev: "node persistent-preview-server.cjs" },
    }, null, 2), "utf8");
    await writeFile(path.join(projectPath, "persistent-preview-server.cjs"), [
      "const http = require('node:http');",
      "const port = Number(process.env.PORT);",
      "const server = http.createServer((request, response) => {",
      " response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });",
      " response.end(`<!doctype html><html lang=\"en\"><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Persistent fixture</title></head><body><main><h1>PERSISTENT_PREVIEW_READY</h1><p id=\"route\">${request.url}</p><a href=\"/quality\">Quality</a></main></body></html>`);",
      "});",
      "server.listen(port, '127.0.0.1', () => console.log(`PERSISTENT_PREVIEW_LISTENING:${port}`));",
    ].join("\n"), "utf8");

    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectPath } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const openedPayload = await opened.json() as { project: { id: string; name: string } };
    projectId = openedPayload.project.id;
    expect((await page.request.post(`/api/workspace/projects/${encodeURIComponent(projectId)}/trust`, { data: { confirmed: true } })).ok()).toBeTruthy();

    const externalRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (/^https?:$/.test(url.protocol) && !["127.0.0.1", "localhost"].includes(url.hostname)) externalRequests.push(request.url());
    });

    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await setProjectContext(page, projectId);
    const dock = page.getByRole("complementary", { name: "Persistent Preview Dock", exact: true });
    await expect(dock).toBeVisible();
    await expect(dock).toContainText(openedPayload.project.name);

    const start = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${projectId}/preview/start`) && response.request().method() === "POST");
    await dock.getByRole("button", { name: "Run", exact: true }).click();
    expect((await start).status()).toBe(202);
    await expect(dock).toContainText("RUNNING", { timeout: 30_000 });
    const persistentFrame = page.frameLocator('iframe[title="Persistent application Preview"]');
    await expect(persistentFrame.locator("#route")).toHaveText("/");

    const before = await (await page.request.get(`/api/workspace/projects/${projectId}/preview`)).json() as { preview: { sessionId: string; pid: number } };
    const address = dock.getByLabel("Persistent Preview address", { exact: true });
    await address.fill("/quality");
    await address.press("Enter");
    await expect(persistentFrame.locator("#route")).toHaveText("/quality");

    for (const [activity, view] of [["AI", "Agents"], ["Online", "Marketplace"], ["Quality", "Problems"], ["Remote / Git", "Git"], ["System", "Settings"]] as const) {
      await selectExplorerView(page, activity, view);
      await expect(dock).toBeVisible();
      await expect(persistentFrame.locator("#route")).toHaveText("/quality");
      const current = await (await page.request.get(`/api/workspace/projects/${projectId}/preview`)).json() as { preview: { sessionId: string; pid: number } };
      expect(current.preview).toMatchObject({ sessionId: before.preview.sessionId, pid: before.preview.pid });
    }

    await dock.getByLabel("Bottom Preview layout", { exact: true }).click();
    await expect(dock).toHaveAttribute("data-layout", "bottom");
    await dock.getByLabel("Minimize persistent Preview", { exact: true }).click();
    await expect(dock).toHaveAttribute("data-minimized", "true");
    await page.reload({ waitUntil: "domcontentloaded" });
    await setProjectContext(page, projectId);
    const restoredDock = page.getByRole("complementary", { name: "Persistent Preview Dock", exact: true });
    await expect(restoredDock).toHaveAttribute("data-layout", "bottom");
    await expect(restoredDock).toHaveAttribute("data-minimized", "true");
    await restoredDock.getByLabel("Restore persistent Preview", { exact: true }).click();
    await expect(page.frameLocator('iframe[title="Persistent application Preview"]').locator("#route")).toHaveText("/quality");

    await restoredDock.getByRole("button", { name: "Open Workbench", exact: true }).click();
    await expect(page.locator(".kw-workbench")).toHaveAttribute("data-workbench-surface", "developer-tools:preview");
    await expect(restoredDock).toContainText("Full Preview Workbench active");
    await expect(page.locator('iframe[title="Persistent application Preview"]')).toHaveCount(0);
    await expect(page.getByRole("region", { name: "KForge Preview Workbench", exact: true })).toContainText("RUNNING");
    await expect(page.getByRole("complementary", { name: "Preview runtime Inspector", exact: true })).toContainText(before.preview.sessionId);

    const axe = await new AxeBuilder({ page }).include(".kw-shell").analyze();
    expect(axe.violations, axe.violations.map((entry) => `${entry.id}: ${entry.help}`).join("\n")).toEqual([]);
    expect(externalRequests).toEqual([]);
  });
});

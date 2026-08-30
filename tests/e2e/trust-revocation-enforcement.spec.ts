import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { selectExplorerView, setProjectContext } from "./helpers/workbench";

test.describe("KForge trust revocation enforcement", () => {
  test.setTimeout(150_000);
  let projectPath = "";
  let projectId = "";

  test.afterEach(async ({ request }) => {
    if (projectId) await request.post(`/api/workspace/projects/${encodeURIComponent(projectId)}/preview/stop`).catch(() => undefined);
    if (projectPath) await rm(projectPath, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
    projectPath = "";
    projectId = "";
  });

  test("persists untrusted first, stops KForge-owned Preview, and blocks future trust-gated execution", async ({ page }) => {
    projectPath = await mkdtemp(path.join(os.tmpdir(), "kforge-revocation-enforcement-"));
    await writeFile(path.join(projectPath, "package.json"), JSON.stringify({
      name: "kforge-revocation-enforcement-fixture",
      private: true,
      version: "1.0.0",
      type: "commonjs",
      scripts: {
        dev: "node preview-server.cjs",
        test: "node -e \"console.log('REVOCATION_TEST_SHOULD_NOT_RUN_AFTER_REVOKE')\"",
      },
    }, null, 2), "utf8");
    await writeFile(path.join(projectPath, "preview-server.cjs"), [
      "const http = require('node:http');",
      "const port = Number(process.env.PORT);",
      "const server = http.createServer((_request, response) => {",
      " response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });",
      " response.end('<main><h1>REVOCATION_PREVIEW_READY</h1></main>');",
      "});",
      "server.listen(port, '127.0.0.1', () => console.log(`REVOCATION_PREVIEW_LISTENING:${port}`));",
    ].join("\n"), "utf8");
    await writeFile(path.join(projectPath, "source.js"), "module.exports = 'unchanged';\n", "utf8");

    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectPath } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = (await opened.json() as { project: { id: string } }).project;
    projectId = project.id;
    expect((await page.request.post(`/api/workspace/projects/${encodeURIComponent(project.id)}/trust`, { data: { confirmed: true } })).ok()).toBeTruthy();

    const sourceBefore = await readFile(path.join(projectPath, "source.js"), "utf8");
    const packageBefore = await readFile(path.join(projectPath, "package.json"), "utf8");

    const started = await page.request.post(`/api/workspace/projects/${encodeURIComponent(project.id)}/preview/start`);
    expect([200, 202]).toContain(started.status());
    let running = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const health = await page.request.post(`/api/workspace/projects/${encodeURIComponent(project.id)}/preview/health`);
      expect(health.ok(), await health.text()).toBeTruthy();
      const payload = await health.json() as { preview: { state: string; health?: { ok?: boolean } } };
      if (payload.preview.state === "running" && payload.preview.health?.ok) { running = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(running).toBe(true);

    const externalRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) externalRequests.push(request.url());
    });

    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await setProjectContext(page, project.id);
    await selectExplorerView(page, "System", "Trust");
    const center = page.getByRole("region", { name: "KForge Trust Center", exact: true });
    await expect(center).toHaveAttribute("data-project-trust", "trusted");

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("stop its active Preview when possible");
      expect(dialog.message()).toContain("cannot be retroactively undone");
      await dialog.accept();
    });
    const revokeResponsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/trust/revoke`) && response.request().method() === "POST");
    await center.getByRole("button", { name: "Revoke project trust", exact: true }).click();
    const revokeResponse = await revokeResponsePromise;
    expect(revokeResponse.ok(), await revokeResponse.text()).toBeTruthy();
    const revoked = await revokeResponse.json() as {
      trust: string;
      teardown: {
        preview: { before: string; after: string; stopError?: string };
        tasks: { alreadyRunning: unknown[]; cancelledBeforeExecution: unknown[] };
        guarantees: { futureTrustGatedRequests: string; alreadyRunningCommands: string; remoteContactByRevocation: boolean };
      };
    };
    expect(revoked.trust).toBe("untrusted");
    expect(revoked.teardown.preview.before).toBe("running");
    expect(revoked.teardown.preview.after).toBe("stopped");
    expect(revoked.teardown.preview.stopError).toBeUndefined();
    expect(revoked.teardown.guarantees).toMatchObject({
      futureTrustGatedRequests: "BLOCKED_UNTIL_RETRUSTED",
      alreadyRunningCommands: "NOT_RETROACTIVELY_UNDONE",
      remoteContactByRevocation: false,
    });

    await expect(center).toHaveAttribute("data-project-trust", "untrusted", { timeout: 30_000 });
    const teardown = center.getByRole("region", { name: "Trust revocation teardown evidence", exact: true });
    await expect(teardown).toBeVisible();
    await expect(teardown).toHaveAttribute("data-revocation-preview-after", "stopped");
    await expect(teardown).toContainText("running → stopped");
    await expect(teardown).toContainText("AUTHORITY_REVOKED");

    const previewAfter = await page.request.get(`/api/workspace/projects/${encodeURIComponent(project.id)}/preview`);
    expect(previewAfter.ok(), await previewAfter.text()).toBeTruthy();
    expect((await previewAfter.json() as { preview: { state: string } }).preview.state).toBe("stopped");

    const blockedAction = await page.request.post(`/api/workspace/projects/${encodeURIComponent(project.id)}/actions`, { data: { action: "test" } });
    expect(blockedAction.status()).toBe(428);
    expect((await blockedAction.json() as { error: string }).error).toMatch(/untrusted/i);

    expect(externalRequests).toEqual([]);
    expect(await readFile(path.join(projectPath, "source.js"), "utf8")).toBe(sourceBefore);
    expect(await readFile(path.join(projectPath, "package.json"), "utf8")).toBe(packageBefore);
  });
});

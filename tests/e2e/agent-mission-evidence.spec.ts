import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView, selectProjectByPath } from "./helpers/workbench";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);
const external = (raw: string) => /^https?:$/i.test(new URL(raw).protocol) && !LOCAL_ORIGINS.has(new URL(raw).origin);

test.describe("KForge agent mission evidence in contextual workbench", () => {
  test.setTimeout(120_000);
  let untrustedFixturePath = "";
  test.afterEach(async () => { if (untrustedFixturePath) await rm(untrustedFixturePath, { recursive: true, force: true, maxRetries: 24, retryDelay: 250 }); untrustedFixturePath = ""; });

  test("enforces trust, starts a typed audit mission, and preserves task evidence across reload", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (external(request.url())) externalRequests.push(request.url()); });
    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();

    untrustedFixturePath = await mkdtemp(path.join(os.tmpdir(), "kforge-agent-untrusted-"));
    await writeFile(path.join(untrustedFixturePath, "package.json"), JSON.stringify({ name: "kforge-agent-untrusted-fixture", private: true, version: "1.0.0" }), "utf8");
    const untrustedOpened = await page.request.post("/api/workspace/projects/open", { data: { path: untrustedFixturePath } });
    const untrusted = (await untrustedOpened.json() as { project: { id: string; trust: string } }).project;
    expect(untrusted.trust).toBe("untrusted");
    const blocked = await page.request.post(`/api/workspace/projects/${untrusted.id}/agent/missions`, { data: { mission: "audit" } });
    expect(blocked.status()).toBe(428);

    const projectPath = path.resolve(process.cwd());
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectPath } });
    const project = (await opened.json() as { project: { id: string } }).project;
    expect((await page.request.post(`/api/workspace/projects/${project.id}/trust`, { data: { confirmed: true } })).ok()).toBeTruthy();

    await openWorkbench(page);
    await selectProjectByPath(page, projectPath);
    await selectExplorerView(page, "AI", "Agents");
    const center = page.locator(".kw-agent-panel");
    await expect(center.getByRole("heading", { name: "KForge Engineer missions", exact: true })).toBeVisible();
    await expect(center).toContainText("Read · Plan · Patch · Verify");
    await expect(center).toContainText(/typecheck|scan|graph/i);

    const missionResponse = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/agent/missions`) && response.request().method() === "POST");
    await center.getByRole("button", { name: "Start mission", exact: true }).click();
    const mission = await missionResponse;
    expect(mission.status()).toBe(202);
    const payload = await mission.json() as { task: { id: string } };
    await expect(center).toContainText(payload.task.id);

    await selectExplorerView(page, "AI", "Tasks");
    await expect(page.locator(".kw-workbench-scroll")).toContainText(payload.task.id, { timeout: 60_000 });
    await expect(page.locator(".kw-workbench-scroll")).toContainText(/agent/i);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByLabel("Project context").selectOption(project.id);
    await selectExplorerView(page, "AI", "Tasks");
    await expect(page.locator(".kw-workbench-scroll")).toContainText(payload.task.id, { timeout: 30_000 });
    expect(externalRequests).toEqual([]);
  });
});

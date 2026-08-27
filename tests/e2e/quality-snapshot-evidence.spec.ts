import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView, selectProjectByPath } from "./helpers/workbench";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);
const external = (raw: string) => /^https?:$/i.test(new URL(raw).protocol) && !LOCAL_ORIGINS.has(new URL(raw).origin);

test.describe("KForge snapshot and recovery evidence", () => {
  test.setTimeout(120_000);
  let projectRoot = "";
  test.afterEach(async () => { if (projectRoot) await rm(projectRoot, { recursive: true, force: true, maxRetries: 24, retryDelay: 250 }); projectRoot = ""; });

  test("creates and restores an explicit local snapshot and keeps adjacent quality surfaces truthful", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (external(request.url())) externalRequests.push(request.url()); });
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "kforge-quality-fixture-"));
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "quality-recovery-fixture", private: true, version: "1.0.0" }), "utf8");
    await writeFile(path.join(projectRoot, "config.txt"), "original local recovery evidence\n", "utf8");
    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectRoot } });
    const project = (await opened.json() as { project: { id: string } }).project;
    expect((await page.request.post(`/api/workspace/projects/${project.id}/trust`, { data: { confirmed: true } })).ok()).toBeTruthy();

    await openWorkbench(page);
    await selectProjectByPath(page, projectRoot);
    await selectExplorerView(page, "Quality", "Snapshots");
    const snapshots = page.locator(".kw-workbench-scroll");
    await snapshots.getByLabel("Files to snapshot").fill("config.txt");
    await snapshots.getByLabel("Snapshot reason").fill("Browser-confirmed local recovery evidence");
    page.once("dialog", (dialog) => dialog.accept());
    const created = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/snapshots`) && response.request().method() === "POST");
    await snapshots.getByRole("button", { name: "Create snapshot", exact: true }).click();
    expect((await created).status()).toBe(201);
    await expect(snapshots).toContainText("Browser-confirmed local recovery evidence");

    await writeFile(path.join(projectRoot, "config.txt"), "changed after local snapshot\n", "utf8");
    page.once("dialog", (dialog) => dialog.accept());
    const restored = page.waitForResponse((response) => /\/snapshots\/[^/]+\/restore$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
    await snapshots.getByRole("button", { name: "Restore snapshot", exact: true }).click();
    expect((await restored).ok()).toBeTruthy();
    await expect.poll(() => readFile(path.join(projectRoot, "config.txt"), "utf8")).toBe("original local recovery evidence\n");
    await expect(snapshots).toContainText(/restored/i);

    await selectExplorerView(page, "Quality", "KForge Sonar");
    await expect(page.locator(".kw-workbench-scroll")).toContainText("Security Tool Manager");
    await expect(page.locator(".kw-workbench-scroll")).toContainText("No tool is downloaded or run silently.");
    await selectExplorerView(page, "Quality", "Solutions");
    await expect(page.locator(".kw-workbench-scroll")).toContainText(/Solutions Engine|No matching scan evidence|Current normalized findings/i);
    await selectExplorerView(page, "Quality", "Documentation");
    await expect(page.locator(".kw-workbench-scroll")).toContainText(/Documentation Audit|No semantic contradictions|documentation/i);
    expect(externalRequests).toEqual([]);
  });
});

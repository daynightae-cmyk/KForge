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

  test("reviews recovery without writes, invalidates stale restore authority, then restores only after fresh explicit review", async ({ page }) => {
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

    const recovery = page.getByRole("region", { name: "KForge Snapshot Recovery", exact: true });
    await expect(recovery).toBeVisible();
    await expect(recovery.getByRole("heading", { name: "Snapshot Recovery Workbench", exact: true })).toBeVisible();
    await recovery.getByLabel("Files to snapshot").fill("config.txt");
    await recovery.getByLabel("Snapshot reason").fill("Browser-confirmed local recovery evidence");
    page.once("dialog", (dialog) => dialog.accept());
    const created = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/snapshots`) && response.request().method() === "POST");
    await recovery.getByRole("button", { name: "Create snapshot", exact: true }).click();
    expect((await created).status()).toBe(201);
    await expect(recovery).toContainText("Browser-confirmed local recovery evidence");
    await expect(recovery).not.toContainText("contentBase64");

    await writeFile(path.join(projectRoot, "config.txt"), "changed after local snapshot\n", "utf8");
    const plan = recovery.getByRole("region", { name: "Restore plan", exact: true });
    await expect(plan).toHaveAttribute("data-review-state", "NOT_REVIEWED");
    await expect(plan).toContainText("RESTORE");
    await expect(recovery.getByRole("button", { name: "Restore reviewed snapshot", exact: true })).toHaveCount(0);

    await recovery.getByRole("button", { name: "Review restore plan", exact: true }).click();
    await expect(plan).toHaveAttribute("data-review-state", "REVIEWED");
    await expect.poll(() => readFile(path.join(projectRoot, "config.txt"), "utf8")).toBe("changed after local snapshot\n");
    await expect(recovery.getByRole("button", { name: "Restore reviewed snapshot", exact: true })).toBeVisible();

    await recovery.getByRole("button", { name: "Refresh snapshots", exact: true }).click();
    await expect(plan).toHaveAttribute("data-review-state", "NOT_REVIEWED");
    await expect(recovery.getByRole("button", { name: "Restore reviewed snapshot", exact: true })).toHaveCount(0);
    await expect.poll(() => readFile(path.join(projectRoot, "config.txt"), "utf8")).toBe("changed after local snapshot\n");

    await recovery.getByRole("button", { name: "Review restore plan", exact: true }).click();
    await expect(plan).toHaveAttribute("data-review-state", "REVIEWED");
    page.once("dialog", (dialog) => dialog.accept());
    const restored = page.waitForResponse((response) => /\/snapshots\/[^/]+\/restore$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
    await recovery.getByRole("button", { name: "Restore reviewed snapshot", exact: true }).click();
    expect((await restored).ok()).toBeTruthy();
    await expect.poll(() => readFile(path.join(projectRoot, "config.txt"), "utf8")).toBe("original local recovery evidence\n");
    const operation = recovery.getByRole("region", { name: "Recovery operation", exact: true });
    await expect(operation).toHaveAttribute("data-recovery-state", "SUCCEEDED");
    await expect(plan).toHaveAttribute("data-review-state", "NOT_REVIEWED");

    await selectExplorerView(page, "Quality", "KForge Sonar");
    await expect(page.locator(".kw-workbench-scroll")).toContainText("Security Tool Manager");
    await expect(page.locator(".kw-workbench-scroll")).toContainText("No tool is downloaded or run silently.");
    await selectExplorerView(page, "Quality", "Solutions");
    const solutions = page.getByRole("region", { name: "KForge Quality Solutions", exact: true });
    await expect(solutions).toBeVisible();
    await expect(solutions.getByRole("heading", { name: "Solutions Triage Workbench", exact: true })).toBeVisible();
    await expect(solutions).toContainText(/No matching findings|Check verified fix/i);
    await selectExplorerView(page, "Quality", "Documentation");
    const documentation = page.getByRole("region", { name: "KForge Documentation Consistency", exact: true });
    await expect(documentation).toBeVisible();
    await expect(documentation.getByRole("heading", { name: "Documentation Consistency Workbench", exact: true })).toBeVisible();
    expect(externalRequests).toEqual([]);
  });
});

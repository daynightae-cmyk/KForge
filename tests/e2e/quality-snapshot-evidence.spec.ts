import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

test.describe("KForge quality and recovery evidence in production", () => {
  test.setTimeout(90_000);
  let projectRoot = "";

  test.afterEach(async () => {
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
    projectRoot = "";
  });

  test("creates and restores an explicit local snapshot while exposing honest quality, security, solution, and documentation surfaces", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });

    projectRoot = await mkdtemp(path.join(os.tmpdir(), "kforge-quality-fixture-"));
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "kforge-quality-fixture", private: true, version: "1.0.0" }), "utf8");
    await writeFile(path.join(projectRoot, "config.txt"), "original local recovery evidence\n", "utf8");

    const settings = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(settings.ok(), await settings.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectRoot } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = (await opened.json() as { project: { id: string } }).project;
    const trusted = await page.request.post(`/api/workspace/projects/${project.id}/trust`, { data: { confirmed: true } });
    expect(trusted.ok(), await trusted.text()).toBeTruthy();

    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    const selectedRow = page.locator(".kf-table tbody tr").filter({ hasText: projectRoot }).first();
    await expect(selectedRow).toBeVisible();
    await selectedRow.locator(".kf-project-cell").click();
    await expect(selectedRow).toHaveClass(/is-active/);

    await page.locator(".kf-nav").getByRole("button", { name: "Snapshots", exact: true }).click();
    const snapshots = page.locator(".kf-active-surface");
    await expect(snapshots.getByRole("heading", { name: "Snapshot & Recovery", exact: true })).toBeVisible();
    await snapshots.getByLabel("Files to snapshot").fill("config.txt");
    await snapshots.getByLabel("Snapshot reason").fill("Browser-confirmed local recovery evidence");
    page.once("dialog", (dialog) => dialog.accept());
    const createResponse = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/snapshots`) && response.request().method() === "POST");
    await snapshots.getByRole("button", { name: "Create snapshot", exact: true }).click();
    expect((await createResponse).ok()).toBeTruthy();
    await expect(snapshots).toContainText("Browser-confirmed local recovery evidence");

    await writeFile(path.join(projectRoot, "config.txt"), "changed after local snapshot\n", "utf8");
    page.once("dialog", (dialog) => dialog.accept());
    const restoreResponse = page.waitForResponse((response) => /\/snapshots\/[^/]+\/restore$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
    await snapshots.getByRole("button", { name: "Restore snapshot", exact: true }).click();
    expect((await restoreResponse).ok()).toBeTruthy();
    await expect.poll(() => readFile(path.join(projectRoot, "config.txt"), "utf8")).toBe("original local recovery evidence\n");
    await expect(snapshots).toContainText(/restored/i);

    await page.locator(".kf-nav").getByRole("button", { name: "KForge Sonar", exact: true }).click();
    const security = page.locator(".kf-active-surface");
    await expect(security).toContainText("Security Tool Manager");
    await expect(security).toContainText("No tool is downloaded or run silently.");
    await expect(security).toContainText("Current normalized security findings");

    await page.locator(".kf-nav").getByRole("button", { name: "Solutions", exact: true }).click();
    const solutions = page.locator(".kf-active-surface");
    await expect(solutions.getByRole("heading", { name: "Solutions Engine", exact: true })).toBeVisible();
    await expect(solutions).toContainText(/verified preview path|No scan evidence is loaded|current evidence contains no automatic patch/i);

    await page.locator(".kf-nav").getByRole("button", { name: "Documentation", exact: true }).click();
    const documentation = page.locator(".kf-active-surface");
    await expect(documentation.getByRole("heading", { name: "Documentation Audit V2", exact: true })).toBeVisible();
    await expect(documentation).toContainText(/local documentation evidence|No semantic contradictions|Evidence:/i);

    expect(externalRequests, `Unexpected external requests in quality and recovery flows:\n${externalRequests.join("\n")}`).toEqual([]);
  });
});

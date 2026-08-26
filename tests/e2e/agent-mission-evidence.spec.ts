import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

test.describe("KForge agent mission evidence in production", () => {
  test.setTimeout(90_000);
  let untrustedFixturePath = "";

  test.afterEach(async () => {
    if (untrustedFixturePath) await rm(untrustedFixturePath, { recursive: true, force: true, maxRetries: 24, retryDelay: 250 });
    untrustedFixturePath = "";
  });

  test.beforeEach(async ({ page }) => {
    const settings = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(settings.ok(), await settings.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
  });

  test("enforces project trust, records a typed audit mission, and keeps its evidence after reload", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });

    untrustedFixturePath = await mkdtemp(path.join(os.tmpdir(), "kforge-agent-untrusted-"));
    await writeFile(path.join(untrustedFixturePath, "package.json"), JSON.stringify({ name: "kforge-agent-untrusted-fixture", private: true, version: "1.0.0" }), "utf8");
    const untrustedOpened = await page.request.post("/api/workspace/projects/open", { data: { path: untrustedFixturePath } });
    expect(untrustedOpened.ok(), await untrustedOpened.text()).toBeTruthy();
    const untrustedProject = (await untrustedOpened.json() as { project: { id: string; trust: string } }).project;
    expect(untrustedProject.trust).toBe("untrusted");

    const blocked = await page.request.post(`/api/workspace/projects/${untrustedProject.id}/agent/missions`, { data: { mission: "audit" } });
    expect(blocked.status()).toBe(428);
    await expect(blocked.json()).resolves.toMatchObject({ trust: "untrusted", permission: "ask", error: expect.stringMatching(/UNTRUSTED PROJECT/) });

    const selectedOpened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(selectedOpened.ok(), await selectedOpened.text()).toBeTruthy();
    const project = (await selectedOpened.json() as { project: { id: string } }).project;
    const trusted = await page.request.post(`/api/workspace/projects/${project.id}/trust`, { data: { confirmed: true } });
    expect(trusted.ok(), await trusted.text()).toBeTruthy();

    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    const selectedRow = page.locator(".kf-table tbody tr").filter({ hasText: path.resolve(process.cwd()) }).first();
    await expect(selectedRow).toBeVisible();
    await selectedRow.locator(".kf-project-cell").click();
    await expect(selectedRow).toHaveClass(/is-active/);
    await page.locator(".kf-nav").getByRole("button", { name: "Agents", exact: true }).click();
    const agentCenter = page.locator(".kf-active-surface");
    await expect(agentCenter.getByRole("heading", { name: "KForge Engineer missions", exact: true })).toBeVisible();
    await expect(agentCenter).toContainText("Agent permissions");
    await expect(agentCenter).toContainText("Read · Plan · Patch · Verify");

    const started = page.waitForResponse((response) => /\/api\/workspace\/projects\/[^/]+\/agent\/missions$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
    await agentCenter.getByRole("button", { name: "Start mission", exact: true }).click();
    const startedResponse = await started;
    expect(startedResponse.url()).toContain(`/api/workspace/projects/${project.id}/agent/missions`);
    expect(startedResponse.status()).toBe(202);
    await expect(agentCenter).toContainText(/Mission task .* started\. Open Tasks to follow its event log\./);

    await page.locator(".kf-nav").getByRole("button", { name: "Tasks", exact: true }).click();
    const taskCenter = page.locator(".kf-active-surface");
    await expect(taskCenter.getByRole("heading", { name: "Task Center v2", exact: true })).toBeVisible();
    await expect(taskCenter).toContainText(/agent · (success|error|blocked|running)/i, { timeout: 60_000 });
    await expect(taskCenter).toContainText(/All planned mission steps completed with recorded evidence|Mission audit (succeeded|blocked|failed)/i, { timeout: 60_000 });
    await expect(taskCenter).toContainText(/Summarize evidence|Scan source and project profile/i);

    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.locator(".kf-nav").getByRole("button", { name: "Workspace", exact: true }).click();
    const reselectedRow = page.locator(".kf-table tbody tr").filter({ hasText: path.resolve(process.cwd()) }).first();
    await expect(reselectedRow).toBeVisible();
    await reselectedRow.locator(".kf-project-cell").click();
    await expect(reselectedRow).toHaveClass(/is-active/);
    await page.locator(".kf-nav").getByRole("button", { name: "Tasks", exact: true }).click();
    await expect(page.locator(".kf-active-surface")).toContainText(/agent · (success|error|blocked|running)/i);
    expect(externalRequests, `Unexpected external requests in agent mission flow:\n${externalRequests.join("\n")}`).toEqual([]);
  });
});

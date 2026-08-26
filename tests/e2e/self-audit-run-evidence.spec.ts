import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

test.describe("KForge Self Audit persisted run evidence in production", () => {
  test.setTimeout(360_000);

  test.beforeEach(async () => {
    const entries = await readdir(process.cwd(), { withFileTypes: true });
    await Promise.all(entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("kforge-cloud-route-")).map((entry) => rm(path.join(process.cwd(), entry.name), { recursive: true, force: true })));
  });

  test("runs the explicit observational KForge-on-KForge sequence and persists a restart boundary without source mutation", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });

    const settings = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(settings.ok(), await settings.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = (await opened.json() as { project: { id: string } }).project;
    const trusted = await page.request.post(`/api/workspace/projects/${project.id}/trust`, { data: { confirmed: true } });
    expect(trusted.ok(), await trusted.text()).toBeTruthy();

    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    const selectedRow = page.locator(".kf-table tbody tr").filter({ hasText: path.resolve(process.cwd()) }).first();
    await expect(selectedRow).toBeVisible();
    await selectedRow.locator(".kf-project-cell").click();
    await expect(selectedRow).toHaveClass(/is-active/);
    await page.locator(".kf-nav").getByRole("button", { name: "Self Audit", exact: true }).click();
    const audit = page.locator('.kf-active-surface[aria-label="Self Audit capability"]');
    await expect(audit.getByRole("heading", { name: "KForge Self Audit", exact: true })).toBeVisible();
    await expect(audit).toContainText("It never applies a fix, starts Preview, or contacts a remote provider implicitly.");

    const persisted = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/self-audit`) && response.request().method() === "POST", { timeout: 300_000 });
    await audit.getByRole("button", { name: "Run KForge Self Audit", exact: true }).click();
    expect((await persisted).status()).toBe(202);
    await expect(audit).toContainText("WAITING_RESTART", { timeout: 30_000 });
    await expect(audit).toContainText("ObservationalYES");
    await expect(audit).toContainText("Source mutationNONE");
    await expect(audit).toContainText("Persistence and restart boundary");
    expect(externalRequests, `Unexpected external requests in Self Audit run:\n${externalRequests.join("\n")}`).toEqual([]);
  });
});

import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView, selectProjectByPath } from "./helpers/workbench";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);
const external = (raw: string) => /^https?:$/i.test(new URL(raw).protocol) && !LOCAL_ORIGINS.has(new URL(raw).origin);

test.describe("KForge Self Audit persisted evidence", () => {
  test.setTimeout(360_000);
  test.beforeEach(async () => {
    const entries = await readdir(process.cwd(), { withFileTypes: true });
    await Promise.all(entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("kforge-cloud-route-")).map((entry) => rm(path.join(process.cwd(), entry.name), { recursive: true, force: true })));
  });

  test("runs the explicit observational sequence and preserves the restart boundary without source mutation", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (external(request.url())) externalRequests.push(request.url()); });
    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    const projectPath = path.resolve(process.cwd());
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectPath } });
    const project = (await opened.json() as { project: { id: string } }).project;
    expect((await page.request.post(`/api/workspace/projects/${project.id}/trust`, { data: { confirmed: true } })).ok()).toBeTruthy();

    await openWorkbench(page);
    await selectProjectByPath(page, projectPath);
    await selectExplorerView(page, "System", "Self Audit");
    const audit = page.locator(".kw-self-audit");
    await expect(audit).toContainText("observational");
    await expect(audit).toContainText("Source mutation is NONE");
    const persisted = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/self-audit`) && response.request().method() === "POST", { timeout: 300_000 });
    await audit.getByRole("button", { name: "Run KForge Self Audit", exact: true }).click();
    expect((await persisted).status()).toBe(202);
    await expect(audit).toContainText(/WAITING_RESTART|restart boundary/i, { timeout: 30_000 });
    const rawRecord = audit.getByText("Advanced · Raw persisted Self Audit record", { exact: true }).locator("..").locator("pre");
    await expect(rawRecord).toContainText(/observational|sourceMutation|WAITING_RESTART/i);
    expect(externalRequests).toEqual([]);
  });
});

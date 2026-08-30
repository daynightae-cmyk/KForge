import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { selectExplorerView, setProjectContext } from "./helpers/workbench";

const execFile = promisify(execFileCallback);
const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

test.describe("KForge persistent execution evidence ledger", () => {
  test.setTimeout(120_000);
  let repository = "";

  test.afterEach(async () => {
    if (repository) await rm(repository, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
    repository = "";
  });

  test("persists successful and blocked action transparency without duplicating raw output or contacting a remote", async ({ page }) => {
    repository = await mkdtemp(path.join(os.tmpdir(), "kforge-execution-ledger-"));
    await execFile("git", ["init"], { cwd: repository, windowsHide: true });
    await execFile("git", ["config", "user.name", "KForge Ledger Acceptance"], { cwd: repository, windowsHide: true });
    await execFile("git", ["config", "user.email", "ledger@kforge.local"], { cwd: repository, windowsHide: true });
    await writeFile(path.join(repository, "package.json"), JSON.stringify({ name: "kforge-ledger-fixture", private: true, scripts: { typecheck: "node typecheck.js" } }), "utf8");
    await writeFile(path.join(repository, "typecheck.js"), "console.log('LEDGER_RAW_OUTPUT_SENTINEL');\n", "utf8");
    await execFile("git", ["add", "."], { cwd: repository, windowsHide: true });
    await execFile("git", ["commit", "-m", "ledger fixture"], { cwd: repository, windowsHide: true });

    const externalRequests: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });

    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: repository } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = (await opened.json() as { project: { id: string } }).project;
    expect((await page.request.post(`/api/workspace/projects/${encodeURIComponent(project.id)}/trust`, { data: { confirmed: true } })).ok()).toBeTruthy();

    const typecheck = await page.request.post(`/api/workspace/projects/${encodeURIComponent(project.id)}/actions`, { data: { action: "typecheck", confirmed: false } });
    expect(typecheck.ok(), await typecheck.text()).toBeTruthy();
    const typecheckBody = await typecheck.json() as { output: string; transparency: { result: string } };
    expect(typecheckBody.output).toContain("LEDGER_RAW_OUTPUT_SENTINEL");
    expect(typecheckBody.transparency.result).toBe("SUCCEEDED");

    const blockedPush = await page.request.post(`/api/workspace/projects/${encodeURIComponent(project.id)}/actions`, { data: { action: "push", confirmed: true } });
    expect(blockedPush.status()).toBeGreaterThanOrEqual(400);
    const blockedBody = await blockedPush.json() as { transparency: { result: string; network: string; confirmation: string } };
    expect(blockedBody.transparency).toMatchObject({ result: "BLOCKED", network: "REQUIRED", confirmation: "CONFIRMED" });

    const ledgerResponse = await page.request.get(`/api/workspace/projects/${encodeURIComponent(project.id)}/execution-ledger`);
    expect(ledgerResponse.ok(), await ledgerResponse.text()).toBeTruthy();
    const ledgerText = await ledgerResponse.text();
    expect(ledgerText).not.toContain("LEDGER_RAW_OUTPUT_SENTINEL");
    const ledger = JSON.parse(ledgerText) as { store: { state: string }; records: Array<{ action: string; persisted: boolean; transparency: { execution: string; network: string; confirmation: string; result: string } }> };
    expect(ledger.store.state).toBe("READY");
    expect(ledger.records.find((entry) => entry.action === "typecheck")).toMatchObject({ persisted: true, transparency: { execution: "LOCAL", network: "NOT_REQUIRED", confirmation: "NOT_REQUIRED", result: "SUCCEEDED" } });
    expect(ledger.records.find((entry) => entry.action === "push")).toMatchObject({ persisted: true, transparency: { execution: "HYBRID", network: "REQUIRED", confirmation: "CONFIRMED", result: "BLOCKED" } });

    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".kw-shell")).toBeVisible({ timeout: 60_000 });
    await setProjectContext(page, project.id);
    await selectExplorerView(page, "Developer Tools", "Logs");
    const logs = page.getByRole("region", { name: "KForge Developer Logs", exact: true });
    await expect(logs).toBeVisible();
    await expect(logs.getByRole("region", { name: "Persisted execution ledger", exact: true })).toBeVisible();
    await expect(logs.locator('[data-ledger-action="typecheck"]')).toContainText("SUCCEEDED");
    await expect(logs.locator('[data-ledger-action="push"]')).toContainText("BLOCKED");
    await logs.locator('[data-ledger-action="push"] button').click();
    const selected = logs.getByRole("complementary", { name: "Selected execution evidence", exact: true });
    await expect(selected).toContainText("HYBRID");
    await expect(selected).toContainText("REQUIRED");
    await expect(selected).toContainText("CONFIRMED");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".kw-shell")).toBeVisible({ timeout: 60_000 });
    await setProjectContext(page, project.id);
    await selectExplorerView(page, "Developer Tools", "Logs");
    const reloadedLogs = page.getByRole("region", { name: "KForge Developer Logs", exact: true });
    await expect(reloadedLogs).toContainText("Persistent execution ledger", { timeout: 30_000 });
    await expect(reloadedLogs.locator('[data-ledger-action="typecheck"]')).toContainText("SUCCEEDED");
    await expect(reloadedLogs.locator('[data-ledger-action="push"]')).toContainText("BLOCKED");
    expect(externalRequests, `Unexpected external requests:\n${externalRequests.join("\n")}`).toEqual([]);
  });
});

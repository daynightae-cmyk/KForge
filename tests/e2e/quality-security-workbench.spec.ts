import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView, setProjectContext } from "./helpers/workbench";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);
const external = (raw: string) => /^https?:$/i.test(new URL(raw).protocol) && !LOCAL_ORIGINS.has(new URL(raw).origin);

test.describe("KForge specialized quality security evidence", () => {
  test.setTimeout(120_000);
  let projectRoot = "";

  test.afterEach(async ({ page }) => {
    await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } }).catch(() => undefined);
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true, maxRetries: 24, retryDelay: 250 });
    projectRoot = "";
  });

  test("shows real scanner/tool evidence and never runs a network security tool before reviewed disclosure", async ({ page }) => {
    const externalRequests: string[] = [];
    const securityRunRequests: string[] = [];
    page.on("request", (request) => {
      if (external(request.url())) externalRequests.push(request.url());
      if (request.method() === "POST" && /\/security\/tools\/[^/]+\/run$/.test(new URL(request.url()).pathname)) securityRunRequests.push(request.url());
    });

    projectRoot = await mkdtemp(path.join(os.tmpdir(), "kforge-security-fixture-"));
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "security-workbench-fixture", private: true, version: "1.0.0" }), "utf8");
    await writeFile(path.join(projectRoot, "package-lock.json"), JSON.stringify({ name: "security-workbench-fixture", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "security-workbench-fixture", version: "1.0.0" } } }), "utf8");
    await writeFile(path.join(projectRoot, ".env"), "KFORGE_TEST_VALUE=fixture-only\n", "utf8");
    execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
    execFileSync("git", ["add", ".env", "package.json", "package-lock.json"], { cwd: projectRoot, stdio: "ignore" });

    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectRoot } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = (await opened.json() as { project: { id: string } }).project;
    expect((await page.request.post(`/api/workspace/projects/${project.id}/trust`, { data: { confirmed: true } })).ok()).toBeTruthy();

    await openWorkbench(page);
    await setProjectContext(page, project.id);
    await selectExplorerView(page, "Quality", "Security");

    const security = page.getByRole("region", { name: "KForge Quality Security", exact: true });
    await expect(security.getByRole("heading", { name: "Security Evidence Workbench", exact: true })).toBeVisible();
    await expect(security).toContainText("Opening or refreshing this surface never runs a tool or contacts a remote service.");
    await expect(security.getByRole("region", { name: "Security summary", exact: true })).toContainText("OFFLINE");
    await expect(security.getByRole("region", { name: "Normalized security findings", exact: true })).toContainText(/Potentially sensitive file is tracked by Git|\.env/i);

    const npmAudit = security.locator('[data-tool-id="npm-audit"]');
    await expect(npmAudit).toBeVisible();
    await expect(npmAudit).toContainText("AVAILABLE");
    await expect(npmAudit).toContainText("NETWORK_REQUIRED");
    await npmAudit.getByRole("button", { name: "Select npm audit", exact: true }).click();

    const selected = security.getByRole("region", { name: "Selected security tool", exact: true });
    await expect(selected).toContainText("Dependency metadata from package-lock.json is sent to the npm registry");
    const run = selected.getByRole("button", { name: "Run npm audit", exact: true });
    await expect(run).toBeDisabled();
    await selected.getByRole("button", { name: "Review data disclosure", exact: true }).click();
    await expect(security.getByRole("status")).toContainText("No security tool has been run and no remote service has been contacted.");
    await expect(run).toBeDisabled();
    await expect(selected).toContainText(/offline mode blocks this network-required security operation/i);
    expect(securityRunRequests).toEqual([]);
    expect(externalRequests).toEqual([]);

    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "local-first" } })).ok()).toBeTruthy();
    await security.getByRole("button", { name: "Refresh security evidence", exact: true }).click();
    await expect(security.getByRole("region", { name: "Security summary", exact: true })).toContainText("LOCAL-FIRST");
    await npmAudit.getByRole("button", { name: "Select npm audit", exact: true }).click();
    const selectedOnlineOptional = security.getByRole("region", { name: "Selected security tool", exact: true });
    const runAfterModeChange = selectedOnlineOptional.getByRole("button", { name: "Run npm audit", exact: true });
    await expect(runAfterModeChange).toBeDisabled();
    await selectedOnlineOptional.getByRole("button", { name: "Review data disclosure", exact: true }).click();
    await expect(runAfterModeChange).toBeEnabled();

    expect(securityRunRequests, "The acceptance test must not execute npm audit; it only proves authority becomes available after explicit disclosure.").toEqual([]);
    expect(externalRequests, `Security evidence review contacted an external origin:\n${externalRequests.join("\n")}`).toEqual([]);
  });
});

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView, selectProjectByPath } from "./helpers/workbench";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);
const external = (raw: string) => /^https?:$/i.test(new URL(raw).protocol) && !LOCAL_ORIGINS.has(new URL(raw).origin);

async function fileExists(target: string) {
  try { await readFile(target, "utf8"); return true; } catch { return false; }
}

test.describe("KForge quality scan and deterministic solution evidence", () => {
  test.setTimeout(180_000);
  let projectRoot = "";
  test.afterEach(async () => { if (projectRoot) await rm(projectRoot, { recursive: true, force: true, maxRetries: 24, retryDelay: 250 }); projectRoot = ""; });

  test("triages real findings, previews deterministic fixes without writes, then applies only after explicit review", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (external(request.url())) externalRequests.push(request.url()); });
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "kforge-quality-scan-"));
    await mkdir(path.join(projectRoot, "src"));
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "quality-fixture", private: true, version: "1.0.0", scripts: { typecheck: "node -e \"console.log('TYPE_OK')\"", test: "node -e \"console.log('TEST_OK')\"", build: "node -e \"console.log('BUILD_OK')\"" } }), "utf8");
    await writeFile(path.join(projectRoot, ".env"), "PUBLIC_API_URL=https://local.invalid\nSERVICE_TOKEN=\"fixture-secret-value-never-disclosed\"\n", "utf8");
    await writeFile(path.join(projectRoot, "README.md"), "# Fixture\n\nRun `npm run obsolete` before review.\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "placeholder.ts"), "// TODO placeholder implementation\nexport function unfinished() {}\nconst response = {}; // mock placeholder\n", "utf8");

    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectRoot } });
    const project = (await opened.json() as { project: { id: string } }).project;
    expect((await page.request.post(`/api/workspace/projects/${project.id}/trust`, { data: { confirmed: true } })).ok()).toBeTruthy();

    await openWorkbench(page);
    await selectProjectByPath(page, projectRoot);
    await selectExplorerView(page, "Quality", "KForge Sonar");
    const sonar = page.locator(".kw-workbench-scroll");
    const scanStarted = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/tasks`) && response.request().method() === "POST");
    await sonar.getByRole("button", { name: "Run current scan", exact: true }).click();
    expect((await scanStarted).status()).toBe(202);
    await expect(sonar).toContainText("Environment example is missing", { timeout: 90_000 });
    await expect(sonar).toContainText("Hardcoded credential pattern detected");
    await expect(sonar).toContainText("No tool is downloaded or run silently.");

    await selectExplorerView(page, "Quality", "Security");
    await expect(page.locator(".kw-workbench-scroll")).toContainText(/Hardcoded credential pattern detected|UNAVAILABLE|BLOCKED/i);

    await selectExplorerView(page, "Quality", "Problems");
    const problemsWorkbench = page.getByRole("region", { name: "KForge Quality Problems", exact: true });
    await expect(problemsWorkbench).toBeVisible();
    await expect(problemsWorkbench.getByRole("heading", { name: "Problems Triage Workbench", exact: true })).toBeVisible();
    await expect(problemsWorkbench.getByRole("region", { name: "Quality triage summary", exact: true })).toContainText("Total findings");
    const problemFinding = problemsWorkbench.locator(".kw-quality-card").filter({ hasText: "Environment example is missing" });
    await expect(problemFinding).toBeVisible();
    await problemFinding.getByRole("button", { name: "Select finding", exact: true }).click();
    await expect(problemsWorkbench.getByRole("region", { name: "Selected quality finding", exact: true })).toContainText("Environment example is missing");
    await expect(problemsWorkbench.getByRole("button", { name: "Review remediation in Solutions", exact: true })).toBeVisible();

    await selectExplorerView(page, "Quality", "Solutions");
    const solutionsWorkbench = page.getByRole("region", { name: "KForge Quality Solutions", exact: true });
    await expect(solutionsWorkbench).toBeVisible();
    await expect(solutionsWorkbench.getByRole("heading", { name: "Solutions Triage Workbench", exact: true })).toBeVisible();
    const solution = solutionsWorkbench.locator(".kw-quality-card").filter({ hasText: "Environment example is missing" });
    await expect(solution).toBeVisible();
    await solution.getByRole("button", { name: "Select finding", exact: true }).click();
    expect(await fileExists(path.join(projectRoot, ".env.example"))).toBe(false);

    const previewResponse = page.waitForResponse((response) => /\/problems\/[^/]+\/preview$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
    await solutionsWorkbench.getByRole("button", { name: "Check verified fix", exact: true }).click();
    expect((await previewResponse).ok()).toBeTruthy();
    expect(await fileExists(path.join(projectRoot, ".env.example"))).toBe(false);
    const fixEvidence = solutionsWorkbench.getByRole("region", { name: "Verified fix evidence", exact: true });
    await expect(fixEvidence).toHaveAttribute("data-fix-state", "AVAILABLE");
    await expect(fixEvidence).toContainText("create");
    await expect(fixEvidence).toContainText(".env.example");
    await expect(solutionsWorkbench.getByRole("button", { name: "Apply verified fix", exact: true })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    const apply = page.waitForResponse((response) => /\/problems\/[^/]+\/apply$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
    await solutionsWorkbench.getByRole("button", { name: "Apply verified fix", exact: true }).click();
    expect((await apply).ok()).toBeTruthy();
    await expect.poll(() => readFile(path.join(projectRoot, ".env.example"), "utf8")).toBe("PUBLIC_API_URL=\nSERVICE_TOKEN=\n");
    const operation = solutionsWorkbench.getByRole("region", { name: "Verified fix operation", exact: true });
    await expect(operation).toHaveAttribute("data-apply-state", "SUCCEEDED");

    await selectExplorerView(page, "Quality", "Documentation");
    const doc = page.locator(".kw-quality-card").filter({ hasText: "npm run obsolete" }).first();
    await expect(doc).toBeVisible({ timeout: 30_000 });
    page.once("dialog", (dialog) => dialog.accept());
    const docApply = page.waitForResponse((response) => /\/documentation\/[^/]+\/apply$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
    await doc.getByRole("button", { name: "Preview + Apply + Verify", exact: true }).click();
    expect((await docApply).ok()).toBeTruthy();
    await expect.poll(() => readFile(path.join(projectRoot, "README.md"), "utf8")).toContain("npm run test");

    await selectExplorerView(page, "Quality", "Technical Debt");
    await expect(page.locator(".kw-workbench-scroll")).toContainText(/placeholder|Implementation marker|mock/i);
    expect(externalRequests).toEqual([]);
  });
});

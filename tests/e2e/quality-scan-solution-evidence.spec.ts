import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

test.describe("KForge scanned quality and safe solution evidence in production", () => {
  test.setTimeout(120_000);
  let projectRoot = "";

  test.afterEach(async () => {
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true, maxRetries: 24, retryDelay: 250 });
    projectRoot = "";
  });

  test("scans actual local findings, preserves security/tool truth, and applies only the reviewed non-secret environment template", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });

    projectRoot = await mkdtemp(path.join(os.tmpdir(), "kforge-quality-scan-"));
    await mkdir(path.join(projectRoot, "src"));
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({
      name: "kforge-quality-scan-fixture",
      private: true,
      version: "1.0.0",
      scripts: { typecheck: "node -e \"console.log('KFORGE_SCAN_TYPECHECK_OK')\"", test: "node -e \"console.log('KFORGE_SCAN_TEST_OK')\"", build: "node -e \"console.log('KFORGE_SCAN_BUILD_OK')\"" },
    }), "utf8");
    await writeFile(path.join(projectRoot, ".env"), "PUBLIC_API_URL=https://local.invalid\nSERVICE_TOKEN=\"fixture-secret-value-never-disclosed\"\n", "utf8");
    await writeFile(path.join(projectRoot, "README.md"), "# Quality fixture\n\nRun `npm run obsolete` before local review.\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "placeholder.ts"), "// TODO placeholder implementation\nexport function unfinished() {}\nconst response = {}; // mock placeholder\n", "utf8");

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

    await page.locator(".kf-nav").getByRole("button", { name: "KForge Sonar", exact: true }).click();
    const sonar = page.locator('.kf-active-surface[aria-label="KForge Sonar capability"]');
    await expect(sonar.getByRole("heading", { name: /Security Tool Manager/ })).toBeVisible();
    const scanRequest = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/tasks`)
      && response.request().method() === "POST" && response.request().postData()?.includes('"action":"scan"') === true);
    await sonar.getByRole("button", { name: "Run current scan", exact: true }).click();
    expect((await scanRequest).status()).toBe(202);
    await expect(sonar).toContainText("Environment example is missing", { timeout: 60_000 });
    await expect(sonar).toContainText("Hardcoded credential pattern detected");
    await expect(sonar).toContainText("No tool is downloaded or run silently.");

    await page.locator(".kf-nav").getByRole("button", { name: "Security", exact: true }).click();
    const security = page.locator('.kf-active-surface[aria-label="Security capability"]');
    await expect(security).toContainText("KForge will not invent or modify a lockfile for an audit.");
    await expect(security).toContainText(/UNAVAILABLE|BLOCKED/);

    await page.locator(".kf-nav").getByRole("button", { name: "Problems", exact: true }).click();
    const problems = page.locator('.kf-active-surface[aria-label="Problems capability"]');
    await expect(problems.getByRole("heading", { name: "Problems center", exact: true })).toBeVisible();
    await expect(problems).toContainText("Environment example is missing");
    await problems.getByLabel("Filter problems by category").selectOption("completeness");
    await expect(problems).toContainText("Implementation marker found");
    await expect(problems).toContainText("Environment example is missing");
    await problems.getByLabel("Filter problems by category").selectOption("security");
    const secretFinding = problems.locator(".kf-issue").filter({ hasText: "Hardcoded credential pattern detected" });
    await expect(secretFinding.getByRole("button", { name: "Preview + Apply safe template", exact: true })).toHaveCount(0);
    await problems.getByLabel("Filter problems by category").selectOption("all");
    await problems.getByLabel("Search problems").fill("Placeholder implementation marker");
    await expect(problems).toContainText("Placeholder implementation marker");
    await problems.getByLabel("Search problems").fill("");

    await page.locator(".kf-nav").getByRole("button", { name: "Solutions", exact: true }).click();
    const solutions = page.locator('.kf-active-surface[aria-label="Solutions capability"]');
    await expect(solutions.getByRole("heading", { name: "Solutions Engine", exact: true })).toBeVisible();
    await expect(solutions).toContainText("Environment example is missing");
    await expect(solutions).toContainText("deterministic preview path");
    const solutionFinding = solutions.locator(".kf-issue").filter({ hasText: "Environment example is missing" });
    await solutionFinding.locator("summary").click();
    await solutionFinding.getByRole("button", { name: "Open in Problems", exact: true }).click();
    await expect(problems).toBeVisible();

    const environmentFinding = problems.locator(".kf-issue").filter({ hasText: "Environment example is missing" });
    await environmentFinding.locator("summary").click();
    const previewRequest = page.waitForResponse((response) => /\/problems\/[^/]+\/preview$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
    const applyRequest = page.waitForResponse((response) => /\/problems\/[^/]+\/apply$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
    page.once("dialog", (dialog) => dialog.accept());
    await environmentFinding.getByRole("button", { name: "Preview + Apply safe template", exact: true }).click();
    expect((await previewRequest).ok()).toBeTruthy();
    expect((await applyRequest).ok()).toBeTruthy();
    await expect(problems).toContainText("Applied with snapshot");
    await expect.poll(() => readFile(path.join(projectRoot, ".env.example"), "utf8")).toBe("PUBLIC_API_URL=\nSERVICE_TOKEN=\n");

    await page.locator(".kf-nav").getByRole("button", { name: "Documentation", exact: true }).click();
    const documentation = page.locator('.kf-active-surface[aria-label="Documentation capability"]');
    await expect(documentation.getByRole("heading", { name: "Documentation Audit V2", exact: true })).toBeVisible();
    await expect(documentation).toContainText("npm run obsolete");
    const staleCommand = documentation.locator(".kf-issue").filter({ hasText: "npm run obsolete" });
    await staleCommand.locator("summary").click();
    const documentationApply = page.waitForResponse((response) => /\/documentation\/[^/]+\/apply$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
    page.once("dialog", (dialog) => dialog.accept());
    await staleCommand.getByRole("button", { name: "Preview + Apply + Verify", exact: true }).click();
    expect((await documentationApply).ok()).toBeTruthy();
    await expect(documentation).toContainText("Documentation fix applied and re-audited.");
    await expect.poll(() => readFile(path.join(projectRoot, "README.md"), "utf8")).toContain("npm run test");

    await page.locator(".kf-nav").getByRole("button", { name: "Performance", exact: true }).click();
    const performance = page.locator('.kf-active-surface[aria-label="Performance capability"]');
    await expect(performance.getByRole("heading", { name: "Performance Evidence", exact: true })).toBeVisible();
    await expect(performance).toContainText("No matching local scanner evidence was produced by the current scan.");

    await page.locator(".kf-nav").getByRole("button", { name: "Technical debt", exact: true }).click();
    const debt = page.locator('.kf-active-surface[aria-label="Technical debt capability"]');
    await expect(debt.getByRole("heading", { name: "Technical Debt Evidence", exact: true })).toBeVisible();
    await expect(debt).toContainText("Implementation marker found");
    expect(externalRequests, `Unexpected external requests in scanned quality evidence:\n${externalRequests.join("\n")}`).toEqual([]);
  });
});

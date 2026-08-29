import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView, setProjectContext } from "./helpers/workbench";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);
const isExternal = (raw: string) => {
  const url = new URL(raw);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
};

test.describe("KForge specialized technical debt evidence", () => {
  test.setTimeout(120_000);
  let projectRoot = "";

  test.afterEach(async ({ page }) => {
    await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } }).catch(() => undefined);
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true, maxRetries: 24, retryDelay: 250 });
    projectRoot = "";
  });

  test("keeps architecture collection explicit and technical-debt evidence observational", async ({ page }) => {
    const externalRequests: string[] = [];
    const architectureRequests: string[] = [];
    page.on("request", (request) => {
      if (isExternal(request.url())) externalRequests.push(request.url());
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "GET" && /\/projects\/[^/]+\/architecture$/.test(pathname)) architectureRequests.push(request.url());
    });

    projectRoot = await mkdtemp(path.join(os.tmpdir(), "kforge-technical-debt-fixture-"));
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "technical-debt-workbench-fixture", private: true, version: "1.0.0" }, null, 2), "utf8");
    await writeFile(path.join(projectRoot, "src", "a.ts"), 'import { b } from "./b"; export const a = b + 1;\n', "utf8");
    await writeFile(path.join(projectRoot, "src", "b.ts"), 'import { a } from "./a"; export const b = a + 1;\n', "utf8");
    execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
    execFileSync("git", ["add", "package.json", "src/a.ts", "src/b.ts"], { cwd: projectRoot, stdio: "ignore" });

    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectRoot } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = (await opened.json() as { project: { id: string } }).project;
    expect((await page.request.post(`/api/workspace/projects/${project.id}/trust`, { data: { confirmed: true } })).ok()).toBeTruthy();

    const originalA = await readFile(path.join(projectRoot, "src", "a.ts"), "utf8");
    const originalB = await readFile(path.join(projectRoot, "src", "b.ts"), "utf8");

    await openWorkbench(page);
    await setProjectContext(page, project.id);
    await selectExplorerView(page, "Quality", "Technical Debt");

    const debt = page.getByRole("region", { name: "KForge Quality Technical Debt", exact: true });
    await expect(debt.getByRole("heading", { name: "Technical Debt Evidence Workbench", exact: true })).toBeVisible();
    await expect(debt).toContainText("KForge does not invent a debt score, engineering-hour estimate, monetary cost, or remediation deadline.");
    await expect(debt.getByRole("region", { name: "Technical debt evidence summary", exact: true })).toContainText("ARCHITECTURE_NOT_COLLECTED");
    expect(architectureRequests, "Opening Technical Debt must not start hidden architecture graph analysis.").toEqual([]);

    const architecture = debt.getByRole("region", { name: "Architecture debt evidence", exact: true });
    await expect(architecture).toContainText("Architecture debt evidence not collected");
    await architecture.getByRole("button", { name: "Collect architecture debt evidence", exact: true }).click();
    await expect(architecture).toContainText("Direct cycles");
    await expect(architecture).toContainText("Dependency cycles");
    await expect(debt.getByRole("status")).toContainText("No debt score, remediation time, or cost was synthesized.");
    expect(architectureRequests).toHaveLength(1);

    await debt.getByRole("button", { name: "Refresh debt evidence", exact: true }).click();
    await expect(architecture).toContainText("Architecture debt evidence not collected");
    expect(architectureRequests, "Refresh must not silently recollect architecture evidence.").toHaveLength(1);

    expect(await readFile(path.join(projectRoot, "src", "a.ts"), "utf8")).toBe(originalA);
    expect(await readFile(path.join(projectRoot, "src", "b.ts"), "utf8")).toBe(originalB);
    expect(externalRequests, `Technical Debt contacted an external origin:\n${externalRequests.join("\n")}`).toEqual([]);
  });
});

import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView, selectProjectByPath } from "./helpers/workbench";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);
function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

test.describe("KForge release evidence in contextual workbench", () => {
  test.setTimeout(300_000);

  test("keeps release preparation, local artifacts, CI identity and remote evidence independent without release mutation", async ({ page }) => {
    const projectPath = path.resolve(process.cwd());
    const externalRequests: string[] = [];
    const releaseMutationRequests: string[] = [];
    page.on("request", (request) => {
      if (isExternalHttpRequest(request.url())) externalRequests.push(request.url());
      const pathname = new URL(request.url()).pathname;
      if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method()) && /\/release(?:\/|$)/.test(pathname) && !pathname.endsWith("/release-gate")) releaseMutationRequests.push(`${request.method()} ${pathname}`);
    });

    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectPath } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = (await opened.json() as { project: { id: string } }).project;
    expect((await page.request.post(`/api/workspace/projects/${project.id}/trust`, { data: { confirmed: true } })).ok()).toBeTruthy();
    const headBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectPath, encoding: "utf8" }).trim();

    const preparation = await page.request.get(`/api/workspace/projects/${encodeURIComponent(project.id)}/release/preparation`);
    expect(preparation.ok(), await preparation.text()).toBeTruthy();
    const prep = await preparation.json() as { preparation: { localEvidence: Record<string, { state: string; evidence?: string[] }> } };
    expect(prep.preparation.localEvidence).toMatchObject({
      DESKTOP: { state: expect.stringMatching(/READY|UNAVAILABLE|ERROR/) },
      WINDOWS_PACKAGE: { state: expect.stringMatching(/READY|READY_WITH_WARNINGS|UNAVAILABLE|ERROR/) },
      INSTALLER: { state: expect.stringMatching(/READY|READY_WITH_WARNINGS|UNAVAILABLE|ERROR/) },
    });

    await openWorkbench(page);
    await selectProjectByPath(page, projectPath);

    await selectExplorerView(page, "Release", "Release Preparation");
    let center = page.getByRole("region", { name: "KForge Release and Distribution Center", exact: true });
    await expect(center.getByRole("heading", { name: "Release & Distribution Center 2.0", exact: true })).toBeVisible();
    await expect(center.getByRole("region", { name: "Release preparation summary", exact: true })).toBeVisible();
    await expect(center.getByRole("region", { name: "Release notes proposal", exact: true })).toContainText("PREVIEW_ONLY");
    await expect(center.getByRole("region", { name: "Local release verification evidence", exact: true })).toContainText("CI artifact identity");
    expect(await page.locator(".kw-workbench-scroll pre").evaluateAll((nodes) => nodes.every((node) => Boolean(node.closest("details")))), "Raw release JSON must remain secondary inside Advanced/Domain details.").toBeTruthy();

    await selectExplorerView(page, "Release", "Artifacts");
    center = page.getByRole("region", { name: "KForge Release and Distribution Center", exact: true });
    const inventory = center.getByRole("region", { name: "Artifact evidence inventory", exact: true });
    await expect(inventory.getByRole("heading", { name: "Artifact Evidence Inventory", exact: true })).toBeVisible();
    await expect(inventory).toContainText("CI artifact identity");
    await expect(inventory).toContainText(/PRESENCE_ONLY|No local artifact directory detected/);
    await expect(inventory).toContainText(/NOT_MEASURED|Verification records/);

    await selectExplorerView(page, "Release", "Versioning");
    center = page.getByRole("region", { name: "KForge Release and Distribution Center", exact: true });
    const versioning = center.getByRole("region", { name: "Versioning readiness workspace", exact: true });
    await expect(versioning.getByRole("heading", { name: "Versioning Readiness", exact: true })).toBeVisible();
    await expect(versioning).toContainText("No version, tag, commit, branch, push, GitHub Release, or remote registry state is modified.");
    await expect(versioning.getByRole("region", { name: "Distribution readiness evidence", exact: true })).toContainText("SOURCE / LOCAL / PREVIEW / DESKTOP / WINDOWS_PACKAGE / INSTALLER / GITHUB / CI / REMOTE");

    await selectExplorerView(page, "Release", "Release Gate");
    const response = page.waitForResponse((entry) => entry.url().endsWith(`/api/workspace/projects/${project.id}/release-gate`) && entry.request().method() === "POST", { timeout: 240_000 });
    await page.getByRole("button", { name: "Run Release Gate", exact: true }).click();
    const gate = await response;
    expect([200, 422]).toContain(gate.status());
    const grid = page.locator(".kw-release-grid");
    await expect(grid).toBeVisible({ timeout: 30_000 });
    for (const domain of ["SOURCE", "LOCAL", "PREVIEW", "DESKTOP", "WINDOWS_PACKAGE", "INSTALLER", "GITHUB", "CI", "REMOTE"]) await expect(grid).toContainText(domain);
    await expect(grid.locator("article")).toHaveCount(9);

    const headAfter = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectPath, encoding: "utf8" }).trim();
    expect(headAfter).toBe(headBefore);
    expect(releaseMutationRequests, `Unexpected release mutation request(s):\n${releaseMutationRequests.join("\n")}`).toEqual([]);
    expect(externalRequests, `Release evidence contacted an external origin in Offline Mode:\n${externalRequests.join("\n")}`).toEqual([]);
  });
});

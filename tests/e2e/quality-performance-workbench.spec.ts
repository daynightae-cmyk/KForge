import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView, setProjectContext } from "./helpers/workbench";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);
const isExternal = (raw: string) => {
  const url = new URL(raw);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
};

test.describe("KForge specialized quality performance evidence", () => {
  test.setTimeout(120_000);
  let projectRoot = "";

  test.afterEach(async ({ page }) => {
    await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } }).catch(() => undefined);
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true, maxRetries: 24, retryDelay: 250 });
    projectRoot = "";
  });

  test("keeps graph collection explicit, invalidates stale cache-clear authority, and clears only reviewed local cache", async ({ page }) => {
    const externalRequests: string[] = [];
    const graphRequests: string[] = [];
    const clearRequests: string[] = [];
    page.on("request", (request) => {
      if (isExternal(request.url())) externalRequests.push(request.url());
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "GET" && /\/projects\/[^/]+\/graph$/.test(pathname)) graphRequests.push(request.url());
      if (request.method() === "POST" && /\/projects\/[^/]+\/cache\/clear$/.test(pathname)) clearRequests.push(request.url());
    });

    projectRoot = await mkdtemp(path.join(os.tmpdir(), "kforge-performance-fixture-"));
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "performance-workbench-fixture", private: true, version: "1.0.0" }, null, 2), "utf8");
    await writeFile(path.join(projectRoot, "src", "a.ts"), "export const value = 1;\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "b.ts"), 'import { value } from "./a"; export const next = value + 1;\n', "utf8");
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
    await selectExplorerView(page, "Quality", "Performance");

    const performance = page.getByRole("region", { name: "KForge Quality Performance", exact: true });
    await expect(performance.getByRole("heading", { name: "Performance Evidence Workbench", exact: true })).toBeVisible();
    await expect(performance).toContainText("Opening this surface does not run a benchmark or build the project graph.");
    await expect(performance.getByRole("region", { name: "Performance strategy summary", exact: true })).toContainText("SMALL");
    await expect(performance.getByRole("region", { name: "Bounded analysis policy", exact: true })).toContainText("File discovery");
    expect(graphRequests, "Opening Performance must not start hidden graph indexing.").toEqual([]);

    const graphRegion = performance.getByRole("region", { name: "Graph performance evidence", exact: true });
    await expect(graphRegion).toContainText("Graph evidence not collected in this session");
    await graphRegion.getByRole("button", { name: "Collect graph evidence", exact: true }).click();
    await expect(graphRegion).toContainText(/Coverage|Graph summary/);
    await expect(performance.getByRole("status")).toContainText("No synthetic benchmark was generated.");
    expect(graphRequests).toHaveLength(1);

    const cache = performance.getByRole("region", { name: "Local analysis cache", exact: true });
    await expect(cache).toContainText(/graph/i);
    const clear = cache.getByRole("button", { name: "Clear local analysis cache", exact: true });
    await expect(clear).toBeDisabled();
    await cache.getByRole("button", { name: "Review cache clear", exact: true }).click();
    await expect(clear).toBeEnabled();
    await expect(performance.getByRole("status")).toContainText("No cache entry or source file has been changed.");

    await performance.getByRole("button", { name: "Refresh performance evidence", exact: true }).click();
    await expect(clear).toBeDisabled();
    expect(clearRequests, "Refresh must invalidate clear authority without mutating cache.").toEqual([]);

    await cache.getByRole("button", { name: "Review cache clear", exact: true }).click();
    await expect(clear).toBeEnabled();
    page.once("dialog", async (dialog) => dialog.accept());
    await clear.click();
    await expect(performance.getByRole("status")).toContainText("CACHE_CLEARED");
    expect(clearRequests).toHaveLength(1);
    await expect(graphRegion).toContainText("Graph evidence not collected in this session");

    const cacheResponse = await page.request.get(`/api/workspace/projects/${project.id}/cache`);
    expect(cacheResponse.ok(), await cacheResponse.text()).toBeTruthy();
    expect((await cacheResponse.json() as { entries: unknown[] }).entries).toEqual([]);
    expect(await readFile(path.join(projectRoot, "src", "a.ts"), "utf8")).toBe(originalA);
    expect(await readFile(path.join(projectRoot, "src", "b.ts"), "utf8")).toBe(originalB);
    expect(externalRequests, `Performance evidence contacted an external origin:\n${externalRequests.join("\n")}`).toEqual([]);
  });
});

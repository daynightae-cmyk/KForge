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

test.describe("KForge System Storage Center", () => {
  test.setTimeout(120_000);
  let projectRoot = "";

  test.afterEach(async () => {
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true, maxRetries: 24, retryDelay: 250 });
    projectRoot = "";
  });

  test("reviews without mutation, rejects stale clear authority, then clears only fresh reviewed in-memory cache", async ({ page }) => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "kforge-storage-center-"));
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "package.json"), JSON.stringify({ name: "storage-center-fixture", private: true, version: "1.0.0" }, null, 2), "utf8");
    await writeFile(path.join(projectRoot, "src", "a.ts"), "export const storageFixture = 1;\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "b.ts"), 'import { storageFixture } from "./a"; export const value = storageFixture + 1;\n', "utf8");

    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectRoot } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = (await opened.json() as { project: { id: string } }).project;
    expect((await page.request.post(`/api/workspace/projects/${project.id}/trust`, { data: { confirmed: true } })).ok()).toBeTruthy();

    const graph = await page.request.get(`/api/workspace/projects/${project.id}/graph`);
    expect(graph.ok(), await graph.text()).toBeTruthy();
    const initialCacheResponse = await page.request.get(`/api/workspace/projects/${project.id}/cache`);
    expect(initialCacheResponse.ok(), await initialCacheResponse.text()).toBeTruthy();
    const initialCache = (await initialCacheResponse.json() as { entries: Array<{ key: string; hits: number }> }).entries;
    expect(initialCache.length).toBeGreaterThan(0);

    const sourceA = await readFile(path.join(projectRoot, "src", "a.ts"), "utf8");
    const sourceB = await readFile(path.join(projectRoot, "src", "b.ts"), "utf8");
    const packageJson = await readFile(path.join(projectRoot, "package.json"), "utf8");

    const externalRequests: string[] = [];
    const clearRequests: string[] = [];
    page.on("request", (request) => {
      if (isExternal(request.url())) externalRequests.push(request.url());
      const pathname = new URL(request.url()).pathname;
      if (request.method() === "POST" && /\/projects\/[^/]+\/cache\/clear$/.test(pathname)) clearRequests.push(request.url());
    });

    await openWorkbench(page);
    await setProjectContext(page, project.id);
    await selectExplorerView(page, "System", "Storage");

    const storage = page.getByRole("region", { name: "KForge Storage Center", exact: true });
    await expect(storage).toBeVisible();
    await expect(storage.getByRole("heading", { name: "Storage Center", exact: true })).toBeVisible();
    await expect(storage).toContainText("in-memory cache registry");
    await expect(storage).toContainText("does not invent disk usage");
    await expect(storage.getByRole("region", { name: "Storage scope contract", exact: true })).toContainText("does not delete source files");
    await expect(storage.getByRole("region", { name: "Analysis cache inventory", exact: true })).toContainText(/graph/i);
    await expect(storage).toHaveAttribute("data-review-state", "NOT_REVIEWED");

    const review = storage.getByRole("button", { name: "Review current cache clear", exact: true });
    const clear = storage.getByRole("button", { name: "Clear reviewed cache", exact: true });
    await expect(clear).toBeDisabled();
    await review.click();
    await expect(storage).toHaveAttribute("data-review-state", "REVIEWED");
    await expect(clear).toBeEnabled();
    await expect(storage.getByRole("status")).toContainText("CLEAR_PLAN_REVIEWED");
    expect(clearRequests).toEqual([]);

    const afterReviewResponse = await page.request.get(`/api/workspace/projects/${project.id}/cache`);
    const afterReview = (await afterReviewResponse.json() as { entries: Array<{ key: string; hits: number }> }).entries;
    expect(afterReview).toEqual(initialCache);

    const graphHit = await page.request.get(`/api/workspace/projects/${project.id}/graph`);
    expect(graphHit.ok(), await graphHit.text()).toBeTruthy();
    await clear.click();
    await expect(storage).toHaveAttribute("data-review-state", "NOT_REVIEWED");
    await expect(storage.getByRole("status")).toContainText("STALE_CLEAR_REVIEW");
    expect(clearRequests, "A stale review must be rejected before the mutating cache-clear endpoint.").toEqual([]);

    const staleCacheResponse = await page.request.get(`/api/workspace/projects/${project.id}/cache`);
    const staleCache = (await staleCacheResponse.json() as { entries: Array<{ key: string; hits: number }> }).entries;
    expect(staleCache.length).toBeGreaterThan(0);
    expect(staleCache.some((entry) => entry.hits > (initialCache.find((initial) => initial.key === entry.key)?.hits || 0))).toBeTruthy();

    await review.click();
    await expect(storage).toHaveAttribute("data-review-state", "REVIEWED");
    page.once("dialog", async (dialog) => dialog.accept());
    await clear.click();
    await expect(storage.getByRole("status")).toContainText("CACHE_CLEAR_COMPLETED");
    await expect(storage).toHaveAttribute("data-review-state", "NOT_REVIEWED");
    await expect(storage).toHaveAttribute("data-cache-count", "0");
    expect(clearRequests).toHaveLength(1);

    const finalCacheResponse = await page.request.get(`/api/workspace/projects/${project.id}/cache`);
    expect((await finalCacheResponse.json() as { entries: unknown[] }).entries).toEqual([]);
    expect(await readFile(path.join(projectRoot, "src", "a.ts"), "utf8")).toBe(sourceA);
    expect(await readFile(path.join(projectRoot, "src", "b.ts"), "utf8")).toBe(sourceB);
    expect(await readFile(path.join(projectRoot, "package.json"), "utf8")).toBe(packageJson);
    expect(externalRequests, `Storage Center contacted an external origin:\n${externalRequests.join("\n")}`).toEqual([]);
  });
});

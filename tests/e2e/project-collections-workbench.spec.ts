import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView, setProjectContext } from "./helpers/workbench";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);
const external = (raw: string) => /^https?:$/i.test(new URL(raw).protocol) && !LOCAL_ORIGINS.has(new URL(raw).origin);

test.describe("KForge Projects Collections Workbench", () => {
  test.setTimeout(120_000);
  let projectPath = "";

  test.afterEach(async () => {
    if (projectPath) await rm(projectPath, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    projectPath = "";
  });

  test("persists favorite, pin, tags, archive and restore without remote contact or source mutation", async ({ page }) => {
    projectPath = await mkdtemp(path.join(os.tmpdir(), "kforge-project-collections-"));
    await writeFile(path.join(projectPath, "package.json"), JSON.stringify({ name: "collections-fixture", private: true, version: "1.0.0" }, null, 2), "utf8");
    const sourceBefore = await writeFile(path.join(projectPath, "README.md"), "COLLECTION_SOURCE_UNCHANGED\n", "utf8").then(() => "COLLECTION_SOURCE_UNCHANGED\n");

    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectPath } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = (await opened.json() as { project: { id: string; name: string } }).project;

    const externalRequests: string[] = [];
    page.on("request", (request) => { if (external(request.url())) externalRequests.push(request.url()); });

    await openWorkbench(page);
    await setProjectContext(page, project.id);
    await selectExplorerView(page, "Projects", "Recent");
    const workbench = page.getByRole("region", { name: "KForge Project Collections Workbench", exact: true });
    await expect(workbench).toHaveAttribute("data-collection-view", "recent");
    let row = workbench.locator(`[data-project-id="${project.id}"]`);
    await expect(row).toBeVisible();
    await expect(workbench).toContainText("LOCAL_PERSISTED_METADATA");

    let mutation = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/collection`) && response.request().method() === "POST");
    await row.getByRole("button", { name: `Favorite ${project.name}`, exact: true }).click();
    expect((await mutation).ok()).toBeTruthy();

    await selectExplorerView(page, "Projects", "Favorites");
    row = workbench.locator(`[data-project-id="${project.id}"]`);
    await expect(row).toBeVisible();
    mutation = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/collection`) && response.request().method() === "POST");
    await row.getByRole("button", { name: `Pin ${project.name}`, exact: true }).click();
    expect((await mutation).ok()).toBeTruthy();

    await workbench.getByRole("textbox", { name: "Project collection tags", exact: true }).fill("client, release-ready");
    mutation = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/collection`) && response.request().method() === "POST");
    await workbench.getByRole("button", { name: "Save local tags", exact: true }).click();
    expect((await mutation).ok()).toBeTruthy();
    await expect(workbench).toContainText("tags saved (2)");

    page.once("dialog", (dialog) => void dialog.accept());
    mutation = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/collection`) && response.request().method() === "POST");
    await row.getByRole("button", { name: `Archive ${project.name}`, exact: true }).click();
    expect((await mutation).ok()).toBeTruthy();

    await selectExplorerView(page, "Projects", "Archive");
    row = workbench.locator(`[data-project-id="${project.id}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("ARCHIVED");
    await expect(row).toContainText("client · release-ready");

    mutation = page.waitForResponse((response) => response.url().endsWith(`/api/workspace/projects/${project.id}/collection`) && response.request().method() === "POST");
    await row.getByRole("button", { name: `Restore ${project.name}`, exact: true }).click();
    expect((await mutation).ok()).toBeTruthy();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-workbench='kforge']")).toBeVisible({ timeout: 60_000 });
    await setProjectContext(page, project.id);
    await selectExplorerView(page, "Projects", "Favorites");
    await expect(workbench.locator(`[data-project-id="${project.id}"]`)).toContainText("FAVORITE");
    await selectExplorerView(page, "Projects", "Pinned");
    await expect(workbench.locator(`[data-project-id="${project.id}"]`)).toContainText("PINNED");
    await workbench.getByRole("textbox", { name: "Search project collection", exact: true }).fill("release-ready");
    await expect(workbench.locator(`[data-project-id="${project.id}"]`)).toBeVisible();

    expect(externalRequests).toEqual([]);
    const readme = await import("node:fs/promises").then(({ readFile }) => readFile(path.join(projectPath, "README.md"), "utf8"));
    expect(readme).toBe(sourceBefore);
  });
});

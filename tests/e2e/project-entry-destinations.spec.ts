import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkbench, projectContext, selectExplorerView } from "./helpers/workbench";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);
const external = (raw: string) => /^https?:$/i.test(new URL(raw).protocol) && !LOCAL_ORIGINS.has(new URL(raw).origin);

/**
 * The dedicated Open Project and Import Project destinations must use the
 * canonical ProjectStartActions handler (serviceDirectory contract), not a
 * duplicated inline form. Opening registers a real local directory; cloning
 * stays policy-blocked in Offline mode and reports the real refusal.
 */
test.describe("KForge Projects entry destinations", () => {
  test.setTimeout(120_000);
  let projectPath = "";

  test.afterEach(async () => {
    if (projectPath) await rm(projectPath, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    projectPath = "";
  });

  test("Open Project registers a real local directory through the canonical start actions", async ({ page }) => {
    projectPath = await mkdtemp(path.join(os.tmpdir(), "kforge-open-project-"));
    await writeFile(path.join(projectPath, "package.json"), JSON.stringify({ name: "open-project-fixture", private: true, version: "1.0.0" }, null, 2), "utf8");

    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();

    const externalRequests: string[] = [];
    page.on("request", (request) => { if (external(request.url())) externalRequests.push(request.url()); });

    await openWorkbench(page);
    await selectExplorerView(page, "Projects", "Open Project");
    const surface = page.getByRole("region", { name: "KForge Open Project", exact: true });
    await expect(surface).toBeVisible();
    const actions = surface.locator(".kw-start-actions");
    await expect(actions).toBeVisible();
    await expect(surface.getByRole("tab", { name: "Open local project", exact: true })).toHaveAttribute("aria-selected", "true");

    const openResponse = page.waitForResponse((response) => response.url().endsWith("/api/workspace/projects/open") && response.request().method() === "POST");
    await surface.getByLabel("Project directory", { exact: true }).fill(projectPath);
    await surface.getByRole("button", { name: "Open project", exact: true }).click();
    expect((await openResponse).ok()).toBeTruthy();
    await expect(surface.getByRole("status")).toContainText("is now the active project");
    await expect(projectContext(page)).not.toHaveValue("");
    expect(externalRequests, "opening a local project must not contact a remote").toEqual([]);
  });

  test("Import Project opens the canonical clone form and reports the real Offline refusal", async ({ page }) => {
    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();

    const externalRequests: string[] = [];
    page.on("request", (request) => { if (external(request.url())) externalRequests.push(request.url()); });

    await openWorkbench(page);
    // Navigate through Open Project first: the two destinations share the
    // canonical handler at the same tree position, so the keyed remount must
    // reset the tab mode instead of retaining the previous destination's tab.
    await selectExplorerView(page, "Projects", "Open Project");
    await selectExplorerView(page, "Projects", "Import Project");
    const surface = page.getByRole("region", { name: "KForge Import Repository", exact: true });
    await expect(surface).toBeVisible();
    // The dedicated destination opens directly on the canonical clone tab.
    await expect(surface.getByRole("tab", { name: "Clone repository", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(surface).toContainText("KForge refuses it unless Online Optional or Online mode is active");

    const cloneResponse = page.waitForResponse((response) => response.url().endsWith("/api/workspace/projects/clone") && response.request().method() === "POST");
    await surface.getByLabel("Repository URL", { exact: true }).fill("https://github.com/daynightae-cmyk/KForge");
    await surface.getByLabel("Clone target folder", { exact: true }).fill("clone-refusal-fixture");
    await surface.getByRole("button", { name: "Clone", exact: true }).click();
    const refused = await cloneResponse;
    expect(refused.status(), "Offline mode must refuse the remote transfer").toBe(409);
    await expect(surface.getByRole("status")).toContainText("Remote cloning is disabled by the current operating mode");
    expect(externalRequests, "a policy-blocked clone must not contact the remote").toEqual([]);
  });
});

import path from "node:path";
import { expect, test } from "@playwright/test";
import { selectExplorerView, setProjectContext } from "./helpers/workbench";

test.describe("KForge Project Center real-evidence contract", () => {
  test.setTimeout(process.platform === "win32" ? 120_000 : 60_000);

  test("renders real project evidence and routes quick actions to canonical workbenches", async ({ page }) => {
    const reset = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(reset.ok(), await reset.text()).toBeTruthy();

    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();

    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = (await opened.json() as { project: { id: string; name: string; path: string; branch: string } }).project;

    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-workbench='kforge']")).toBeVisible({ timeout: 60_000 });
    await setProjectContext(page, project.id);
    await selectExplorerView(page, "Projects", "Workspace");

    const card = page.locator(".kw-project-card.is-active").filter({ hasText: project.name }).first();
    await expect(card).toBeVisible();
    await expect(card).toContainText(project.name);
    await expect(card).toContainText(project.path);
    await expect(card).toContainText(project.branch || "NO_GIT");
    await expect(card).toContainText(/local evidence/i);

    await card.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.locator(".kw-workbench h1")).toHaveText("Preview");

    await selectExplorerView(page, "Projects", "Workspace");
    const testsCard = page.locator(".kw-project-card.is-active").filter({ hasText: project.name }).first();
    await testsCard.getByRole("button", { name: "Tests", exact: true }).click();
    await expect(page.locator(".kw-workbench h1")).toHaveText("Tests");

    await selectExplorerView(page, "Projects", "Workspace");
    const gitCard = page.locator(".kw-project-card.is-active").filter({ hasText: project.name }).first();
    await gitCard.getByRole("button", { name: "Git", exact: true }).click();
    await expect(page.locator(".kw-workbench h1")).toHaveText("Git");
    await expect(gitCard.getByRole("button", { name: /Sync/i })).toHaveCount(0);
  });
});

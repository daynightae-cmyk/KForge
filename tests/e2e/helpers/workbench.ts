import { expect, type Page } from "@playwright/test";

export async function openWorkbench(page: Page) {
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-workbench='kforge']")).toBeVisible({ timeout: 60_000 });
}

export function projectContext(page: Page) {
  return page.getByRole("combobox", { name: "Project context", exact: true });
}

export async function setProjectContext(page: Page, projectId: string) {
  const control = projectContext(page);
  await control.selectOption(projectId);
  await expect(control).toHaveValue(projectId);
}

export async function clearProjectContext(page: Page) {
  const control = projectContext(page);
  await control.selectOption("");
  await expect(control).toHaveValue("");
}

export async function selectActivity(page: Page, activity: string) {
  const button = page.getByRole("complementary", { name: "KForge activities" }).getByRole("button", { name: activity, exact: true });
  await button.click();
  await expect(button).toHaveClass(/is-active/);
  await expect(page.getByRole("complementary", { name: `${activity} Explorer`, exact: true })).toBeVisible();
}

export async function selectExplorerView(page: Page, activity: string, view: string) {
  await selectActivity(page, activity);
  const explorer = page.getByRole("complementary", { name: `${activity} Explorer`, exact: true });
  const button = explorer.getByRole("button", { name: view, exact: true });
  await button.click();
  await expect(page.locator(".kw-workbench h1")).toHaveText(view);
  await expect(page.locator(".kw-workbench")).toHaveAttribute("data-workbench-surface", /.+:.+/);
}

export async function selectProjectByPath(page: Page, projectPath: string) {
  await selectExplorerView(page, "Projects", "Workspace");
  const row = page.locator("[data-project-path]").filter({ hasText: projectPath }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: /Select project/i }).click();
  await expect(row).toHaveClass(/is-selected/);
  const projectId = await row.getAttribute("data-project-id");
  expect(projectId).toBeTruthy();
  await expect(projectContext(page)).toHaveValue(projectId!);
}

export async function expectActiveSurface(page: Page, title: string) {
  await expect(page.locator(".kw-workbench h1")).toHaveText(title);
  await expect(page.locator(".kw-workbench h1")).toHaveCount(1);
}

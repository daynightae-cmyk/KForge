import path from "node:path";
import { expect, test } from "@playwright/test";

test.describe("KForge release evidence in production", () => {
  test.setTimeout(120_000);

  test("keeps local desktop, Windows package, and installer evidence distinct from CI", async ({ page }) => {
    const projectPath = process.cwd();
    const reset = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(reset.ok(), await reset.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: projectPath } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const { project } = await opened.json() as { project: { id: string } };

    const preparation = await page.request.get(`/api/workspace/projects/${encodeURIComponent(project.id)}/release/preparation`);
    expect(preparation.ok(), await preparation.text()).toBeTruthy();
    const preparationPayload = await preparation.json() as { preparation: { localEvidence: Record<string, { state: string; evidence: string[] }> } };
    expect(preparationPayload.preparation.localEvidence).toMatchObject({
      DESKTOP: { state: expect.stringMatching(/READY|UNAVAILABLE|ERROR/) },
      WINDOWS_PACKAGE: { state: expect.stringMatching(/READY|UNAVAILABLE|ERROR/) },
      INSTALLER: { state: expect.stringMatching(/READY|UNAVAILABLE|ERROR/) },
    });

    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    const rows = page.locator(".kf-table tbody tr");
    const projectIndex = await rows.evaluateAll((entries, exactPath) => entries.findIndex((entry) => entry.querySelector(".kf-project-cell small")?.getAttribute("title") === exactPath), projectPath);
    expect(projectIndex).toBeGreaterThanOrEqual(0);
    const selectedRow = rows.nth(projectIndex);
    await selectedRow.locator(".kf-project-cell").click();
    await expect(selectedRow).toHaveClass(/is-active/);
    const artifacts = page.locator(".kf-nav").getByRole("button", { name: "Artifacts", exact: true });
    await artifacts.click();
    await expect(artifacts).toHaveClass(/is-active/);
    await expect(page.locator(".kf-page-heading h1")).toHaveText("Artifacts");
    await expect(page.getByText("Independent local artifact evidence", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(".kf-command-evidence pre").filter({ hasText: "localEvidence" })).toContainText("WINDOWS_PACKAGE");
    await expect(page.locator(".kf-command-evidence pre").filter({ hasText: "localEvidence" })).toContainText("INSTALLER");
    expect(path.basename(projectPath)).toBe("KForge");
  });
});

import path from "node:path";
import { expect, test } from "@playwright/test";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

test.describe("KForge Online Control Center in production", () => {
  test.beforeEach(async ({ page }) => {
    const settings = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(settings.ok(), await settings.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
  });

  test("renders local service policy, cache/contact evidence, and remote-source empty state without implicit network contact", async ({ page }) => {
    const externalRequests: string[] = [];
    const apiFailures: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });
    page.on("response", (response) => {
      if (response.url().includes("/api/") && response.status() >= 400) apiFailures.push(`${response.status()} ${response.url()}`);
    });

    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    const rows = page.locator(".kf-table tbody tr");
    const projectPath = path.resolve(process.cwd());
    const projectIndex = await rows.evaluateAll((entries, exactPath) => entries.findIndex((entry) => entry.querySelector(".kf-project-cell small")?.getAttribute("title") === exactPath), projectPath);
    expect(projectIndex).toBeGreaterThanOrEqual(0);
    const selectedRow = rows.nth(projectIndex);
    await selectedRow.locator(".kf-project-cell").click();
    await expect(selectedRow).toHaveClass(/is-active/);
    await page.locator(".kf-nav").getByRole("button", { name: "Marketplace", exact: true }).click();
    const controlCenter = page.getByRole("region", { name: "Online Control Center" });
    await expect(controlCenter).toBeVisible({ timeout: 30_000 });
    await expect(controlCenter).toContainText("NO REMOTE CONTACT");
    await expect(controlCenter).toContainText("Marketplace Registry");
    await expect(controlCenter).toContainText("Model Registry");
    await expect(controlCenter).toContainText("Remote CI");

    const registryEvidence = controlCenter.getByText("Marketplace Registry", { exact: true });
    await registryEvidence.click();
    await expect(controlCenter).toContainText("Last success");
    await expect(controlCenter).toContainText("Destination");
    await expect(controlCenter).toContainText("Cache");
    await expect(controlCenter).toContainText("Not configured");

    const refresh = page.locator(".kf-online-results-header").getByRole("button", { name: "Refresh", exact: true });
    const refreshed = page.waitForResponse((response) => response.url().includes("/api/workspace/projects/") && response.url().includes("/marketplace"));
    await refresh.click();
    expect((await refreshed).ok()).toBeTruthy();
    await expect(controlCenter).toContainText("NO REMOTE CONTACT");

    await page.locator(".kf-nav").getByRole("button", { name: "Remote Sources", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Remote Sources", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Declared remote sources", exact: true })).toBeVisible();
    await expect(page.locator(".kf-active-surface")).toContainText(/No provider matches|NOT_CONFIGURED|OFFLINE/i);

    expect(externalRequests, `Unexpected external requests from Online Control Center:\n${externalRequests.join("\n")}`).toEqual([]);
    expect(apiFailures, `Unexpected API failures in Online Control Center:\n${apiFailures.join("\n")}`).toEqual([]);
  });
});

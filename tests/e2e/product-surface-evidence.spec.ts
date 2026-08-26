import path from "node:path";
import { expect, test } from "@playwright/test";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

test.describe("KForge product evidence surfaces in production", () => {
  test.beforeEach(async ({ page }) => {
    const reset = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(reset.ok(), await reset.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    const rows = page.locator(".kf-table tbody tr");
    const projectPath = path.resolve(process.cwd());
    const projectIndex = await rows.evaluateAll((entries, exactPath) => entries.findIndex((entry) => entry.querySelector(".kf-project-cell small")?.getAttribute("title") === exactPath), projectPath);
    expect(projectIndex).toBeGreaterThanOrEqual(0);
    const selectedRow = rows.nth(projectIndex);
    await selectedRow.locator(".kf-project-cell").click();
    await expect(selectedRow).toHaveClass(/is-active/);
  });

  test("loads local Online, AI, graph, and quality evidence without a silent external request", async ({ page }) => {
    const externalRequests: string[] = [];
    const pageErrors: string[] = [];
    const apiFailures: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
      if (response.url().includes("/api/") && response.status() >= 400) apiFailures.push(`${response.status()} ${response.url()}`);
    });

    const navigate = async (label: string) => {
      const button = page.locator(".kf-nav").getByRole("button", { name: label, exact: true });
      await expect(button).toBeVisible();
      await button.click();
      await expect(page.locator(".kf-page-heading h1")).toHaveText(label);
      await expect(page.locator(`.kf-active-surface[aria-label="${label} capability"]`)).toBeVisible();
    };

    await navigate("Marketplace");
    const modelsCategory = page.getByRole("button", { name: /^Models \d+ AVAILABLE$/ });
    await expect(modelsCategory).toBeVisible({ timeout: 30_000 });
    await modelsCategory.click();
    await expect(page.getByRole("heading", { name: "DeepSeek Coder 6.7B", exact: true })).toBeVisible();

    await navigate("AI providers");
    await expect(page.locator(".kf-active-surface")).toContainText(/provider|local|configured|unavailable/i);

    await navigate("Project graph");
    await expect(page.getByLabel("File path or symbol node id for impact analysis")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Project Graph", exact: true })).toBeVisible();

    await navigate("KForge Sonar");
    await expect(page.locator(".kf-active-surface")).toContainText(/security|tool|unavailable|detecting/i);

    expect(externalRequests, `Unexpected external requests in Offline mode:\n${externalRequests.join("\n")}`).toEqual([]);
    expect(apiFailures, `Unexpected API failures while loading product evidence surfaces:\n${apiFailures.join("\n")}`).toEqual([]);
    expect(pageErrors, `Unexpected page errors:\n${pageErrors.join("\n")}`).toEqual([]);
  });
});

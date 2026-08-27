import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { setProjectContext } from "./helpers/workbench";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

async function navigate(page: Page, activity: string, view: string) {
  await page.locator(".kw-activity-bar").getByRole("button", { name: activity, exact: true }).click();
  const explorer = page.getByRole("complementary", { name: `${activity} Explorer`, exact: true });
  await explorer.getByRole("button", { name: view, exact: true }).click();
  await expect(page.locator(".kw-workbench h1")).toHaveText(view);
}

test.describe("KForge product evidence surfaces in contextual workbench", () => {
  test.beforeEach(async ({ page }) => {
    const reset = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(reset.ok(), await reset.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = await opened.json() as { project: { id: string } };
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".kw-shell")).toBeVisible({ timeout: 60_000 });
    await setProjectContext(page, project.project.id);
  });

  test("loads Online, AI, graph and quality evidence without silent external requests", async ({ page }) => {
    const externalRequests: string[] = [];
    const pageErrors: string[] = [];
    const apiFailures: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
      if (response.url().includes("/api/") && response.status() >= 400) apiFailures.push(`${response.status()} ${response.url()}`);
    });

    await navigate(page, "Online", "Marketplace");
    await expect(page.locator(".kw-online")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".kw-online-results")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".kw-online-inspector")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".kw-online")).toContainText(/authority|availability|runtime evidence/i);

    await navigate(page, "AI", "Providers");
    await expect(page.locator(".kw-workbench-scroll")).toContainText(/ollama|lm studio|llama\.cpp|provider/i, { timeout: 30_000 });

    await navigate(page, "Intelligence", "Project Graph");
    await expect(page.locator(".kw-simple-surface")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".kw-workbench-scroll")).toContainText(/graph|nodes|coverage|evidence/i);

    await navigate(page, "Quality", "KForge Sonar");
    await expect(page.getByRole("heading", { level: 1, name: "KForge Sonar", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".kw-workbench-scroll")).toContainText(/problem|finding|security|scan/i);

    expect(externalRequests, `Unexpected external requests in Offline mode:\n${externalRequests.join("\n")}`).toEqual([]);
    expect(apiFailures, `Unexpected API failures while loading product evidence surfaces:\n${apiFailures.join("\n")}`).toEqual([]);
    expect(pageErrors, `Unexpected page errors:\n${pageErrors.join("\n")}`).toEqual([]);
  });
});

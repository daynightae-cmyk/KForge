import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

async function navigate(page: Page, view: string) {
  await page.locator(".kw-activity-bar").getByRole("button", { name: "Intelligence", exact: true }).click();
  const explorer = page.getByRole("complementary", { name: "Intelligence Explorer", exact: true });
  await explorer.getByRole("button", { name: view, exact: true }).click();
  await expect(page.locator(".kw-workbench h1")).toHaveText(view);
}

test.describe("KForge project intelligence in contextual workbench", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    const settings = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(settings.ok(), await settings.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const project = await opened.json() as { project: { id: string } };
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Project context").selectOption(project.project.id);
  });

  test("uses bounded local source evidence for graph, impact, dependencies, architecture and project questions", async ({ page }) => {
    const externalRequests: string[] = [];
    const apiFailures: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });
    page.on("response", (response) => { if (response.url().includes("/api/") && response.status() >= 400) apiFailures.push(`${response.status()} ${response.url()}`); });

    await navigate(page, "Project Graph");
    const graph = page.locator(".kw-simple-surface");
    await expect(graph).toBeVisible({ timeout: 30_000 });
    await expect(graph).toContainText(/coverage|nodes|analysis|graph/i);
    await expect(graph).toContainText(/COMPLETE|LIMIT_REACHED/);

    await navigate(page, "Impact Analysis");
    const impactInput = page.getByLabel("Impact target");
    await impactInput.fill("client/App.tsx");
    const impactResponse = page.waitForResponse((response) => response.url().includes("/graph/impact") && response.request().method() === "GET");
    await page.getByRole("button", { name: "Analyze impact", exact: true }).click();
    expect((await impactResponse).ok()).toBeTruthy();
    await expect(page.locator(".kw-workbench-scroll")).toContainText(/impact|dependents|target/i);

    await navigate(page, "Dependencies");
    await expect(page.locator(".kw-simple-surface")).toContainText(/packageManager|dependencies|manifest/i, { timeout: 30_000 });

    await navigate(page, "Architecture");
    await expect(page.locator(".kw-simple-surface")).toContainText(/modules|cycles|coupling|limitations/i, { timeout: 30_000 });

    await navigate(page, "Ask KForge");
    await page.getByLabel("Ask KForge question").fill("What release blockers are supported by current local evidence?");
    const answerResponse = page.waitForResponse((response) => response.url().includes("/ask") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Analyze project evidence", exact: true }).click();
    expect((await answerResponse).ok()).toBeTruthy();
    await expect(page.locator(".kw-answer")).toContainText(/mode|provider|answer|notice|evidence/i, { timeout: 30_000 });

    expect(externalRequests, `Unexpected external requests in project intelligence:\n${externalRequests.join("\n")}`).toEqual([]);
    expect(apiFailures, `Unexpected API failures in project intelligence:\n${apiFailures.join("\n")}`).toEqual([]);
  });
});

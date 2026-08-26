import path from "node:path";
import { expect, test } from "@playwright/test";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

test.describe("KForge project intelligence in production", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    const settings = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(settings.ok(), await settings.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
  });

  test("uses bounded local source evidence for graph, impact, dependencies, architecture, and deterministic project questions", async ({ page }) => {
    const externalRequests: string[] = [];
    const apiFailures: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });
    page.on("response", (response) => { if (response.url().includes("/api/") && response.status() >= 400) apiFailures.push(`${response.status()} ${response.url()}`); });

    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await page.locator(".kf-nav").getByRole("button", { name: "Project graph", exact: true }).click();
    const graph = page.locator(".kf-active-surface");
    await expect(graph.getByRole("heading", { name: "Project Graph", exact: true })).toBeVisible();
    await expect(graph).toContainText(/COMPLETE|LIMIT_REACHED/);
    await expect(graph).toContainText("Language parser boundaries");
    const impactInput = graph.getByLabel("File path or symbol node id for impact analysis");
    const graphMap = graph.getByLabel("Interactive local project graph");
    await expect(graphMap).toBeVisible();
    await expect(graphMap).toContainText("LOCAL STATIC EVIDENCE");
    const graphNode = graphMap.getByRole("button", { name: /Select (file|test|symbol|dependency|route|api) node/i }).first();
    await expect(graphNode).toBeVisible();
    await graphNode.click();
    await expect(impactInput).not.toHaveValue("");
    const impactResponse = page.waitForResponse((response) => response.url().includes("/graph/impact") && response.request().method() === "GET");
    await graph.getByRole("button", { name: "Analyze impact", exact: true }).click();
    expect((await impactResponse).ok()).toBeTruthy();
    await expect(graph).toContainText(/impact ·|Direct dependents and Transitive dependents/i);

    await page.locator(".kf-nav").getByRole("button", { name: "Dependencies", exact: true }).click();
    const dependencies = page.locator(".kf-active-surface");
    await expect(dependencies.getByRole("heading", { name: "Dependency Evidence", exact: true })).toBeVisible();
    await expect(dependencies).toContainText("Package manager");
    await expect(dependencies).toContainText(/Dependencies|No manifest-declared dependencies/);

    await page.locator(".kf-nav").getByRole("button", { name: "Architecture", exact: true }).click();
    const architecture = page.locator(".kf-active-surface");
    await expect(architecture.getByRole("heading", { name: "Architecture Evidence", exact: true })).toBeVisible();
    await expect(architecture).toContainText("Boundaries, dependency cycles, and coupling");
    await expect(architecture).toContainText("Measured limitations");

    await page.locator(".kf-nav").getByRole("button", { name: "Ask KForge", exact: true }).click();
    const ask = page.locator(".kf-active-surface");
    await expect(ask.getByRole("heading", { name: "Ask KForge", exact: true })).toBeVisible();
    const answerResponse = page.waitForResponse((response) => response.url().includes("/ask") && response.request().method() === "POST");
    await ask.getByRole("button", { name: "Ask", exact: true }).click();
    expect((await answerResponse).ok()).toBeTruthy();
    await expect(ask).toContainText(/Evidence-based local rules|Local model/);
    await expect(ask).toContainText("Execution and data disclosure");

    expect(externalRequests, `Unexpected external requests in project intelligence:\n${externalRequests.join("\n")}`).toEqual([]);
    expect(apiFailures, `Unexpected API failures in project intelligence:\n${apiFailures.join("\n")}`).toEqual([]);
  });
});

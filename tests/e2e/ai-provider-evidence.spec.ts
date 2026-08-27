import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView } from "./helpers/workbench";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);
const FORBIDDEN = ["test-secret-never-returned", "authorization: bearer", "sk-", "api_key="];
const external = (raw: string) => /^https?:$/i.test(new URL(raw).protocol) && !LOCAL_ORIGINS.has(new URL(raw).origin);

test.describe("KForge AI provider truth in contextual workbench", () => {
  test.beforeEach(async ({ page }) => {
    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    await openWorkbench(page);
  });

  test("shows measured local runtimes and configured cloud states without provider contact or credential exposure", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (external(request.url())) externalRequests.push(request.url()); });
    await selectExplorerView(page, "AI", "Providers");
    const surface = page.locator(".kw-workbench-scroll");
    for (const provider of ["Ollama", "LM Studio", "llama.cpp", "OpenAI", "Anthropic", "Gemini", "OpenRouter"]) await expect(surface).toContainText(provider, { timeout: 30_000 });
    await expect(surface).toContainText(/NOT_DETECTED|REACHABLE|CONFIGURED|NOT_CONFIGURED|DETECTED/i);
    await expect(surface).toContainText("Opening Providers does not contact cloud providers or expose credentials.");
    await selectExplorerView(page, "AI", "Models");
    await expect(page.locator(".kw-workbench-scroll")).toContainText(/Installed runtime inventory|Recommended catalog models|UNKNOWN/i, { timeout: 30_000 });
    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const marker of FORBIDDEN) expect(body).not.toContain(marker);
    expect(externalRequests).toEqual([]);
  });
});

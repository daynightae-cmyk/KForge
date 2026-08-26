import path from "node:path";
import { expect, test } from "@playwright/test";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);
const FORBIDDEN_SECRET_MARKERS = ["test-secret-never-returned", "authorization: bearer", "sk-", "api_key="];

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

test.describe("KForge local AI provider evidence in production", () => {
  test.beforeEach(async ({ page }) => {
    const settings = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(settings.ok(), await settings.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
  });

  test("shows measured local runtimes and cloud configuration states without exposing credentials or contacting providers", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });

    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await page.locator(".kf-nav").getByRole("button", { name: "AI providers", exact: true }).click();
    const center = page.locator(".kf-active-surface");
    await expect(center.getByRole("heading", { name: "KForge AI Center", exact: true })).toBeVisible();
    for (const provider of ["Ollama", "LM Studio", "llama.cpp compatible runtime", "OpenAI", "Anthropic", "Gemini", "OpenRouter"]) {
      await expect(center).toContainText(provider);
    }
    await expect(center).toContainText(/Ready|Reachable — no model|Configured — not contacted|Not configured/i);
    await expect(center).toContainText("Local: project context stays on this machine.");

    await page.locator(".kf-nav").getByRole("button", { name: "Models", exact: true }).click();
    const onboarding = page.locator(".kf-active-surface");
    await expect(onboarding.getByRole("heading", { name: "Enable Local AI", exact: true })).toBeVisible();
    await expect(onboarding).toContainText("Hardware Detection");
    await expect(onboarding).toContainText("Local Model Families");
    await expect(onboarding).toContainText(/Remote update data: DATA_UNAVAILABLE|Continue Without AI keeps evidence-based planning active/i);

    const visibleText = (await page.locator("body").innerText()).toLowerCase();
    for (const marker of FORBIDDEN_SECRET_MARKERS) expect(visibleText).not.toContain(marker);
    expect(externalRequests, `Unexpected external requests while opening local AI surfaces:\n${externalRequests.join("\n")}`).toEqual([]);
  });
});

import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView } from "./helpers/workbench";

test.describe("Provider + Model Command Center acceptance", () => {
  test.beforeEach(async ({ page }) => {
    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    await openWorkbench(page);
  });

  test("registers a custom provider with masked credential, explicit reveal contract and disclosure-gated session", async ({ page, request }) => {
    const fakeKey = `sk-e2e-secret-${Date.now()}`;
    const created = await request.post("/api/workspace/ai/command-center/providers", {
      data: { name: `E2ELab ${Date.now()}`, baseUrl: "https://provider.example/v1", apiKey: fakeKey, timeoutMs: 5000, streaming: true },
    });
    expect(created.ok()).toBeTruthy();
    const createdBody = await created.json() as { provider: { id: string; maskedKey: string } };
    expect(createdBody.provider.maskedKey).toContain("••••");
    expect(JSON.stringify(createdBody)).not.toContain(fakeKey);

    const listed = await request.get("/api/workspace/ai/command-center/providers");
    expect(listed.ok()).toBeTruthy();
    const listedBody = await listed.json() as { providers: Array<{ id: string; maskedKey: string | null }> };
    expect(JSON.stringify(listedBody)).not.toContain(fakeKey);
    const stored = listedBody.providers.find((entry) => entry.id === createdBody.provider.id);
    expect(stored?.maskedKey).toContain("••••");

    const unconfirmed = await request.post(`/api/workspace/ai/command-center/providers/${createdBody.provider.id}/reveal`, { data: { confirmed: false } });
    expect(unconfirmed.status()).toBe(428);

    const projectId = "e2e-disclosure-project";
    const sessionDenied = await request.post("/api/workspace/ai/command-center/sessions", {
      data: { projectId, providerId: createdBody.provider.id, modelId: "e2e-model", mode: "PLAN", task: "Inspect export flow", contextScope: "Repository", disclosureConfirmed: false },
    });
    expect(sessionDenied.status()).toBe(428);

    const sessionOk = await request.post("/api/workspace/ai/command-center/sessions", {
      data: { projectId, providerId: createdBody.provider.id, modelId: "e2e-model", mode: "PLAN", task: "Inspect export flow", contextScope: "Repository", disclosureConfirmed: true },
    });
    expect(sessionOk.ok()).toBeTruthy();

    await selectExplorerView(page, "AI", "Providers");
    const surface = page.locator(".kw-workbench-scroll");
    await expect(surface.getByTestId("provider-studio")).toBeVisible({ timeout: 30_000 });
    await expect(surface).toContainText("Provider + Model Command Center");
    await expect(surface).toContainText("Discover all models");
    const body = (await page.locator("body").innerText());
    expect(body).not.toContain(fakeKey);
  });
});

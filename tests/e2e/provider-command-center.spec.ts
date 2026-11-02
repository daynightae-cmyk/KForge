import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView, setProjectContext } from "./helpers/workbench";

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

  test("session context files disclose the exact bounded bytes the session sends", async ({ page, request }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    // A small deterministic fixture project, not the whole repository: the
    // disclosure reads real bytes through the real route, and keeping the
    // project tiny means this test measures the disclosure journey instead of
    // the cost of scanning KForge itself.
    const fixturePath = await mkdtemp(path.join(os.tmpdir(), "kforge-disclosure-e2e-"));
    await writeFile(path.join(fixturePath, "package.json"), JSON.stringify({ name: "kforge-disclosure-fixture", private: true, version: "9.9.9" }, null, 2), "utf8");
    try {
      const opened = await request.post("/api/workspace/projects/open", { data: { path: fixturePath } });
      expect(opened.ok(), "fixture project opened in the isolated e2e workspace").toBeTruthy();
      const { project } = await opened.json() as { project: { id: string } };

      const session = await request.post("/api/workspace/ai/command-center/sessions", {
        data: {
          projectId: project.id, providerId: "ollama", modelId: "local-model", mode: "PLAN",
          task: "Disclose bounded context", contextScope: "Repository", disclosureConfirmed: true,
        },
      });
      expect(session.ok(), "local session created").toBeTruthy();

      await openWorkbench(page);
      await setProjectContext(page, project.id);
      await selectExplorerView(page, "AI", "Providers");
      await page.getByRole("button", { name: "SESSIONS", exact: true }).click();
      await page.locator(".kw-session-list button").filter({ hasText: "Disclose bounded context" }).first().click();

      const chip = page.locator('.kw-context-files button[data-context-file="package.json"]');
      await expect(chip, "context file is rendered as an actionable control").toBeVisible({ timeout: 30_000 });

      // The advertised promise is "exact file context can be inspected inside the
      // session". A click has to produce that evidence, not a no-op.
      await chip.click();
      const region = page.getByRole("region", { name: /package\.json/ });
      await expect(region).toBeVisible();
      await expect(chip).toHaveAttribute("aria-pressed", "true");
      const bytes = region.getByLabel("Exact sent bytes for package.json");
      await expect(bytes, "disclosure settles with the exact sent body").toBeVisible({ timeout: 30_000 });
      await expect(bytes).toContainText("kforge-disclosure-fixture");
      await expect(region).toContainText("Bytes for this file");
      await expect(region).toContainText("Inclusion reason");
      await expect(region).toContainText("Redaction applied");

      // Closing returns the inspector to the honest empty prompt.
      await region.getByRole("button", { name: "Close context file disclosure" }).click();
      await expect(region).toHaveCount(0);
      await expect(chip).toHaveAttribute("aria-pressed", "false");

      // Every inspector tab must stay reachable: the disclosure lives behind CONTEXT,
      // so a clipped or unreachable tab row would silently remove the feature.
      const tabs = page.locator(".kw-mini-tabs");
      for (const label of ["PREVIEW", "MODEL", "CONTEXT", "DIAGNOSTICS", "SESSION"]) {
        await expect(tabs.getByRole("button", { name: label, exact: true }), `${label} tab is visible`).toBeVisible();
      }
      await tabs.getByRole("button", { name: "PREVIEW", exact: true }).click();
      await expect(tabs.getByRole("button", { name: "PREVIEW", exact: true })).toHaveClass(/is-active/);
      await expect(page.getByText("Preview not started")).toBeVisible();
      await tabs.getByRole("button", { name: "CONTEXT", exact: true }).click();
      await expect(tabs.getByRole("button", { name: "CONTEXT", exact: true })).toHaveClass(/is-active/);
      await expect(page.getByText("Context disclosure")).toBeVisible();

      expect(errors, "no unhandled renderer errors during disclosure").toEqual([]);
    } finally {
      await rm(fixturePath, { recursive: true, force: true, maxRetries: 24, retryDelay: 250 });
    }
  });
});

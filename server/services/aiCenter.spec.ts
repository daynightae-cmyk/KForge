import { promises as fs } from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkForModelUpdates, generateWithCloudAI, getModelCenter, getModelChangelog, getModelCompatibility, installModelUpdate, listCloudAIProviders, setActiveModel, verifyModelUpdate, type CloudAIProviderId } from "./aiCenter";

afterEach(() => vi.unstubAllEnvs());

describe("KForge Model Center", () => {
  it("exposes local model families while marking unavailable remote update data as UNKNOWN", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-model-center-"));
    try {
      const center = await getModelCenter(workspaceRoot);
      const qwenFamily = center.families.find((family) => family.family === "Qwen2.5-Coder");
      expect(qwenFamily?.variants.map((variant) => variant.variant)).toEqual(expect.arrayContaining(["1.5B", "3B", "7B"]));
      expect(qwenFamily?.updateSource).toBe("DATA_UNAVAILABLE");
      expect(center.recommendations.every((model) => model.update.state === "UNKNOWN" && model.update.latestKnownVersion === "UNKNOWN" && model.quantization === "UNSPECIFIED")).toBe(true);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 10_000);

  it("exposes a truthful blocked update workflow when no remote registry adapter is configured", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-model-updates-"));
    try {
      const update = await checkForModelUpdates(workspaceRoot, "qwen2.5-coder:3b");
      const changelog = await getModelChangelog(workspaceRoot, "qwen2.5-coder:3b");
      const compatibility = await getModelCompatibility(workspaceRoot, "qwen2.5-coder:3b");
      const installation = await installModelUpdate(workspaceRoot, "qwen2.5-coder:3b");
      const verification = await verifyModelUpdate(workspaceRoot, "qwen2.5-coder:3b");
      expect(update).toMatchObject({ state: "MODEL_NOT_INSTALLED", latestKnownVersion: "UNKNOWN", changelog: "REMOTE_REGISTRY_NOT_CONFIGURED", source: { configured: false } });
      expect(changelog.entries).toEqual([]);
      expect(compatibility.state).toBe("AVAILABLE");
      expect(installation).toMatchObject({ allowed: false, action: "BLOCKED", state: "MODEL_NOT_INSTALLED" });
      expect(verification.verification).toBe("MODEL_NOT_INSTALLED");
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 10_000);
});

describe("optional cloud AI providers", () => {
  it("reports every provider as NOT_CONFIGURED without exposing credential fields", () => {
    for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "KFORGE_OPENAI_MODEL", "KFORGE_ANTHROPIC_MODEL", "KFORGE_GEMINI_MODEL", "KFORGE_OPENROUTER_MODEL"]) vi.stubEnv(key, "");
    const providers = listCloudAIProviders();
    expect(providers.map((provider) => provider.id)).toEqual(["openai", "anthropic", "gemini", "openrouter"]);
    expect(providers.every((provider) => provider.state === "NOT_CONFIGURED" && !provider.configured)).toBe(true);
    expect(JSON.stringify(providers)).not.toMatch(/apiKey|credential|authorization/i);
  });

  it.each([
    ["openai", "OPENAI_API_KEY", "KFORGE_OPENAI_MODEL", "https://api.openai.com/v1/responses", { output_text: "OpenAI plan" }, "OpenAI plan"],
    ["anthropic", "ANTHROPIC_API_KEY", "KFORGE_ANTHROPIC_MODEL", "https://api.anthropic.com/v1/messages", { content: [{ type: "text", text: "Anthropic plan" }] }, "Anthropic plan"],
    ["gemini", "GEMINI_API_KEY", "KFORGE_GEMINI_MODEL", "https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent", { candidates: [{ content: { parts: [{ text: "Gemini plan" }] } }] }, "Gemini plan"],
    ["openrouter", "OPENROUTER_API_KEY", "KFORGE_OPENROUTER_MODEL", "https://openrouter.ai/api/v1/chat/completions", { choices: [{ message: { content: "OpenRouter plan" } }] }, "OpenRouter plan"],
  ] as const)("executes only the explicitly selected %s adapter with server-side credentials", async (id, keyEnvironment, modelEnvironment, expectedUrl, responseBody, expectedText) => {
    vi.stubEnv(keyEnvironment, "test-secret-never-returned");
    vi.stubEnv(modelEnvironment, "test-model");
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify(responseBody), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const result = await generateWithCloudAI(id as CloudAIProviderId, "system", "project context", fetcher);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(expectedUrl);
    expect(result.content).toBe(expectedText);
    expect(result.provider).toMatchObject({ id, model: "test-model", configured: true, state: "CONFIGURED" });
    expect(JSON.stringify(result)).not.toContain("test-secret-never-returned");
    expect(requests[0].init?.body).toContain("project context");
  });

  it("never activates a configured cloud provider as the local default model", async () => {
    vi.stubEnv("OPENAI_API_KEY", "activation-secret");
    vi.stubEnv("KFORGE_OPENAI_MODEL", "test-model");
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-cloud-activation-"));
    try {
      await expect(setActiveModel(workspaceRoot, "openai", "test-model")).rejects.toThrow("not currently available locally");
      await expect(fs.access(path.join(workspaceRoot, ".kforge", "ai-settings.json"))).rejects.toThrow();
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

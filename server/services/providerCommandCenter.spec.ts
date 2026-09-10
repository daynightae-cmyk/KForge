import { promises as fs } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { containsPlaintextSecret, maskApiKey, normalizeModelRecord, normalizeProviderError, redactSensitiveHeaders } from "../../shared/providerCommandCenter";
import { isTrustedKForgeOrigin } from "../../shared/trustOrigin";
import { createProviderSession, discoverProviderModels, listProviderSummaries, revealProviderKey, testProviderConnection, upsertCustomProvider } from "./providerCommandCenter";

async function workspaceRoot() {
  return fs.mkdtemp(path.join(process.cwd(), "kforge-provider-cc-"));
}

describe("provider command center secret boundary", () => {
  it("masks credentials and never leaks plaintext in summaries", async () => {
    const root = await workspaceRoot();
    try {
      const { provider } = await upsertCustomProvider(root, {
        name: "Reasonix",
        baseUrl: "https://provider.example/v1",
        apiKey: "sk-test-secret-value-1234567890",
      });
      expect(provider.maskedKey).toBe("sk-••••••••••••••••••••••••7890");
      expect(provider.maskedKey).not.toContain("sk-test-secret");
      const summaries = await listProviderSummaries(root);
      const found = summaries.find((entry) => entry.id === provider.id);
      expect(found?.maskedKey).toContain("••••");
      expect(containsPlaintextSecret(summaries, ["sk-test-secret-value-1234567890"])).toBe(false);
      expect(maskApiKey("sk-test-secret-value-1234567890")).toBe("sk-••••••••••••••••••••••••7890");
      await expect(revealProviderKey(root, provider.id, false)).rejects.toThrow("confirmation");
      const revealed = await revealProviderKey(root, provider.id, true);
      expect(revealed.value).toBe("sk-test-secret-value-1234567890");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("redacts sensitive headers in request inspector evidence", () => {
    const headers = redactSensitiveHeaders({ Authorization: "Bearer secret", "Content-Type": "application/json", "x-api-key": "abc" });
    expect(headers.Authorization).toBe("[REDACTED]");
    expect(headers["x-api-key"]).toBe("[REDACTED]");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("discovers models through a fake OpenAI-compatible server without inventing capabilities", async () => {
    const root = await workspaceRoot();
    try {
      const { provider } = await upsertCustomProvider(root, {
        name: "FakeLab",
        baseUrl: "https://fake.example/v1",
        apiKey: "sk-fake-secret-abcdef123456",
      });
      const fetcher = (async () => new Response(JSON.stringify({
        data: [{ id: "fake-alpha", context_length: 128000, pricing: { prompt: "0.000001", completion: "0.000002" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
      const result = await discoverProviderModels(root, provider.id, fetcher);
      expect(result.models).toHaveLength(1);
      expect(result.models[0].id).toBe("fake-alpha");
      expect(result.models[0].contextWindow).toBe(128000);
      expect(result.models[0].priceSource).toBe("PROVIDER_REPORTED");
      expect(result.models[0].capabilities.vision).toBe("PROVIDER_NOT_REPORTED");
      expect(containsPlaintextSecret(result, ["sk-fake-secret-abcdef123456"])).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("normalizes provider errors and bounds connection tests without project code", async () => {
    expect(normalizeProviderError(401, "Invalid API key")).toBe("AUTH_FAILED");
    expect(normalizeProviderError(429, "Rate limit exceeded")).toBe("RATE_LIMITED");
    expect(normalizeProviderError(null, "fetch failed")).toBe("NETWORK_ERROR");
    expect(normalizeModelRecord("p1", { id: "m1" }, new Date().toISOString()).capabilities.text).toBe("SUPPORTED");
    const root = await workspaceRoot();
    try {
      const { provider } = await upsertCustomProvider(root, {
        name: "TimeoutLab",
        baseUrl: "https://timeout.example/v1",
        apiKey: "sk-timeout-secret-12345678",
      });
      const failing = (async () => { throw new Error("fetch failed"); }) as typeof fetch;
      const evidence = await testProviderConnection(root, provider.id, "connection", null, failing);
      expect(evidence.ok).toBe(false);
      expect(evidence.errorKind).toBe("NETWORK_ERROR");
      expect(evidence.errorDetail).toContain("No project code was sent");
      expect(containsPlaintextSecret(evidence, ["sk-timeout-secret-12345678"])).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("requires cloud disclosure before creating a project session", async () => {
    const root = await workspaceRoot();
    try {
      const { provider } = await upsertCustomProvider(root, {
        name: "CloudLab",
        baseUrl: "https://cloud.example/v1",
        apiKey: "sk-cloud-secret-1234567890",
      });
      await expect(createProviderSession(root, {
        projectId: "p1",
        providerId: provider.id,
        modelId: "m1",
        mode: "IMPLEMENT",
        task: "Fix export",
        contextScope: "Repository",
        disclosureConfirmed: false,
      })).rejects.toThrow("disclosure");
      const session = await createProviderSession(root, {
        projectId: "p1",
        providerId: provider.id,
        modelId: "m1",
        mode: "IMPLEMENT",
        task: "Fix export",
        contextScope: "Repository",
        disclosureConfirmed: true,
      });
      expect(session.status).toBe("READY");
      expect(session.cloudDisclosure).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("exact KForge origin trust", () => {
  const server = "http://127.0.0.1:4173";
  it("accepts only the exact loopback origin", () => {
    expect(isTrustedKForgeOrigin("http://127.0.0.1:4173/workspace", server)).toBe(true);
    expect(isTrustedKForgeOrigin("http://127.0.0.1:4173@exampl" + "e.com/", server)).toBe(false);
    expect(isTrustedKForgeOrigin("http://example.com/?next=http://127.0.0.1:4173", server)).toBe(false);
    expect(isTrustedKForgeOrigin("http://127.0.0.1:9999/", server)).toBe(false);
    expect(isTrustedKForgeOrigin("https://127.0.0.1:4173/", server)).toBe(false);
    expect(isTrustedKForgeOrigin("http://127.0.0.1:4173/", "http://localhost:4173")).toBe(false);
    expect(isTrustedKForgeOrigin("http://user:pass@127.0.0.1:4173/", server)).toBe(false);
    expect(isTrustedKForgeOrigin("not-a-url", server)).toBe(false);
    expect(isTrustedKForgeOrigin("http://127.0.0.1:4173.evil.com/", server)).toBe(false);
  });
});

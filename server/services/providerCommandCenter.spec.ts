import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { containsPlaintextSecret, maskApiKey, normalizeModelRecord, normalizeProviderError, redactSensitiveHeaders } from "../../shared/providerCommandCenter";
import { isTrustedKForgeOrigin } from "../../shared/trustOrigin";
import { createProviderSession, discoverProviderModels, listDiscoveredModels, listProviderSummaries, refreshProviderModels, revealProviderKey, testProviderConnection, upsertCustomProvider } from "./providerCommandCenter";
import { setLocalPlatformMode } from "./localPlatform";

async function workspaceRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "kforge-provider-cc-"));
}

async function onlineWorkspaceRoot() {
  const root = await workspaceRoot();
  await setLocalPlatformMode(root, "online");
  return root;
}

describe("provider command center secret boundary", () => {
  it("masks credentials and never leaks plaintext in summaries", { timeout: 30_000 }, async () => {
    const root = await workspaceRoot();
    try {
      const { provider } = await upsertCustomProvider(root, {
        name: "Reasonix",
        baseUrl: "https://provider.example/v1",
        apiKey: "sk-test-secret-value-1234567890",
      });
      expect(provider.maskedKey).toBe("••••••••••••••••••••••••7890");
      expect(provider.maskedKey).not.toContain("sk-test-secret");
      const summaries = await listProviderSummaries(root);
      const found = summaries.find((entry) => entry.id === provider.id);
      expect(found?.maskedKey).toContain("••••");
      expect(containsPlaintextSecret(summaries, ["sk-test-secret-value-1234567890"])).toBe(false);
      expect(maskApiKey("sk-test-secret-value-1234567890")).toBe("••••••••••••••••••••••••7890");
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

  it("discovers models through a fake OpenAI-compatible server without inventing capabilities", { timeout: 30_000 }, async () => {
    const root = await onlineWorkspaceRoot();
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

  it("normalizes provider errors and bounds connection tests without project code", { timeout: 30_000 }, async () => {
    expect(normalizeProviderError(401, "Invalid API key")).toBe("AUTH_FAILED");
    expect(normalizeProviderError(429, "Rate limit exceeded")).toBe("RATE_LIMITED");
    expect(normalizeProviderError(null, "fetch failed")).toBe("NETWORK_ERROR");
    expect(normalizeModelRecord("p1", { id: "m1" }, new Date().toISOString()).capabilities.text).toBe("SUPPORTED");
    const root = await onlineWorkspaceRoot();
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
  it("refuses cloud provider contact outside Online mode without opening a socket", { timeout: 30_000 }, async () => {
    const root = await workspaceRoot();
    try {
      const { provider } = await upsertCustomProvider(root, {
        name: "OfflineGateLab",
        baseUrl: "https://provider.example/v1",
        apiKey: "sk-offline-gate-secret-1234567",
      });
      const fetcher = (async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
      for (const mode of ["offline", "local-first", "online-optional"] as const) {
        await setLocalPlatformMode(root, mode);
        await expect(discoverProviderModels(root, provider.id, fetcher)).rejects.toThrow(/requires Online mode/);
        await expect(testProviderConnection(root, provider.id, "connection", null, fetcher)).rejects.toThrow(/requires Online mode/);
      }
      await expect(listDiscoveredModels(root, provider.id)).resolves.toEqual([]);
      await setLocalPlatformMode(root, "online");
      await expect(discoverProviderModels(root, provider.id, fetcher)).resolves.toMatchObject({ discoveryState: "PARTIAL", cached: false });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps cached discovery evidence when a policy-blocked refresh is refused", { timeout: 30_000 }, async () => {
    const root = await onlineWorkspaceRoot();
    try {
      const { provider } = await upsertCustomProvider(root, {
        name: "BlockedRefreshLab",
        baseUrl: "https://provider.example/v1",
        apiKey: "sk-blocked-refresh-secret-1234",
      });
      const fetcher = (async () => new Response(JSON.stringify({ data: [{ id: "cached-alpha" }] }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
      await discoverProviderModels(root, provider.id, fetcher);
      expect(await listDiscoveredModels(root, provider.id)).toHaveLength(1);

      for (const mode of ["offline", "local-first", "online-optional"] as const) {
        await setLocalPlatformMode(root, mode);
        await expect(refreshProviderModels(root, provider.id, fetcher)).rejects.toThrow(/requires Online mode/);
        expect(await listDiscoveredModels(root, provider.id)).toEqual([expect.objectContaining({ id: "cached-alpha" })]);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects provider storage identifiers before filesystem access", async () => {
    const root = await workspaceRoot();
    try {
      const sentinel = path.join(root, "outside.json");
      await fs.writeFile(sentinel, "keep", "utf8");
      await expect(listDiscoveredModels(root, "../outside")).rejects.toThrow(/provider identifier/i);
      await expect(refreshProviderModels(root, "../outside")).rejects.toThrow(/provider identifier/i);
      expect(await fs.readFile(sentinel, "utf8")).toBe("keep");
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

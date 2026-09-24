import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHfModel, searchHfModels } from "./huggingFaceService";
import { remoteCacheKey, writeRemoteCache } from "./cacheStore";
import { RemoteFetchError } from "./fetchPolicy";
import { HF_DETAIL_FIXTURE, HF_SEARCH_FIXTURE } from "./adapters/fixtures/huggingFaceFixtures";

const PUBLIC_RESOLVER = async () => [{ address: "93.184.216.34", family: 4 }];
const LOCALS = ["qwen2.5-coder:1.5b", "mistral:7b"];

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

function searchKey(query = "coder"): string {
  return remoteCacheKey(["hugging-face-hub", "models", query, "", "", "", "", "20", ""]);
}

describe("Hugging Face Hub service", () => {
  let workspaceRoot = "";

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-hf-service-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  async function readContacts(): Promise<Record<string, unknown>> {
    try {
      return JSON.parse(await fs.readFile(path.join(workspaceRoot, ".kforge", "network-contacts.json"), "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      return {};
    }
  }

  async function seedStaleSearchCache(): Promise<void> {
    await writeRemoteCache(workspaceRoot, {
      sourceId: "hugging-face-hub",
      key: searchKey(),
      url: "https://huggingface.co/api/models",
      fetchedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      etag: '"seeded"',
      data: HF_SEARCH_FIXTURE,
    });
  }

  it("blocks OFFLINE search with zero external requests when no cache exists", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(HF_SEARCH_FIXTURE));
    await expect(
      searchHfModels({ workspaceRoot, networkAllowed: false, search: "coder", fetchImpl, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toBeInstanceOf(RemoteFetchError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("searches live on explicit action, records model-registry contact, and matches local inventory", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("https://huggingface.co/api/models");
      return jsonResponse(HF_SEARCH_FIXTURE, { headers: { etag: '"live-1"' } });
    });
    const result = await searchHfModels({
      workspaceRoot,
      networkAllowed: true,
      search: "coder",
      fetchImpl,
      hostResolver: PUBLIC_RESOLVER,
      localModelNames: LOCALS,
    });
    expect(result.models.map((model) => model.modelId)).toEqual(["Qwen/Qwen2.5-Coder-1.5B", "acme/minimal-gated"]);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].category).toBe("models");
    expect(result.items[0].availability).toBe("CATALOG");
    expect(result.items[0].installed).toBe(false);
    expect(result.localRuntimeChecked).toBe(true);
    expect(result.localMatches["Qwen/Qwen2.5-Coder-1.5B"]?.matchedName).toBe("qwen2.5-coder:1.5b");
    expect(result.localMatches["acme/minimal-gated"]).toBeUndefined();
    expect(result.evidence.freshness).toBe("CURRENT");
    expect(result.transparency.projectSourceSent).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await readContacts()).toHaveProperty("contacts.model-registry");
  });

  it("reports NOT_CHECKED local evidence when no inventory is supplied", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(HF_SEARCH_FIXTURE));
    const result = await searchHfModels({ workspaceRoot, networkAllowed: true, search: "coder", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(result.localRuntimeChecked).toBe(false);
    expect(result.models.every((model) => model.localEvidence.state === "NOT_CHECKED")).toBe(true);
  });

  it("serves a fresh cache without contacting the provider", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(HF_SEARCH_FIXTURE));
    await searchHfModels({ workspaceRoot, networkAllowed: true, search: "coder", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    const cached = await searchHfModels({ workspaceRoot, networkAllowed: true, search: "coder", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cached.evidence.fromCache).toBe(true);
    expect(cached.models).toHaveLength(2);
  });

  it("falls back to STALE cache on provider failure without losing last-good evidence", async () => {
    await seedStaleSearchCache();
    const bad = vi.fn(async () => new Response("boom", { status: 500 }));
    const stale = await searchHfModels({ workspaceRoot, networkAllowed: true, search: "coder", fetchImpl: bad, hostResolver: PUBLIC_RESOLVER, maxRetries: 0 });
    expect(stale.evidence.stale).toBe(true);
    expect(stale.models).toHaveLength(2);
  });

  it("validates search bounds and model ids before any request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(HF_SEARCH_FIXTURE));
    await expect(
      searchHfModels({ workspaceRoot, networkAllowed: true, limit: 500, fetchImpl, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toThrow(/limit/);
    await expect(
      searchHfModels({ workspaceRoot, networkAllowed: true, sort: "nope" as never, fetchImpl, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toThrow(/sort/);
    await expect(
      getHfModel({ workspaceRoot, networkAllowed: true, id: "../../etc", fetchImpl, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads model detail explicitly with local evidence", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(HF_DETAIL_FIXTURE));
    const result = await getHfModel({
      workspaceRoot,
      networkAllowed: true,
      id: "Qwen/Qwen2.5-Coder-1.5B",
      fetchImpl,
      hostResolver: PUBLIC_RESOLVER,
      localModelNames: LOCALS,
    });
    expect(result.model.modelId).toBe("Qwen/Qwen2.5-Coder-1.5B");
    expect(result.model.revision).toContain("a1b2c3");
    expect(result.item.availability).toBe("CATALOG");
    expect(result.localMatches["Qwen/Qwen2.5-Coder-1.5B"]?.state).toBe("INSTALLED");
  });
});

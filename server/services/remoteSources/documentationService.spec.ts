import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listAvailableDocumentation,
  listCachedDocumentation,
  readCachedDocumentation,
  refreshDocumentation,
  searchCachedDocumentation,
} from "./documentationService";
import { remoteCacheKey, writeRemoteCache } from "./cacheStore";
import { REMOTE_DOC_SOURCE_ID } from "./adapters/documentation";
import { RemoteFetchError } from "./fetchPolicy";
import { DOCS_LLMS_FIXTURE, DOCS_OPENAPI_FIXTURE } from "./adapters/fixtures/documentationFixtures";

const PUBLIC_RESOLVER = async () => [{ address: "93.184.216.34", family: 4 }];

function textResponse(body: string, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(body, { status: init.status ?? 200, headers: { "Content-Type": "text/plain", ...(init.headers ?? {}) } });
}

function docKey(sourceId: string): string {
  return remoteCacheKey([REMOTE_DOC_SOURCE_ID, "document", sourceId]);
}

describe("Remote Documentation service", () => {
  let workspaceRoot = "";

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-docs-service-"));
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

  async function seedDoc(sourceId = "hf-openapi", text: string = DOCS_OPENAPI_FIXTURE, ageMs = 60 * 60_000): Promise<void> {
    await writeRemoteCache(workspaceRoot, {
      sourceId: REMOTE_DOC_SOURCE_ID,
      key: docKey(sourceId),
      url: "https://example.invalid/seeded",
      fetchedAt: new Date(Date.now() - ageMs).toISOString(),
      etag: '"seeded"',
      data: { text },
    });
  }

  it("lists allowlisted sources locally without contacting any provider", async () => {
    const fetchImpl = vi.fn(async () => textResponse(DOCS_OPENAPI_FIXTURE));
    expect(listAvailableDocumentation().map((source) => source.id)).toEqual([
      "hf-openapi",
      "mcp-registry-openapi",
      "openvsx-openapi",
      "ollama-openapi",
      "openai-llms-full",
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses unknown source ids before any request", async () => {
    const fetchImpl = vi.fn(async () => textResponse("x"));
    await expect(
      refreshDocumentation({ workspaceRoot, networkAllowed: true, sourceId: "https://evil.example/docs", fetchImpl, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toThrow();
    await expect(
      refreshDocumentation({ workspaceRoot, networkAllowed: true, sourceId: "not-a-source", fetchImpl, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toThrow(/unknown documentation source/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks OFFLINE refresh with zero external requests when no cache exists", async () => {
    const fetchImpl = vi.fn(async () => textResponse(DOCS_OPENAPI_FIXTURE));
    await expect(
      refreshDocumentation({ workspaceRoot, networkAllowed: false, sourceId: "hf-openapi", fetchImpl, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toBeInstanceOf(RemoteFetchError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes an allowlisted document live with full provenance and contact", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe("https://huggingface.co/.well-known/openapi.json");
      return textResponse(DOCS_OPENAPI_FIXTURE, { headers: { etag: '"live-1"', "Content-Type": "application/json" } });
    });
    const result = await refreshDocumentation({ workspaceRoot, networkAllowed: true, sourceId: "hf-openapi", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(result.record.title).toBe("Fixture Provider API");
    expect(result.record.version).toBe("1.4.0");
    expect(result.record.canonicalUrl).toBe("https://huggingface.co/.well-known/openapi.json");
    expect(result.record.contentHash).toHaveLength(64);
    expect(result.record.licenseTerms).toContain("Hugging Face");
    expect(result.evidence.freshness).toBe("CURRENT");
    expect(result.transparency.projectSourceSent).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await readContacts()).toHaveProperty("contacts.remote-documentation");
  });

  it("serves a fresh cache without contacting the provider", async () => {
    await seedDoc("hf-openapi", DOCS_OPENAPI_FIXTURE, 0);
    const fetchImpl = vi.fn(async () => textResponse(DOCS_OPENAPI_FIXTURE));
    const result = await refreshDocumentation({ workspaceRoot, networkAllowed: true, sourceId: "hf-openapi", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.evidence.fromCache).toBe(true);
    expect(result.record.title).toBe("Fixture Provider API");
  });

  it("falls back to STALE cache on provider failure without losing last-good evidence", async () => {
    await seedDoc();
    const bad = vi.fn(async () => new Response("boom", { status: 500 }));
    const stale = await refreshDocumentation({ workspaceRoot, networkAllowed: true, sourceId: "hf-openapi", fetchImpl: bad, hostResolver: PUBLIC_RESOLVER, maxRetries: 0 });
    expect(stale.evidence.stale).toBe(true);
    expect(stale.record.title).toBe("Fixture Provider API");
  });

  it("searches cached documents locally without any fetch", async () => {
    await seedDoc("hf-openapi", DOCS_OPENAPI_FIXTURE, 0);
    await seedDoc("openai-llms-full", DOCS_LLMS_FIXTURE, 0);
    const fetchImpl = vi.fn(async () => textResponse("never"));
    const result = await searchCachedDocumentation(workspaceRoot, "pagination");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.hits.map((hit) => hit.sourceId).sort()).toEqual(["hf-openapi", "openai-llms-full"]);
    expect(result.searchedSources).toBe(2);
    expect(result.evidence.network).toBe("NOT_REQUIRED");
  });

  it("reports empty search honestly", async () => {
    const result = await searchCachedDocumentation(workspaceRoot, "pagination");
    expect(result.hits).toEqual([]);
    expect(result.searchedSources).toBe(0);
  });

  it("reads cached records for enrichment with malformed cache treated as absent", async () => {
    await seedDoc("hf-openapi", DOCS_OPENAPI_FIXTURE, 0);
    expect((await readCachedDocumentation(workspaceRoot, "hf-openapi"))?.record.title).toBe("Fixture Provider API");
    expect(await readCachedDocumentation(workspaceRoot, "unknown-id")).toBeNull();
    expect((await listCachedDocumentation(workspaceRoot)).map((entry) => entry.record.sourceId)).toEqual(["hf-openapi"]);
  });
});

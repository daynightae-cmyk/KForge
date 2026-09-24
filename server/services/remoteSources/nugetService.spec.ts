import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNugetRegistration, searchNugetPackages } from "./nugetService";
import { remoteCacheKey, writeRemoteCache } from "./cacheStore";
import { RemoteFetchError } from "./fetchPolicy";
import { NUGET_REGISTRATION_FIXTURE, NUGET_SEARCH_FIXTURE } from "./adapters/fixtures/nugetFixtures";

const PUBLIC_RESOLVER = async () => [{ address: "93.184.216.34", family: 4 }];

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
}

function searchKey(q = "Newtonsoft.Json"): string {
  return remoteCacheKey(["nuget-v3", "search", q, "0", "20"]);
}

describe("NuGet service", () => {
  let workspaceRoot = "";

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-nuget-service-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  async function readContacts(): Promise<Record<string, unknown>> {
    try {
      return JSON.parse(await fs.readFile(path.join(workspaceRoot, ".kforge", "network-contacts.json"), "utf8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  async function seedStaleSearchCache(): Promise<void> {
    await writeRemoteCache(workspaceRoot, {
      sourceId: "nuget-v3",
      key: searchKey(),
      url: "https://azuresearch-usnc.nuget.org/query",
      fetchedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      etag: '"seeded"',
      data: NUGET_SEARCH_FIXTURE,
    });
  }

  it("blocks OFFLINE search with zero external requests when no cache exists", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(NUGET_SEARCH_FIXTURE));
    await expect(searchNugetPackages({ workspaceRoot, networkAllowed: false, q: "Newtonsoft.Json", fetchImpl, hostResolver: PUBLIC_RESOLVER })).rejects.toBeInstanceOf(RemoteFetchError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("searches live on explicit action and records marketplace-registry contact", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("azuresearch-usnc.nuget.org/query");
      return jsonResponse(NUGET_SEARCH_FIXTURE, { headers: { etag: '"live-1"' } });
    });
    const result = await searchNugetPackages({ workspaceRoot, networkAllowed: true, q: "Newtonsoft.Json", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(result.items).toHaveLength(2);
    expect(result.items[0].id).toBe("nuget:Newtonsoft.Json");
    expect(result.items[0].availability).toBe("CATALOG");
    expect(result.evidence.freshness).toBe("CURRENT");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await readContacts()).toHaveProperty("contacts.marketplace-registry");
  });

  it("serves fresh cache without contacting provider", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(NUGET_SEARCH_FIXTURE));
    await searchNugetPackages({ workspaceRoot, networkAllowed: true, q: "Newtonsoft.Json", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    const cached = await searchNugetPackages({ workspaceRoot, networkAllowed: true, q: "Newtonsoft.Json", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cached.evidence.fromCache).toBe(true);
  });

  it("falls back to STALE cache on provider failure", async () => {
    await seedStaleSearchCache();
    const bad = vi.fn(async () => new Response("boom", { status: 500 }));
    const stale = await searchNugetPackages({ workspaceRoot, networkAllowed: true, q: "Newtonsoft.Json", fetchImpl: bad, hostResolver: PUBLIC_RESOLVER, maxRetries: 0 });
    expect(stale.evidence.stale).toBe(true);
    expect(stale.items).toHaveLength(2);
  });

  it("validates search and ids before any request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(NUGET_SEARCH_FIXTURE));
    await expect(searchNugetPackages({ workspaceRoot, networkAllowed: true, q: "", fetchImpl, hostResolver: PUBLIC_RESOLVER })).rejects.toThrow(/search query/);
    await expect(getNugetRegistration({ workspaceRoot, networkAllowed: true, id: "../../etc", fetchImpl, hostResolver: PUBLIC_RESOLVER })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads registration explicitly", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(NUGET_REGISTRATION_FIXTURE));
    const result = await getNugetRegistration({ workspaceRoot, networkAllowed: true, id: "Newtonsoft.Json", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(result.versions).toContain("13.0.3");
    expect(result.items).toHaveLength(2);
  });
});

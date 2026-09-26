import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOvsxExtension, getOvsxVersion, getOvsxVersions, searchOvsxExtensions } from "./openVsxService";
import { readRemoteCache, remoteCacheKey, writeRemoteCache } from "./cacheStore";
import { RemoteFetchError } from "./fetchPolicy";
import { OVSX_EXTENSION_FIXTURE, OVSX_SEARCH_FIXTURE, OVSX_VERSIONS_FIXTURE, OVSX_VERSION_FIXTURE } from "./adapters/fixtures/openVsxFixtures";

const PUBLIC_RESOLVER = async () => [{ address: "93.184.216.34", family: 4 }];

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

function searchKey(query = "", category = "", size = 20, offset = 0): string {
  return remoteCacheKey(["open-vsx", "search", query, category, String(size), String(offset)]);
}

describe("Open VSX service", () => {
  let workspaceRoot = "";

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-ovsx-service-"));
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

  async function seedStaleSearchCache(query = "yaml"): Promise<void> {
    await writeRemoteCache(workspaceRoot, {
      sourceId: "open-vsx",
      key: searchKey(query),
      url: "https://open-vsx.org/api/-/search",
      fetchedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      etag: '"seeded"',
      data: OVSX_SEARCH_FIXTURE,
    });
  }

  it("blocks OFFLINE search with zero external requests when no cache exists", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OVSX_SEARCH_FIXTURE));
    await expect(
      searchOvsxExtensions({ workspaceRoot, networkAllowed: false, query: "yaml", fetchImpl, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toBeInstanceOf(RemoteFetchError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches live on explicit search and records marketplace-registry contact", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OVSX_SEARCH_FIXTURE, { headers: { etag: '"live-1"' } }));
    const result = await searchOvsxExtensions({ workspaceRoot, networkAllowed: true, query: "yaml", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(result.items).toHaveLength(2);
    expect(result.items[0].id).toBe("openvsx:redhat/vscode-yaml");
    expect(result.items[0].category).toBe("plugins");
    expect(result.items[0].availability).toBe("CATALOG");
    expect(result.items[0].installed).toBe(false);
    expect(result.evidence.freshness).toBe("CURRENT");
    expect(result.transparency.projectSourceSent).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await readContacts()).toHaveProperty("contacts.marketplace-registry");
  });

  it("serves a fresh cache without contacting the provider", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OVSX_SEARCH_FIXTURE));
    await searchOvsxExtensions({ workspaceRoot, networkAllowed: true, query: "yaml", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    const cached = await searchOvsxExtensions({ workspaceRoot, networkAllowed: true, query: "yaml", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cached.evidence.fromCache).toBe(true);
    expect(cached.evidence.freshness).toBe("CACHED");
  });

  it("serves OFFLINE callers from cache with zero external requests", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OVSX_SEARCH_FIXTURE));
    await searchOvsxExtensions({ workspaceRoot, networkAllowed: true, query: "yaml", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    const offline = await searchOvsxExtensions({ workspaceRoot, networkAllowed: false, query: "yaml", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(offline.evidence.fromCache).toBe(true);
    expect(offline.items).toHaveLength(2);
  });

  it("falls back to STALE cache on provider failure without losing last-good evidence", async () => {
    await seedStaleSearchCache();
    const bad = vi.fn(async () => new Response("boom", { status: 500 }));
    const stale = await searchOvsxExtensions({ workspaceRoot, networkAllowed: true, query: "yaml", fetchImpl: bad, hostResolver: PUBLIC_RESOLVER, maxRetries: 0 });
    expect(stale.evidence.stale).toBe(true);
    expect(stale.evidence.freshness).toBe("STALE");
    expect(stale.items).toHaveLength(2);
  });

  it("refuses malformed provider JSON and keeps last-good cache", async () => {
    await seedStaleSearchCache();
    const malformed = vi.fn(async () => new Response("{broken", { status: 200 }));
    const stale = await searchOvsxExtensions({ workspaceRoot, networkAllowed: true, query: "yaml", fetchImpl: malformed, hostResolver: PUBLIC_RESOLVER });
    expect(stale.evidence.stale).toBe(true);
    expect(stale.items).toHaveLength(2);
  });

  it("revalidates with 304 and keeps catalog CURRENT", async () => {
    await seedStaleSearchCache("yaml");
    const revalidate = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["If-None-Match"]).toBe('"seeded"');
      return new Response(null, { status: 304, headers: { etag: '"seeded"' } });
    });
    const result = await searchOvsxExtensions({ workspaceRoot, networkAllowed: true, query: "yaml", fetchImpl: revalidate, hostResolver: PUBLIC_RESOLVER });
    expect(result.evidence.notModified).toBe(true);
    expect(result.evidence.freshness).toBe("CURRENT");
  });

  it("refreshes persisted version cache freshness after a 304 revalidation", async () => {
    const staleAt = new Date(Date.now() - 60 * 60_000).toISOString();
    await writeRemoteCache(workspaceRoot, {
      sourceId: "open-vsx",
      key: remoteCacheKey(["open-vsx", "versions", "redhat", "vscode-yaml"]),
      url: "https://open-vsx.org/api/redhat/vscode-yaml/versions",
      fetchedAt: staleAt,
      etag: '"old-etag"',
      data: OVSX_VERSIONS_FIXTURE,
    });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 304, headers: { etag: '"new-etag"' } }));
    const result = await getOvsxVersions({ workspaceRoot, networkAllowed: true, namespace: "redhat", extension: "vscode-yaml", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(result.evidence.notModified).toBe(true);
    const refreshed = await readRemoteCache(workspaceRoot, "open-vsx", remoteCacheKey(["open-vsx", "versions", "redhat", "vscode-yaml"]));
    expect(refreshed?.fetchedAt).not.toBe(staleAt);
    expect(refreshed?.etag).toBe('"new-etag"');
  });

  it("validates search bounds before any request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OVSX_SEARCH_FIXTURE));
    await expect(
      searchOvsxExtensions({ workspaceRoot, networkAllowed: true, size: 500, fetchImpl, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toThrow(/size/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects unsafe namespace/extension before any request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OVSX_EXTENSION_FIXTURE));
    await expect(
      getOvsxExtension({ workspaceRoot, networkAllowed: true, namespace: "../x", extension: "y", fetchImpl, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads extension detail, version detail, and version references explicitly", async () => {
    const detailFetch = vi.fn(async () => jsonResponse(OVSX_EXTENSION_FIXTURE));
    const detail = await getOvsxExtension({
      workspaceRoot,
      networkAllowed: true,
      namespace: "redhat",
      extension: "vscode-yaml",
      fetchImpl: detailFetch,
      hostResolver: PUBLIC_RESOLVER,
    });
    expect(detail.item.version).toBe("1.18.0");
    expect(detail.item.availability).toBe("CATALOG");
    expect(detail.item.installed).toBe(false);

    const versionFetch = vi.fn(async () => jsonResponse(OVSX_VERSION_FIXTURE));
    const version = await getOvsxVersion({
      workspaceRoot,
      networkAllowed: true,
      namespace: "redhat",
      extension: "vscode-yaml",
      version: "1.17.0",
      fetchImpl: versionFetch,
      hostResolver: PUBLIC_RESOLVER,
    });
    expect(version.item.version).toBe("1.17.0");

    const versionsFetch = vi.fn(async () => jsonResponse(OVSX_VERSIONS_FIXTURE));
    const versions = await getOvsxVersions({
      workspaceRoot,
      networkAllowed: true,
      namespace: "redhat",
      extension: "vscode-yaml",
      fetchImpl: versionsFetch,
      hostResolver: PUBLIC_RESOLVER,
    });
    expect(versions.versions).toEqual(["1.18.0", "1.17.0", "1.16.0"]);
  });
});

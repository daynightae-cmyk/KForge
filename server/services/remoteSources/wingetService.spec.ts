import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWingetManifest, searchWingetPackages } from "./wingetService";
import { remoteCacheKey, writeRemoteCache } from "./cacheStore";
import { RemoteFetchError } from "./fetchPolicy";
import { WINGET_MANIFEST_FIXTURE, WINGET_SEARCH_FIXTURE } from "./adapters/fixtures/wingetFixtures";

const PUBLIC_RESOLVER = async () => [{ address: "93.184.216.34", family: 4 }];

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
}

function textResponse(body: string, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(body, { status: init.status ?? 200, headers: { "Content-Type": "text/yaml", ...(init.headers ?? {}) } });
}

function searchKey(q = "Git.Git"): string {
  return remoteCacheKey(["winget-community", "search", q]);
}

describe("WinGet service", () => {
  let workspaceRoot = "";

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-winget-service-"));
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
      sourceId: "winget-community",
      key: searchKey(),
      url: "https://api.github.com/repos/microsoft/winget-pkgs/contents/manifests/g/Git/Git",
      fetchedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      etag: '"seeded"',
      data: WINGET_SEARCH_FIXTURE,
    });
  }

  it("blocks OFFLINE search with zero external requests when no cache exists", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(WINGET_SEARCH_FIXTURE));
    await expect(searchWingetPackages({ workspaceRoot, networkAllowed: false, q: "Git.Git", fetchImpl, hostResolver: PUBLIC_RESOLVER })).rejects.toBeInstanceOf(RemoteFetchError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("searches live on explicit action and records marketplace-registry contact", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("api.github.com/repos/microsoft/winget-pkgs/contents/manifests/g/Git/Git");
      return jsonResponse(WINGET_SEARCH_FIXTURE, { headers: { etag: '"live-1"' } });
    });
    const result = await searchWingetPackages({ workspaceRoot, networkAllowed: true, q: "Git.Git", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(result.items).toHaveLength(2);
    expect(result.items[0].id).toBe("winget:Git.Git@2.44.0");
    expect(result.evidence.freshness).toBe("CURRENT");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await readContacts()).toHaveProperty("contacts.marketplace-registry");
  });

  it("serves fresh cache without contacting provider", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(WINGET_SEARCH_FIXTURE));
    await searchWingetPackages({ workspaceRoot, networkAllowed: true, q: "Git.Git", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    const cached = await searchWingetPackages({ workspaceRoot, networkAllowed: true, q: "Git.Git", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cached.evidence.fromCache).toBe(true);
  });

  it("falls back to STALE cache on provider failure", async () => {
    await seedStaleSearchCache();
    const bad = vi.fn(async () => new Response("boom", { status: 500 }));
    const stale = await searchWingetPackages({ workspaceRoot, networkAllowed: true, q: "Git.Git", fetchImpl: bad, hostResolver: PUBLIC_RESOLVER, maxRetries: 0 });
    expect(stale.evidence.stale).toBe(true);
    expect(stale.items).toHaveLength(2);
  });

  it("validates search and package ids before any request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(WINGET_SEARCH_FIXTURE));
    await expect(searchWingetPackages({ workspaceRoot, networkAllowed: true, q: "", fetchImpl, hostResolver: PUBLIC_RESOLVER })).rejects.toThrow(/search query/);
    await expect(getWingetManifest({ workspaceRoot, networkAllowed: true, packageId: "no-dot", version: "1.0", fetchImpl, hostResolver: PUBLIC_RESOLVER })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads manifest explicitly", async () => {
    const fetchImpl = vi.fn(async () => textResponse(WINGET_MANIFEST_FIXTURE));
    const result = await getWingetManifest({ workspaceRoot, networkAllowed: true, packageId: "Git.Git", version: "2.44.0", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(result.item.id).toBe("winget:Git.Git@2.44.0");
    expect(result.manifest.packageIdentifier).toBe("Git.Git");
    expect(result.manifest.installers[0].installerSha256).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

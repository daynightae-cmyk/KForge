import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNpmPackage, getNpmVersion, searchNpmPackages } from "./npmService";
import { remoteCacheKey, writeRemoteCache } from "./cacheStore";
import { RemoteFetchError } from "./fetchPolicy";
import { NPM_PACKAGE_FIXTURE, NPM_SEARCH_FIXTURE, NPM_VERSION_FIXTURE } from "./adapters/fixtures/npmFixtures";

const PUBLIC_RESOLVER = async () => [{ address: "93.184.216.34", family: 4 }];

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
}

function searchKey(text = "left-pad"): string {
  return remoteCacheKey(["npm-registry", "search", text, "20", "0"]);
}

describe("npm service", () => {
  let workspaceRoot = "";

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-npm-service-"));
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
      sourceId: "npm-registry",
      key: searchKey(),
      url: "https://registry.npmjs.org/-/v1/search",
      fetchedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      etag: '"seeded"',
      data: NPM_SEARCH_FIXTURE,
    });
  }

  it("blocks OFFLINE search with zero external requests when no cache exists", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(NPM_SEARCH_FIXTURE));
    await expect(searchNpmPackages({ workspaceRoot, networkAllowed: false, text: "left-pad", fetchImpl, hostResolver: PUBLIC_RESOLVER })).rejects.toBeInstanceOf(RemoteFetchError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("searches live on explicit action, records marketplace-registry contact", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("https://registry.npmjs.org/-/v1/search");
      return jsonResponse(NPM_SEARCH_FIXTURE, { headers: { etag: '"live-1"' } });
    });
    const result = await searchNpmPackages({ workspaceRoot, networkAllowed: true, text: "left-pad", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(result.items).toHaveLength(2);
    expect(result.items[0].id).toBe("npm:left-pad");
    expect(result.items[0].availability).toBe("CATALOG");
    expect(result.items[0].installed).toBe(false);
    expect(result.evidence.freshness).toBe("CURRENT");
    expect(result.transparency.projectSourceSent).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await readContacts()).toHaveProperty("contacts.marketplace-registry");
  });

  it("serves a fresh cache without contacting the provider", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(NPM_SEARCH_FIXTURE));
    await searchNpmPackages({ workspaceRoot, networkAllowed: true, text: "left-pad", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    const cached = await searchNpmPackages({ workspaceRoot, networkAllowed: true, text: "left-pad", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cached.evidence.fromCache).toBe(true);
  });

  it("falls back to STALE cache on provider failure without losing last-good evidence", async () => {
    await seedStaleSearchCache();
    const bad = vi.fn(async () => new Response("boom", { status: 500 }));
    const stale = await searchNpmPackages({ workspaceRoot, networkAllowed: true, text: "left-pad", fetchImpl: bad, hostResolver: PUBLIC_RESOLVER, maxRetries: 0 });
    expect(stale.evidence.stale).toBe(true);
    expect(stale.items).toHaveLength(2);
  });

  it("validates search bounds and package names before any request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(NPM_SEARCH_FIXTURE));
    await expect(searchNpmPackages({ workspaceRoot, networkAllowed: true, text: "", fetchImpl, hostResolver: PUBLIC_RESOLVER })).rejects.toThrow(/search text/);
    await expect(getNpmPackage({ workspaceRoot, networkAllowed: true, name: "../../etc", fetchImpl, hostResolver: PUBLIC_RESOLVER })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads package detail and version detail explicitly", async () => {
    const fetchImplPkg = vi.fn(async () => jsonResponse(NPM_PACKAGE_FIXTURE));
    const pkg = await getNpmPackage({ workspaceRoot, networkAllowed: true, name: "left-pad", fetchImpl: fetchImplPkg, hostResolver: PUBLIC_RESOLVER });
    expect(pkg.item.id).toBe("npm:left-pad");
    expect(pkg.versions).toContain("1.3.0");
    expect(pkg.item.version).toBe("1.3.0");

    const fetchImplVer = vi.fn(async () => jsonResponse(NPM_VERSION_FIXTURE));
    const ver = await getNpmVersion({ workspaceRoot, networkAllowed: true, name: "left-pad", version: "1.3.0", fetchImpl: fetchImplVer, hostResolver: PUBLIC_RESOLVER });
    expect(ver.item.id).toBe("npm:left-pad");
    expect(ver.item.version).toBe("1.3.0");
  });
});

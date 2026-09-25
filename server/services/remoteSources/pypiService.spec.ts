import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPypiPackage, searchPypiPackages } from "./pypiService";
import { remoteCacheKey, writeRemoteCache } from "./cacheStore";
import { RemoteFetchError } from "./fetchPolicy";
import { PYPI_PACKAGE_FIXTURE } from "./adapters/fixtures/pypiFixtures";

const PUBLIC_RESOLVER = async () => [{ address: "93.184.216.34", family: 4 }];

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
}

function pkgKey(name = "requests"): string {
  return remoteCacheKey(["pypi", "package", name.toLowerCase()]);
}

describe("PyPI service", () => {
  let workspaceRoot = "";

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-pypi-service-"));
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

  async function seedStaleCache(): Promise<void> {
    await writeRemoteCache(workspaceRoot, {
      sourceId: "pypi",
      key: pkgKey(),
      url: "https://pypi.org/pypi/requests/json",
      fetchedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      etag: '"seeded"',
      data: PYPI_PACKAGE_FIXTURE,
    });
  }

  it("blocks OFFLINE with zero external requests when no cache exists", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(PYPI_PACKAGE_FIXTURE));
    await expect(getPypiPackage({ workspaceRoot, networkAllowed: false, name: "requests", fetchImpl, hostResolver: PUBLIC_RESOLVER })).rejects.toBeInstanceOf(RemoteFetchError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches live on explicit action and records marketplace-registry contact", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe("https://pypi.org/pypi/requests/json");
      return jsonResponse(PYPI_PACKAGE_FIXTURE, { headers: { etag: '"live-1"' } });
    });
    const result = await getPypiPackage({ workspaceRoot, networkAllowed: true, name: "requests", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(result.item.id).toBe("pypi:requests");
    expect(result.item.availability).toBe("CATALOG");
    expect(result.evidence.freshness).toBe("CURRENT");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await readContacts()).toHaveProperty("contacts.marketplace-registry");
  });

  it("serves fresh cache without contacting provider", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(PYPI_PACKAGE_FIXTURE));
    await getPypiPackage({ workspaceRoot, networkAllowed: true, name: "requests", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    const cached = await getPypiPackage({ workspaceRoot, networkAllowed: true, name: "requests", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cached.evidence.fromCache).toBe(true);
  });

  it("falls back to STALE cache on provider failure", async () => {
    await seedStaleCache();
    const bad = vi.fn(async () => new Response("boom", { status: 500 }));
    const stale = await getPypiPackage({ workspaceRoot, networkAllowed: true, name: "requests", fetchImpl: bad, hostResolver: PUBLIC_RESOLVER, maxRetries: 0 });
    expect(stale.evidence.stale).toBe(true);
    expect(stale.item.id).toBe("pypi:requests");
  });

  it("validates names before any request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(PYPI_PACKAGE_FIXTURE));
    await expect(getPypiPackage({ workspaceRoot, networkAllowed: true, name: "../../etc", fetchImpl, hostResolver: PUBLIC_RESOLVER })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("searches via direct lookup and returns empty on 404", async () => {
    const found = vi.fn(async () => jsonResponse(PYPI_PACKAGE_FIXTURE));
    const result = await searchPypiPackages({ workspaceRoot, networkAllowed: true, text: "requests", fetchImpl: found, hostResolver: PUBLIC_RESOLVER });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("pypi:requests");

    const missing = vi.fn(async () => new Response("{}", { status: 404 }));
    const empty = await searchPypiPackages({ workspaceRoot, networkAllowed: true, text: "nope-nope-nope", fetchImpl: missing, hostResolver: PUBLIC_RESOLVER });
    expect(empty.items).toEqual([]);
    expect(empty.evidence.httpStatus).toBe(404);
  });
});

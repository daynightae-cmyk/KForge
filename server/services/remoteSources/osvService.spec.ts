import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOsvVuln, queryOsvAdvisories, queryOsvBatch } from "./osvService";
import { remoteCacheKey, writeRemoteCache } from "./cacheStore";
import { RemoteFetchError } from "./fetchPolicy";
import { OSV_BATCH_FIXTURE, OSV_QUERY_FIXTURE, OSV_VULN_FIXTURE } from "./adapters/fixtures/osvFixtures";

const PUBLIC_RESOLVER = async () => [{ address: "93.184.216.34", family: 4 }];

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

const PKG = { ecosystem: "npm", name: "test-package", version: "1.0.0" };

describe("OSV service", () => {
  let workspaceRoot = "";

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-osv-service-"));
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

  async function seedStaleQueryCache(): Promise<void> {
    await writeRemoteCache(workspaceRoot, {
      sourceId: "osv",
      key: remoteCacheKey(["osv", "query", "npm", "test-package", "", "1.0.0", ""]),
      url: "https://api.osv.dev/v1/query",
      fetchedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      etag: '"seeded"',
      data: OSV_QUERY_FIXTURE,
    });
  }

  it("blocks OFFLINE queries with zero external requests when no cache exists", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OSV_QUERY_FIXTURE));
    await expect(
      queryOsvAdvisories({ workspaceRoot, networkAllowed: false, package: PKG, fetchImpl, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toBeInstanceOf(RemoteFetchError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("queries live on explicit action and records security-intelligence contact", async () => {
    let seenBody = "";
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      seenBody = String(init?.body || "");
      expect(init?.method).toBe("POST");
      return jsonResponse(OSV_QUERY_FIXTURE, { headers: { etag: '"live-1"' } });
    });
    const result = await queryOsvAdvisories({ workspaceRoot, networkAllowed: true, package: PKG, fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(JSON.parse(seenBody)).toMatchObject({ version: "1.0.0", package: { ecosystem: "npm", name: "test-package" } });
    expect(result.advisories.map((advisory) => advisory.id)).toEqual(["GHSA-test-0001", "PYSEC-test-0002"]);
    expect(result.advisories[0].fixedVersions).toEqual(["1.2.3"]);
    expect(result.evidence.freshness).toBe("CURRENT");
    expect(result.transparency.projectSourceSent).toBe(false);
    expect(result.transparency.purpose).toMatch(/no manifest was modified/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await readContacts()).toHaveProperty("contacts.security-intelligence");
  });

  it("returns an empty advisory list as a normal negative result", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const result = await queryOsvAdvisories({ workspaceRoot, networkAllowed: true, package: PKG, fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(result.advisories).toEqual([]);
    expect(result.evidence.freshness).toBe("CURRENT");
  });

  it("serves a fresh cache without contacting the provider", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OSV_QUERY_FIXTURE));
    await queryOsvAdvisories({ workspaceRoot, networkAllowed: true, package: PKG, fetchImpl, hostResolver: PUBLIC_RESOLVER });
    const cached = await queryOsvAdvisories({ workspaceRoot, networkAllowed: true, package: PKG, fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cached.evidence.fromCache).toBe(true);
    expect(cached.advisories).toHaveLength(2);
  });

  it("serves OFFLINE callers from cache with zero external requests", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OSV_QUERY_FIXTURE));
    await queryOsvAdvisories({ workspaceRoot, networkAllowed: true, package: PKG, fetchImpl, hostResolver: PUBLIC_RESOLVER });
    const offline = await queryOsvAdvisories({ workspaceRoot, networkAllowed: false, package: PKG, fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(offline.evidence.fromCache).toBe(true);
  });

  it("falls back to STALE cache on provider failure without losing last-good evidence", async () => {
    await seedStaleQueryCache();
    const bad = vi.fn(async () => new Response("boom", { status: 500 }));
    const stale = await queryOsvAdvisories({ workspaceRoot, networkAllowed: true, package: PKG, fetchImpl: bad, hostResolver: PUBLIC_RESOLVER, maxRetries: 0 });
    expect(stale.evidence.stale).toBe(true);
    expect(stale.evidence.freshness).toBe("STALE");
    expect(stale.advisories).toHaveLength(2);
  });

  it("refuses malformed provider JSON and keeps last-good cache", async () => {
    await seedStaleQueryCache();
    const malformed = vi.fn(async () => new Response("{broken", { status: 200 }));
    const stale = await queryOsvAdvisories({ workspaceRoot, networkAllowed: true, package: PKG, fetchImpl: malformed, hostResolver: PUBLIC_RESOLVER });
    expect(stale.evidence.stale).toBe(true);
    expect(stale.advisories).toHaveLength(2);
  });

  it("validates query selectors before any request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OSV_QUERY_FIXTURE));
    await expect(
      queryOsvAdvisories({ workspaceRoot, networkAllowed: true, package: { version: "1.0.0" }, fetchImpl, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toThrow(/needs ecosystem/);
    await expect(
      queryOsvBatch({ workspaceRoot, networkAllowed: true, queries: [], fetchImpl, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toThrow(/1-25/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("queries batches aligned with request order", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OSV_BATCH_FIXTURE));
    const result = await queryOsvBatch({
      workspaceRoot,
      networkAllowed: true,
      queries: [PKG, { ecosystem: "PyPI", name: "other-package", version: "0.2.0" }],
      fetchImpl,
      hostResolver: PUBLIC_RESOLVER,
    });
    expect(result.results).toHaveLength(2);
    expect(result.results[0].advisories.map((advisory) => advisory.id)).toEqual(["GHSA-test-0001"]);
    expect(result.results[1].advisories).toEqual([]);
    expect(result.evidence.freshness).toBe("CURRENT");
  });

  it("reads vulnerability detail explicitly and maps 404 without cache", async () => {
    const detail = vi.fn(async () => jsonResponse(OSV_VULN_FIXTURE));
    const result = await getOsvVuln({ workspaceRoot, networkAllowed: true, id: "GHSA-test-0001", fetchImpl: detail, hostResolver: PUBLIC_RESOLVER });
    expect(result.advisory.id).toBe("GHSA-test-0001");
    expect(result.advisory.severityLevel).toBe("high");

    const missing = vi.fn(async () => new Response("{}", { status: 404 }));
    await expect(
      getOsvVuln({ workspaceRoot, networkAllowed: true, id: "GHSA-missing-0000", fetchImpl: missing, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toMatchObject({ code: "HTTP_ERROR" });
    expect(await readContacts()).toHaveProperty("contacts.security-intelligence");
  });

  it("rejects unsafe vulnerability ids before any request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OSV_VULN_FIXTURE));
    await expect(
      getOsvVuln({ workspaceRoot, networkAllowed: true, id: "../../etc", fetchImpl, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

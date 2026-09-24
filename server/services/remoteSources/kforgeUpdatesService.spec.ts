import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getKforgeRelease, getKforgeUpdateStatus, listKforgeReleases } from "./kforgeUpdatesService";
import { remoteCacheKey, writeRemoteCache } from "./cacheStore";
import { RemoteFetchError } from "./fetchPolicy";
import { KFORGE_RELEASES_FIXTURE, KFORGE_RELEASE_DETAIL_FIXTURE } from "./adapters/fixtures/githubReleasesFixtures";

const PUBLIC_RESOLVER = async () => [{ address: "93.184.216.34", family: 4 }];

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

function listKey(): string {
  return remoteCacheKey(["github-releases-kforge", "releases", "30", "1"]);
}

describe("KForge update-discovery service", () => {
  let workspaceRoot = "";

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-updates-service-"));
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

  async function seedStaleListCache(): Promise<void> {
    await writeRemoteCache(workspaceRoot, {
      sourceId: "github-releases-kforge",
      key: listKey(),
      url: "https://api.github.com/repos/daynightae-cmyk/KForge/releases",
      fetchedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      etag: '"seeded"',
      data: KFORGE_RELEASES_FIXTURE,
    });
  }

  it("blocks OFFLINE discovery with zero external requests when no cache exists", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(KFORGE_RELEASES_FIXTURE));
    await expect(
      listKforgeReleases({ workspaceRoot, networkAllowed: false, fetchImpl, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toBeInstanceOf(RemoteFetchError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("discovers releases live on explicit action and records updates contact", async () => {
    let seenHeaders: Record<string, string> = {};
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      seenHeaders = { ...(init?.headers as Record<string, string>) };
      return jsonResponse(KFORGE_RELEASES_FIXTURE, { headers: { etag: '"live-1"' } });
    });
    const result = await listKforgeReleases({ workspaceRoot, networkAllowed: true, fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(seenHeaders["X-GitHub-Api-Version"]).toBe("2026-03-10");
    expect(result.releases).toHaveLength(4);
    expect(result.releases.map((release) => release.tag)).toEqual(["v0.1.0", "v0.2.0", "v0.3.0-beta.1", "v0.4.0-draft"]);
    expect(result.evidence.freshness).toBe("CURRENT");
    expect(result.transparency.projectSourceSent).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await readContacts()).toHaveProperty("contacts.updates");
  });

  it("filters channels without refetching", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(KFORGE_RELEASES_FIXTURE));
    const stables = await listKforgeReleases({ workspaceRoot, networkAllowed: true, channel: "stable", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(stables.releases.map((release) => release.tag)).toEqual(["v0.1.0", "v0.2.0"]);
  });

  it("serves a fresh cache without contacting the provider", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(KFORGE_RELEASES_FIXTURE));
    await listKforgeReleases({ workspaceRoot, networkAllowed: true, fetchImpl, hostResolver: PUBLIC_RESOLVER });
    const cached = await listKforgeReleases({ workspaceRoot, networkAllowed: true, fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cached.evidence.fromCache).toBe(true);
  });

  it("falls back to STALE cache on provider failure without losing last-good evidence", async () => {
    await seedStaleListCache();
    const bad = vi.fn(async () => new Response("boom", { status: 500 }));
    const stale = await listKforgeReleases({ workspaceRoot, networkAllowed: true, fetchImpl: bad, hostResolver: PUBLIC_RESOLVER, maxRetries: 0 });
    expect(stale.evidence.stale).toBe(true);
    expect(stale.releases).toHaveLength(4);
  });

  it("decides availability vs installed version while trusted install stays blocked", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(KFORGE_RELEASES_FIXTURE));
    const behind = await getKforgeUpdateStatus({ workspaceRoot, networkAllowed: true, currentVersion: "0.1.0", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(behind.decision.availability).toBe("UPDATE_AVAILABLE");
    expect(behind.decision.latestStable?.tag).toBe("v0.2.0");
    expect(behind.decision.trustedUpdate).toBe("BLOCKED");
    expect(behind.decision.trustedBlockers).toHaveLength(3);
    const current = await getKforgeUpdateStatus({ workspaceRoot, networkAllowed: true, currentVersion: "0.2.0", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(current.decision.availability).toBe("UP_TO_DATE");
    expect(current.decision.trustedUpdate).toBe("BLOCKED");
  });

  it("reads release detail explicitly and maps 404 without cache", async () => {
    const detail = vi.fn(async () => jsonResponse(KFORGE_RELEASE_DETAIL_FIXTURE));
    const result = await getKforgeRelease({ workspaceRoot, networkAllowed: true, tag: "v0.2.0", fetchImpl: detail, hostResolver: PUBLIC_RESOLVER });
    expect(result.release.nsisAsset?.expectedSha256).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

    const missing = vi.fn(async () => new Response("{}", { status: 404 }));
    await expect(
      getKforgeRelease({ workspaceRoot, networkAllowed: true, tag: "v9.9.9", fetchImpl: missing, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toMatchObject({ code: "HTTP_ERROR" });
  });

  it("validates paging and tags before any request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(KFORGE_RELEASES_FIXTURE));
    await expect(
      listKforgeReleases({ workspaceRoot, networkAllowed: true, perPage: 500, fetchImpl, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toThrow(/per_page/);
    await expect(
      getKforgeRelease({ workspaceRoot, networkAllowed: true, tag: "../../etc", fetchImpl, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

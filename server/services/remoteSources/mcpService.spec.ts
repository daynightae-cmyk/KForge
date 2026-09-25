import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMcpServerVersion, getMcpServerVersions, searchMcpServers } from "./mcpService";
import { remoteCacheKey, writeRemoteCache } from "./cacheStore";
import { RemoteFetchError } from "./fetchPolicy";
import { MCP_LIST_FIXTURE, MCP_VERSION_DETAIL_FIXTURE, MCP_VERSIONS_FIXTURE } from "./adapters/fixtures/mcpRegistryFixtures";

const PUBLIC_RESOLVER = async () => [{ address: "93.184.216.34", family: 4 }];

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("MCP Registry service", () => {
  let workspaceRoot = "";

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-mcp-service-"));
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

  it("blocks OFFLINE search with zero external requests when no cache exists", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(MCP_LIST_FIXTURE));
    await expect(
      searchMcpServers({ workspaceRoot, networkAllowed: false, search: "fs", fetchImpl, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toBeInstanceOf(RemoteFetchError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches live on explicit search and records marketplace-registry contact", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(MCP_LIST_FIXTURE, { headers: { etag: '"live-1"' } }));
    const result = await searchMcpServers({ workspaceRoot, networkAllowed: true, search: "fs", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(result.items).toHaveLength(2);
    expect(result.items[0].availability).toBe("CATALOG");
    expect(result.items[0].installed).toBe(false);
    expect(result.items.every((item) => item.authority.kind === "REMOTE_REGISTRY")).toBe(true);
    expect(result.evidence.freshness).toBe("CURRENT");
    expect(result.evidence.fromCache).toBe(false);
    expect(result.transparency.network).toBe("REQUIRED");
    expect(result.transparency.projectSourceSent).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const contacts = await readContacts();
    expect(contacts).toHaveProperty("contacts.marketplace-registry");
  });

  it("serves a fresh cache without contacting the provider", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(MCP_LIST_FIXTURE));
    await searchMcpServers({ workspaceRoot, networkAllowed: true, search: "fs", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const cached = await searchMcpServers({ workspaceRoot, networkAllowed: true, search: "fs", fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cached.evidence.fromCache).toBe(true);
    expect(cached.evidence.freshness).toBe("CACHED");
    expect(cached.items).toHaveLength(2);
    expect(cached.transparency.network).toBe("NOT_REQUIRED");
  });

  it("serves OFFLINE callers from cache with zero external requests", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(MCP_LIST_FIXTURE));
    await searchMcpServers({ workspaceRoot, networkAllowed: true, fetchImpl, hostResolver: PUBLIC_RESOLVER });
    const offline = await searchMcpServers({ workspaceRoot, networkAllowed: false, fetchImpl, hostResolver: PUBLIC_RESOLVER });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(offline.evidence.fromCache).toBe(true);
    expect(offline.items).toHaveLength(2);
  });

  async function seedStaleSearchCache(search: string | undefined, etag = '"seeded"'): Promise<void> {
    await writeRemoteCache(workspaceRoot, {
      sourceId: "mcp-official-registry",
      key: remoteCacheKey(["mcp-official-registry", "servers", search ?? "", "", "30", "", "", "false"]),
      url: "https://registry.modelcontextprotocol.io/v0.1/servers",
      fetchedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      etag,
      data: MCP_LIST_FIXTURE,
    });
  }

  it("falls back to STALE cache on provider failure without losing last-good evidence", async () => {
    await seedStaleSearchCache("fs");
    const bad = vi.fn(async () => new Response("boom", { status: 500 }));
    const stale = await searchMcpServers({ workspaceRoot, networkAllowed: true, search: "fs", fetchImpl: bad, hostResolver: PUBLIC_RESOLVER, maxRetries: 0 });
    expect(stale.evidence.stale).toBe(true);
    expect(stale.evidence.freshness).toBe("STALE");
    expect(stale.items).toHaveLength(2);
    expect(stale.evidence.error).toMatch(/last-good cached catalog/);
  });

  it("refuses malformed provider JSON and keeps last-good cache", async () => {
    await seedStaleSearchCache("fs");
    const malformed = vi.fn(async () => new Response("{broken", { status: 200, headers: { "Content-Type": "application/json" } }));
    const stale = await searchMcpServers({ workspaceRoot, networkAllowed: true, search: "fs", fetchImpl: malformed, hostResolver: PUBLIC_RESOLVER });
    expect(stale.evidence.stale).toBe(true);
    expect(stale.items).toHaveLength(2);
  });

  it("throws on malformed provider JSON when no cache exists", async () => {
    const malformed = vi.fn(async () => new Response("{broken", { status: 200 }));
    await expect(
      searchMcpServers({ workspaceRoot, networkAllowed: true, search: "x", fetchImpl: malformed, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toThrow(/malformed JSON/);
  });

  it("revalidates with 304 and keeps catalog CURRENT", async () => {
    await seedStaleSearchCache("fs", '"v1"');
    const revalidate = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["If-None-Match"]).toBe('"v1"');
      return new Response(null, { status: 304, headers: { etag: '"v1"' } });
    });
    const result = await searchMcpServers({ workspaceRoot, networkAllowed: true, search: "fs", fetchImpl: revalidate, hostResolver: PUBLIC_RESOLVER });
    expect(result.evidence.notModified).toBe(true);
    expect(result.evidence.freshness).toBe("CURRENT");
    expect(result.items).toHaveLength(2);
  });

  it("validates pagination bounds", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(MCP_LIST_FIXTURE));
    await expect(
      searchMcpServers({ workspaceRoot, networkAllowed: true, limit: 500, fetchImpl, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toThrow(/limit/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects unsafe server names before any request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(MCP_VERSIONS_FIXTURE));
    await expect(
      getMcpServerVersions({ workspaceRoot, networkAllowed: true, serverName: "../../etc", fetchImpl, hostResolver: PUBLIC_RESOLVER }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads version history and version detail explicitly", async () => {
    const history = vi.fn(async () => jsonResponse(MCP_VERSIONS_FIXTURE));
    const versions = await getMcpServerVersions({
      workspaceRoot,
      networkAllowed: true,
      serverName: "io.github.owner/filesystem",
      fetchImpl: history,
      hostResolver: PUBLIC_RESOLVER,
    });
    expect(versions.versions.map((entry) => entry.version)).toEqual(["1.2.0", "1.1.0"]);
    expect(versions.evidence.freshness).toBe("CURRENT");

    const detailFetch = vi.fn(async () => jsonResponse(MCP_VERSION_DETAIL_FIXTURE));
    const detail = await getMcpServerVersion({
      workspaceRoot,
      networkAllowed: true,
      serverName: "io.github.owner/filesystem",
      version: "1.2.0",
      fetchImpl: detailFetch,
      hostResolver: PUBLIC_RESOLVER,
    });
    expect(detail.item.version).toBe("1.2.0");
    expect(detail.item.availability).toBe("CATALOG");
    expect(detail.item.installed).toBe(false);
  });

  it("maps 404 detail to a failed contact without cache", async () => {
    const missing = vi.fn(async () => new Response("{}", { status: 404 }));
    await expect(
      getMcpServerVersion({
        workspaceRoot,
        networkAllowed: true,
        serverName: "io.github.owner/missing",
        version: "9.9.9",
        fetchImpl: missing,
        hostResolver: PUBLIC_RESOLVER,
      }),
    ).rejects.toMatchObject({ code: "HTTP_ERROR" });
    const contacts = await readContacts();
    expect(contacts).toHaveProperty("contacts.marketplace-registry");
  });
});

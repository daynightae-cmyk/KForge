import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cacheAgeMs,
  isCacheFresh,
  readRemoteCache,
  remoteCacheKey,
  revalidateRemoteCache,
  writeRemoteCache,
} from "./cacheStore";

describe("remote-source bounded cache", () => {
  let workspaceRoot = "";

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-remote-cache-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it("round-trips an entry with validators", async () => {
    const key = remoteCacheKey(["mcp-official-registry", "servers", "{}"]);
    await writeRemoteCache(workspaceRoot, {
      sourceId: "mcp-official-registry",
      key,
      url: "https://registry.modelcontextprotocol.io/v0.1/servers",
      fetchedAt: new Date().toISOString(),
      etag: '"v1"',
      lastModified: "Wed, 01 Jan 2025 00:00:00 GMT",
      data: { servers: [] },
    });
    const entry = await readRemoteCache(workspaceRoot, "mcp-official-registry", key);
    expect(entry?.etag).toBe('"v1"');
    expect(entry?.data).toEqual({ servers: [] });
    expect(isCacheFresh(entry!, 15 * 60_000)).toBe(true);
  });

  it("treats malformed cache files as absent", async () => {
    const key = remoteCacheKey(["x"]);
    const target = path.join(workspaceRoot, ".kforge", "remote-sources", "mcp-official-registry", `${key}.json`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "{not json", "utf8");
    await expect(readRemoteCache(workspaceRoot, "mcp-official-registry", key)).resolves.toBeNull();
  });

  it("rejects traversal-shaped keys", async () => {
    await expect(readRemoteCache(workspaceRoot, "mcp-official-registry", "../evil")).resolves.toBeNull();
    await expect(
      writeRemoteCache(workspaceRoot, {
        sourceId: "mcp-official-registry",
        key: "../evil",
        url: "https://registry.modelcontextprotocol.io/v0.1/servers",
        fetchedAt: new Date().toISOString(),
        data: {},
      }),
    ).rejects.toThrow();
  });

  it("refreshes persisted validators and timestamp after revalidation", async () => {
    const key = remoteCacheKey(["revalidated"]);
    const oldFetchedAt = new Date(Date.now() - 60 * 60_000).toISOString();
    const entry = await writeRemoteCache(workspaceRoot, {
      sourceId: "mcp-official-registry",
      key,
      url: "https://registry.modelcontextprotocol.io/v0.1/servers",
      fetchedAt: oldFetchedAt,
      etag: '"old"',
      lastModified: "old-date",
      cacheControl: "old-control",
      data: { servers: [] },
    });
    const refreshedAt = new Date().toISOString();
    await revalidateRemoteCache(workspaceRoot, entry, refreshedAt, { etag: '"new"', lastModified: "new-date", cacheControl: "new-control" });
    const refreshed = await readRemoteCache(workspaceRoot, "mcp-official-registry", key);
    expect(refreshed).toMatchObject({ fetchedAt: refreshedAt, etag: '"new"', lastModified: "new-date", cacheControl: "new-control" });
  });

  it("reports stale entries past the TTL but keeps them readable", async () => {
    const key = remoteCacheKey(["stale"]);
    const fetchedAt = new Date(Date.now() - 60 * 60_000).toISOString();
    await writeRemoteCache(workspaceRoot, {
      sourceId: "mcp-official-registry",
      key,
      url: "https://registry.modelcontextprotocol.io/v0.1/servers",
      fetchedAt,
      data: { servers: [{ name: "old" }] },
    });
    const entry = await readRemoteCache(workspaceRoot, "mcp-official-registry", key);
    expect(entry).not.toBeNull();
    expect(isCacheFresh(entry!, 15 * 60_000)).toBe(false);
    expect(cacheAgeMs(entry!)).toBeGreaterThan(15 * 60_000);
  });

  it("evicts the oldest entries past the bound", async () => {
    for (let index = 0; index < 4; index += 1) {
      const key = remoteCacheKey([`entry-${index}`]);
      await writeRemoteCache(
        workspaceRoot,
        {
          sourceId: "mcp-official-registry",
          key,
          url: "https://registry.modelcontextprotocol.io/v0.1/servers",
          fetchedAt: new Date(Date.now() - (10 - index) * 1000).toISOString(),
          data: { index },
        },
        { maxEntries: 3 },
      );
    }
    const oldest = await readRemoteCache(workspaceRoot, "mcp-official-registry", remoteCacheKey(["entry-0"]));
    const newest = await readRemoteCache(workspaceRoot, "mcp-official-registry", remoteCacheKey(["entry-3"]));
    expect(oldest).toBeNull();
    expect(newest?.data).toEqual({ index: 3 });
  });
});

import { describe, expect, it } from "vitest";
import {
  buildMcpServersUrl,
  buildMcpVersionDetailUrl,
  buildMcpVersionsUrl,
  mcpServerToMarketplaceItem,
  normalizeMcpServer,
  parseMcpListResponse,
  parseMcpVersionDetailResponse,
  parseMcpVersionsResponse,
} from "./mcpRegistry";
import { MCP_LIST_FIXTURE, MCP_VERSION_DETAIL_FIXTURE, MCP_VERSIONS_FIXTURE } from "./fixtures/mcpRegistryFixtures";

describe("MCP Registry response validation", () => {
  it("parses a valid server list with cursor pagination", () => {
    const result = parseMcpListResponse(JSON.stringify(MCP_LIST_FIXTURE));
    expect(result.servers).toHaveLength(2);
    expect(result.servers[0].name).toBe("io.github.owner/filesystem");
    expect(result.nextCursor).toBe("cursor-abc");
  });

  it("accepts a bare array list shape", () => {
    const result = parseMcpListResponse(JSON.stringify(MCP_LIST_FIXTURE.servers));
    expect(result.servers).toHaveLength(2);
    expect(result.nextCursor).toBeUndefined();
  });

  it("parses an empty result without fabricating entries", () => {
    expect(parseMcpListResponse(JSON.stringify({ servers: [] })).servers).toEqual([]);
  });

  it("refuses malformed JSON", () => {
    expect(() => parseMcpListResponse("{nope")).toThrow(/malformed JSON/);
  });

  it("refuses schema mismatches (servers not an array, missing identity)", () => {
    expect(() => parseMcpListResponse(JSON.stringify({ servers: [{ description: "no name" }] }))).toThrow(/response shape/);
    expect(() => parseMcpListResponse(JSON.stringify({ servers: "nope" }))).toThrow(/response shape/);
    expect(() => parseMcpListResponse(JSON.stringify({ nope: true }))).toThrow(/response shape/);
  });

  it("parses version history and version detail", () => {
    const versions = parseMcpVersionsResponse(JSON.stringify(MCP_VERSIONS_FIXTURE));
    expect(versions.versions.map((entry) => entry.version)).toEqual(["1.2.0", "1.1.0"]);
    const detail = parseMcpVersionDetailResponse(JSON.stringify(MCP_VERSION_DETAIL_FIXTURE));
    expect(detail.version).toBe("1.2.0");
  });

  it("refuses version detail without an immutable version", () => {
    expect(() => parseMcpVersionDetailResponse(JSON.stringify({ description: "no version" }))).toThrow(/response shape/);
  });
});

describe("MCP Registry URL builders", () => {
  it("encodes search, cursor, limit, updated_since, and version", () => {
    const url = buildMcpServersUrl("https://registry.modelcontextprotocol.io", {
      search: "file system",
      cursor: "opaque+cursor/=",
      limit: 10,
      updatedSince: "2026-01-01T00:00:00Z",
      version: "latest",
    });
    expect(url).toContain("search=file+system");
    expect(url).toContain("limit=10");
    expect(url).toContain("updated_since=2026-01-01T00%3A00%3A00Z");
    expect(url).toContain("version=latest");
  });

  it("encodes server names with slashes safely", () => {
    expect(buildMcpVersionsUrl("https://registry.modelcontextprotocol.io", "io.github.o/ps")).toContain(
      "io.github.o%2Fps",
    );
    expect(buildMcpVersionDetailUrl("https://registry.modelcontextprotocol.io", "a/b", "1.0.0")).toContain("1.0.0");
  });
});

describe("MCP normalization truth boundaries", () => {
  const retrievedAt = "2026-09-24T00:00:00.000Z";

  it("normalizes live discovery as REMOTE_REGISTRY / CATALOG with no runtime proof", () => {
    const normalized = normalizeMcpServer(MCP_LIST_FIXTURE.servers[0], retrievedAt, "LIVE");
    expect(normalized.sourceId).toBe("mcp-official-registry");
    expect(normalized.authority).toEqual({ kind: "REMOTE_REGISTRY" });
    expect(normalized.availability).toBe("CATALOG");
    expect(normalized.runtimeEvidence.state).toBe("NOT_AVAILABLE");
    expect(normalized.trustStage).toBe("CATALOG_DISCOVERED");
    expect(normalized.freshness).toEqual({ state: "CURRENT", at: retrievedAt });
    expect(normalized.provenance.origin).toBe("LIVE");
  });

  it("marks cache-served records CACHED_REMOTE distinctly from live", () => {
    const normalized = normalizeMcpServer(MCP_LIST_FIXTURE.servers[0], retrievedAt, "CACHE");
    expect(normalized.authority).toEqual({ kind: "CACHED_REMOTE", originalKind: "REMOTE_REGISTRY" });
    expect(normalized.freshness.state).toBe("CACHED");
    expect(normalized.provenance.origin).toBe("CACHE");
  });

  it("captures supplied sha256 as EXPECTED integrity, never as publisher proof", () => {
    const normalized = normalizeMcpServer(MCP_LIST_FIXTURE.servers[0], retrievedAt, "LIVE");
    expect(normalized.integrity.state).toBe("EXPECTED");
    expect(normalized.integrity.expectedHash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(normalized.signature.state).toBe("NOT_AVAILABLE");
  });

  it("keeps missing integrity/license as MISSING/UNKNOWN, never open-source", () => {
    const normalized = normalizeMcpServer(MCP_LIST_FIXTURE.servers[1], retrievedAt, "LIVE");
    expect(normalized.integrity.state).toBe("MISSING");
    expect(normalized.license.state).toBe("UNKNOWN");
    expect(normalized.license.license).toBeUndefined();
  });

  it("projects onto MarketplaceItem with install disabled and catalog availability", () => {
    const item = mcpServerToMarketplaceItem(normalizeMcpServer(MCP_LIST_FIXTURE.servers[0], retrievedAt, "LIVE"), retrievedAt);
    expect(item.id).toBe("mcp:io.github.owner/filesystem");
    expect(item.authority.kind).toBe("REMOTE_REGISTRY");
    expect(item.availability).toBe("CATALOG");
    expect(item.installed).toBe(false);
    expect(item.trust).toBe("UNTRUSTED");
    expect(item.installAction).toBe("NOT_AVAILABLE");
    expect(item.runtimeEvidence.state).toBe("NOT_AVAILABLE");
    expect(item.actionEligibility.actions.find((action) => action.id === "install")?.enabled).toBe(false);
    expect(item.permissions).toHaveLength(9);
  });
});

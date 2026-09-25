import { describe, expect, it } from "vitest";
import {
  buildOvsxExtensionUrl,
  buildOvsxSearchUrl,
  buildOvsxVersionUrl,
  buildOvsxVersionsUrl,
  normalizeOvsxExtension,
  ovsxExtensionToMarketplaceItem,
  parseOvsxExtensionResponse,
  parseOvsxSearchResponse,
  parseOvsxVersionResponse,
  parseOvsxVersionsResponse,
} from "./openVsx";
import { OVSX_EXTENSION_FIXTURE, OVSX_SEARCH_FIXTURE, OVSX_VERSIONS_FIXTURE, OVSX_VERSION_FIXTURE } from "./fixtures/openVsxFixtures";

describe("Open VSX response validation", () => {
  it("parses a valid extension search with pagination", () => {
    const result = parseOvsxSearchResponse(JSON.stringify(OVSX_SEARCH_FIXTURE));
    expect(result.extensions).toHaveLength(2);
    expect(result.extensions[0].namespace).toBe("redhat");
    expect(result.totalSize).toBe(2);
  });

  it("accepts a bare array search shape", () => {
    const result = parseOvsxSearchResponse(JSON.stringify(OVSX_SEARCH_FIXTURE.extensions));
    expect(result.extensions).toHaveLength(2);
  });

  it("parses an empty result without fabricating entries", () => {
    expect(parseOvsxSearchResponse(JSON.stringify({ extensions: [] })).extensions).toEqual([]);
  });

  it("refuses malformed JSON", () => {
    expect(() => parseOvsxSearchResponse("{nope")).toThrow(/malformed JSON/);
  });

  it("refuses schema mismatches (missing namespace identity)", () => {
    expect(() => parseOvsxSearchResponse(JSON.stringify({ extensions: [{ name: "no-namespace" }] }))).toThrow(/response shape/);
    expect(() => parseOvsxSearchResponse(JSON.stringify({ extensions: "nope" }))).toThrow(/response shape/);
    expect(() => parseOvsxSearchResponse(JSON.stringify({ nope: true }))).toThrow(/response shape/);
  });

  it("parses extension detail and version detail", () => {
    expect(parseOvsxExtensionResponse(JSON.stringify(OVSX_EXTENSION_FIXTURE)).version).toBe("1.18.0");
    expect(parseOvsxVersionResponse(JSON.stringify(OVSX_VERSION_FIXTURE)).version).toBe("1.17.0");
  });

  it("refuses version detail without an immutable version", () => {
    expect(() => parseOvsxVersionResponse(JSON.stringify({ namespace: "a", name: "b" }))).toThrow(/immutable version/);
  });

  it("parses version references in mixed shapes", () => {
    expect(parseOvsxVersionsResponse(JSON.stringify(OVSX_VERSIONS_FIXTURE))).toEqual(["1.18.0", "1.17.0", "1.16.0"]);
    expect(parseOvsxVersionsResponse(JSON.stringify(["2.0.0"]))).toEqual(["2.0.0"]);
    expect(() => parseOvsxVersionsResponse(JSON.stringify({ versions: [] }))).toThrow(/response shape/);
    expect(() => parseOvsxVersionsResponse(JSON.stringify({ nope: true }))).toThrow(/response shape/);
  });
});

describe("Open VSX URL builders", () => {
  it("encodes search, category, size, and offset", () => {
    const url = buildOvsxSearchUrl("https://open-vsx.org", { query: "yaml kubernetes", category: "Programming Languages", size: 20, offset: 40 });
    expect(url).toContain("query=yaml+kubernetes");
    expect(url).toContain("size=20");
    expect(url).toContain("offset=40");
  });

  it("encodes namespace/extension/version path segments", () => {
    expect(buildOvsxExtensionUrl("https://open-vsx.org", "red-hat", "my.ext")).toContain("/api/red-hat/my.ext");
    expect(buildOvsxVersionUrl("https://open-vsx.org", "a", "b", "1.0.0")).toContain("/api/a/b/1.0.0");
    expect(buildOvsxVersionsUrl("https://open-vsx.org", "a", "b")).toContain("/api/a/b/versions");
  });
});

describe("Open VSX normalization truth boundaries", () => {
  const retrievedAt = "2026-09-24T00:00:00.000Z";

  it("normalizes live discovery as REMOTE_REGISTRY / CATALOG with no runtime proof", () => {
    const normalized = normalizeOvsxExtension(OVSX_SEARCH_FIXTURE.extensions[0], retrievedAt, "LIVE", ["1.18.0", "1.17.0"]);
    expect(normalized.sourceId).toBe("open-vsx");
    expect(normalized.authority).toEqual({ kind: "REMOTE_REGISTRY" });
    expect(normalized.availability).toBe("CATALOG");
    expect(normalized.runtimeEvidence.state).toBe("NOT_AVAILABLE");
    expect(normalized.trustStage).toBe("CATALOG_DISCOVERED");
    expect(normalized.freshness).toEqual({ state: "CURRENT", at: retrievedAt });
    expect(normalized.verified).toBe(true);
    expect(normalized.versions).toEqual(["1.18.0", "1.17.0"]);
  });

  it("marks cache-served records CACHED_REMOTE distinctly from live", () => {
    const normalized = normalizeOvsxExtension(OVSX_SEARCH_FIXTURE.extensions[0], retrievedAt, "CACHE");
    expect(normalized.authority).toEqual({ kind: "CACHED_REMOTE", originalKind: "REMOTE_REGISTRY" });
    expect(normalized.freshness.state).toBe("CACHED");
    expect(normalized.provenance.origin).toBe("CACHE");
  });

  it("notes signature assets without trusting them", () => {
    const normalized = normalizeOvsxExtension(OVSX_SEARCH_FIXTURE.extensions[0], retrievedAt, "LIVE");
    expect(normalized.signature.state).toBe("NOT_AVAILABLE");
    expect(normalized.signature.source).toMatch(/presence is not verification/);
  });

  it("keeps missing integrity/license as MISSING/UNKNOWN, never open-source", () => {
    const normalized = normalizeOvsxExtension(OVSX_SEARCH_FIXTURE.extensions[1], retrievedAt, "LIVE");
    expect(normalized.integrity.state).toBe("MISSING");
    expect(normalized.license.state).toBe("UNKNOWN");
    expect(normalized.license.license).toBeUndefined();
  });

  it("projects onto MarketplaceItem as an extension with install disabled", () => {
    const item = ovsxExtensionToMarketplaceItem(
      normalizeOvsxExtension(OVSX_SEARCH_FIXTURE.extensions[0], retrievedAt, "LIVE", ["1.18.0"]),
      retrievedAt,
    );
    expect(item.id).toBe("openvsx:redhat/vscode-yaml");
    expect(item.category).toBe("plugins");
    expect(item.taxonomy).toEqual(["extensions"]);
    expect(item.authority.kind).toBe("REMOTE_REGISTRY");
    expect(item.availability).toBe("CATALOG");
    expect(item.installed).toBe(false);
    expect(item.trust).toBe("UNTRUSTED");
    expect(item.installAction).toBe("NOT_AVAILABLE");
    expect(item.runtimeEvidence.state).toBe("NOT_AVAILABLE");
    expect(item.actionEligibility.actions.find((action) => action.id === "install")?.enabled).toBe(false);
    expect(item.permissions).toHaveLength(9);
    expect(item.releaseHistory.items).toEqual(["1.18.0"]);
  });
});

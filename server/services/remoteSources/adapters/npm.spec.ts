import { describe, expect, it } from "vitest";
import {
  buildNpmPackageUrl,
  buildNpmSearchUrl,
  buildNpmVersionUrl,
  normalizeNpmPackage,
  normalizeNpmSearchRecord,
  npmPackageToMarketplaceItem,
  parseNpmPackageResponse,
  parseNpmSearchResponse,
  parseNpmVersionResponse,
  validatedNpmPackageName,
  validatedNpmVersion,
} from "./npm";
import { NPM_PACKAGE_FIXTURE, NPM_SEARCH_FIXTURE, NPM_VERSION_FIXTURE } from "./fixtures/npmFixtures";

describe("npm response validation", () => {
  it("parses search with packages", () => {
    const result = parseNpmSearchResponse(JSON.stringify(NPM_SEARCH_FIXTURE));
    expect(result.packages).toHaveLength(2);
    expect(result.packages[0].name).toBe("left-pad");
    expect(result.total).toBe(2);
  });

  it("parses empty search without fabricating", () => {
    expect(parseNpmSearchResponse(JSON.stringify({ objects: [], total: 0 })).packages).toEqual([]);
  });

  it("refuses malformed JSON and schema mismatches", () => {
    expect(() => parseNpmSearchResponse("{nope")).toThrow(/malformed JSON/);
    expect(() => parseNpmSearchResponse(JSON.stringify({ objects: [{ package: { description: "no name" } }] }))).toThrow(/response shape/);
    expect(() => parseNpmSearchResponse(JSON.stringify({ nope: true }))).toThrow(/response shape/);
  });

  it("parses package detail and version detail", () => {
    expect(parseNpmPackageResponse(JSON.stringify(NPM_PACKAGE_FIXTURE)).name).toBe("left-pad");
    expect(parseNpmVersionResponse(JSON.stringify(NPM_VERSION_FIXTURE)).version).toBe("1.3.0");
    expect(() => parseNpmVersionResponse(JSON.stringify({ description: "no version" }))).toThrow(/response shape/);
  });

  it("validates package names and versions before any request", () => {
    expect(validatedNpmPackageName("left-pad")).toBe("left-pad");
    expect(validatedNpmPackageName("@babel/core")).toBe("@babel/core");
    expect(() => validatedNpmPackageName("")).toThrow();
    expect(() => validatedNpmPackageName("../../etc")).toThrow();
    expect(validatedNpmVersion("1.3.0")).toBe("1.3.0");
    expect(() => validatedNpmVersion("")).toThrow();
  });

  it("builds URLs with correct encoding for scoped packages", () => {
    expect(buildNpmSearchUrl("https://registry.npmjs.org", { text: "left pad", size: 10 })).toContain("text=left+pad");
    expect(buildNpmPackageUrl("https://registry.npmjs.org", "@babel/core")).toBe("https://registry.npmjs.org/@babel/core");
    expect(buildNpmVersionUrl("https://registry.npmjs.org", "left-pad", "1.3.0")).toBe("https://registry.npmjs.org/left-pad/1.3.0");
  });
});

describe("npm normalization truth boundaries", () => {
  const retrievedAt = "2026-09-24T00:00:00.000Z";

  it("normalizes search records as CATALOG with no integrity", () => {
    const normalized = normalizeNpmSearchRecord(NPM_SEARCH_FIXTURE.objects[0].package, retrievedAt, "LIVE");
    expect(normalized.sourceId).toBe("npm-registry");
    expect(normalized.authority).toEqual({ kind: "REMOTE_REGISTRY" });
    expect(normalized.availability).toBe("CATALOG");
    expect(normalized.runtimeEvidence.state).toBe("NOT_AVAILABLE");
    expect(normalized.integrity.state).toBe("MISSING");
  });

  it("normalizes package detail with expected integrity and license", () => {
    const normalized = normalizeNpmPackage(NPM_PACKAGE_FIXTURE, retrievedAt, "LIVE");
    expect(normalized.name).toBe("left-pad");
    expect(normalized.version).toBe("1.3.0");
    expect(normalized.latestVersion).toBe("1.3.0");
    expect(normalized.versions).toContain("1.3.0");
    expect(normalized.license).toMatchObject({ state: "CLASSIFIED", license: "WTFPL" });
    expect(normalized.integrity.state).toBe("EXPECTED");
    expect(normalized.integrity.expectedHash).toContain("sha512");
    expect(normalized.tarballUrl).toContain("left-pad-1.3.0.tgz");
  });

  it("keeps missing license as UNKNOWN", () => {
    const rec = { ...NPM_PACKAGE_FIXTURE, license: undefined, versions: { "1.0.0": { name: "x", version: "1.0.0" } } } as unknown as typeof NPM_PACKAGE_FIXTURE;
    const normalized = normalizeNpmPackage(rec, retrievedAt, "LIVE");
    expect(normalized.license.state).toBe("UNKNOWN");
  });

  it("projects onto MarketplaceItem as catalog with install disabled", () => {
    const item = npmPackageToMarketplaceItem(normalizeNpmPackage(NPM_PACKAGE_FIXTURE, retrievedAt, "LIVE"), retrievedAt);
    expect(item.id).toBe("npm:left-pad");
    expect(item.category).toBe("plugins");
    expect(item.authority.kind).toBe("REMOTE_REGISTRY");
    expect(item.availability).toBe("CATALOG");
    expect(item.installed).toBe(false);
    expect(item.trust).toBe("UNTRUSTED");
    expect(item.installAction).toBe("NOT_AVAILABLE");
  });
});

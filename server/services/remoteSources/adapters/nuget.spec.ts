import { describe, expect, it } from "vitest";
import {
  buildNugetRegistrationUrl,
  buildNugetSearchUrl,
  normalizeNugetCatalogEntry,
  normalizeNugetSearchRecord,
  nugetPackageToMarketplaceItem,
  parseNugetRegistrationResponse,
  parseNugetSearchResponse,
  validatedNugetPackageId,
} from "./nuget";
import { NUGET_REGISTRATION_FIXTURE, NUGET_SEARCH_FIXTURE } from "./fixtures/nugetFixtures";

describe("NuGet response validation", () => {
  it("parses search with packages", () => {
    const result = parseNugetSearchResponse(JSON.stringify(NUGET_SEARCH_FIXTURE));
    expect(result.packages).toHaveLength(2);
    expect(result.packages[0].id).toBe("Newtonsoft.Json");
    expect(result.totalHits).toBe(2);
  });

  it("parses empty search without fabricating", () => {
    expect(parseNugetSearchResponse(JSON.stringify({ data: [] })).packages).toEqual([]);
  });

  it("refuses malformed JSON and schema mismatches", () => {
    expect(() => parseNugetSearchResponse("{nope")).toThrow(/malformed JSON/);
    expect(() => parseNugetSearchResponse(JSON.stringify({ data: [{ description: "no id" }] }))).toThrow(/response shape/);
    expect(() => parseNugetSearchResponse(JSON.stringify({ nope: true }))).toThrow(/response shape/);
  });

  it("parses registration with catalog entries", () => {
    const entries = parseNugetRegistrationResponse(JSON.stringify(NUGET_REGISTRATION_FIXTURE));
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe("Newtonsoft.Json");
    expect(entries[0].version).toBe("13.0.3");
  });

  it("validates package ids before any request", () => {
    expect(validatedNugetPackageId("Newtonsoft.Json")).toBe("Newtonsoft.Json");
    expect(() => validatedNugetPackageId("")).toThrow();
    expect(() => validatedNugetPackageId("../../etc")).toThrow();
  });

  it("builds URLs correctly", () => {
    expect(buildNugetSearchUrl("https://azuresearch-usnc.nuget.org/query", { q: "json", take: 10 })).toContain("q=json");
    expect(buildNugetRegistrationUrl("https://api.nuget.org/v3/registration5-gz-semver2", "Newtonsoft.Json")).toBe(
      "https://api.nuget.org/v3/registration5-gz-semver2/newtonsoft.json/index.json",
    );
  });
});

describe("NuGet normalization truth boundaries", () => {
  const retrievedAt = "2026-09-24T00:00:00.000Z";

  it("normalizes search records as CATALOG", () => {
    const normalized = normalizeNugetSearchRecord(NUGET_SEARCH_FIXTURE.data[0], retrievedAt, "LIVE");
    expect(normalized.sourceId).toBe("nuget-v3");
    expect(normalized.authority).toEqual({ kind: "REMOTE_REGISTRY" });
    expect(normalized.availability).toBe("CATALOG");
    expect(normalized.runtimeEvidence.state).toBe("NOT_AVAILABLE");
    expect(normalized.verified).toBe(true);
    expect(normalized.tags).toContain("json");
  });

  it("normalizes registration entries with versions", () => {
    const entries = parseNugetRegistrationResponse(JSON.stringify(NUGET_REGISTRATION_FIXTURE));
    const normalized = normalizeNugetCatalogEntry(entries[0], retrievedAt, "LIVE", "CURRENT", ["13.0.3", "13.0.2"]);
    expect(normalized.versions).toEqual(["13.0.3", "13.0.2"]);
    expect(normalized.license.state).toBe("CLASSIFIED");
  });

  it("keeps missing license as UNKNOWN", () => {
    const normalized = normalizeNugetSearchRecord(NUGET_SEARCH_FIXTURE.data[1], retrievedAt, "LIVE");
    expect(normalized.license.state).toBe("UNKNOWN");
  });

  it("projects onto MarketplaceItem as catalog with install disabled", () => {
    const item = nugetPackageToMarketplaceItem(normalizeNugetSearchRecord(NUGET_SEARCH_FIXTURE.data[0], retrievedAt, "LIVE"), retrievedAt);
    expect(item.id).toBe("nuget:Newtonsoft.Json");
    expect(item.category).toBe("plugins");
    expect(item.authority.kind).toBe("REMOTE_REGISTRY");
    expect(item.availability).toBe("CATALOG");
    expect(item.installed).toBe(false);
    expect(item.trust).toBe("UNTRUSTED");
    expect(item.installAction).toBe("NOT_AVAILABLE");
  });
});

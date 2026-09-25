import { describe, expect, it } from "vitest";
import {
  buildWingetManifestUrl,
  buildWingetSearchUrl,
  normalizeWingetManifest,
  normalizeWingetSearchRecord,
  parseWingetManifestYaml,
  parseWingetSearchResponse,
  validatedWingetPackageId,
  wingetPackageToMarketplaceItem,
} from "./winget";
import { WINGET_MANIFEST_FIXTURE, WINGET_MINIMAL_MANIFEST_FIXTURE, WINGET_SEARCH_FIXTURE } from "./fixtures/wingetFixtures";

describe("WinGet response validation", () => {
  it("parses search with packages", () => {
    const result = parseWingetSearchResponse(JSON.stringify(WINGET_SEARCH_FIXTURE));
    expect(result.packages).toHaveLength(2);
    expect(result.packages[0].path).toBe("manifests/g/Git/Git/2.44.0");
    expect(result.totalCount).toBe(2);
  });

  it("filters non-version directories from search results", () => {
    const result = parseWingetSearchResponse(JSON.stringify([
      ...WINGET_SEARCH_FIXTURE,
      { name: "Beta", path: "manifests/m/Microsoft/Edge/Beta", type: "dir" },
      { name: "Canary", path: "manifests/m/Microsoft/Edge/Canary", type: "dir" },
    ]));
    expect(result.packages.map((item) => item.name)).toEqual(["2.44.0", "2.43.0"]);
  });

  it("parses empty search without fabricating", () => {
    expect(parseWingetSearchResponse(JSON.stringify([])).packages).toEqual([]);
  });

  it("refuses malformed JSON and schema mismatches", () => {
    expect(() => parseWingetSearchResponse("{nope")).toThrow(/malformed JSON/);
    expect(() => parseWingetSearchResponse(JSON.stringify({ items: [{ path: 123 }] }))).toThrow(/response shape/);
  });

  it("parses manifest YAML with installers", () => {
    const manifest = parseWingetManifestYaml(WINGET_MANIFEST_FIXTURE);
    expect(manifest.packageIdentifier).toBe("Git.Git");
    expect(manifest.packageVersion).toBe("2.44.0");
    expect(manifest.installers).toHaveLength(2);
    expect(manifest.installers[0].installerSha256).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(() => parseWingetManifestYaml(WINGET_MINIMAL_MANIFEST_FIXTURE)).not.toThrow();
    expect(() => parseWingetManifestYaml("no identifier")).toThrow(/manifest without PackageIdentifier/);
  });

  it("validates package ids before any request", () => {
    expect(validatedWingetPackageId("Git.Git")).toBe("Git.Git");
    expect(validatedWingetPackageId("Microsoft.VisualStudioCode")).toBe("Microsoft.VisualStudioCode");
    expect(() => validatedWingetPackageId("")).toThrow();
    expect(() => validatedWingetPackageId("../../etc")).toThrow();
    expect(() => validatedWingetPackageId("no-dot")).toThrow();
  });

  it("builds URLs correctly", () => {
    expect(buildWingetSearchUrl("https://api.github.com/repos/microsoft/winget-pkgs/contents", "Git.Git")).toBe(
      "https://api.github.com/repos/microsoft/winget-pkgs/contents/manifests/g/Git/Git",
    );
    expect(buildWingetManifestUrl("Git.Git", "2.44.0")).toBe(
      "https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests/g/Git/Git/2.44.0/Git.Git.installer.yaml",
    );
  });
});

describe("WinGet normalization truth boundaries", () => {
  const retrievedAt = "2026-09-24T00:00:00.000Z";

  it("normalizes manifest as CATALOG with expected hash", () => {
    const manifest = parseWingetManifestYaml(WINGET_MANIFEST_FIXTURE);
    const normalized = normalizeWingetManifest(manifest, retrievedAt, "LIVE");
    expect(normalized.sourceId).toBe("winget-community");
    expect(normalized.authority).toEqual({ kind: "REMOTE_REGISTRY" });
    expect(normalized.availability).toBe("CATALOG");
    expect(normalized.runtimeEvidence.state).toBe("NOT_AVAILABLE");
    expect(normalized.packageId).toBe("Git.Git");
    expect(normalized.packageVersion).toBe("2.44.0");
    expect(normalized.integrity.state).toBe("EXPECTED");
    expect(normalized.installers).toHaveLength(2);
  });

  it("keeps missing hash as MISSING", () => {
    const manifest = parseWingetManifestYaml(WINGET_MINIMAL_MANIFEST_FIXTURE);
    const normalized = normalizeWingetManifest(manifest, retrievedAt, "LIVE");
    expect(normalized.integrity.state).toBe("MISSING");
    expect(normalized.license.state).toBe("UNKNOWN");
  });

  it("normalizes search records as CATALOG", () => {
    const parsed = parseWingetSearchResponse(JSON.stringify(WINGET_SEARCH_FIXTURE));
    const normalized = normalizeWingetSearchRecord(parsed.packages[0], retrievedAt, "LIVE");
    expect(normalized.packageId).toBe("Git.Git");
    expect(normalized.authority.kind).toBe("REMOTE_REGISTRY");
  });

  it("projects onto MarketplaceItem as catalog with install disabled", () => {
    const manifest = parseWingetManifestYaml(WINGET_MANIFEST_FIXTURE);
    const item = wingetPackageToMarketplaceItem(normalizeWingetManifest(manifest, retrievedAt, "LIVE"), retrievedAt);
    expect(item.id).toBe("winget:Git.Git@2.44.0");
    expect(item.category).toBe("plugins");
    expect(item.authority.kind).toBe("REMOTE_REGISTRY");
    expect(item.availability).toBe("CATALOG");
    expect(item.installed).toBe(false);
    expect(item.trust).toBe("UNTRUSTED");
    expect(item.installAction).toBe("NOT_AVAILABLE");
  });
});

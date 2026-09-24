import { describe, expect, it } from "vitest";
import {
  buildKforgeReleaseTagUrl,
  buildKforgeReleasesUrl,
  classifyReleaseAsset,
  compareReleaseVersions,
  decideKforgeUpdate,
  normalizeKforgeRelease,
  parseKforgeReleaseResponse,
  parseKforgeReleasesResponse,
  parseReleaseVersion,
  releaseChannelOf,
  validatedReleaseTag,
} from "./githubReleases";
import { KFORGE_RELEASES_FIXTURE, KFORGE_RELEASE_DETAIL_FIXTURE } from "./fixtures/githubReleasesFixtures";

describe("KForge Releases response validation", () => {
  it("parses a release list", () => {
    const releases = parseKforgeReleasesResponse(JSON.stringify(KFORGE_RELEASES_FIXTURE));
    expect(releases.map((entry) => entry.tag_name)).toEqual(["v0.1.0", "v0.2.0", "v0.3.0-beta.1", "v0.4.0-draft"]);
  });

  it("parses an empty list without fabricating releases", () => {
    expect(parseKforgeReleasesResponse(JSON.stringify([]))).toEqual([]);
  });

  it("refuses malformed JSON and schema mismatches", () => {
    expect(() => parseKforgeReleasesResponse("{nope")).toThrow(/malformed JSON/);
    expect(() => parseKforgeReleasesResponse(JSON.stringify([{ name: "no tag" }]))).toThrow(/response shape/);
    expect(() => parseKforgeReleasesResponse(JSON.stringify({ nope: true }))).toThrow(/response shape/);
  });

  it("parses release detail", () => {
    expect(parseKforgeReleaseResponse(JSON.stringify(KFORGE_RELEASE_DETAIL_FIXTURE)).tag_name).toBe("v0.2.0");
  });

  it("validates tags and builds documented URLs", () => {
    expect(validatedReleaseTag("v0.2.0")).toBe("v0.2.0");
    expect(() => validatedReleaseTag("../../etc")).toThrow();
    expect(buildKforgeReleasesUrl("https://api.github.com", { perPage: 30 })).toContain("per_page=30");
    expect(buildKforgeReleaseTagUrl("https://api.github.com", "v0.2.0")).toContain("/releases/tags/v0.2.0");
  });
});

describe("Release version and channel truth", () => {
  it("parses semver tags and leaves other tags unparsed but listed", () => {
    expect(parseReleaseVersion("v0.2.0")).toMatchObject({ major: 0, minor: 2, patch: 0, prerelease: false, unparsed: false });
    expect(parseReleaseVersion("v0.3.0-beta.1").prerelease).toBe(true);
    expect(parseReleaseVersion("nightly-2026").unparsed).toBe(true);
  });

  it("orders versions with prerelease below stable", () => {
    expect(compareReleaseVersions(parseReleaseVersion("v0.2.0"), parseReleaseVersion("v0.1.0"))).toBeGreaterThan(0);
    expect(compareReleaseVersions(parseReleaseVersion("v0.3.0-beta.1"), parseReleaseVersion("v0.3.0"))).toBeLessThan(0);
    expect(compareReleaseVersions(parseReleaseVersion("v0.2.0"), parseReleaseVersion("v0.2.0"))).toBe(0);
  });

  it("classifies channels and asset kinds", () => {
    const records = parseKforgeReleasesResponse(JSON.stringify(KFORGE_RELEASES_FIXTURE));
    expect(records.map(releaseChannelOf)).toEqual(["stable", "stable", "prerelease", "draft"]);
    expect(classifyReleaseAsset("KNOuX-Forge-Setup-v0.2.0-Windows-x64.exe")).toBe("nsis-installer");
    expect(classifyReleaseAsset("KNOuX-Forge-Setup-v0.2.0-Windows-x64.exe.sha256")).toBe("checksum");
    expect(classifyReleaseAsset("installer.sig")).toBe("signature");
    expect(classifyReleaseAsset("sbom.json")).toBe("sbom");
    expect(classifyReleaseAsset("README.md")).toBe("other");
  });
});

describe("Release normalization and update decisions", () => {
  const retrievedAt = "2026-09-24T00:00:00.000Z";

  it("normalizes catalog facts with asset evidence", () => {
    const normalized = normalizeKforgeRelease(KFORGE_RELEASE_DETAIL_FIXTURE, retrievedAt, "LIVE");
    expect(normalized.tag).toBe("v0.2.0");
    expect(normalized.channel).toBe("stable");
    expect(normalized.targetCommit).toBe("abc1234");
    expect(normalized.nsisAsset?.name).toContain("Windows-x64.exe");
    expect(normalized.nsisAsset?.expectedSha256).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(normalized.checksumAssets).toHaveLength(1);
    expect(normalized.freshness).toBe("CURRENT");
  });

  it("reports UPDATE_AVAILABLE as a catalog fact while trusted install stays BLOCKED", () => {
    const releases = KFORGE_RELEASES_FIXTURE.map((record) => normalizeKforgeRelease(record, retrievedAt, "LIVE"));
    const decision = decideKforgeUpdate(releases, "0.1.0");
    expect(decision.availability).toBe("UPDATE_AVAILABLE");
    expect(decision.latestStable?.tag).toBe("v0.2.0");
    expect(decision.latestPrerelease?.tag).toBe("v0.3.0-beta.1");
    expect(decision.trustedUpdate).toBe("BLOCKED");
    expect(decision.trustedBlockers.map((blocker) => blocker.id)).toEqual(["checksum-unverified", "signature-unavailable", "workflow-unimplemented"]);
  });

  it("reports UP_TO_DATE without implying trust", () => {
    const releases = KFORGE_RELEASES_FIXTURE.map((record) => normalizeKforgeRelease(record, retrievedAt, "LIVE"));
    const decision = decideKforgeUpdate(releases, "0.2.0");
    expect(decision.availability).toBe("UP_TO_DATE");
    expect(decision.trustedUpdate).toBe("BLOCKED");
  });

  it("excludes drafts and unparsed tags from comparisons", () => {
    const releases = KFORGE_RELEASES_FIXTURE.map((record) => normalizeKforgeRelease(record, retrievedAt, "LIVE"));
    const decision = decideKforgeUpdate(releases, "9.9.9");
    // Installed is newer than every comparable stable: UP_TO_DATE, never UNKNOWN-by-draft.
    expect(decision.availability).toBe("UP_TO_DATE");
    const unknown = decideKforgeUpdate([], "0.1.0");
    expect(unknown.availability).toBe("UNKNOWN");
  });
});

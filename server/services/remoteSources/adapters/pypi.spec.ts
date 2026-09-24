import { describe, expect, it } from "vitest";
import {
  buildPypiPackageUrl,
  normalizePypiPackage,
  parsePypiPackageResponse,
  pypiPackageToMarketplaceItem,
  validatedPypiPackageName,
} from "./pypi";
import { PYPI_MINIMAL_FIXTURE, PYPI_PACKAGE_FIXTURE } from "./fixtures/pypiFixtures";

describe("PyPI response validation", () => {
  it("parses package detail", () => {
    expect(parsePypiPackageResponse(JSON.stringify(PYPI_PACKAGE_FIXTURE)).info.name).toBe("requests");
  });

  it("refuses malformed JSON and schema mismatches", () => {
    expect(() => parsePypiPackageResponse("{nope")).toThrow(/malformed JSON/);
    expect(() => parsePypiPackageResponse(JSON.stringify({ info: { summary: "no name" } }))).toThrow(/response shape/);
  });

  it("validates package names before any request", () => {
    expect(validatedPypiPackageName("requests")).toBe("requests");
    expect(validatedPypiPackageName("my-package_2.0")).toBe("my-package_2.0");
    expect(() => validatedPypiPackageName("")).toThrow();
    expect(() => validatedPypiPackageName("../../etc")).toThrow();
  });

  it("builds URLs with correct encoding", () => {
    expect(buildPypiPackageUrl("https://pypi.org", "requests")).toBe("https://pypi.org/pypi/requests/json");
  });
});

describe("PyPI normalization truth boundaries", () => {
  const retrievedAt = "2026-09-24T00:00:00.000Z";

  it("normalizes package detail as CATALOG with license and integrity", () => {
    const normalized = normalizePypiPackage(PYPI_PACKAGE_FIXTURE, retrievedAt, "LIVE");
    expect(normalized.sourceId).toBe("pypi");
    expect(normalized.authority).toEqual({ kind: "REMOTE_REGISTRY" });
    expect(normalized.availability).toBe("CATALOG");
    expect(normalized.runtimeEvidence.state).toBe("NOT_AVAILABLE");
    expect(normalized.version).toBe("2.31.0");
    expect(normalized.latestVersion).toBe("2.31.0");
    expect(normalized.versions).toContain("2.31.0");
    expect(normalized.license).toMatchObject({ state: "CLASSIFIED", license: "Apache 2.0" });
    expect(normalized.integrity.state).toBe("EXPECTED");
    expect(normalized.integrity.expectedHash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(normalized.repositoryUrl).toContain("github.com/psf/requests");
  });

  it("keeps missing license/integrity as UNKNOWN/MISSING", () => {
    const normalized = normalizePypiPackage(PYPI_MINIMAL_FIXTURE, retrievedAt, "LIVE");
    expect(normalized.license.state).toBe("UNKNOWN");
    expect(normalized.integrity.state).toBe("MISSING");
  });

  it("projects onto MarketplaceItem as catalog with install disabled", () => {
    const item = pypiPackageToMarketplaceItem(normalizePypiPackage(PYPI_PACKAGE_FIXTURE, retrievedAt, "LIVE"), retrievedAt);
    expect(item.id).toBe("pypi:requests");
    expect(item.category).toBe("plugins");
    expect(item.authority.kind).toBe("REMOTE_REGISTRY");
    expect(item.availability).toBe("CATALOG");
    expect(item.installed).toBe(false);
    expect(item.trust).toBe("UNTRUSTED");
    expect(item.installAction).toBe("NOT_AVAILABLE");
  });
});

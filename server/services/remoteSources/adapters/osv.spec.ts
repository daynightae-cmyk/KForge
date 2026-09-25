import { describe, expect, it } from "vitest";
import {
  buildOsvBatchBody,
  buildOsvQueryBody,
  normalizeOsvAdvisory,
  parseOsvBatchResponse,
  parseOsvQueryResponse,
  parseOsvVulnResponse,
  validatedOsvBatch,
  validatedOsvQuery,
  validatedOsvVulnId,
} from "./osv";
import { OSV_BATCH_FIXTURE, OSV_EMPTY_FIXTURE, OSV_QUERY_FIXTURE, OSV_VULN_FIXTURE, OSV_WITHDRAWN_FIXTURE } from "./fixtures/osvFixtures";

describe("OSV response validation", () => {
  it("parses a package query with advisories", () => {
    const vulns = parseOsvQueryResponse(JSON.stringify(OSV_QUERY_FIXTURE));
    expect(vulns.map((entry) => entry.id)).toEqual(["GHSA-test-0001", "PYSEC-test-0002"]);
  });

  it("treats an absent vulns list as a normal negative result", () => {
    expect(parseOsvQueryResponse(JSON.stringify(OSV_EMPTY_FIXTURE))).toEqual([]);
    expect(parseOsvQueryResponse(JSON.stringify({ vulns: [] }))).toEqual([]);
  });

  it("refuses malformed JSON and schema mismatches", () => {
    expect(() => parseOsvQueryResponse("{nope")).toThrow(/malformed JSON/);
    expect(() => parseOsvQueryResponse(JSON.stringify({ vulns: [{ summary: "no id" }] }))).toThrow(/response shape/);
    expect(() => parseOsvQueryResponse(JSON.stringify({ vulns: "nope" }))).toThrow(/response shape/);
  });

  it("parses batch responses aligned with request order", () => {
    const results = parseOsvBatchResponse(JSON.stringify(OSV_BATCH_FIXTURE));
    expect(results).toHaveLength(2);
    expect(results[0].map((entry) => entry.id)).toEqual(["GHSA-test-0001"]);
    expect(results[1]).toEqual([]);
    expect(() => parseOsvBatchResponse(JSON.stringify({ results: "nope" }))).toThrow(/response shape/);
  });

  it("parses vulnerability detail by id", () => {
    expect(parseOsvVulnResponse(JSON.stringify(OSV_VULN_FIXTURE)).id).toBe("GHSA-test-0001");
    expect(() => parseOsvVulnResponse(JSON.stringify({ summary: "no id" }))).toThrow(/response shape/);
  });
});

describe("OSV request validation", () => {
  it("requires a package selector", () => {
    expect(() => validatedOsvQuery({ version: "1.0.0" })).toThrow(/needs ecosystem\+name/);
    expect(validatedOsvQuery({ ecosystem: "npm", name: "left-pad", version: "1.3.0" })).toEqual({
      ecosystem: "npm",
      name: "left-pad",
      version: "1.3.0",
    });
    expect(validatedOsvQuery({ purl: "pkg:npm/left-pad@1.3.0" })).toEqual({ purl: "pkg:npm/left-pad@1.3.0" });
    expect(() => validatedOsvQuery({ ecosystem: "npm!", name: "x" })).toThrow(/ecosystem/);
    expect(() => validatedOsvQuery({ commit: "not-hex!!" })).toThrow(/commit/);
  });

  it("bounds batch sizes", () => {
    const one = { ecosystem: "npm", name: "a", version: "1.0.0" };
    expect(validatedOsvBatch([one])).toHaveLength(1);
    expect(() => validatedOsvBatch([])).toThrow(/1-25/);
    expect(() => validatedOsvBatch(new Array(26).fill(one))).toThrow(/1-25/);
  });

  it("validates vulnerability ids", () => {
    expect(validatedOsvVulnId("GHSA-abcd-1234")).toBe("GHSA-abcd-1234");
    expect(() => validatedOsvVulnId("../../etc")).toThrow();
  });

  it("builds documented request bodies", () => {
    expect(JSON.parse(buildOsvQueryBody({ ecosystem: "npm", name: "a", version: "1.0.0" }))).toEqual({
      version: "1.0.0",
      package: { ecosystem: "npm", name: "a" },
    });
    expect(JSON.parse(buildOsvQueryBody({ purl: "pkg:npm/a@1.0.0" }))).toEqual({ package: { purl: "pkg:npm/a@1.0.0" } });
    const batch = JSON.parse(buildOsvBatchBody([{ ecosystem: "npm", name: "a", version: "1.0.0" }])) as { queries: unknown[] };
    expect(batch.queries).toHaveLength(1);
  });
});

describe("OSV normalization truth boundaries", () => {
  const retrievedAt = "2026-09-24T00:00:00.000Z";

  it("normalizes advisories with ranges, fixes, severity, and references", () => {
    const advisory = normalizeOsvAdvisory(OSV_VULN_FIXTURE, retrievedAt, "LIVE");
    expect(advisory.id).toBe("GHSA-test-0001");
    expect(advisory.aliases).toEqual(["CVE-2026-00001"]);
    expect(advisory.severityLevel).toBe("high");
    expect(advisory.severityScore).toBe(7.5);
    expect(advisory.fixedVersions).toEqual(["1.2.3"]);
    expect(advisory.affectedRanges[0]).toMatchObject({ rangeType: "SEMVER", introduced: "1.0.0", fixed: "1.2.3" });
    expect(advisory.references[0].url).toContain("GHSA-test-0001");
    expect(advisory.freshness).toBe("CURRENT");
    expect(advisory.origin).toBe("LIVE");
  });

  it("keeps unassessed severity distinct from assessed info", () => {
    const advisory = normalizeOsvAdvisory(OSV_QUERY_FIXTURE.vulns[1], retrievedAt, "LIVE");
    expect(advisory.severityLevel).toBe("unassessed");
    expect(advisory.severityScore).toBeUndefined();
  });

  it("preserves withdrawn state instead of hiding it", () => {
    const advisory = normalizeOsvAdvisory(OSV_WITHDRAWN_FIXTURE, retrievedAt, "LIVE");
    expect(advisory.withdrawn).toBe("2026-04-01T00:00:00Z");
  });

  it("marks cache-served advisories distinctly from live", () => {
    const advisory = normalizeOsvAdvisory(OSV_VULN_FIXTURE, retrievedAt, "CACHE");
    expect(advisory.origin).toBe("CACHE");
    expect(advisory.freshness).toBe("CACHED");
  });
});

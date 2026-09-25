/**
 * Deterministic OSV.dev fixtures (Slice 3).
 *
 * Shapes follow the documented OSV schema (ossf.github.io/osv-schema):
 * advisory identity, aliases, affected package/ranges/events, fixed
 * versions, severity scores, references, published/modified/withdrawn.
 * Unit tests MUST NOT require live OSV network; these fixtures are the
 * contract stand-ins. Optional live tests stay behind KFORGE_LIVE_PROVIDER_TESTS=1.
 */

export const OSV_QUERY_FIXTURE = {
  vulns: [
    {
      id: "GHSA-test-0001",
      summary: "Test advisory with a fixed version.",
      details: "A test vulnerability used for deterministic adapter tests.",
      aliases: ["CVE-2026-00001"],
      affected: [
        {
          package: { ecosystem: "npm", name: "test-package" },
          ranges: [
            {
              type: "SEMVER",
              events: [{ introduced: "1.0.0" }, { fixed: "1.2.3" }],
            },
          ],
        },
      ],
      severity: [{ type: "CVSS_V3", score: "7.5" }],
      references: [{ type: "ADVISORY", url: "https://example.com/advisories/GHSA-test-0001" }],
      published: "2026-01-01T00:00:00Z",
      modified: "2026-02-01T00:00:00Z",
    },
    {
      id: "PYSEC-test-0002",
      summary: "Unassessed test advisory without severity.",
      affected: [
        {
          package: { ecosystem: "PyPI", name: "other-package" },
          versions: ["0.1.0", "0.2.0"],
        },
      ],
      references: [{ type: "WEB", url: "https://example.com/pysec-test-0002" }],
      published: "2026-03-01T00:00:00Z",
      modified: "2026-03-02T00:00:00Z",
    },
  ],
};

export const OSV_EMPTY_FIXTURE = {};

export const OSV_BATCH_FIXTURE = {
  results: [{ vulns: OSV_QUERY_FIXTURE.vulns.slice(0, 1) }, {}],
};

export const OSV_VULN_FIXTURE = OSV_QUERY_FIXTURE.vulns[0];

export const OSV_WITHDRAWN_FIXTURE = {
  ...OSV_QUERY_FIXTURE.vulns[0],
  id: "GHSA-test-0003",
  withdrawn: "2026-04-01T00:00:00Z",
};

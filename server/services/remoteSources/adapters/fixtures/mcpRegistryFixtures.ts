/**
 * Deterministic MCP Registry fixtures (Slice 1).
 *
 * Shapes follow the documented response fields from the research pack
 * (section 5.1): server identity, description, repository, package
 * distributions with registry type/identifier/version, transports, runtime
 * hints, args, environment declarations, and optional sha256 metadata.
 * Unit tests MUST NOT require live MCP network; these fixtures are the
 * contract stand-ins. Optional live tests stay behind KFORGE_LIVE_PROVIDER_TESTS=1.
 */

export const MCP_LIST_FIXTURE = {
  servers: [
    {
      name: "io.github.owner/filesystem",
      description: "Filesystem access for the verified test workspace.",
      repository: { url: "https://github.com/owner/filesystem", source: "github" },
      version: "1.2.0",
      license: "MIT",
      publisher: "owner",
      updated_at: "2026-09-01T00:00:00Z",
      packages: [
        {
          registry_type: "npm",
          identifier: "@owner/mcp-filesystem",
          version: "1.2.0",
          transport: { type: "stdio" },
          runtime_hint: "node",
          package_arguments: [{ name: "--root", required: true }],
          environment_variables: [{ name: "FS_ROOT", required: false }],
          integrity: { sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
        },
      ],
    },
    {
      name: "io.github.other/minimal",
      description: "Minimal record without integrity or license fields.",
      packages: [{ registry_type: "pypi", identifier: "mcp-minimal", version: "0.1.0" }],
    },
  ],
  metadata: { nextCursor: "cursor-abc" },
};

export const MCP_VERSIONS_FIXTURE = {
  versions: [
    { version: "1.2.0", release_date: "2026-09-01T00:00:00Z", description: "Latest.", license: "MIT" },
    { version: "1.1.0", release_date: "2026-06-01T00:00:00Z", description: "Previous." },
  ],
  metadata: {},
};

export const MCP_VERSION_DETAIL_FIXTURE = {
  version: "1.2.0",
  release_date: "2026-09-01T00:00:00Z",
  description: "Filesystem access for the verified test workspace.",
  license: "MIT",
  repository: { url: "https://github.com/owner/filesystem" },
  packages: MCP_LIST_FIXTURE.servers[0].packages,
};

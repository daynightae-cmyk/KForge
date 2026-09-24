/**
 * Deterministic Open VSX fixtures (Slice 2).
 *
 * Shapes follow the documented response fields from the research pack
 * (section 5.2): publisher namespace, extension identity, versions, file
 * assets (VSIX, manifest, license, changelog, signature, public key),
 * license, repository, categories, target platforms, and verified metadata.
 * Unit tests MUST NOT require live Open VSX network; these fixtures are the
 * contract stand-ins. Optional live tests stay behind KFORGE_LIVE_PROVIDER_TESTS=1.
 */

export const OVSX_SEARCH_FIXTURE = {
  extensions: [
    {
      namespace: "redhat",
      name: "vscode-yaml",
      displayName: "YAML",
      description: "YAML language support with schema validation.",
      version: "1.18.0",
      verified: true,
      publishedBy: { login: "redhat-publisher" },
      license: "MIT",
      repository: "https://github.com/redhat-developer/vscode-yaml",
      homepage: "https://github.com/redhat-developer/vscode-yaml",
      downloadUrl: "https://open-vsx.org/api/redhat/vscode-yaml/1.18.0/file/redhat.vscode-yaml-1.18.0.vsix",
      files: {
        download: "https://open-vsx.org/api/redhat/vscode-yaml/1.18.0/file/redhat.vscode-yaml-1.18.0.vsix",
        manifest: "https://open-vsx.org/api/redhat/vscode-yaml/1.18.0/file/package.json",
        license: "https://open-vsx.org/api/redhat/vscode-yaml/1.18.0/file/LICENSE",
        changelog: "https://open-vsx.org/api/redhat/vscode-yaml/1.18.0/file/CHANGELOG.md",
        signature: "https://open-vsx.org/api/redhat/vscode-yaml/1.18.0/file/redhat.vscode-yaml-1.18.0.sigzip",
        publicKey: "https://open-vsx.org/api/redhat/vscode-yaml/public-key",
      },
      categories: ["Programming Languages", "Linters"],
      tags: ["yaml", "kubernetes"],
      targetPlatform: "universal",
      timestamp: "2026-08-01T00:00:00Z",
    },
    {
      namespace: "acme",
      name: "minimal-theme",
      description: "Minimal record without integrity, license, or file assets.",
      version: "0.2.0",
      verified: false,
    },
  ],
  offset: 0,
  totalSize: 2,
};

export const OVSX_EXTENSION_FIXTURE = OVSX_SEARCH_FIXTURE.extensions[0];

export const OVSX_VERSION_FIXTURE = {
  ...OVSX_SEARCH_FIXTURE.extensions[0],
  version: "1.17.0",
  downloadUrl: "https://open-vsx.org/api/redhat/vscode-yaml/1.17.0/file/redhat.vscode-yaml-1.17.0.vsix",
};

export const OVSX_VERSIONS_FIXTURE = {
  versions: [{ version: "1.18.0" }, { version: "1.17.0" }, "1.16.0"],
};

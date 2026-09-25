/**
 * Deterministic KForge GitHub Releases fixtures (Slice 5).
 *
 * Shapes follow the documented GitHub REST release fields: tag_name,
 * name, draft/prerelease flags, published_at, target_commitish, body,
 * and asset entries (name, size, browser_download_url, digest).
 * Unit tests MUST NOT require live GitHub network; these fixtures are the
 * contract stand-ins. Optional live tests stay behind KFORGE_LIVE_PROVIDER_TESTS=1.
 */

export const KFORGE_RELEASES_FIXTURE = [
  {
    tag_name: "v0.1.0",
    name: "KNOuX Forge 0.1.0",
    draft: false,
    prerelease: false,
    created_at: "2026-08-01T00:00:00Z",
    published_at: "2026-08-02T00:00:00Z",
    target_commitish: "main",
    body: "Initial verified release.",
    assets: [
      {
        name: "KNOuX-Forge-Setup-v0.1.0-Windows-x64.exe",
        size: 95000000,
        browser_download_url: "https://github.com/daynightae-cmyk/KForge/releases/download/v0.1.0/KNOuX-Forge-Setup-v0.1.0-Windows-x64.exe",
        digest: null,
      },
    ],
  },
  {
    tag_name: "v0.2.0",
    name: "KNOuX Forge 0.2.0",
    draft: false,
    prerelease: false,
    created_at: "2026-09-01T00:00:00Z",
    published_at: "2026-09-02T00:00:00Z",
    target_commitish: "abc1234",
    body: "Remote source foundation.",
    assets: [
      {
        name: "KNOuX-Forge-Setup-v0.2.0-Windows-x64.exe",
        size: 96000000,
        browser_download_url: "https://github.com/daynightae-cmyk/KForge/releases/download/v0.2.0/KNOuX-Forge-Setup-v0.2.0-Windows-x64.exe",
        digest: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      },
      {
        name: "KNOuX-Forge-Setup-v0.2.0-Windows-x64.exe.sha256",
        size: 120,
        browser_download_url: "https://github.com/daynightae-cmyk/KForge/releases/download/v0.2.0/KNOuX-Forge-Setup-v0.2.0-Windows-x64.exe.sha256",
        digest: null,
      },
    ],
  },
  {
    tag_name: "v0.3.0-beta.1",
    name: "KNOuX Forge 0.3.0 Beta 1",
    draft: false,
    prerelease: true,
    created_at: "2026-09-10T00:00:00Z",
    published_at: "2026-09-11T00:00:00Z",
    target_commitish: "def5678",
    body: "Beta channel.",
    assets: [],
  },
  {
    tag_name: "v0.4.0-draft",
    name: "Unpublished draft",
    draft: true,
    prerelease: false,
    created_at: "2026-09-12T00:00:00Z",
    published_at: null,
    target_commitish: "main",
    body: null,
    assets: [],
  },
];

export const KFORGE_RELEASE_DETAIL_FIXTURE = KFORGE_RELEASES_FIXTURE[1];

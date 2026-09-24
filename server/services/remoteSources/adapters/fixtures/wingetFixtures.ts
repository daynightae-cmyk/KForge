/**
 * Deterministic WinGet fixtures (P1-4).
 */

export const WINGET_SEARCH_FIXTURE = {
  total_count: 2,
  items: [
    {
      name: "Git.Git.yaml",
      path: "manifests/g/Git.Git/2.44.0/Git.Git.yaml",
      sha: "abc123",
      repository: { full_name: "microsoft/winget-pkgs" },
    },
    {
      name: "Git.Git.yaml",
      path: "manifests/g/Git.Git/2.43.0/Git.Git.yaml",
      sha: "def456",
      repository: { full_name: "microsoft/winget-pkgs" },
    },
  ],
};

export const WINGET_MANIFEST_FIXTURE = `
PackageIdentifier: Git.Git
PackageVersion: 2.44.0
PackageName: Git
Publisher: Git
ShortDescription: Distributed version control system
License: GPL-2.0
Homepage: https://git-scm.com
Installers:
  - Architecture: x64
    InstallerType: exe
    InstallerUrl: https://github.com/git-for-windows/git/releases/download/v2.44.0.windows.1/Git-2.44.0-64-bit.exe
    InstallerSha256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    Scope: machine
  - Architecture: x86
    InstallerType: exe
    InstallerUrl: https://github.com/git-for-windows/git/releases/download/v2.44.0.windows.1/Git-2.44.0-32-bit.exe
    InstallerSha256: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
`;

export const WINGET_MINIMAL_MANIFEST_FIXTURE = `
PackageIdentifier: Acme.Minimal
PackageVersion: 0.1.0
`;

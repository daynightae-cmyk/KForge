# KNOuX Forge Windows signing and release modes

Evidence-scoped trust policy. This document describes measured behavior only;
it never claims a Trusted Publisher without OS-verified evidence.

## Release modes

| Mode | Meaning | Signing requirement |
| --- | --- | --- |
| `DEVELOPMENT` (default) | Local development artifact. | May be unsigned. Exposes `SIGNING_STATUS=UNSIGNED`, `TRUST_STATUS=DEVELOPMENT_ARTIFACT`. |
| `RELEASE_CANDIDATE` | Full engineering gate green (audit, typecheck, lint, Vitest, build, Playwright, desktop, Windows package, installer lifecycle). | May remain unsigned but must say so clearly in the manifest, release notes, and verification evidence. |
| `TRUSTED_RELEASE` | Everything in `RELEASE_CANDIDATE` plus verified release signing and required governance/trust evidence. | Requires `WIN_CSC_LINK`/`CSC_LINK` signing material AND a `Valid` Authenticode status. No escalation without evidence. |

Set the mode with `KFORGE_RELEASE_MODE`:

```powershell
$env:KFORGE_RELEASE_MODE='RELEASE_CANDIDATE'
npm run package:windows
```

## Signing contract (CI secrets only)

electron-builder reads these environment variables directly. Never commit
certificates, keys, or passwords to git. Never print secret values in logs.

| Variable | Purpose |
| --- | --- |
| `WIN_CSC_LINK` / `CSC_LINK` | Path (or URL) to the code-signing certificate (`.pfx`/`.p12`). Presence means STATE A (signing configured). |
| `WIN_CSC_KEY_PASSWORD` / `CSC_KEY_PASSWORD` | Certificate password, via CI secret only. |
| `CSC_SUBJECT_NAME` | Optional subject-name selection when the store holds multiple identities. |
| `KFORGE_TRUSTED_RELEASE` | Set to `1` to force trusted-gate semantics regardless of mode name. |

When none of the certificate variables are set, the build proceeds as STATE B:
an explicitly unsigned development/release-candidate artifact.

## What packaging measures

`node scripts/package-windows.mjs` records, for every build:

- `release/<installer>.exe` + `SHA256SUMS.txt`
- `release/installer-manifest.json` with `signatureState`, `signing` object, `releaseMode`, `trustStatus`, `sha256`, `gitSha`
- `release/RELEASE-NOTES.md` with a signing section that matches the manifest
- `release/verification/package-windows.json` with the same evidence plus check results
- On Windows, an OS `Get-AuthenticodeSignature` observation of the produced installer

Standalone verification of any artifact:

```powershell
node scripts/verify-signing.mjs release/KNOuX-Forge-Setup-v0.1.0-Windows-x64.exe
node scripts/verify-signing.mjs release/KNOuX-Forge-Setup-v0.1.0-Windows-x64.exe --require-valid
$env:KFORGE_RELEASE_MODE='TRUSTED_RELEASE'
node scripts/verify-signing.mjs release/KNOuX-Forge-Setup-v0.1.0-Windows-x64.exe
```

`installer/verify-installer.ps1` re-checks the manifest hash, re-observes
Authenticode via the OS, and fails when a configured-signing claim does not
match a `Valid` OS status. It never claims Trusted Publisher, SmartScreen
reputation, or a trusted identity for an unsigned artifact.

## Trusted-release gate

`TRUSTED_RELEASE` fails closed when:

- no signing material is configured, or
- the OS-reported Authenticode status is anything other than `Valid`.

Normal developer packaging (`DEVELOPMENT`, `RELEASE_CANDIDATE`) never fails
merely because a certificate is absent; it records `UNSIGNED` truthfully.

## Evidence schema

Signed:

```json
{
  "artifact": "KNOuX-Forge-Setup-v0.1.0-Windows-x64.exe",
  "sha256": "...",
  "signing": {
    "configured": true,
    "status": "Valid",
    "subject": "CN=...",
    "issuer": "CN=...",
    "timestamped": true
  }
}
```

Unsigned:

```json
{
  "signing": {
    "configured": false,
    "status": "UNSIGNED"
  }
}
```

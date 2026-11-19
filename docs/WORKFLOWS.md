# KNOuX Forge Workflows

This page describes the automation that exists in the repository and the
evidence each command produces. It does not describe a capability that KForge
does not have.

## Local verification path

Run from the repository root with Node 24 and npm 11.

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=moderate
npm run verify:gate
```

`verify:gate` is the authoritative aggregate. It records each step under
`docs/verification-evidence/local-*.json` and fails if any required step fails.
The required sequence is:

```text
workflow-pins → asset-budget → brand-contract → npm ci → npm audit
→ typecheck → lint → tests → build → browser install (optional) → E2E
```

### Focused checks

| Command | What it proves |
| --- | --- |
| `npm run verify:workflow-pins` | Every external GitHub Action is pinned to a full 40-character commit SHA |
| `npm run verify:assets` | Logo, runtime logo and reveal audio stay inside their byte and format budgets |
| `npm run verify:brand` | Brand tokens, public SVGs, manifest, `index.html` metadata and `docs/BRANDING.md` agree |
| `npm run verify:desktop` | The packaged desktop shell can load the production build |
| `npm run package:windows` | The NSIS installer is produced from the current build |
| `npm run verify:installer` | The installed Windows runtime and NSIS lifecycle behave as declared |
| `npm run verify:signing` | Reports the Authenticode state that actually exists; it does not create signing material |

## Repository workflows

### `KForge Verification Gate` — `.github/workflows/kforge-verification.yml`

Runs on pushes to `main`, pull requests targeting `main`, and manual dispatch.

- **Aggregate verification** (Ubuntu): brand, asset, workflow-pin, dependency,
  type, lint, unit, build and Playwright E2E evidence. Uploads
  `verification-evidence.json` and rendered Preview evidence.
- **Windows NSIS package gate** (Windows): builds the production server, runs the
  Windows browser E2E gate against Microsoft Edge, verifies the desktop shell,
  packages the NSIS installer, records Authenticode evidence truthfully with
  `continue-on-error`, verifies the installed runtime, and uploads the installer,
  checksums, manifest, release notes and verification JSON.

This workflow is the authoritative cross-platform evidence for the exact pushed
SHA. A green run does not imply that the installer is signed; read the signing
step output.

### `KForge Windows Release Candidate (unsigned)` — `.github/workflows/kforge-release-candidate.yml`

Manual `workflow_dispatch` only. It requires:

- `sha`: the full 40-character commit SHA to rehearse.
- `confirm_unsigned`: an explicit acknowledgement that the produced artifact is
  unsigned unless repository signing material is configured.

The job checks out the requested SHA, verifies pins, assets and brand contracts,
runs the GitHub Connect security contracts, typecheck, lint, unit tests, the
production build, the Windows Edge E2E gate, desktop verification, packaging,
truthful signing evidence and the installer lifecycle. It writes
`release/RELEASE-CANDIDATE-STATUS.md` next to the installer and uploads the
installer plus verification JSON as a 14-day artifact.

It never publishes a GitHub Release, never uploads to a store, and never turns a
missing certificate into a signed claim.

## Pinning policy

Every external action must use a full 40-character commit SHA.
`scripts/verify-workflow-pins.mjs` scans every workflow file and fails the gate
when a tag, branch or short SHA is used. The current pins are:

| Action | Pinned commit |
| --- | --- |
| `actions/checkout` | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| `actions/upload-artifact` | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |

## Windows packaging lifecycle

```text
npm run build
  → npm run package:windows
      → electron-builder NSIS (x64, assisted installer)
      → release/KNOuX-Forge-Setup-v<version>-Windows-x64.exe
      → release/SHA256SUMS.txt
      → release/installer-manifest.json
      → release/RELEASE-NOTES.md
  → npm run verify:installer
```

Packaging does not sign the binary. The installer remains **UNSIGNED** unless a
certificate is configured outside the repository. Never commit a certificate, a
password or a signing token.

## What is deliberately absent

- No workflow automatically publishes a release or creates a tag.
- No workflow contacts an AI provider, a package registry or a store on its own.
- No workflow treats a catalog listing, a provider key or an E2E pass as proof of
  remote connectivity, SmartScreen reputation or clean-machine readiness.
- No fixture or mock is promoted into product truth by automation.

## Related documentation

- `docs/BRANDING.md`
- `docs/ONBOARDING.md`
- `docs/SIGNING.md`
- `docs/KFORGE-SERVICE-DIRECTORY.md`
- `AGENTS.md`

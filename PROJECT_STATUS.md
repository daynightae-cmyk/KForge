# Project Status

## Current verified state (2026-09-26)

- Product: KNOuX Forge
- Verified implementation SHA: `dac3a8fe684b82c4d9612076cd7ee175c38e43f0` (audit hardening, session-identifier validation, documentation realpath containment)
- Later commits on `main` are the project-first UX correction and its end-to-end adaptation; the exact verification run for the final head is recorded below once it settles.
- Remote branch topology: `main` only. The previously recorded four obsolete remote refs no longer exist, so that PARTIAL item is now resolved.
- Open CodeQL findings: 21, down from 45 on the 2026-09-08 baseline. Classified rather than chased to zero: 15 `js/path-injection` in `routes/workspace.ts` and `services/agentTools.ts` guarded by realpath containment, 2 `js/request-forgery` now fronted by the API caller boundary, 1 `js/reflected-xss` in a non-shipped fixture (escaping since corrected), 2 URL-substring warnings in test sources, and `js/shell-command-injection-from-environment` where the service spawns with `shell: false` and an argument array.
- Installer signing: **UNSIGNED**. Release mode DEVELOPMENT, observed Authenticode signature UNAVAILABLE, build signing not configured. No Trusted Publisher, SmartScreen, or clean-machine claim is made.

### What changed in this pass, and why

- **Project-first recovery.** Thirteen project-scoped surfaces previously opened on an inert "No project selected" panel. They now offer the two real ways a project enters KForge — open a local directory, or clone a supported repository — against the existing `/projects/open` and `/projects/clone` services with their genuine policy gates, plus quick jumps to project commands, providers, marketplace, and settings. A successful open becomes the global active project.
- **The idle Preview no longer eats the workspace.** Measured at 1440x900: the Persistent Preview was expanded by default, so the workbench was 496px instead of 856px and the grid carried a third implicit track. It is now collapsed by default, restoring the full 856px, and reveals itself when a Preview or topology is actually running. Operator intent always wins over the automatic behaviour.
- **Real containment fixes.** Provider session identifiers are now asserted before they become `.kforge` filenames, and documentation fixes are held inside the project with realpath containment at both preview and apply, replacing a string-prefix check that a symlinked document could escape.
- **Local API boundary.** Cross-site, cross-origin, and rebound-`Host` callers are refused before any route observes them, ahead of a per-address request allowance; every real provider request passes a destination policy with bounded JSON, error, and stream bodies.

## Historical evidence (retained, not current)

The sections below record earlier verified states. They are kept as history and must not be read as current HEAD evidence.

- Historical implementation baseline captured on 2026-09-08: GitHub Actions `KForge Verification Gate` Run #271 at SHA `a7464f3d3f1758b1a9725304719e0ebaacb79f3b`.
- Historical release closure work recorded on 2026-09-09 at Run **34412720862**, implementation SHA `7e36c34a1259f71a0f2c0af9d9cc0a1791afca21`.

### 2026-09-08 baseline, as recorded at the time

Counts and package versions below are the values measured on that date and are
not current. Dependency versions, including the exact install-script allowlist,
have moved since.

- Product: KNOuX Forge
- Delivery branch: `main`
- Branch-protection and required-status enforcement remain a separate repository-administration policy domain. The current integration receives HTTP 403 from the branch-protection endpoint, so a green workflow proves the tested SHA rather than administrative enforcement.
- Workflow supply-chain gate: PASS — external action references in the authoritative verification workflow are immutable SHA pins.
- Dependency gate: PASS — `npm ci` installed 691 packages, npm audited 692 packages, and `npm audit --audit-level=moderate` reported `0 vulnerabilities`.
- Install-script supply-chain gate: PASS — `.npmrc` enforces `strict-allow-scripts=true`, and `package.json` permits lifecycle scripts only for the exact reviewed versions `@swc/core@1.16.1`, `esbuild@0.25.4`, and `fsevents@2.3.2`. Run #271 proves locked installation succeeds under that policy on Linux and Windows; an unreviewed/new script version remains fail-closed.
- Source gate: PASS — TypeScript, lint across 217 source files, 34 Vitest files with 166 passed and 1 opt-in benchmark skipped, and the production client/server build all passed on the exact tested SHA.
- Browser acceptance: PASS — 61/61 Playwright tests passed, including Workspace, Online Explorer, canonical Inspector, Preview/Topology, accessibility, keyboard, responsive, trust, release, telemetry-boundary, and evidence-boundary regressions.
- Windows package gate: PASS — x64 NSIS packaging plus installed Windows runtime and installer lifecycle verification passed and uploaded installer/evidence artifacts on the same tested SHA.
- Client bundle gate: PASS for the previous Vite warning target — the main application entry is 487.85 kB after minification, with React Query split into a 26.69 kB vendor chunk; the prior >500 kB main-entry warning is no longer emitted.
- Release evidence: local preparation, local package verification, CI artifact identity, and remote release state remain independent. A local PASS never manufactures CI or remote provenance.

## Verified Preview 5.0 baseline

The verified Preview topology/observability implementation includes manifest-backed and framework-native topology discovery, Docker Compose and Procfile evidence, listener ownership attribution where the host OS can prove it, bounded packaged-Electron browser traffic evidence with query-value redaction, and bounded packaged-Electron browser-console evidence attributed only to an active KForge-owned loopback Preview with sensitive values redacted.

Run #271 proves, on SHA `a7464f3d3f1758b1a9725304719e0ebaacb79f3b`:

- workflow pin verification
- locked dependency installation under strict exact-version install-script policy on Linux and Windows
- npm audit with 0 vulnerabilities
- TypeScript
- lint across 217 source files
- 34 Vitest files with 166 passed and 1 skipped benchmark
- production client/server build
- main client entry at 487.85 kB, below Vite's 500 kB warning threshold
- 61/61 Playwright E2E tests, including the Preview Studio browser-console truth boundary
- Windows x64 NSIS packaging
- installed Windows runtime and installer lifecycle
- verification and rendered Preview evidence upload

## Open evidence gaps

- Branch-protection and required-status enforcement remain a separate repository-administration policy domain. The current integration receives HTTP 403 from the branch-protection endpoint, so a green workflow proves the tested SHA rather than administrative enforcement.
- The Windows installer remains an **UNSIGNED DEVELOPMENT/RELEASE ARTIFACT** for trust purposes. KForge does not claim a Trusted Publisher, SmartScreen reputation, or trusted code-signing identity without separate evidence.
- Remote registries, remote CI, remote Preview, product updates, GitHub operations, and cloud AI remain dependent on their real adapters, credentials, network policy, trust, and explicit actions. Missing prerequisites stay `OFFLINE`, `NOT_CONFIGURED`, `UNKNOWN`, `UNAVAILABLE`, or `BLOCKED`.
- Browser-console capture is deliberately bounded to packaged Electron and an active KForge-owned loopback Preview. HTML-only inspection still does not claim executed-JavaScript DOM coverage, rendered layout/contrast, request waterfalls, screenshots, element picking, or user-interaction telemetry unless a separate measured capability supplies that evidence.

This file is a dated evidence snapshot, not a permanently self-updating claim about HEAD. Run #271 and SHA `a7464f3d3f1758b1a9725304719e0ebaacb79f3b` are the latest verified implementation baseline captured here. A later documentation-only commit does not retroactively change that tested SHA; for any newer implementation commit, use that exact SHA's GitHub Actions run and artifacts.

## Release closure work (2026-09-09, local HEAD, unpushed at write time)

Implemented on top of `f57d0ddce3f7fbec02dfa36299e77c5a1428fc1c`, verified locally as recorded below. CI attestation: GitHub Actions `KForge Verification Gate` Run **34412720862** is green on implementation SHA `7e36c34a1259f71a0f2c0af9d9cc0a1791afca21` (aggregate verification gate PASS and Windows NSIS package gate PASS, with installer/verification artifacts uploaded); the only delta after that SHA is this documentation line.

- Windows signing-ready architecture: `shared/releaseState.ts` contract plus `scripts/release-state.mjs`, `scripts/verify-signing.mjs`, dual-state `scripts/package-windows.mjs` (STATE A signs and verifies via OS Authenticode; STATE B records `SIGNING_STATUS=UNSIGNED` / `TRUST_STATUS=DEVELOPMENT_ARTIFACT`), `installer/verify-installer.ps1` Authenticode cross-check, `docs/SIGNING.md`, and `TRUSTED_RELEASE` fail-closed gating. Local package + installer lifecycle: PASS (installer `KNOuX-Forge-Setup-v0.1.0-Windows-x64.exe`, SHA-256 `1b201c4d0dc1f49d9d64f8f57cff6e360b5d620f4d1bbc531ff9740c190a97e7`, UNSIGNED truthfully recorded).
- Runtime hardening: loopback-scoped Express middleware (fingerprinting off, bounded bodies, normalized malformed-JSON errors), offline-first security-tool policy ordering (BLOCKED before probing), toolchain availability caching (`localPlatform`, security-tool version probes) that cut hot status/scan paths from multi-second to ~2.8 s on the local host, and topology shutdown/probe races fixed (wave-parallel stops, bounded futile-graceful budget, no-revive guard for terminal states).
- Regression tests added: `shared/releaseState.spec.ts`, `server/index.spec.ts`, platform cache/mode-freshness test, version-probe consistency test, unexpected-exit persistence test.
- Supply chain: `js-yaml` 4.3.1 → 4.3.2 via `npm update` (resolves the high-severity advisory within the electron-builder range), and `vitest` 3.2.7 → 4.1.11 via `npm install -D` (resolves the 2 moderate `@vitest/mocker` path-traversal advisories; vitest 4 supports the repo's vite 6 toolchain, introduces no new install-script packages, and the full 185-test suite passes unmodified in behavior). `npm audit --audit-level=moderate` reports **0 vulnerabilities**. No audit ignores added; `strict-allow-scripts` policy untouched.
- Governance: repository description replaced (stale starter-template copy removed) via API; `main` branch protection configured (force-push blocked, deletion blocked, both verification gates required strict, admins not enforced so the owner recovery path remains, no PR-review mandate so direct-owner workflow is preserved).
- Fixtures manifest: `fixtures/FIXTURES.md` classifies every fixture (A verification, B first-party marketplace, C development-only none, D obsolete none).
- Local verification at write time: `npm ci` PASS; `npm run typecheck` PASS; `npm run lint` PASS (230 files); Vitest 184 passed + 1 skipped opt-in benchmark across 39 files; `npm run build` PASS with code splitting intact; `npm run verify:assets` PASS; `npm run verify:desktop` PASS; `npm run package:windows` PASS; `npm run verify:installer` PASS (full lifecycle). Playwright on this Windows+Edge host: serial run reaches 58+ passes with residual host-slowness failures (5 s default assertions vs 5–7 s scan-heavy API responses measured directly; audio-decode of the valid Opus asset fails in this host browser); targeted re-runs pass except the two deterministic host-bound cases, and the ubuntu/Chromium CI gate remains the authoritative E2E platform.

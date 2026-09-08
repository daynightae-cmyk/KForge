# Project Status

- Product: KNOuX Forge
- Delivery branch: `main`
- Readiness: Evidence-scoped product completion. No external provider, CI, package, signing, or release state is promoted beyond the source that actually measured it.
- Authoritative reference baseline captured on 2026-09-08: GitHub Actions `KForge Verification Gate` Run #258 at SHA `0afad41249439fe03f81ab84f538ce47a14f3224`.
- Workflow supply-chain gate: PASS — external action references in the authoritative verification workflow are immutable SHA pins.
- Dependency gate: PASS — `npm ci` installed 752 packages, npm audited 753 packages, and `npm audit --audit-level=moderate` reported `0 vulnerabilities`.
- Source gate: PASS — TypeScript, lint across 241 source files, 34 Vitest files with 164 passed and 1 opt-in benchmark skipped, and the production client/server build all passed on the exact tested SHA.
- Browser acceptance: PASS — 61/61 Playwright tests passed, including Workspace, Online Explorer, canonical Inspector, Preview/Topology, accessibility, keyboard, responsive, trust, release, telemetry-boundary, and evidence-boundary regressions.
- Windows package gate: PASS — x64 NSIS packaging plus installed Windows runtime and installer lifecycle verification passed and uploaded installer/evidence artifacts on the same tested SHA.
- Client bundle gate: PASS for the previous Vite warning target — the main application entry is 487.85 kB after minification, with React Query split into a 26.69 kB vendor chunk; the prior >500 kB main-entry warning is no longer emitted.
- Release evidence: local preparation, local package verification, CI artifact identity, and remote release state remain independent. A local PASS never manufactures CI or remote provenance.

## Verified Preview 5.0 baseline

The verified Preview topology/observability implementation includes manifest-backed and framework-native topology discovery, Docker Compose and Procfile evidence, listener ownership attribution where the host OS can prove it, bounded packaged-Electron browser traffic evidence with query-value redaction, and bounded packaged-Electron browser-console evidence attributed only to an active KForge-owned loopback Preview with sensitive values redacted.

Run #258 proves, on SHA `0afad41249439fe03f81ab84f538ce47a14f3224`:

- workflow pin verification
- locked dependency installation
- npm audit with 0 vulnerabilities
- TypeScript
- lint across 241 source files
- 34 Vitest files with 164 passed and 1 skipped benchmark
- production client/server build
- main client entry at 487.85 kB, below Vite's 500 kB warning threshold
- 61/61 Playwright E2E tests, including the Preview Studio browser-console truth boundary
- Windows x64 NSIS packaging
- installed Windows runtime and installer lifecycle
- verification and rendered Preview evidence upload

## Open evidence gaps

- npm reports pending install-script review for `@swc/core@1.16.1` and `esbuild@0.25.4`; approval is not inferred. The verified build succeeds while those scripts remain unapproved.
- `main` is not branch-protected and required status-check enforcement is off. A green workflow therefore proves the tested SHA, not repository policy enforcement.
- The Windows installer remains an **UNSIGNED DEVELOPMENT/RELEASE ARTIFACT** for trust purposes. KForge does not claim a Trusted Publisher, SmartScreen reputation, or trusted code-signing identity without separate evidence.
- GitHub repository description metadata may contain stale starter-template copy. Repository-content commits cannot change that metadata; it requires a supported repository-metadata write path.
- Remote registries, remote CI, remote Preview, product updates, GitHub operations, and cloud AI remain dependent on their real adapters, credentials, network policy, trust, and explicit actions. Missing prerequisites stay `OFFLINE`, `NOT_CONFIGURED`, `UNKNOWN`, `UNAVAILABLE`, or `BLOCKED`.
- Browser-console capture is deliberately bounded to packaged Electron and an active KForge-owned loopback Preview. HTML-only inspection still does not claim executed-JavaScript DOM coverage, rendered layout/contrast, request waterfalls, screenshots, element picking, or user-interaction telemetry unless a separate measured capability supplies that evidence.

This file is a dated evidence snapshot, not a permanently self-updating claim about HEAD. Run #258 and SHA `0afad41249439fe03f81ab84f538ce47a14f3224` are the latest verified implementation baseline captured here. A later documentation-only commit does not retroactively change that tested SHA; for any newer implementation commit, use that exact SHA's GitHub Actions run and artifacts.

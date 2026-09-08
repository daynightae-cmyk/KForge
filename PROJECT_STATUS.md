# Project Status

- Product: KNOuX Forge
- Delivery branch: `main`
- Readiness: Evidence-scoped product completion. No external provider, CI, package, signing, or release state is promoted beyond the source that actually measured it.
- Authoritative reference baseline captured on 2026-09-08: GitHub Actions `KForge Verification Gate` Run #254 at SHA `82461f1f7782799bae09889c4523f367f9341e93`.
- Workflow supply-chain gate: PASS — external action references in the authoritative verification workflow are immutable SHA pins.
- Dependency gate: PASS — `npm ci` installed 752 packages, npm audited 753 packages, and the authoritative moderate-severity audit reported `0 vulnerabilities`.
- Source gate: PASS — TypeScript, lint across 240 source files, 33 Vitest files with 161 passed and 1 opt-in benchmark skipped, and the production client/server build all passed on the exact tested SHA.
- Browser acceptance: PASS — 61/61 Playwright tests passed, including Workspace, Online Explorer, canonical Inspector, Preview/Topology, accessibility, keyboard, responsive, trust, release, and evidence-boundary regressions.
- Windows package gate: PASS — x64 NSIS packaging plus installed Windows runtime and installer lifecycle verification passed and uploaded installer/evidence artifacts on the same tested SHA.
- Release evidence: local preparation, local package verification, CI artifact identity, and remote release state remain independent. A local PASS never manufactures CI or remote provenance.

## Verified Preview 5.0 baseline

The verified Preview topology/observability implementation includes manifest-backed and framework-native topology discovery, Docker Compose and Procfile evidence, listener ownership attribution where the host OS can prove it, bounded packaged-Electron browser traffic evidence with query-value redaction, and an npm audit gate at `moderate` severity. React Router is on the audited 7.18.3 line in the verified dependency graph.

Run #254 proves, on SHA `82461f1f7782799bae09889c4523f367f9341e93`:

- workflow pin verification
- locked dependency installation
- npm audit with 0 vulnerabilities
- TypeScript
- lint
- unit/integration tests
- production client/server build
- 61/61 Playwright E2E tests including Preview/Topology regressions
- Windows x64 NSIS packaging
- installed Windows runtime and installer lifecycle
- verification and rendered Preview evidence upload

## Open evidence gaps

- npm reports pending install-script review for `@swc/core@1.16.1` and `esbuild@0.25.4`; approval is not inferred. The verified build succeeds while those scripts remain unapproved.
- `main` is not branch-protected and required status-check enforcement is off. A green workflow therefore proves the tested SHA, not repository policy enforcement.
- The Windows installer remains an **UNSIGNED DEVELOPMENT/RELEASE ARTIFACT** for trust purposes. KForge does not claim a Trusted Publisher, SmartScreen reputation, or trusted code-signing identity without separate evidence.
- The production client build emits a non-gating chunk-size warning for the main application bundle. This is a performance/maintainability optimization opportunity, not a failed correctness or security gate.
- GitHub repository description metadata may contain stale starter-template copy. Repository-content commits cannot change that metadata; it requires a supported repository-metadata write path.
- Remote registries, remote CI, remote Preview, product updates, GitHub operations, and cloud AI remain dependent on their real adapters, credentials, network policy, trust, and explicit actions. Missing prerequisites stay `OFFLINE`, `NOT_CONFIGURED`, `UNKNOWN`, `UNAVAILABLE`, or `BLOCKED`.
- Full target-application browser-console telemetry is not inferred from KForge Workbench Playwright coverage or bounded Electron traffic evidence; it requires a dedicated target telemetry bridge if promoted as a product capability.

This file is a dated evidence snapshot, not a permanently self-updating claim about HEAD. For a newer commit, use that exact SHA's GitHub Actions run and its artifacts. Static file counts or an older green run are never substituted for current release evidence.

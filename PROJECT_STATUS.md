# Project Status

- Product: KNOuX Forge
- Delivery branch: `main`
- Readiness: Evidence-scoped product completion. No external provider, CI, package, signing, or release state is promoted beyond the source that actually measured it.
- Authoritative reference baseline captured on 2026-08-30: GitHub Actions `KForge Verification Gate` Run #208 at SHA `3c1b6f86309b8a3b8a533b0da4e5402df01935f4`.
- Workflow supply-chain gate: PASS — external action references in the authoritative verification workflow are immutable SHA pins.
- TypeScript, lint, unit/integration, production build, browser acceptance, and Windows packaging remain release-gated by the exact tested SHA; older PASS evidence is not substituted for current HEAD.
- Release evidence: local preparation, local package verification, CI artifact identity, and remote release state remain independent. A local PASS never manufactures CI or remote provenance.

## Final Preview 5.0 verification target

The merged Preview topology/observability implementation now includes manifest-backed and framework-native topology discovery, Docker Compose and Procfile evidence, listener ownership attribution where the host OS can prove it, packaged-Electron browser traffic evidence, and an npm audit gate at `moderate` severity. React Router was advanced to the audited fixed release before this final verification cycle.

This status update intentionally makes no PASS claim for the current HEAD. The current SHA is acceptable only when the authoritative `KForge Verification Gate` proves, on that same SHA:

- workflow pin verification
- locked dependency installation
- zero moderate-or-higher npm audit findings
- TypeScript
- lint
- unit/integration tests
- production client/server build
- Playwright E2E including Preview/Topology regressions
- Windows x64 NSIS packaging
- installed Windows runtime and installer lifecycle

## Open evidence gaps

- npm reports pending install-script review for `@swc/core@1.16.1` and `esbuild@0.25.4`; approval is not inferred.
- `main` is not branch-protected and required status-check enforcement is off. A green workflow therefore proves the tested SHA, not repository policy enforcement.
- The Windows installer remains an **UNSIGNED DEVELOPMENT/RELEASE ARTIFACT** for trust purposes. KForge does not claim a Trusted Publisher, SmartScreen reputation, or trusted code-signing identity without separate evidence.
- GitHub repository description metadata may contain stale starter-template copy. Repository-content commits cannot change that metadata; it requires a supported repository-metadata write path.
- Remote registries, remote CI, remote Preview, product updates, GitHub operations, and cloud AI remain dependent on their real adapters, credentials, network policy, trust, and explicit actions. Missing prerequisites stay `OFFLINE`, `NOT_CONFIGURED`, `UNKNOWN`, `UNAVAILABLE`, or `BLOCKED`.

This file is a dated evidence snapshot, not a permanently self-updating claim about HEAD. For a newer commit, use that exact SHA's GitHub Actions run and its artifacts. Static file counts or an older green run are never substituted for current release evidence.

# Changelog

All notable changes to KNOuX Forge are recorded here. The format follows Keep a Changelog, and the project follows Semantic Versioning for its application version.

## [Unreleased]

### Added

- **Get Started** onboarding destination that derives every step from workspace, trust, policy, provider and persisted scan evidence instead of visit state.
- **Brand & Identity** destination with the canonical palette, typography, experience rules, public SVG assets, copy controls and Day/Night preview.
- **Capabilities** destination projecting all registered destinations, handlers and API contracts as an explicit contract inventory.
- Canonical brand token module, public app icon, wordmark, social card, installed-app manifest and document metadata.
- `verify:brand` contract check and its `brand-contract` step inside the authoritative verification gate.
- `KForge Windows Release Candidate (unsigned)` manual workflow for an exact-SHA installer rehearsal with truthful signing evidence.
- Brand, onboarding and workflow guides plus a Playwright spec covering the three new destinations.
- Branded renderer recovery boundary and a theme-consistent route-not-found surface, so a render failure or unknown route never leaves a blank window.
- Desktop window placement is remembered across launches and validated against attached displays before it is restored.
- About and diagnostics menu entries, plus a Windows app-user-model identity aligned with the packaged application id.
- Bug-report and feature-request issue forms, plus an issue chooser that routes vulnerability reports to GitHub Private Vulnerability Reporting.

### Changed

- The navigation contract now defines **71** user-facing destinations across the same nine Activity domains.
- The Projects Project Center links to the Get Started guide, and the projectless quick actions include a Setup guide entry.
- README, changelog and service documentation describe the new destinations without turning a registered contract into a readiness claim.
- The packaged desktop menu exposes native editing, zoom, fullscreen, About and diagnostics while withholding reload and DevTools from production.
- Desktop diagnostics are now bounded at 5 MB with a single rotated `.1` backup instead of growing indefinitely.

### Security

- The standalone production browser runtime now serves the built workbench under the same content security policy as the packaged desktop shell, with `nosniff`, frame, referrer and permissions headers. HSTS remains omitted because the runtime is loopback HTTP only.
- Unhandled HTTP failures now terminate in a generic JSON boundary that preserves deliberate 4xx statuses without echoing stacks, absolute paths, request bodies or credentials.
- Desktop main-process fatal failures are logged through the redacting diagnostic writer and fail closed; renderer crashes offer bounded reload recovery instead of leaving an unresponsive shell.
- Tests assert content-security-policy parity between the production browser runtime and the packaged desktop policy, verify the terminal error boundary never leaks failure internals, and cover window-state validation and production menu roles.

## [0.1.0] - 2026-11-18

### Added

- Repository metadata for the canonical GitHub repository, product homepage, issue tracker, supported Node.js range and package manager.
- Portable Windows preview launcher defaults and a repository-relative run guide.
- Contributor guide, pull-request checklist, editor configuration and this changelog.
- `verify:workflow-pins` as a directly runnable script alongside the aggregate gate.

### Changed

- Consolidated all repository work onto a single `main` head with `main` as the only local and remote branch.
- Refreshed test-fixture dependency ranges to patched releases.
- Isolated the workspace snapshot test in a disposable temporary project root so tests no longer write snapshot state into tracked fixture directories.
- Enabled Dependabot security updates and automatic deletion of merged branches.
- Updated the security policy to record verified private vulnerability reporting and repository security controls.
- Updated the project status with the 2026-11-18 authoritative verification result.

### Removed

- Retired OpenSumi research source archive from the working tree; it remains recoverable from Git history and was never part of the product graph, build or packaging.
- Obsolete tags, worktrees, hidden archive refs and generated build/verification residue.

### Security

- Removed the historical OpenSumi lockfile that produced all three critical and most high/medium Dependabot findings.
- Patched the remaining declared fixture dependency ranges and deduplicated `postcss-selector-parser` to a patched release.
- Production dependency audit remains at **0 vulnerabilities**.

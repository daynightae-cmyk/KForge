# Changelog

All notable changes to KNOuX Forge are recorded here. The format follows Keep a Changelog, and the project follows Semantic Versioning for its application version.

## [Unreleased]

Nothing recorded yet.

## [0.1.0] - 2026-11-18

### Added

- Repository metadata for the canonical GitHub repository, product homepage, issue tracker, supported Node.js range and package manager.
- Portable Windows preview launcher defaults and a repository-relative run guide.
- Contributor guide, pull-request checklist, editor configuration and this changelog.
- `verify:workflow-pins` as a directly runnable script alongside the aggregate gate.

### Changed

- Consolidated all repository work onto a single `main` head with `main` as the only local and remote branch.
- Refreshed test-fixture dependency ranges to patched releases.
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

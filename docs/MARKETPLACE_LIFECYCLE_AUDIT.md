# Marketplace Lifecycle Audit

Baseline: 288c2d9e19c98563e5cc11a378d45fc0fd6bf618

## What already exists

- `server/services/marketplace.ts` - Registry adapter list (`local-registry`, `ollama-official`, `extension-registries`), `MarketplaceItem`, `MarketplaceProviderStatus`, `MarketplaceRegistryAdapter`.
- `getMarketplace()` reads `.kforge/marketplace-registry.json` (local) + combines with model center (ollama) + registered extensions + recommendations.
- `previewMarketplaceInstall()` does basic preview (installed check, install action, allowed/reason) but NO download, verify, stage, install, or rollback.
- `localEngineItems()` exposes agent `agent:kforge:engineer` and agent tools from `agentTools`.
- No integrity (SHA-256) verification path.
- No real download adapter.
- No package staging directory.
- No durable installed-state persistence outside `.kforge/marketplace-registry.json` (only read, never written by install).
- `trusted` and `installed` are set from remote/local manifest; `verified` derived state is not enforced.

## What is metadata-only (not real lifecycle)

- `installAction`: `MANAGE_LOCAL` / `NOT_AVAILABLE` / `INSTALL_REQUIRES_CONFIRMATION` are UI labels, not adapter contracts.
- `trust`: set directly from source data (TRUSTED for local engine), not verified locally.
- No `sha256`, `size`, `download`, `changelog`, `version` comparison, `update` detection from remote.
- `registered` extensions are read from file but never installed/updated/uninstalled.

## Where install adapters live (current)

None. There is no `install` adapter function exported by marketplace service. Only `previewMarketplaceInstall` exists.

## Where integrity verification belongs

Not present. Needs to be added near package acquisition, before stage.

## Where local package state belongs

`.kforge/marketplace-registry.json` exists but is only read (`readLocalRegistry`). No write/update/uninstall function exists. Installed-state must be durable across restarts; this file can serve as state store but is not currently written.

## Missing for real lifecycle

- Integrity (SHA-256, size) verification.
- Real download/stage adapter (even for first-party package).
- Compatibility check (version, OS, dependencies).
- Dependency resolution before install.
- Rollback on failure.
- Health check after install.
- Uninstall with file removal and state cleanup.
- Durable write of installed/update/uninstalled state.
- Security tests (bad SHA, wrong size, path traversal, unknown permission, dependency failure, health failure).
- First-party registry source (immutable, owned).

Next step: implement Playwright E2E first, then extend marketplace using existing architecture only.

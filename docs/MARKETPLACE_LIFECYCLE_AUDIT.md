# Marketplace Lifecycle Audit

Baseline: `288c2d9e19c98563e5cc11a378d45fc0fd6bf618`

## Final verified architecture

KForge Marketplace now keeps the existing normalized Marketplace model while adding a bounded, first-party lifecycle path for locally bundled packages.

### Catalog and evidence

- `server/services/marketplace.ts` exposes local-registry, Ollama, and extension-registry status through normalized Marketplace contracts.
- Built-in agents/tools remain local registry items and do not fabricate remote metadata.
- Remote registries remain `OFFLINE` or `NOT_CONFIGURED` when no trustworthy adapter exists.
- First-party package catalog metadata comes from bundled manifests under `fixtures/marketplace-first-party*`.
- Publisher, permissions, provenance, installation, update, dependency, integrity, and trust evidence are represented explicitly rather than inferred as successful.

### Real first-party lifecycle

The first-party package lifecycle implements:

- manifest schema validation;
- bounded package IDs and path-containment checks;
- permission allowlist validation;
- OS / command / dependency compatibility checks;
- artifact byte-size verification;
- SHA-256 verification before installation;
- staging before activation;
- atomic durable registry writes;
- post-install health verification;
- trusted-package execution only after health verification;
- version comparison and update staging;
- rollback to the previous package and registry state when an update fails;
- staged uninstall followed by durable registration cleanup;
- restart/reconnect evidence through fresh Marketplace and health reads.

Installed state is persisted under the selected workspace's `.kforge` directory. Package directories use a SHA-256-derived storage key rather than untrusted package IDs as filesystem paths.

### Confirmation and concurrency

- Install, update, uninstall, and execution API routes require an explicit `{ "confirmed": true }` body.
- Canonical Marketplace lifecycle API operations are serialized per workspace so overlapping mutations cannot perform concurrent registry read-modify-write transactions.
- Acceptance coverage includes an overlapping update/uninstall scenario and verifies final filesystem/registry truth.

### Runtime packaging

- Production startup derives a stable application root from the built server location (or `KFORGE_APP_ROOT`).
- Startup fails explicitly if required first-party manifests are absent rather than silently dropping the catalog item.
- Packaging metadata includes both first-party fixture directories.

### Offline behavior

- First-party install/update fixtures are local and require no remote download.
- Offline Marketplace state does not probe remote registries.
- Production E2E observes requests from the first navigation and rejects any external HTTP/HTTPS contact.
- External Google Font loading is stripped from generated CSS, so core Offline Mode does not depend on Google Fonts or another CDN.

## Verification gate

The authoritative GitHub workflow is `.github/workflows/kforge-verification.yml` and is observational only:

- `permissions: contents: read`;
- runs for pull requests to `main`, pushes to `main`, and manual dispatch;
- never commits or pushes verification results to the source branch;
- uploads `verification-evidence.json` as an Actions artifact;
- truthfully enforces `npm ci`, typecheck, lint, Marketplace acceptance, full tests, production build, Playwright browser installation, production E2E, and `npm run verify:gate`.

Generated verification evidence is not part of product source history and `docs/verification-evidence/` is ignored.

## Acceptance rule

A Marketplace lifecycle success is valid only after the corresponding filesystem transaction, durable registry state, and integrity/health checks agree. Tests must exercise the real service/API path; mocked success responses are not sufficient.

# KNOuX Forge Post-NSIS Acceptance Gap Matrix

**Audit baseline:** `674e27c78b06863921760ff4c08a55c4a16e0c9e` on `main`
**Audit date:** 2026-08-25
**Purpose:** Distinguish evidence-backed behavior from surfaces that are merely rendered, provider-dependent, or not yet certified in an installed Windows runtime.

## Classification

| State | Meaning |
|---|---|
| `COMPLETE_VERIFIED` | Real data and behavior exist, failure states are truthful, persistence is present when needed, and relevant automated/runtime evidence exists. |
| `PARTIAL` | A real local path exists, but a material acceptance or installed-runtime condition has not yet been verified. |
| `UI_ONLY` | A view or navigation entry exists without enough evidence of real data and behavior. |
| `BACKEND_ONLY` | A service or route exists without a verified product surface. |
| `UNAVAILABLE` | A truthful unavailable state is the expected current product behavior. |
| `NOT_IMPLEMENTED` | The required implementation or verification gate is absent. |
| `BLOCKED_BY_ENVIRONMENT` | Verification requires an environment, identity, provider, or system feature unavailable in this audit. |

## Product capability matrix — before remediation

| Capability group | Current repository truth | Status before remediation | Required closure evidence |
|---|---|---|---|
| Workspace, project discovery, recent, favorites, pinned, archive | Canonical workspace route and collection persistence exist; source tests cover local discovery and collections. | `PARTIAL` | Live workspace navigation and installed persistence evidence. |
| Trust, project health, diagnostics, self audit | Local trust, evidence separation, scans, and restart-aware self audit are implemented and source-tested. | `PARTIAL` | Installed runtime execution evidence. |
| Settings Center | General, Appearance, Privacy, and Preview are persisted editable settings. Other visible domains are explicitly classified as managed, unavailable, or not configured. | `PARTIAL` | Installed restart-persistence test for several real values and a complete visible-domain classification check. |
| Local AI, providers, models | Local runtime detection and explicit cloud-provider disclosure paths exist. External provider execution is configuration-dependent. | `PARTIAL` | Local configured-runtime evidence where available; unconfigured states remain valid. |
| Agents and tasks | Persistent task/mission, retry, recovery, and snapshot flows have source tests. | `PARTIAL` | Installed task-history and interruption-state evidence. |
| Online Hub: Discover, Marketplace, Extensions, Model Hub, Agent/Tool Marketplace, Integrations, Providers, Installed, Updates, Security, Remote Sources, Downloads, Activity | One dedicated Online Hub renderer exposes local/configured evidence and no-contact/blocked states; remote registry operations remain intentionally unavailable without an adapter. | `PARTIAL` | Live three-region navigation checks and installed first-party Marketplace lifecycle. |
| Project Graph, Dependencies, Impact, Code Understanding, Ask KForge, Architecture | Bounded graph, symbol, import/export, impact, architecture, and deterministic assistance services are source-tested. | `PARTIAL` | Live selected-project surface sequence and large-project evidence refresh. |
| Quality: Sonar, Problems, Solutions, Security, Performance, Technical Debt, Documentation, Snapshots | Scanner, safe fix, documentation audit, performance, and snapshot services exist with bounded local evidence. | `PARTIAL` | Live panel transitions and installed task/preview-linked evidence. |
| Release Gate, preparation, artifacts, versioning | Source-separated Release Gate and generated artifact/manifest path exist; version comes from `package.json`. | `PARTIAL` | Canonical desktop and installer gates plus durable tracked certification evidence. |
| Developer tools: Terminal, Tests, Build, Runtime, Logs, Diagnostics, Preview | Canonical task and Preview process services exist, with trusted local execution and bounded process lifecycle. | `PARTIAL` | Installed Preview start/restart/stop/PID/log/cleanup evidence. |
| Git, branches, commits | Real local Git evidence and confirmed tasks exist. | `PARTIAL` | Installed local Git smoke evidence. |
| GitHub, PRs, Issues, Actions, Releases | Read-only remote evidence requires mode, CLI authentication, network, and repository permissions. | `BLOCKED_BY_ENVIRONMENT` | Explicit configured remote credentials and policy; must not be simulated. |
| Offline / online policy | Local platform modes and no-contact controls are implemented and source-tested. | `PARTIAL` | Installed offline request-capture evidence. |
| Desktop runtime | Electron main, minimal preload, loopback server, per-user state root, startup, and managed shutdown are present. | `PARTIAL` | Canonical `verify:desktop` gate and installed resource-resolution evidence. |
| NSIS installer | NSIS artifact, manifest, SHA-256, silent install/startup/uninstall smoke, and secret scan are implemented. | `PARTIAL` | Registry, Start Menu, desktop-shortcut policy, user-data retention, reinstall, installed Marketplace and Preview evidence. |
| Windows CI | The repository has only an Ubuntu source verification workflow. | `NOT_IMPLEMENTED` | A distinct Windows package workflow with uploaded installer evidence. |
| Clean-machine test | No Sandbox, VM, or clean account evidence is present. | `BLOCKED_BY_ENVIRONMENT` | Windows Sandbox, VM, or documented clean account; do not infer success. |
| Live UI acceptance | Current Playwright suite verifies landing-page/basic browser behavior, not the specified Workspace capability sequence. | `PARTIAL` | Workspace navigation, accessibility, console/API-error, and responsive runtime tests. |

## Highest-value acceptance gaps selected for implementation

| Priority | Gap | Why it is real |
|---|---|---|
| 1 | Canonical desktop gate | `verify:desktop` does not exist, so runtime metadata, loopback binding, resource resolution, and graceful shutdown are not independently gated. |
| 2 | Expanded installer gate | Existing installer smoke omits registry, Start Menu, user-data retention, shortcut policy, reinstall, and source-independence assertions. |
| 3 | Workspace live acceptance | Existing production E2E starts at `/` and does not prove the one-active-surface Workspace sequence. |
| 4 | Windows package CI | Existing CI proves source behavior on Ubuntu only; it does not create or retain a Windows NSIS artifact. |
| 5 | Durable certification evidence | The generated release folder is ignored; a tracked verification record is needed for non-binary acceptance evidence. |
| 6 | Shell/process hardening | DEP0190-producing `shell: true` use and external navigation handling require current-source review and tests. |

## Explicit non-claims at baseline

The baseline does not claim a signed installer, SmartScreen reputation, a clean-machine pass, configured external provider lifecycle, remote GitHub data, installed Marketplace lifecycle, installed Preview certification, or installed settings/task persistence. All remain subject to the evidence required by this continuation.

## Remediation and current acceptance status

| Capability group | Status after remediation | Evidence added or executed | Remaining truthful limit |
|---|---|---|---|
| Workspace shell and requested core navigation | `COMPLETE_VERIFIED` | `tests/e2e/workspace-acceptance.spec.ts` opens a real local project and verifies Workspace, Agents, Sonar, Marketplace, Project Graph, Release Gate, Terminal, GitHub, and Settings with one active surface, stable shell, active navigation state, and no API/page/console errors. | The test is browser automation, not a human design review on a clean Windows desktop. |
| Settings Center and platform mode | `COMPLETE_VERIFIED` | The production E2E suite saves editable settings, reloads the renderer, then the installed-runtime verifier restarts the desktop process and reads persisted startup, density, motion, and platform-mode values. | Unconfigured third-party providers remain intentionally `NOT_CONFIGURED`. |
| Desktop runtime | `COMPLETE_VERIFIED` | `npm run verify:desktop` confirms built SPA/server resources, random loopback binding, window load, controlled shutdown, and managed Preview cleanup. | Code-signing and SmartScreen reputation remain unavailable without a signing certificate. |
| NSIS installer and desktop integration | `COMPLETE_VERIFIED` | `npm run verify:installer` checks SHA-256 and manifest, Apps & Features fields, Start Menu and Desktop shortcut targets, signed-state transparency, first launch, user-data retention, uninstall, same-version reinstall, and no surviving install-path process. | The artifact is intentionally `UNSIGNED`. |
| Installed Marketplace and Preview | `COMPLETE_VERIFIED` for the first-party local fixture | Installed verification performs first-party package install, health, run, update, uninstall, plus trusted Preview start, health, PID/port/URL inspection, restart, stop, and child-process cleanup. | Remote registries, cloud adapters, and remote package sources remain unavailable until configured; they are not simulated. |
| Shell/process hardening | `COMPLETE_VERIFIED` for KForge-controlled npm packaging and Preview launch paths | E2E runner, local npm availability probe, packaging script, and npm-based Preview launch use direct Node/CLI execution with `shell: false`. | A runtime `DEP0180` warning was observed from the Electron/Node dependency stack; no `fs.Stats` constructor use was found in KForge source or immediate Electron runtime source. |
| Windows CI | `COMPLETE_VERIFIED` in source configuration | `.github/workflows/kforge-verification.yml` now includes a distinct `windows-latest` job that installs locked dependencies, typechecks, produces NSIS, runs the installed-runtime verifier, and uploads the installer and evidence. | The first remote execution is pending the next pushed commit. |
| Clean-machine validation | `BLOCKED_BY_ENVIRONMENT` | The local verifier uses unique temporary install and user-data roots and refuses to disturb an existing KNOuX Forge installation. | No Windows Sandbox, clean VM, or separate clean account is attached; this result must not be represented as a clean-machine pass. |
| Remote GitHub / CI / provider evidence | `BLOCKED_BY_ENVIRONMENT` | Screens retain explicit no-contact/blocked states and tests make no false provider claim. | Real API credentials, policy enablement, and remote service evidence were not supplied. |

## Acceptance commands and evidence

| Gate | Result in this remediation pass |
|---|---|
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed; 139 source files checked. |
| `npm test` | Passed through the release gate. |
| `npm run test:e2e` | Passed through the release gate, including the new Workspace acceptance suite. |
| `npm run verify:desktop` | Passed; built resource, loopback, window, and shutdown evidence recorded. |
| `npm run package:windows` | Passed; NSIS installer and SHA-256 manifest regenerated. |
| `npm run verify:installer` | Passed; registry, shortcuts, installed runtime, settings restart, Marketplace, Preview, uninstall, data retention, and reinstall evidence recorded. |
| `npm audit --omit=dev --json` | Passed with zero production vulnerabilities reported. |
| `KFORGE_RUN_BENCHMARK=1 npx vitest --run server/routes/performance.spec.ts` | Passed; two performance/cache scenarios completed. |
| `npm run verify:release` | Passed locally; combines source, E2E, desktop, packaging, and installed NSIS gates. |

> The Windows runtime and installer claims above are limited to the connected Windows environment and the evidence files under `release/verification/`. They do not claim signing, SmartScreen reputation, clean-machine status, or configured external-service operation.

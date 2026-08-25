# KNOuX Forge Desktop Architecture Decision

**Status:** Accepted
**Scope:** Windows 10/11 x64 packaging for the current React/Vite and Express product
**Initial desktop package version:** `0.1.0`
**Evidence baseline:** Git `8088a185010b7b3c5959536b6ae3f939d45e87f9` on `main`, matching `origin/main` at audit time.

## Decision

KNOuX Forge will use an **Electron desktop shell** with the existing Express application running in the Electron main-process runtime. The shell opens only a loopback URL after the server reports readiness. This preserves the existing React SPA, Express routes, canonical workspace services, task persistence, Marketplace lifecycle, project trust controls, and preview-process engine without maintaining a second implementation of those systems.

The packaged application does not require the end user to start Node, npm, a terminal, or a localhost URL manually. Electron supplies the embedded runtime and application window; the Express server remains bound to `127.0.0.1` and is stopped during application shutdown.

## Options evaluated

| Option | Fit with the verified repository | Decision |
|---|---|---|
| Electron | Reuses the Node/Express backend and existing filesystem, Git, task, Marketplace, local-AI, and child-process services. Provides a maintained Chromium window and NSIS output through the Windows builder target. | **Selected** |
| Tauri | Would require introducing Rust, a separate native-command boundary, and significant rework of established Node services. No Tauri or Rust tooling was present at audit time. | Rejected for this release |
| Node single executable plus native launcher | Can package a Node server, but still needs a hardened embedded browser window and a Windows launcher. It increases custom process, update, and IPC infrastructure. | Rejected |
| Browser-only wrapper | Cannot satisfy the local-first execution, filesystem, Git, preview subprocess, and no-manual-localhost requirements. | Rejected |

## Desktop runtime design

The Electron main process owns the application lifecycle. It configures an application-data directory under the current Windows user profile, assigns a dedicated KForge workspace-state root, starts the production Express runtime on an OS-assigned loopback port, waits for a health response, then opens a single browser window to that exact local origin.

The renderer has `contextIsolation: true`, `nodeIntegration: false`, sandboxing enabled, a minimal version-only preload bridge, blocked popup creation, controlled external-link opening, blocked permission requests, and a restrictive content-security policy. The renderer does not receive arbitrary shell or filesystem access. The already-existing HTTP API remains the canonical application interface.

Mutable KForge state is kept outside the installation directory. Immutable application code and bundled first-party fixtures are installed beneath Electron resources; user settings, task state, caches, logs, Marketplace state, and workspace collection data use `%LOCALAPPDATA%\KNOuX Forge` through the runtime-owned workspace-state root. The installed server binds only to `127.0.0.1`; it never exposes the KForge API to the LAN by default.

## Audit results and closure plan

| Area | Audit evidence | Gap at baseline | Closure approach |
|---|---|---|---|
| Repository safety | Clean `main`; `HEAD` equals `origin/main`; baseline tests and build completed. | None. | Preserve existing tests and avoid history rewrites or destructive cleanup. |
| Product shell | `KForgeWorkspace.tsx` already keeps the sidebar and topbar stable and maps visible navigation to capability renderers. | None identified from static audit. | Extend only canonical services and retain truthful unavailable states. |
| Backend | `server/node-build.ts` runs the production SPA/API together but assumes a fixed port and source-relative application root. | Not install-safe. | Extract a reusable production-server starter with loopback/ephemeral-port support and explicit application root. |
| Persistence | Existing services persist `.kforge` state below the workspace root. | Installed default would otherwise fall back to an unsuitable location. | Main process sets a user-data state root; no mutable data is written under Program Files. |
| Desktop runtime | No desktop entry point, lifecycle owner, preload policy, user-data logs, or single-instance handling existed. | Missing. | Add Electron main and preload files with guarded startup/shutdown and diagnostics. |
| Packaging | No Electron builder configuration, NSIS compiler, installer source, artifact manifest, checksum, or release output existed. | Missing. | Add reproducible `package:windows` and verification scripts; use the NSIS target produced by the Windows packager. |
| Branding | Existing KNOuX logo and favicon are present. | No multi-resolution desktop icon package. | Generate a Windows ICO from the legitimate existing logo asset and use it for executable and installer resources. |
| Signing | No certificate or signing utility was found. | Signing unavailable. | Produce an explicitly **UNSIGNED DEVELOPMENT/RELEASE ARTIFACT** and document signing readiness without embedding credentials. |
| Installer test isolation | No clean Windows VM or Sandbox is attached to this task. | Full clean-machine confirmation cannot be claimed. | Run repeatable silent install/smoke/uninstall checks in an isolated temporary local profile where tooling permits; record any remaining limitation explicitly. |

## Verification baseline

The following checks completed before desktop modifications:

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm run lint` | Passed; 136 source files inspected |
| `npm test` | Passed; 27 test files, 120 passed, 1 skipped |
| `npm run build` | Passed; SPA and production server built |

> A passing baseline does not establish a signed installer, SmartScreen reputation, a clean-machine installation, or live remote-provider evidence. Those states will remain explicitly unavailable unless verified during this implementation.

## Acceptance criteria

The work is complete only when the package command builds a real NSIS installer, produces a SHA-256 checksum and machine-readable manifest, launches the installed application without development tooling, writes mutable state outside the installation path, cleans up its managed process tree on exit, and has recorded install, first-launch, settings persistence, and uninstall evidence. The installer is not to be represented as code-signed unless a valid certificate is explicitly supplied and verification succeeds.

## References

[1]: ../README.md "KNOuX Forge README"
[2]: ../AGENTS.md "KNOuX Forge repository instructions"
[3]: ../server/node-build.ts "Current production server entry point"
[4]: ../server/routes/workspace.ts "Workspace state and command orchestration"
[5]: ../server/services/previewRuntime.ts "Preview subprocess lifecycle"

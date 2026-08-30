# KNOuX Forge

KNOuX Forge is a local-first engineering command center for discovering repositories, inspecting evidence, running trusted project workflows, and coordinating verified engineering tasks. The product is a React 18 workspace backed by an Express API; it reports unavailable or unconfigured capabilities explicitly instead of fabricating remote, CI, registry, AI, package, or release state.

KForge is under active product-completion work. Verification is SHA-scoped: a green local or CI result proves only the evidence it actually measured, and missing external-provider evidence is never promoted to success.

## Reference verification baseline

A dated authoritative reference is GitHub Actions `KForge Verification Gate` **Run #208** for SHA `3c1b6f86309b8a3b8a533b0da4e5402df01935f4` on 2026-08-30. That run recorded:

- immutable workflow-action pin verification: PASS;
- typecheck: PASS;
- lint: PASS across 224 source files;
- Vitest: 30 test files, 146 passed, 1 explicitly skipped opt-in benchmark;
- production client/server build: PASS;
- Playwright browser acceptance: 58/58 passed, including responsive, keyboard, Axe accessibility, offline-network, Preview, Marketplace, Release, Quality, Developer, Git, Projects, and System evidence;
- Windows x64 NSIS build and installed-runtime/installer lifecycle: PASS;
- installer SHA-256: `5db31b54ea8b54deb11fcff290598fe2face936f00ac6255f863d4d84facce49`.

This is a reference snapshot, not a claim that every later HEAD is green. For a newer commit, inspect that exact SHA's Actions run and artifacts.

## Current product surfaces

- Local project discovery, collections, trust, profiles, health, problems, and bounded scans.
- Language-aware files, imports, exports, symbols, routes, APIs, dependencies, impact, cycles, and architecture evidence.
- Detected test, build, runtime, Preview, Git, task, mission, snapshot, and Release workflows.
- Source-separated Project Health and Release evidence for local, GitHub, CI, registry, Preview, Windows package, and installer sources.
- A specialized Release & Distribution Center that keeps local artifact presence, verified package identity, CI provenance, version evidence, and remote release state independent.
- Local-first model and Agent centers plus a Marketplace that exposes provenance, permissions, compatibility, lifecycle eligibility, and truthful unavailable states.
- A no-contact Online Control Center. Remote reads and writes occur only through explicit configured actions.
- Global Search across real local product entities with visible coverage and safety limits.
- An exact KForge-on-KForge Self Audit that persists evidence atomically and proves restart/reload only when a different server instance reads it.
- Specialized Workbench surfaces across Projects, AI, Online, Intelligence, Quality, Developer Tools, Remote/Git, Release, and System; specialization describes the product UI path, not the availability of every external provider.

## Requirements and installation

KForge requires Node.js with npm and Git. Optional project ecosystems and security tools must be installed separately; KForge does not download them silently.

```powershell
git clone https://github.com/daynightae-cmyk/KForge.git
Set-Location KForge
npm ci
```

Copy values from `.env.example` into the process environment as needed. The production server does not load `.env.example` automatically.

`KFORGE_WORKSPACE_ROOT` should point to the parent directory whose immediate child repositories KForge should discover. If it is omitted, the server uses the parent of its current working directory.

## Windows desktop installer

KNOuX Forge can be built as a Windows x64 desktop application. The packaged application starts the local engine and opens its application window itself; end users do not need Node.js, npm, a terminal, or a manually entered localhost address.

```powershell
npm ci
npm run package:windows
npm run verify:desktop
npm run verify:installer
npm run verify:release
```

The package command creates the NSIS installer, checksum, artifact manifest, release notes, and verification records under `release/`. The installer is intentionally a per-user install and does not request administrator rights. It creates a Start Menu shortcut and a Desktop shortcut on first installation; an existing Desktop shortcut deliberately remains removed if a user removed it before a reinstall. Immutable application resources are installed by the package runtime, while KForge-managed settings, task state, logs, Marketplace state, and workspace collection data use `%LOCALAPPDATA%\KNOuX Forge\workspace\.kforge`. Normal upgrades preserve this user data, and the uninstaller does not delete it automatically.

To permanently remove retained KForge-managed user data after uninstalling, explicitly run `powershell -ExecutionPolicy Bypass -File installer/purge-kforge-user-data.ps1 -ConfirmPurge`. The purge command refuses to delete anything unless `-ConfirmPurge` is supplied and targets only `%LOCALAPPDATA%\KNOuX Forge`.

The current installer is an **UNSIGNED DEVELOPMENT/RELEASE ARTIFACT** for trust purposes. It does not claim a Trusted Publisher, SmartScreen reputation, or trusted code-signing identity. A build log showing `signtool.exe` invocation is not sufficient evidence of a trusted publisher. See [DESKTOP_ARCHITECTURE_DECISION.md](docs/DESKTOP_ARCHITECTURE_DECISION.md) for the architecture, trust boundaries, and signing-readiness constraints.

## Development and production

Development uses Vite on port `8080`:

```powershell
$env:KFORGE_WORKSPACE_ROOT='D:\Projects'
npm run dev
```

Open `http://localhost:8080/workspace`. The `/` route is the KNOuX Forge reveal/entry screen and `/workspace` is the engineering workspace.

The production build serves the SPA and API together. It uses `PORT` or defaults to `3000`:

```powershell
npm run build
$env:KFORGE_WORKSPACE_ROOT='D:\Projects'
$env:PORT='3000'
npm start
```

Open `http://localhost:3000/workspace`. API routes are under `/api/workspace`; `/api/ping` is the local server smoke check.

## Verification commands

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run verify:gate
```

The authoritative GitHub Actions gate provisions Playwright browser dependencies before browser acceptance. A local host without Playwright's browser/runtime dependencies may be unable to reproduce that browser step locally; that host limitation must remain explicit and does not rewrite the CI evidence for another SHA.

The large-project benchmark is intentionally opt-in because it generates thousands of temporary files:

```powershell
$env:KFORGE_RUN_BENCHMARK='1'
npx vitest --run server/routes/performance.spec.ts
```

## Architecture and persistence

```text
client/                 React workspace, routing, and presentation
server/index.ts         Express application and API mount
server/routes/          Workspace HTTP orchestration
server/services/        Canonical local engines and persisted stores
shared/                 Renderer/server evidence contracts
fixtures/               Test-only project ecosystem fixtures
```

KForge-managed settings, tasks, trust decisions, collections, caches, snapshots, and Self Audit evidence are stored below `.kforge` in the configured workspace root or project cache locations. Project source is not uploaded merely because a screen opens. Secrets are redacted, remote writes require confirmation, and remote context remains blocked or confirmation-gated by policy.

## Truthful limitations

- KForge starts in Offline Mode. Local First permits explicit metadata reads, Online Optional additionally permits confirmed transfers, and Online additionally permits explicit provider refresh. Opening a remote surface never contacts its provider. GitHub, registries, remote documentation, remote CI, remote Preview, updates, and cloud AI remain `OFFLINE`, `NOT_CONFIGURED`, `UNKNOWN`, `UNAVAILABLE`, or `BLOCKED` until a real adapter, policy, authentication, and explicit action provide evidence.
- No trustworthy remote extension package adapter is currently configured, so remote install/update/uninstall claims remain blocked rather than simulated.
- Local AI detection supports Ollama, LM Studio, and llama.cpp-compatible endpoints on loopback. Optional OpenAI, Anthropic, Gemini, and OpenRouter credentials/models can be configured only in the server environment. No cloud provider is auto-selected: KForge first shows provider, destination, exact data classes, source-code inclusion, redaction, purpose, confirmation, timestamp, and result, then requires a separate confirmation before sending project context. Missing configuration remains `NOT_CONFIGURED`.
- Preview captures the local process output and KForge health probes. Its Workbench/browser acceptance is covered by Playwright in CI, but KForge still does not claim target-application browser-console or full browser-network telemetry without a dedicated telemetry bridge.
- Remote CI and GitHub Checks cannot pass from local Git state alone.
- Browser, responsive, keyboard, and Axe acceptance are exercised by the authoritative CI browser suite. A different host that lacks browser dependencies must report that local constraint rather than converting it into a repository-wide limitation.
- `npm ci` currently reports 2 moderate-severity dependency vulnerabilities and pending install-script review for `@swc/core` and `esbuild`; these are not represented as remediated.
- Branch protection, required status enforcement, trusted Windows publisher identity, and external-provider availability are separate evidence/policy domains and are not inferred from a green application test run.

See [PROJECT_STATUS.md](PROJECT_STATUS.md), [RUN.md](RUN.md), [docs/KFORGE-CAPABILITY-MATRIX.md](docs/KFORGE-CAPABILITY-MATRIX.md), and [docs/DESKTOP_ARCHITECTURE_DECISION.md](docs/DESKTOP_ARCHITECTURE_DECISION.md) for evidence and capability-level status. Licensing terms are in [LICENSE](LICENSE).

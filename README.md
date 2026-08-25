# KNOuX Forge

KNOuX Forge is a local-first engineering command center for discovering repositories, inspecting evidence, running trusted project workflows, and coordinating verified engineering tasks. The product is a React 18 workspace backed by an Express API; it reports unavailable or unconfigured capabilities explicitly instead of fabricating remote, CI, registry, AI, or release state.

KForge is under active product-completion work. Passing local checks are not presented as proof that an unavailable external provider or live browser acceptance has passed.

## Current product surfaces

- Local project discovery, collections, trust, profiles, health, problems, and bounded scans.
- Language-aware files, imports, exports, symbols, routes, APIs, dependencies, impact, cycles, and architecture evidence.
- Detected test, build, runtime, Preview, Git, task, mission, snapshot, and Release Gate workflows.
- Source-separated Project Health and Release Gate evidence for local, GitHub, CI, registry, and Preview sources.
- Local-first model and Agent centers plus a Marketplace that exposes provenance, permissions, compatibility, lifecycle eligibility, and truthful unavailable states.
- A no-contact Online Control Center. Remote reads and writes occur only through explicit configured actions.
- Global Search across real local product entities with visible coverage and safety limits.
- An exact KForge-on-KForge Self Audit that persists evidence atomically and proves restart/reload only when a different server instance reads it.

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

The current installer is an **UNSIGNED DEVELOPMENT/RELEASE ARTIFACT**. It does not claim a Trusted Publisher, SmartScreen reputation, or code-signing verification. See [DESKTOP_ARCHITECTURE_DECISION.md](docs/DESKTOP_ARCHITECTURE_DECISION.md) for the architecture, trust boundaries, and signing-readiness constraints.

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
npm run typecheck
npm test
npm run build
```

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
- Preview captures the local process output and KForge health probes. It does not claim browser console or full browser-network telemetry without a browser bridge.
- Remote CI and GitHub Checks cannot pass from local Git state alone.
- Live visual and keyboard acceptance requires an available browser automation bridge or external deployment; source, tests, built runtime, API, and persistence evidence do not substitute for that visual gate.

See [PROJECT_STATUS.md](PROJECT_STATUS.md), [RUN.md](RUN.md), [docs/KFORGE-CAPABILITY-MATRIX.md](docs/KFORGE-CAPABILITY-MATRIX.md), and [docs/DESKTOP_ARCHITECTURE_DECISION.md](docs/DESKTOP_ARCHITECTURE_DECISION.md) for current evidence and capability-level status. Licensing terms are in [LICENSE](LICENSE).

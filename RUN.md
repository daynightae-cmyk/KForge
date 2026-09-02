# KNOuX Forge run guide

## Primary Windows checkout: sync `main` and open Preview

The repository-native launcher for the primary Windows development checkout is:

```text
scripts/KForge-Local-Preview.ps1
```

Its defaults are:

```text
Repository:     https://github.com/daynightae-cmyk/KForge.git
Local checkout: D:\Knoux Projects\Knoux_Project_Center\01_Ready\KForge
Preview:        http://127.0.0.1:8081/workspace
Workspace root: D:\Knoux Projects\Knoux_Project_Center\01_Ready
```

Run it from any PowerShell window:

```powershell
powershell -ExecutionPolicy Bypass -File "D:\Knoux Projects\Knoux_Project_Center\01_Ready\KForge\scripts\KForge-Local-Preview.ps1"
```

The launcher:

1. verifies Git, Node.js, and npm are available;
2. clones `main` if the checkout is missing;
3. normalizes `origin` to the canonical KForge repository;
4. fetches/prunes GitHub state and switches to local `main`;
5. stashes uncommitted tracked/untracked work before synchronization and reapplies it afterward;
6. fast-forwards with `git pull --ff-only origin main` and proves local `HEAD == origin/main`;
7. runs `npm ci` and `npm run typecheck` by default;
8. refuses to kill an unrelated process when the selected port is occupied;
9. starts Vite on `127.0.0.1:8081` with `--strictPort`;
10. waits for `/api/ping` before opening `/workspace` in the default browser.

Use `-Port <number>` or `-WorkspaceRoot <path>` when needed. `-SkipInstall` and `-SkipTypecheck` are available only for deliberate local bypasses.

## Manual development and production

1. Install the locked dependencies with `npm ci`.
2. Set `KFORGE_WORKSPACE_ROOT` in the process environment to the parent directory containing repositories KForge should discover. If omitted, KForge uses the parent of its current working directory.
3. Start development with `npm run dev`, then open `http://localhost:8080/workspace`. Supply Vite CLI arguments to override the development port when necessary.
4. For production, run `npm run build` and then `npm start`. The production server uses `PORT` or defaults to `3000`.

## Repository-native verification

```text
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run verify:gate
```

`npm run test:e2e` requires the Playwright browser runtime and its host dependencies. The authoritative GitHub Actions verification workflow provisions browser dependencies before running the browser suite. A developer host without those dependencies has a local environment limitation; that does not erase or replace CI evidence for a different exact SHA.

`npm run verify:gate` is the aggregate repository gate used by CI. It verifies immutable workflow-action pins, locked dependency installation, dependency audit, typecheck, lint, unit/integration tests, production build, browser availability/provisioning as configured by the environment, and Playwright E2E. The gate writes bounded verification evidence instead of converting a missing prerequisite into success.

## Windows packaging verification

On a Windows environment capable of Electron/NSIS packaging:

```text
npm run package:windows
npm run verify:desktop
npm run verify:installer
npm run verify:release
```

Packaging evidence is source-specific: a locally produced installer digest is not CI artifact provenance, and invoking a signing tool does not by itself establish a trusted publisher identity.

Additional scripts include `build:client`, `build:server`, `verify:workflow-pins`, and `format.fix`. Remote providers, registries, GitHub reads, and remote writes require their own configuration and explicit product gates; starting KForge does not contact them.

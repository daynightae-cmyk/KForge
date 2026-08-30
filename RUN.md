# KNOuX Forge run guide

1. Install the locked dependencies with `npm ci`.
2. Set `KFORGE_WORKSPACE_ROOT` in the process environment to the parent directory containing repositories KForge should discover. If omitted, KForge uses the parent of its current working directory.
3. Start development with `npm run dev`, then open `http://localhost:8080/workspace`.
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

`npm run verify:gate` is the aggregate repository gate used by CI. It verifies immutable workflow-action pins, locked dependency installation, typecheck, lint, unit/integration tests, production build, browser availability/provisioning as configured by the environment, and Playwright E2E. The gate writes bounded verification evidence instead of converting a missing prerequisite into success.

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

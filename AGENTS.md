# KNOuX Forge — Repository Agent Contract

## Authority

- Product: **KNOuX Forge / KForge**.
- Canonical repository: `daynightae-cmyk/KForge`.
- Authoritative branch: `main`.
- Treat the current `main` HEAD as source of truth. Do not resurrect removed starter/demo/Edita code from history.
- Do not create parallel product shells or duplicate capability centers when an existing canonical surface/service can be extended.

## Product architecture

KForge is a local-first engineering command center with a persistent workbench shell.

Canonical client entrypoints and architecture:

- `client/App.tsx` — application routing entrypoint.
- `client/workbench/KForgeWorkbench.tsx` — canonical persistent workbench shell.
- `client/workbench/navigation.ts` — activity/view information architecture.
- `client/workbench/*Surface.tsx` and focused workbench components — capability surfaces.
- `client/components/ui/KForgeInspector.tsx` — canonical Inspector for selected capability evidence.
- `client/workbench/workbench.css` — current workbench styling; it intentionally imports `client/pages/KForgeWorkbench.css` while the CSS migration remains active.

The Online product follows this hierarchy:

`Online activity -> scoped Explorer/navigation -> central surface -> canonical Inspector`.

Do not flatten Online children back into the global Activity Bar. Do not create independent Marketplace/Models/Agents/Tools shells when the scoped Online architecture already owns those views.

## Runtime and server architecture

- React 18 + React Router 7 + TypeScript + Vite.
- Express 5 API.
- Electron desktop runtime and electron-builder Windows/NSIS packaging.
- Vitest for unit/service tests and Playwright for production E2E evidence.
- Shared runtime contracts live under `shared/`.
- Canonical API assembly begins in `server/index.ts`; workspace capabilities are owned by the mounted workspace/product-truth/evidence routes and their services.

Do not reintroduce removed Fusion Starter contracts such as:

- `client/pages/Index.tsx` as a product home shell,
- `shared/api.ts` demo interfaces,
- `/api/demo`,
- legacy Knoux Edita/media editor routes or components,
- mock AI-effect catalogs or unreachable media routers.

## Evidence and truth rules

KForge must distinguish implemented capability from environmental availability.

- Never fabricate provider connectivity, cloud credentials, runtime readiness, update availability, security state, or remote evidence.
- If an external provider/credential/runtime is unavailable, expose the truthful blocked/not-configured/not-evaluated state.
- Remote contact must be explicit and policy-controlled; do not add implicit network refreshes.
- Destructive or security-sensitive actions require explicit authority/eligibility and confirmation where the product contract expects it.
- Preserve evidence provenance, disabled reasons, lifecycle state, compatibility, trust, permissions, and operation results in the canonical UI rather than hiding them behind optimistic UI.

## Zero-mock / zero-dead-UI rule

Production product surfaces must not be backed by decorative mock data that pretends to be live capability.

Fixtures are allowed only when they are clearly test/verification fixtures under intentional fixture/test paths. Do not promote fixture data into production truth.

Before adding a new surface, verify that it is reachable from `navigation.ts` and that its actions map to real services or explicit unavailable states. Before keeping old code, prove it is reachable from current entrypoints or tests.

## Dependency and lockfile policy

- `package.json` and `package-lock.json` must remain synchronized.
- Do not hand-edit dependency graph entries in `package-lock.json`.
- Use npm to add/remove/update packages and let npm regenerate the lockfile.
- Do not weaken `npm audit`, add vulnerability ignores, or introduce broad `overrides` merely to silence warnings.
- Deep dependency overrides require a concrete compatibility/security reason and full verification.
- Remove direct dependencies that have no production/test/tooling consumer after verifying reachability.

## Required verification

For substantive code, dependency, build, packaging, or architecture changes, the target state is the authoritative gate, not a single local check.

Primary commands:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm audit
npm run verify:gate
```

Desktop/release-sensitive changes must also preserve:

```bash
npm run verify:desktop
npm run package:windows
npm run verify:installer
```

Use `npm run verify:release` when the execution environment supports the complete release path. GitHub Actions `KForge Verification Gate` is the authoritative cross-platform repository evidence and must be green on the exact final `main` SHA before calling repository work complete.

Do not weaken tests to make a change pass. Fix the violated contract or implementation.

## Security and repository hygiene

- Keep GitHub Actions dependencies pinned as required by the workflow policy.
- Never commit credentials, tokens, private keys, signing certificates, or local `.env` values.
- Do not claim code signing, SmartScreen reputation, clean-machine verification, provider connectivity, or branch protection unless it is actually evidenced.
- Do not add one-shot maintenance workflows permanently. If a temporary workflow is required to safely regenerate repository state, make it self-validating and remove it after the resulting state is verified.
- Avoid stale duplicate config files such as `npmrc.txt`, `gitignore.txt`, `dockerignore.txt`, or renamed config copies that can be mistaken for active configuration.

## Change discipline

- Prefer the smallest coherent change that closes the verified gap.
- Reuse canonical services/contracts instead of parallel implementations.
- Preserve the persistent workbench shell, scoped Explorer model, canonical Inspector, explicit evidence states, accessibility, keyboard navigation, and Windows packaging lifecycle.
- Keep `main` authoritative. Do not create a branch unless the task explicitly requires one or repository policy forces it.

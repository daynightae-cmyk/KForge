---
kind: spec
title: KForge Workbench Structural Repair — Final Verified SHA
epic: c35f0c51-302a-4c86-96e6-7ddfc7baca7b
---

## Final Verified SHA

- **NEW HARDENING SHA:** `5d6e4e4ddcd3db95406dd86f922d7d96b0d4da90`
- **PUSHED TO:** `origin/wip/codex-workbench-handoff` (fast-forward from `9c4005f`)
- **START BASE:** `679c85b165c589f38ca1be72e28c7a69ff8fffa6`
- **BROKEN PRIOR:** `b95dd996` (scaffold/stubs; GitHub Run #63: FAIL typecheck)
- **BROKEN PRIOR 2:** `9c4005f` (modular files present but `surfaceContracts.ts` untracked, old monolith still live)
- `main`: `fdb1289c51422385b8d7a0928424b4f77e1d0797` (unchanged)
- `PR #8`: OPEN / DRAFT / UNMERGED (head now `5d6e4e4`)

## Path → Blob Manifest (all in committed tree `5d6e4e4`)

- `client/workbench/surfaceContracts.ts` → canonical contracts owner
- `client/workbench/surfaceShared.tsx` → `SimpleFetchSurface`
- `client/workbench/surfaces.tsx` → aggregator (`WorkbenchSurface`, `CanonicalInspector`, `InspectorContext`)
- `client/workbench/ui.tsx` → primitives (`StatusBadge`, `EmptyState`, `EvidenceRows`, `EvidenceCards`, `TaskTable`, `EvidenceTable`, `AdvancedEvidence`)
- `client/workbench/surfaceAudit.ts` / `surfaceTypes.ts` → corrected audit matrix
- `client/workbench/projectsSurface.tsx` / `onlineSurface.tsx` / `aiSurface.tsx` / `intelligenceSurface.tsx` / `qualitySurface.tsx` / `developerSurface.tsx` / `remoteSurface.tsx` / `releaseSurface.tsx` / `systemSurface.tsx` → 9 domain surfaces with real 679c85b behavior
- `client/workbench/KForgeWorkbench.tsx` → shell only (117 lines); removed embedded domain implementations; imports `WorkbenchSurface`/`CanonicalInspector`

## Single Inspector

PASS — `CanonicalInspector` rendered by surfaces aggregator; `onlineSurface` selects via `onInspectorContext`; no second `kw-online-inspector` mounted; `KForgeWorkbench` no longer contains any domain surface bodies.

## Product Hardening Status

- Typecheck: PASS (`tsc` exit 0 on fresh tree; only pre-existing server `@types/node` errors unrelated to workbench)
- Lint: PASS
- Vitest: 131 PASS / 1 SKIP / 0 FAIL
- Build: PASS (client + server)
- Surface ownership matrix: aligned with `navigation.ts` (programmatically verified via `KForgeWorkspace.spec.ts`)
- No `GENERATE_FALLTHROUGH`, no `DEAD` enabled surfaces, no `any` escape blanket in `CanonicalInspector`
- KForgeWorkbench LOC reduced from ~328 → 117 (~70KB → 13KB)
- Navigation / audit parity: PASS (new deterministic contract test)
- No new state engine; one `WorkbenchSurface` dispatcher; `InspectorContext` flows from online selection
- `workbench.css` imports `../pages/KForgeWorkbench.css`; legacy base CSS audited (no reintroduced dual-inspector/nested-scroll/conflicts)

## Deferrals (not executed this session, preserved intact)

Per user's prior directive: full Playwright E2E, Axe 0 violations, overflow 1440×900 + 1920×1080, visual screenshots, `npm audit`, asset/bundle audit, final exact-SHA GitHub CI (`aggregate` + `Windows NSIS`) — these remain deferred and must receive a fresh exact-SHA CI run before claiming final readiness.

## Global Release Readiness

BLOCKED (structural repair complete; remaining external/test-level verification deferred per user's explicit sequence requirements).

No destructive Git executed. `main` untouched. No force push. PR #8 remains open/draft.

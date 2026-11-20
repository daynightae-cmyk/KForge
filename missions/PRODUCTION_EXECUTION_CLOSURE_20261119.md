# KForge — Production execution closure (2026-11-19)
Baseline observed locally: main a6373be; origin/main cached same. Recheck live remote, status, branch, worktree, stash, reflog, and concurrent owners before editing.
Execute existing canonical workbench, not a replacement shell. Read AGENTS.md and COMPETITIVE_ROADMAP_AR.md first.
1. Inventory all reachable routes/actions from client/workbench/navigation.ts through shared contracts, server/index.ts and Electron IPC. Classify actual operation, genuinely observational feature, authorized approval gate, incomplete stub, or platform/provider blocker.
2. Convert actionable preview-only promises to real operations. Prioritize ReleaseDistributionWorkbench.tsx PREVIEW_ONLY / READ_ONLY_PREPARATION: inspect real package, signing and publish handlers; implement missing authorized steps, explicit target/review/confirm, verified output and errors. Never publish without explicit authorization; use sandbox/test release target for E2E.
3. Verify provider command center, project execution, task orchestration and workspace write capability with test fixtures and actual runtime evidence. Keep GitHub evidence read path and real Preview Studio; add distinct authorized mutation paths only where product scope and permissions allow, never bypass provider roles. Preserve agent autonomy/security choices, safe defaults and user confirmation.
4. Hide/remove unreachable fake actions only when replacement is impossible; retain real functionality, official visual identity, test fixtures, audit receipts, and unique work. Never silently report success or delete user data.
5. Run npm run typecheck, npm run lint, npm test, npm run build, npm run test:e2e, and desktop/package gates as applicable. Prove click -> API/IPC -> actual side effect -> independent read-back; prove cancel/deny/error/partial outcomes and restart persistence. Record command, exit code, SHA and artifact/runtime evidence.
6. Merge unique work into authoritative main without destructive history edits, push after verification, check CI/remote SHA. No COMPLETE without runtime evidence; environmental failures stay BLOCKED with exact cause. Recheck status and avoid modifying other agents' changes.
Status: OPEN; source audit and targeted test attempt do not establish production closure.

## Execution closure progress (2026-11-20, working state — uncommitted)

Branch/HEAD recheck before edits: `main` at a6373be5793cd5282668ce1438aaf777eb6722ba; single worktree, no stash entries, no concurrent owner changes observed.

### Implemented (authorized operations, canonical workbench only)
- Release execution is real but explicit: `POST /api/workspace/projects/:id/release/execute` runs the detected build/package command, streams artifact SHA-256 hashes, persists a provenance record under `.kforge/release-records/<projectId>/`, and reports signing honestly. Preparation stays read-only and now exposes `sourceHead`.
- Release publication is real but explicit and gated: `POST .../release/publish` requires a trusted project, `confirmed: true`, reviewed `expectedHead`, a persisted VERIFIED record, package/installer assets only, current-HEAD + artifact re-hash, version/tag agreement, and signing acknowledgement when not VALID. Assets upload to a draft release; independent `gh` read-back gates un-drafting; byte identity is claimed only when GitHub reports a matching SHA-256 digest and size.
- GitHub remote workbench mutations (PR create, release create, workflow dispatch/rerun) reuse the hardened `gh` transport with separate action contracts, trust/Online/remote-write/confirmation/repo-identity/HEAD guards plus field-level read-back.
- Evidence honesty: `github_checks` and `artifacts` now return real read-only evidence; local `PREVIEW_ONLY`/`READ_ONLY_PREPARATION` labels remain accurate because no tag/push/publish happens implicitly.
- Stability: the activity rail's live pulse now animates opacity only; a scaling pulse changed the button's bounding box and made Playwright report the control continuously unstable.

### Verification actually run (exit codes recorded)
- `npm run typecheck` — PASS.
- `npm run lint` — PASS, 350 source files checked, no violations.
- `npm test` — PASS, 88 files / 643 tests passed, 3 skipped, 1 skipped file (89 total). One earlier full run showed two pre-existing 5s-timeout flakes in `providerCommandContextDisclosure.spec.ts` and `workspace.spec.ts`; both passed on isolated rerun and the final full run was green.
- `npm run build` — PASS (Vite client + SSR server bundles).
- `npm test -- tests/e2e/github-remote-workbench.spec.ts tests/e2e/release-evidence.spec.ts tests/e2e/release-execution.spec.ts` — PASS after `npm run build` (e2e serves the built SPA; an earlier failure was a stale bundle).
- New `tests/e2e/release-execution.spec.ts` proves click -> `POST /release/execute` -> real build + streaming SHA-256 -> persisted record -> independent `GET /release/records` read-back -> reload in a fresh browser session, with no external requests in Offline Mode and no artifact when the build fails (service/route specs).

Then open items:

### Blocked / not executed (no fake evidence)
- Live GitHub release/asset publication: requires explicit user authorization and a sandbox/test release target; route/service tests cover validation/denial paths without network contact.
- Trusted code signing: no certificate material configured; signing records report UNVERIFIED/NO_RECORD/STALE_RECORD truthfully.
- `npm run package:windows` / installer verification: not run; `release/verification/package-windows.json` and `installer-verification.json` absent; only `desktop-verification.json` exists.
- Full `npm run test:e2e` suite: targeted specs pass; full-suite run in progress at time of writing.

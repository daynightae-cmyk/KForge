# KForge 68-view Day/Night visual capture — verified local evidence

**Date:** 2026-11-02 (Asia/Dubai)
**Captured source HEAD:** `1aba7b97d797fee21661cd5e01bd4446c630dfb0`
**Scope:** opt-in Playwright local-production-browser capture, not installed Electron/NSIS, not owner approval.

## What was actually executed

- Added `tests/e2e/all-views-visual-ledger.spec.ts`, guarded by `KFORGE_CAPTURE_ALL_VIEWS=1`. Ordinary CI/E2E does not execute this 136-image capture by default.
- Reused the repository's Playwright webServer, which starts its own fresh temporary `KFORGE_WORKSPACE_ROOT` and offline app mode. This run did not reset the operator's persistent KForge workspace.
- `npm run typecheck`: EXIT 0.
- `npm run lint`: EXIT 0 (324 source files at execution).
- `npx playwright test tests/e2e/all-views-visual-ledger.spec.ts --list`: EXIT 0; one test discovered.
- Limited `KFORGE_VISUAL_VIEW_LIMIT=2` smoke run: EXIT 0; 4 PNGs; zero reported capture issues; status `PARTIAL_SMOKE`.
- Full capture: `KFORGE_CAPTURE_ALL_VIEWS=1 npx playwright test tests/e2e/all-views-visual-ledger.spec.ts --workers=1`: EXIT 0; 1/1 test passed.

## Actual artifacts

Local-only output: `verification/all-views-visual-evidence/1793580388344/`.

- `ledger.json` — 68 registered views; 136 records; 136 screenshot files; zero flagged entries; `CAPTURED_NOT_VISUALLY_APPROVED`.
- PNG set: 68 light + 68 dark; all images verified `1672x941` from actual PNG bytes.
- Actual total PNG bytes: **79,869,025**.
- `README.md` — local provenance and limits.

The screenshot directory is retained locally under gitignored `verification/`. Images are **not** included in Git commits; these captures may reveal local project names/paths in the UI and are not approved for public release.

## Evidence boundaries — do not overclaim

- Browser-captured views are not design-approved pixel fidelity, reference comparisons, button/handler functional proof, signed package or installed Windows runtime acceptance.
- The automated gate checks each registered view's title, pending loading status, common workbench fade opacity, screenshot dimensions, and unhandled `pageerror`. It does **not** certify all network calls, visual contrast, user-data realism, interactions, overflow, 1366x768 / 1920x1080, RTL, or accessibility conformance.
- Rendered screenshots still require manual/design-reference review and targeted runtime/action E2E. The image count alone is not a production acceptance gate.
- Credential secrets, owner OAuth, live GitHub Connect backend, trusted installer signing/clean-machine acceptance remain separate authorization and evidence gates.
- Two untracked `kforge-security-*/src/keys.ts` fixtures were neither staged nor removed; the four cleanup targets remain deletion-blocked. No workaround cleanup attempted.

## Next safe action

1. Review this local screenshot gallery against approved DAY/NIGHT references, log actual visual defects per view (reference missing -> UNKNOWN, not PASS).
2. Add supported 1366x768 and 1920x1080 captures/overflow and accessibility checks as separate bounded opt-in runs when useful.
3. Preserve the new test code under normal Git/CI workflow; record actual new commit and exact-SHA CI before claiming integrated verification.
4. Keep GitHub Connect deployment/OAuth, signing, and any blocked removal gated on owner authorization.

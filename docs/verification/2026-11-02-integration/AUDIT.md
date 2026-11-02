# KForge integration and production audit — 2026-11-02 (Asia/Dubai)

## REALITY

Canonical checkout: `K:\Knoux Projects\KForge\Base`; its parent is not a Git repository. Origin: `https://github.com/daynightae-cmyk/KForge.git`. Starting local main: `96927fadcb99b5a7cc033c0c05e425cfc36c7e66`. Fresh fetch and ls-remote confirmed upstream main `f1c872fcbfb4a4824a389c999cdad1e8fd6cff52`. No open PRs were returned.

Starting dirt: 18 untracked mission documents and two synthetic security-test files; no tracked edits. Registered worktrees: Base/main and KForge-SwcAllowlist-20261027 at `13f029b4014f51e4f13989de7449f6987bec5f5a`, the latter clean. No live stash entries. Five historical stashes survived as archive branches/tags. A Recovery directory held research, an OpenSumi experiment, Git bundles and historical evidence. The known old Traycer KForge root was absent. This is not an exhaustive search of every drive or unrelated project.

No KForge process was identified by command line in the inspected process inventory; other projects' Node processes were left alone. Source inventory: 9 activities, 68 views and 54 existing E2E spec files. See `SURFACE-INVENTORY.md`; registration is not action or native-runtime certification.

Upstream CI before this work: aggregate and Windows NSIS jobs succeeded on f1c872f, [run 40552465053](https://github.com/daynightae-cmyk/KForge/actions/runs/40552465053). This does not certify new commits.

Main protection was read successfully: protected=true, strict checks `aggregate verification gate` and `Windows NSIS package gate`, force-push=false, deletion=false, enforceAdmins=false. Settings were not changed.

## IMPLEMENTED

- `7548348`: committed 18 local mission documents, retaining the owner's visual requirements.
- `468ac52`: normal merge of three unique README/brand-diagram commits from `origin/docs/kforge-ultimate-readme-20261027`: ef888d1, d8052df, 5bac6ba.
- `9a63ed2`: normal merge of freshly fetched origin/main, including pinned SWC script approval. An initial fast-forward attempt refused divergence after preservation; no history was rewritten.
- `ecb3d9e`: moved 10 temporary-root sites in `server/routes/workspace.spec.ts` from the checkout to `os.tmpdir()`. This targets test residue creation; it does not imply old residue removal. Trimmed one mission whitespace defect.
- `e2c5a14`: recovered 66 source/research files into `docs/research/recovered-20261017` with byte/hash manifest. Generated OpenSumi app bundles were excluded. Historical source is outside the canonical build/runtime; no OpenSumi migration occurred.
- `c843413`: ancestry-only reconciliation of four superseded branches; product files unchanged. This is not a newly applied functional patch.
- `6266db1`: ancestry-only preservation of five archived stash commits and their untracked parents. Retired Edita components and old styling were not reactivated.

## UNIQUE WORK & RISKS

`refs-before.json` records heads, remote refs, tags, divergence and patch equivalence. `content-comparison.json` compares affected files by blob. A plus in git cherry can still be a squashed or superseded change.

| Source | Finding | Disposition |
|---|---|---|
| README branch | Three unique documentation/artwork commits | Normal merge |
| Hardening backup | 35 changed files identical to current main, including API/SSRF, redaction, snapshot and trust boundaries; remaining files evolved after #44 | Current implementation retained; historical parent preserved |
| WinGet and five Traycer aliases | Exact lookup adapter in main through #41 and #43 hardening | Current stricter implementation retained; source preserved in ancestry |
| Living Mark | Existing scene/assets, later lazy accessibility gate, exact Three pin and current theme supersede original | Current scene/gate retained; history preserved |
| MCP/theme | Six of eight changed files identical; theme/E2E evolved through #57 and visual rebirth | Current implementation retained; history preserved |
| Navigation and installer refs | Patch-equivalent commits | Already represented; no duplicates |
| Stash 0f7e1e3 | Old Playwright scripts/dependency and first-generation tests | Modern gate retained; historical parent preserved |
| Stash 1e4e27b | No tracked delta; preview script/screenshots/report in third parent | Historical preservation; not installed as current scripts |
| Stash 290b989 | Older provider CSS and predecessor vault/session work | Current runtime injection/session implementation retained; history preserved |
| Stash 3a5e64e | Two retired Edita component fixes | Historical only; retired product not revived |
| Stash fb8a8d1 | No tracked delta; historical report | Third-parent preservation |
| Recovery source/research | Four research and 62 experiment source/config/license files | Committed as historical research with manifest |
| Ignored auth/config, workspace state, screenshots | Private state or potentially irreplaceable evidence | Retained locally; not published or declared worthless |

A pattern scan of 57 historical blobs found no checked private-key/GitHub/OpenAI token patterns. This limited scan is not a guarantee of absence of every secret format. Values were not printed. Git refs occupy negligible space; deleting names does not reclaim referenced pack data. No branch removal, history rewrite or object pruning occurred. Reflogs were inspected. Observed fsck output contained unreachable trees/blobs, with no unreachable commits reported; these were not discarded blindly.

## STORAGE AND CLEANUP

Starting free space: K approximately 5.22 GiB, D 2.39 GiB, C 13.70 GiB. Measured logical sizes are not guaranteed allocated savings; see `disk-before.json`.

| Area | Logical bytes | Decision |
|---|---:|---|
| Base/release | 557446648 | Installer/evidence retained until replacement verified |
| Base/node_modules | 303059599 | Canonical dependencies refreshed by npm ci |
| Secondary node_modules | 288119065 | Reproducible duplicate; deletion explicitly approved |
| Secondary dist | 6500345 | Reproducible duplicate; deletion explicitly approved |
| Base/verification | 237828299 | Historical screenshots/evidence, not presumed worthless |
| Recovery OpenSumi | 50541232 | Mostly generated bundle; source now separately preserved |
| Recovery Git data | 27294454 | Verify complete reachability/integrity before removal |

**BLOCKED:** automatic execution review rejected the bounded PowerShell deletion with `blocked by policy`, before and after explicit user approval. No deletion occurred. Retained exact paths: `Base/kforge-security-17qX4N`, `Base/kforge-security-1jmRHl`, and `Worktrees/KForge-SwcAllowlist-20261027/{node_modules,dist}`. The security files exactly match synthetic test output, not real product credentials; they were not committed.

Do not report zero dirt or reclaimed space. Approval already covers those four paths; execution policy is the blocker. Do not switch deletion mechanisms to bypass it. Recovery bundles, local authentication and unique screenshots remain preserved.

## VERIFIED PRODUCTION GAPS

### P1: Windows vault and Electron verification fail on this host

The isolated Preview/Topology/provider rerun completed: 28 passed, one failed.
Preview and Topology passed in isolation; provider credential masking still
failed at the real Windows `protectWithDpapi` PowerShell call with ETIMEDOUT.
This repeats the original failure and is not dismissed as parallel-test load.
Source Electron smoke over the fresh build also failed at its 120 s spawn
budget. Neither final native startup nor credential persistence is accepted.
Diagnose real Windows process/log/DPAPI behavior; do not introduce a plaintext
fallback or fake production vault to force tests green.

### P1: Context scan can claim complete after read failure

`server/services/agent.ts`, `collectProjectFiles`, catches `fs.readdir` failure and returns without setting complete=false or recording an unreadable path. A missing root, permissions error or disappearing subtree can yield success-shaped incomplete context. The outer catch cannot see the swallowed error. A read-only tsx invocation against a random nonexistent OS-temp path reproduced files=[], complete=true, truncated=false. See `agent-missing-root.json`. Permission/disappearing-subtree variants remain untested.

Fix truthful partial/unreadable metadata, add missing-root/permission/subtree tests and propagate coverage to UI. Existing file/depth/time checks remain. Bounds are cooperative between filesystem operations; this audit did not establish true cancellable filesystem operations. Validate Windows junction/link behavior separately.

### P1: GitHub Connect lacks deployed backend evidence

Connected Vercel tools returned project `prj_Hm9ggaDtieAqANwsuNAjdy3L4PWF`, Node 24.x, live=false, latestDeployment=null and zero deployments. Dedicated domain listing returned verified connect.knoux.store and knoux-forge-connect.vercel.app; embedded project domains were empty, so the more specific listing is retained. GET https://connect.knoux.store/health failed DNS resolution on this Windows host; no HTTP status was observed. Do not infer global DNS failure from one host or readiness from domain attachment.

The native adapter targets that production origin. Passing synthetic tests cannot establish real account flow. Review durable Redis/encryption, repo/root-directory linkage, DNS/TLS and deployment identity before owner OAuth acceptance. No deployment, DNS edit, secret provisioning or webhook activation occurred. See `vercel-observation.json`.

### P1: Local installer stale and not proven trusted

Local installer manifest names SHA `c728f4733c6c4764e1f06def7cc90fbb0ce57618`, timestamp `2026-10-24T20:43:02.327Z`, hash `47a00f41de39f73ceb6491f2c95fd78c36c0839ee1be0c94a0e60d259a0bee45`, DEVELOPMENT mode, signing configured=false, signature UNAVAILABLE and DEVELOPMENT_ARTIFACT trust. These are manifest observations, not fresh byte/hash/AuthentiCode verification. This artifact cannot represent integrated main or trusted release.

Package final accepted main; verify bytes/signature and install/upgrade/restart/uninstall with retained user data. Trusted release requires real signing material and OS verification; preserve fail-closed policy.

### P2: Development/packaging dependency audit nonzero

Post-push GitHub alert inventory returned 68 open alerts: two in the root
lockfile, 61 in the newly preserved historical OpenSumi lockfile, four in the
PHP detection fixture, and one in the clean-workspace fixture. These are
different graphs from root npm audit. Importing the inactive experiment's
manifest expanded the repository dependency graph; removal of that historical
source directory from the active main tree was proposed for explicit approval,
while preserving its complete source in commit e2c5a14 and the original Recovery.
No alerts were dismissed, ignored or falsely marked fixed. See
`dependabot-alerts.json` for the observed manifest-specific inventory.

Fresh full npm audit: 14 moderate, zero high/critical. Runtime-only audit: zero. Findings include electron-builder/asar/universal/glob/minimatch, Tailwind typography/postcss-selector-parser and sucrase. Some npm suggestions downgrade electron-builder to 20.23.1 or typography to 0.5.4 with major-breaking labels. Review compatibility and packaging proof; do not force automatic graph changes. Complete advisory details: `npm-audit.json`.

### P2: Pagination and webhook execution incomplete

Connect router lists first 50 installations, authorizes repository access against first 100 installations, and returns first 50 repositories. A legitimate later-page installation can be denied; larger accounts are truncated. Add bounded pagination and completeness metadata, with authorization across accessible pages.

Webhook validates signature/replay and records receipt; it does not synchronize repositories or dispatch desktop notifications. Setup is informational. If advertised, installation binding and durable processing/retry/dead-letter behavior require implementation. Receipt must never imply sync. No automatic Git mutation without trust/authority.

### P2: Catalog discovery differs from install/update support

Remote adapters explicitly retain catalog-only/read-only states and NOT_CONFIGURED updates. Open VSX install needs immutable artifact, integrity, compatibility and confirmation. WinGet/npm/PyPI/NuGet presence is not execution proof. Map advertised actions to real lifecycle support or truthful unavailable reasons. No live provider, package install, trusted update or paid AI acceptance occurred here.

### P2: Visual acceptance remains evidence-specific

Two fresh Preview PNGs were inspected. Both are actually 1440x900 according to
their PNG IHDR, including the file named light-mobile: its mobile selector is
embedded viewport simulation, not a mobile-sized application capture. The light
capture still shows “Reconciling Preview Studio runtime evidence...” and the
Inspector renders Activity as “Invalid Date”. It cannot establish a settled
DAY visual acceptance result. `CanonicalInspector.tsx` directly formats truthy
lastActivity values without validating the parsed date. Add a real missing/
invalid timestamp state and capture only after the relevant surface settles.
The dark capture's large header/service deck and open dock consume the initial
viewport; review accessibility of actual Preview controls at bounded heights
with owner-approved composition rather than declaring fidelity from a test pass.
See `fresh-preview-image-dimensions.json`; original PNGs are in local verification.

Mission queue/PENDING_TRANSFER references are historical requirements, not a current completion ledger. Preserve cinematic entry and identity. Check current DAY/NIGHT across 68 views and real actions, realistic data, desktop sizes, supported RTL/LTR, keyboard, reduced motion, focus and failures. Settling only proves leaving loading; it does not prove visual fidelity or owner approval. Existing screenshots remain historical unless freshly captured.

### P3: Type/lint guarantees narrower than their names

TypeScript strict and strictNullChecks are disabled. Custom lint checks syntax, conflict markers, debugger and TypeScript suppressions; it is not comprehensive React/accessibility/security lint. These are baseline limitations, not newly introduced regressions. Ratchet focused contracts without a broad unrelated rewrite.

## VERIFICATION

Fresh raw evidence: `K:\Knoux Projects\KForge\Evidence\integration-audit-20261102`. Final command and delivery results are in `RESULTS.md`. During drafting: npm ci succeeded (596 added, 597 audited); pins/assets passed; runtime audit zero; typecheck passed; custom lint passed on 322 source files; GitHub Connect 17/17 passed. Vitest/build/E2E were running. Gate testedSha records starting code SHA ecb3d9e; subsequent research/docs/ancestry commits do not become exact-SHA CI proof automatically.

Recovered research retains original whitespace anomalies to preserve original bytes. Distinguish these from new implementation defects in diff checks.

## DELIVERY / REMAINING GAPS

Local preservation/integration implemented. Final remote main, CI and worktree status: `RESULTS.md`, then refresh live before further edits. Zero dirt/storage cleanup: BLOCKED by policy. Installed final-main package, live providers/OAuth, trusted update and production runtime: NOT VERIFIED / BLOCKED as above. No full-production claim.

Next execution contract: `docs/handoffs/QODER-PRODUCTION-CLOSURE-20261102.md`. Fix evidenced gaps and final-main provenance while preserving current product, unique history and owner evidence.
### P2: Dependency audit refreshed (post-pagination slice)

Full `npm audit` on the current tree reports 14 moderate and zero high/critical
advisories, all in development/packaging dependencies; production-only audit
reports zero. The suggested fixes are major downgrades of `electron-builder`
(26.18.0 to 20.23.1) and `@tailwindcss/typography` (0.5.20 to 0.5.4), plus
a normal `sucrase` update. No automatic dependency graph change was applied.
The packaging path remains on electron-builder 26.18.0 with the Windows NSIS
installer built and verified below.

### Final-main packaging observation (post-pagination slice)

`npm run package:windows` completed successfully on the current tree without
signing material. Installer:
`release/KNOuX-Forge-Setup-v0.1.0-Windows-x64.exe`,
SHA-256 `37a32a2496cf1569754731b29e27d5d9e72bf64752f4c6fbdac1ac562f7d9d94`,
observed signature UNAVAILABLE, release mode DEVELOPMENT.
`npm run verify:installer` passed. `npm run verify:desktop` also passed.
No trusted-release claim is made; signing remains unavailable.

## Slice: AI session context disclosure and one redaction path (2026-11-02, later)

Baseline revalidated at `3647141c0e5df697efa4f1436dd12dbb24592950`, equal to
`origin/main`, with the `KForge Verification Gate` green on that exact SHA.
One registered worktree, zero stashes, and the same three protected untracked
paths. Free space measured on this host: K 5.7 GiB, C 15.2 GiB, D 3.5 GiB.

### Prior P1 findings re-tested against current main, not assumed

- **Windows DPAPI vault — no longer reproducing as a defect.** The opt-in real
  OS acceptance suite passes on this host
  (`KFORGE_REAL_DPAPI=1 npx vitest --run server/services/credentialVault.dpapi-real.spec.ts`):
  2/2 passed, `set=676ms reveal=265ms`, far inside the 10 s PowerShell budget.
  The earlier `ETIMEDOUT` is therefore treated as environmental (disk pressure /
  first-run cost), not a product defect. This is a local host observation and is
  not offered as packaged-installer evidence.
- **Electron desktop smoke — now passing.** `npm run build` then
  `npm run verify:desktop` completed with exit 0 on this SHA; the gate logged a
  bound loopback URL and wrote `release/verification/desktop-verification.json`.
  That gate still self-reports `sourceIndependentInstalledRuntime:
  NOT_TESTED_BY_THIS_GATE`, so installed-runtime acceptance remains separate.
- **Context-scan completeness** (`428b7e5`) and **inspector timestamp validation**
  (`72558aa`) were already integrated; not reimplemented.

### Gap actually closed in this slice

`client/workbench/SessionWorkspace.tsx` rendered every provider-sent context file
as a native `<button>` with no handler of any kind, while
`server/routes/providerCommandRouter.ts` deliberately stripped `content` from the
bulk `/context` response. The surface therefore advertised "Exact file context can
be inspected inside the session before model execution" with no path that could
deliver it — a dead control on a disclosure-critical journey.

A second, more serious defect was found in the same journey. Operator-selected
context files were redacted by a two-regex copy local to
`safeSelectedContext`, while agent-derived files used the full
`server/services/redaction.ts`. A direct probe confirmed the divergence: PEM
private-key blocks, credentialed URLs (`postgres://user:pass@host`), bare
`ghp_…` tokens and `Set-Cookie` headers all passed through the operator path
**unmodified**, while the service path redacted all four. Those bytes are placed
into the provider prompt.

Implementation, one vertical slice:

- `shared/providerCommandCenter.ts` — added `ProviderContextFileDisclosure`, and
  documented that the bulk inspection payload carries metadata only.
- `server/services/redaction.ts` consumers: `safeSelectedContext` now calls
  `redactProjectText`, removing the weaker duplicate redactor.
- `server/services/agent.ts` — `AgentContextFile` now carries `reasons` and
  `sourceTruncated` honestly instead of hiding them behind an `as` cast; the
  truncation marker is exported as `CONTEXT_TRUNCATION_MARKER`.
- `server/routes/providerCommandRouter.ts` — new bounded
  `GET .../sessions/:sessionId/context/file`. It resolves nothing from the
  requested path: the path is only compared for membership against the
  session's already-computed included set, so it cannot become an arbitrary
  filesystem-read oracle. Redaction categories are reported; values never are.
- `client/workbench/SessionWorkspace.tsx` + `providerStudio.css` — the chip now
  performs the disclosure, switches the canonical inspector to CONTEXT, and
  reports LOADING / ERROR / READY, redaction state, truncation state, byte count,
  destination and read time. Selected state uses `aria-pressed`; existing
  `--kw-*` tokens keep DAY/NIGHT parity without new literal colors.

### Evidence

- `npx tsc --noEmit` exit 0; `npm run lint` exit 0 (324 source files).
- New `server/routes/providerCommandContextDisclosure.spec.ts`: 7 passed — exact
  bytes disclosed, bulk poll carries no body, PEM/URL/token/cookie redaction,
  sensitive-path redaction with non-secret lines preserved, seven non-member
  paths refused with no leakage, unknown session refused, poll/disclosure
  consistency.
- **Negative control run:** reinstalling the historical two-regex redactor made
  2 of those tests fail, including an explicit
  `secret value MIIEpAIBAAKCAQEA must not be disclosed` assertion, then the fix
  was restored. The suite has teeth; it is not vacuously green.
- Full unit suite: 549 passed, 3 skipped, 73 files (baseline was 542/3/72).
- Real-product E2E `tests/e2e/provider-command-center.spec.ts`: 2 passed, now
  also asserting all five inspector tabs are visible and that PREVIEW/CONTEXT
  switching works.
- Visual: `verification/context-disclosure-evidence/` (gitignored) holds DAY and
  NIGHT before/after PNGs at a measured 1672x941 read from PNG IHDR, captured
  only after the disclosure settled.

### Investigated and disproved, recorded so it is not "fixed" later

The inspector mini-tab row appeared to clip `PREVIEW/MODEL/CONTEXT` in the
captured PNGs. Measured geometry showed all five buttons laid out in two wrapped
rows inside a 64px grid track with non-zero rects, and the E2E tab-reachability
assertions pass. There is no clipping defect; the visual impression was a
misreading of a scaled screenshot. No change was made for it.

### Exact-head CI on PR #73 and the defect it exposed

First gate run at head `fb9d1bc`: workflow-pins, asset-budget, npm-ci, npm-audit,
typecheck, lint, unit tests (548 passed), build and playwright-browser all PASS.
`e2e` FAILED on `production-chromium` only — 85 passed, 1 failed, 1 skipped — and
the single failure was the new disclosure test asserting the settled body inside
CI's 5 s default expect window. It passed when run alone on Windows because
`playwright.config.ts` grants a 15 s expect timeout, but the **full local suite
failed it too**, exceeding even 15 s. Raising the test timeout to 60 s was
considered and rejected as masking the defect rather than expressing it.

The cause was test design on top of a pre-existing product defect: the spec
opened the entire KForge repository as the session project, so every context
build scanned the monorepo. Re-pointed at a small deterministic temp fixture, the
same assertions pass in 3.3 s locally, which proves the disclosure logic itself
is fast and that the cost belongs to the scan.

Measuring why the scan was slow exposed a **separate and more serious defect**:
`buildSessionContext` calls `scanProject`, which is not cached and which
**executes the project's own typecheck and lint commands** (`tsc --noEmit`, then
`lintIssues` when the project is trusted) plus secret-literal, completeness and
advanced-completion scans. `GET .../context` runs on every session mount and
refresh, and the new disclosure route runs it again per click.

Measured on this host against the KForge repository itself:

- `GET .../context` — 2827 ms
- `GET .../context/file` — 7664 ms

Merely viewing what a session would send therefore triggers project command
execution, which contradicts the product's own stated contract for other
surfaces ("Opening this surface does not run a benchmark or build the project
graph"), and conflicts with the loopback limiter's own design note that its
ceiling "exists to stop a runaway or hostile local caller, not to shape normal
product behaviour" — an assumption that per-request work is cheap. A 7.7 s
response to a click is not an acceptable interaction cost either.

This was deliberately **not** folded into the disclosure PR: the correct fix
touches the shared context/scan boundary and needs its own evidence, including
proof that disclosed bytes stay identical when the scan is skipped. It is
recorded as the next P1 slice. The disclosure keeps the honest LOADING state
rather than hiding the latency.

### Still open after this slice

GitHub Connect deployment/OAuth/webhook synchronization, trusted signing,
installed-runtime and clean-machine acceptance, live provider effects, and the
four policy-blocked cleanup paths are unchanged by this work. The cleanup mission
remains REVIEW ONLY.



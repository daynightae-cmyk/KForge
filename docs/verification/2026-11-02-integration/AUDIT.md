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

Fresh full npm audit: 14 moderate, zero high/critical. Runtime-only audit: zero. Findings include electron-builder/asar/universal/glob/minimatch, Tailwind typography/postcss-selector-parser and sucrase. Some npm suggestions downgrade electron-builder to 20.23.1 or typography to 0.5.4 with major-breaking labels. Review compatibility and packaging proof; do not force automatic graph changes. Complete advisory details: `npm-audit.json`.

### P2: Pagination and webhook execution incomplete

Connect router lists first 50 installations, authorizes repository access against first 100 installations, and returns first 50 repositories. A legitimate later-page installation can be denied; larger accounts are truncated. Add bounded pagination and completeness metadata, with authorization across accessible pages.

Webhook validates signature/replay and records receipt; it does not synchronize repositories or dispatch desktop notifications. Setup is informational. If advertised, installation binding and durable processing/retry/dead-letter behavior require implementation. Receipt must never imply sync. No automatic Git mutation without trust/authority.

### P2: Catalog discovery differs from install/update support

Remote adapters explicitly retain catalog-only/read-only states and NOT_CONFIGURED updates. Open VSX install needs immutable artifact, integrity, compatibility and confirmation. WinGet/npm/PyPI/NuGet presence is not execution proof. Map advertised actions to real lifecycle support or truthful unavailable reasons. No live provider, package install, trusted update or paid AI acceptance occurred here.

### P2: Visual acceptance remains evidence-specific

Mission queue/PENDING_TRANSFER references are historical requirements, not a current completion ledger. Preserve cinematic entry and identity. Check current DAY/NIGHT across 68 views and real actions, realistic data, desktop sizes, supported RTL/LTR, keyboard, reduced motion, focus and failures. Settling only proves leaving loading; it does not prove visual fidelity or owner approval. Existing screenshots remain historical unless freshly captured.

### P3: Type/lint guarantees narrower than their names

TypeScript strict and strictNullChecks are disabled. Custom lint checks syntax, conflict markers, debugger and TypeScript suppressions; it is not comprehensive React/accessibility/security lint. These are baseline limitations, not newly introduced regressions. Ratchet focused contracts without a broad unrelated rewrite.

## VERIFICATION

Fresh raw evidence: `K:\Knoux Projects\KForge\Evidence\integration-audit-20261102`. Final command and delivery results are in `RESULTS.md`. During drafting: npm ci succeeded (596 added, 597 audited); pins/assets passed; runtime audit zero; typecheck passed; custom lint passed on 322 source files; GitHub Connect 17/17 passed. Vitest/build/E2E were running. Gate testedSha records starting code SHA ecb3d9e; subsequent research/docs/ancestry commits do not become exact-SHA CI proof automatically.

Recovered research retains original whitespace anomalies to preserve original bytes. Distinguish these from new implementation defects in diff checks.

## DELIVERY / REMAINING GAPS

Local preservation/integration implemented. Final remote main, CI and worktree status: `RESULTS.md`, then refresh live before further edits. Zero dirt/storage cleanup: BLOCKED by policy. Installed final-main package, live providers/OAuth, trusted update and production runtime: NOT VERIFIED / BLOCKED as above. No full-production claim.

Next execution contract: `docs/handoffs/QODER-PRODUCTION-CLOSURE-20261102.md`. Fix evidenced gaps and final-main provenance while preserving current product, unique history and owner evidence.

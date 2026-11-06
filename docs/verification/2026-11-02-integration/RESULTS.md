# Verification and delivery snapshot — 2026-11-02, Asia/Dubai

This is the snapshot at audit commit preparation. Refresh the linked CI and the
local evidence directory for later results; pending checks are not passes.

## Completed checks

| Check | Observed result | Scope |
|---|---|---|
| Fresh origin fetch / ls-remote | f1c872fcbfb4a4824a389c999cdad1e8fd6cff52 | Upstream baseline before local integration |
| Open PR inventory | Empty | At observation time |
| Baseline CI 40552465053 | Both required jobs successful | Previous upstream SHA only |
| Main protection | Strict two required checks; force/deletion disabled | No setting mutations |
| npm ci | Exit 0; 596 added, 597 audited | Locked installation |
| Workflow pins | Passed, 7 references | Existing authoritative workflow |
| Asset budgets | Passed | Logo/audio budgets; retired assets absent |
| Runtime npm audit | 0 vulnerabilities | Production dependencies only |
| Full npm audit | Exit 1; 14 moderate, 0 high/critical | Includes build/development graph |
| npm run typecheck | Exit 0 | Current non-strict TS configuration |
| npm run lint | Exit 0; 322 source files | Custom syntax/marker/suppression rules |
| npm run test:github-connect | Exit 0; 17 passed | Synthetic native/backend contracts, not live OAuth |
| npm test (first complete run) | Exit 1; 526 passed, 8 failed, 1 skipped; 8 failed files / 66 passed files | Includes two accidentally discovered local Playwright-probe files |
| Focused documentation rerun | Exit 0; 14 tests / 2 files passed | After restoring README identity and dated evidence boundary |
| npm run build | Exit 0 | SPA and server bundles; lazy Three chunk warns above 500 kB |
| Missing-root context reproduction | files=[], complete=true, truncated=false | Confirmed defect, not a passing acceptance result |
| Vercel deployment inventory | Zero deployments, live=false | Inspected Connect project |
| Dedicated domain inventory | Two verified attachments | Not DNS/TLS/backend readiness proof |
| Connect public health | Host DNS resolution failed; no HTTP status | This Windows host observation only |

## First unit-run failures and action

- Three documentation assertions failed because the newly merged README omitted
  the product H1 and historical evidence boundary. Restored content without
  weakening tests; focused 14-test rerun passed.
- Two non-unit suites under ignored `verification/pwprobe` were picked up by
  Vitest and failed at Playwright test initialization. Added generated evidence,
  release/test output and historical research exclusions to Vitest discovery.
  Canonical client/server/shared/desktop/scripts suites remain in scope.
- Topology unexpected-exit test hit its 5 s budget.
- Provider command-center mask test hit a 10 s Windows DPAPI PowerShell timeout.
- Preview restart failed its health assertion.
- Workspace Golden Matrix exceeded 30 s; Preview Fix & Verify returned an
  unhealthy restart with successful snapshot rollback and failed health probes.

The runtime failures are not automatically dismissed as host load or baseline.
Focused isolated reruns were launched and their results are in
`runtime-isolated-regression.log`. Workspace failures require fresh isolated
verification before claiming the OS-temp fixture relocation fully accepted.

## Checks running at snapshot

Subsequent observations before final delivery: isolated runtime rerun finished
with 28 passed / 1 failed (Windows DPAPI PowerShell timeout). Preview and
Topology passed in that isolated run. Electron smoke failed with a 120 s
spawnSync timeout. Unit discovery after exclusions listed 72 canonical files.
These results supersede the pending state for those three checks below.

The two workspace cases were rerun in isolation after the OS-temp relocation:
Golden Matrix and Preview Fix & Verify both passed (2 passed, 23 unrelated cases
filtered out). This verifies those focused cases, not an aggregate clean gate.

Push to origin/main succeeded at 8aa6f5a5559a24b0a4822a0bd8b63bdcc1722d41.
GitHub reported the owner permission path bypassed two expected status checks;
no protection setting was edited. Exact-SHA verification started in
[run 41348620003](https://github.com/daynightae-cmyk/KForge/actions/runs/41348620003).
Both required jobs were still running at this observation. Later commits and
results must be refreshed; this is not a CI-success claim.

Later CI observation: the Linux aggregate verification gate on the same
8aa6f5a SHA completed successfully. Downloaded `ci-linux-8aa6f5a.json` records
gate=PASS and all required steps passed. The Windows NSIS job was still running.
This certifies the specified commit/platform only, not subsequent report edits
or this host's failing native DPAPI/Electron checks.

- The original authoritative local gate continued after unit failure to build
  and execute 85 Playwright tests serially on Windows Edge. Its overall result
  cannot become PASS while its recorded initial unit step failed.
- Isolated Preview/Topology/provider regression run with maxWorkers=1.
- Electron smoke over freshly built source (`node scripts/verify-desktop.mjs`),
  distinct from packaged/installed-app proof.
- Unit discovery listing after generated-evidence exclusion.

## Delivery truth

Source/research preservation and documentation merge are committed locally.
The changes prepared with this snapshot include the audit, 68-view inventory,
advisory data, source comparisons and 247-line Qoder continuation contract.
Remote push/merge and exact final-main CI must be checked live; this snapshot
does not pre-claim them. Use the repository Actions view for the exact HEAD.

Cleanup remains **BLOCKED**: execution policy rejected the exact approved four
deletion targets even after explicit user confirmation. The original two
synthetic files remain untracked; no zero-dirt or reclaimed-space claim.
Unique ignored auth/config/state and historical evidence remain private/local.

Packaging a replacement installer, installed final-main lifecycle, live OAuth,
live providers, signed trusted release and production health are **UNVERIFIED**
or **BLOCKED**, as detailed in AUDIT.md. No deployment was performed.

## Acceptance gates at this snapshot

| Gate | Status | Boundary |
|---|---|---|
| A — Scope | VERIFIED | Canonical repository, refs/worktrees/recovery and 68 registered views identified |
| B — Preservation | PARTIALLY VERIFIED | Historical objects and unique source retained; private ignored evidence retained, not exhaustively classified for deletion |
| C — Implementation | VERIFIED for bounded integration | README merge, mission preservation, OS-temp fixtures and unit-discovery fix; production gaps remain open |
| D — Quality | PARTIALLY VERIFIED | Type/lint/build and focused checks pass; original aggregate unit step failed, full audit nonzero |
| E — Runtime | PARTIALLY VERIFIED | Browser run in progress; DPAPI and Electron source smoke failed; installed final-main unverified |
| F — Integration | PARTIALLY VERIFIED | Main pushed at observed SHA; exact-SHA CI running; no deployment |
| G — Evidence | VERIFIED for recorded observations | Raw local logs and committed inventories; no unsupported production claim |

## Local evidence paths

`K:\Knoux Projects\KForge\Evidence\integration-audit-20261102` contains:

- `local-gate.log` and, when finished, `local-gate.json`.
- `github-connect-tests.log`, `documentation-regression.log`.
- `runtime-isolated-regression.log`, `desktop-smoke.log`.
- `unit-discovery-after.txt`, `agent-missing-root.json`.
- Ref/content/disk inventories and full npm advisory JSON.

The local gate's testedSha was ecb3d9e at invocation. Later historical research,
ancestry reconciliation, README correction and unit-discovery changes require
their own exact final-SHA CI; do not relabel the earlier gate.

## Refreshed baseline and Task 001 — 2026-11-06, Asia/Dubai

Revalidated before any source modification. The 2026-11-02/05 observations above
are history, not current HEAD evidence.

| Item | Observed on 2026-11-06 | Boundary |
|---|---|---|
| Canonical root / branch | `K:\Knoux Projects\KForge\Base`, `main` | One registered worktree (`Base`) |
| HEAD and `origin/main` | `fc74fc2f4513fd2d9799ff2412f74fe840d0a8dc`, divergence 0/0 | Checkpoint SHA unchanged |
| Open PRs at revalidation | None | Before this task's PR |
| Exact-SHA CI at `fc74fc2` | `KForge Verification Gate` success; `aggregate verification gate` and `Windows NSIS package gate` success; CodeQL success | Repository evidence for that SHA only |
| Working tree | Three protected untracked paths only (`fixtures/.marketplace-bad-sha-Pb4nO0/`, `kforge-security-17qX4N/`, `kforge-security-1jmRHl/`) | Never staged; cleanup remains REVIEW ONLY |
| Local branches | `fix/ai-context-disclosure-redaction`, `perf/ai-context-without-implicit-scan`, both mirrored on origin and merged by PR #73/#74 | Preserved, not deleted |
| Stashes | None | |
| Git LFS | Filter configured, zero tracked LFS files, zero pending objects | Content filters are why tree cleanliness is not inferable from a single status field |
| Machine | Windows 10 Pro 19045, 4 logical CPUs, 11.9 GiB RAM (5.7 GiB free), Node 24.21.0, npm 11.19.0 | |
| Disk | **K: 46 GB used / 2.5 GB free (95%)**; C: 15 GB free; D: 6.3 GB free | Blocks `npm ci` and any parallel heavy build; no heavy build was run concurrently on this host |
| KForge tree size | `node_modules` 690 MB, `release` 535 MB, `verification` 487 MB, `dist` 6.4 MB, `.git` 12 MB; whole project 1.8 GB | The remaining ~44 GB on K: is outside this project and outside cleanup authority |
| Open CodeQL alerts | 20 (15 `js/path-injection`, 2 `js/request-forgery`, 2 `js/incomplete-url-substring-sanitization`, 1 `js/shell-command-injection-from-environment`) | Matches the audit count |
| Open Dependabot alerts | 66: 60 `docs/research/recovered-20261017/opensumi-spike-source/package-lock.json`, 4 `fixtures/workspace-php/composer.json`, 1 `fixtures/workspace-clean/package.json`, 1 root `package-lock.json` (`postcss-selector-parser`) | 4 critical = 3 research + 1 PHP fixture |
| Production-only audit | `npm audit --omit=dev` → 0 vulnerabilities | Confirmed again at `57561e8` |

### The reported topology failures were not reproduced as a deterministic red run

At `fc74fc2` the full local suite **passed**: 551 passed / 3 skipped, 73 files
passed / 1 skipped, exit 0, in 58.8 s. `topologyRuntime.spec.ts` nevertheless
inflated from 27.5 s isolated to 45.9 s under suite load, and the three tests
named in the audit are the three slowest in that file. The recorded failure
mechanism is therefore load-sensitive timing pressure on the same path this
section identifies, not a reproducible assertion failure on this host at this
SHA. That distinction is kept: no pre-fix red/green pair is claimed.

### Task 001 root cause, measured rather than inferred

Windows listener attribution crossed a `powershell.exe` cold start once per
service per health probe. Measured idle cost 0.95–1.03 s per call.

| Probe (Windows 10, same host, same 3-service fixture) | Before | After |
|---|---:|---:|
| `TOTAL_START_MS` for an explicit HTTP topology | 2381 ms | **683 ms** |
| `process-spawned` → `listener-detected` per HTTP service | 1203 / 1129 ms | 346 / 288 ms |
| OS attribution processes during 12 s steady-state polling (2 services) | 10 | **0** |
| Worst contended topology test | 10681 ms | **6594 ms** |
| `topologyRuntime.spec.ts` isolated file duration | 27544 ms | **16629 ms** |

The attribution source in live evidence changed from `Get-NetTCPConnection` to
`netstat -ano -p TCP`, which returns the same owning PID in 36–42 ms.

No startup, health, shutdown or test timeout constant was raised; no test was
skipped, disabled or weakened; the 12 s readiness budget, 3 s health interval and
bounded shutdown escalation are unchanged.

### Task 001 local results at `57561e8332722059365b79a9c5adb8582f7dba8e`

| Command | Result |
|---|---|
| `npm run typecheck` | Exit 0 |
| `npm run lint` | Exit 0, 327 source files |
| `npm test` (full suite) | Exit 0; 569 passed / 3 skipped (572); 75 files passed / 1 skipped; 52.3 s |
| `npm run build` | Exit 0 |
| `npm audit --omit=dev` | 0 vulnerabilities |
| New regression specs | `listenerAttribution.spec.ts` 7 tests, `topologyRuntimeIntegration.spec.ts` 11 tests |
| `previewRuntime.spec.ts` | Exit 0, 8 tests (same runtime path) |

### Explicitly not closed by this section

- `stopTopology` still stops in sequential dependency waves at ~1.5 s graceful
  budget each: measured 4883 ms for three services. Bounded, escalated and
  ownership-checked, but real shutdown latency and a separate slice.
- The Windows DPAPI PowerShell cold start recorded above for the provider
  command-center path is the same defect class in a different service and is
  still open.
- CodeQL alert 32 (`js/shell-command-injection-from-environment`) points into
  `topologyRuntime.ts` `resolveWindowsCommand`, which this change did not touch.
- No installed-runtime, packaged, signed-release, live-provider or GitHub
  Connect deployment claim is made here.


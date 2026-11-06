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

## Task 002 — CodeQL reconciliation at 20 accounts (2026-11-06)

20 alerts were open on `main`. Each was traced to an exact sink line through the
CodeQL API, reconciled against the code, and then either proved by a bounded
negative test or classified with its guard named. None was dismissed and none
was suppressed; `main` still reports the same 20 until a triager acts.

| Alert(s) | Rule / severity | Sink | Disposition | Evidence |
|---|---|---|---|---|
| 48, 5–17, 9–16 (14) | `js/path-injection` high | `server/routes/workspace.ts` | **Bounded by one guard, now tested.** All 14 fan in from the profile traversal root; recursion happens only when `entry.isDirectory()` (`workspace.ts:260`) | New containment test plants a Windows junction and a directory symlink to an outside directory and asserts exact entry counts; `OUTSIDE-SECRET.txt` never surfaces |
| 19, 17, 9 | `js/path-injection` high | `workspace.ts:2600`, `:498`, `:363` | **By design, boundary is the caller check — residual risk recorded, not closed.** `/projects/open` opens any existing local directory | `server/index.ts:51-80` refuses non-loopback Host, `Sec-Fetch-Site: cross-site` and `Origin !== Host`; `productionServer.ts:68` sets `enforceLoopbackHostHeader: true`, the path the packaged app runs (`desktop/main.cjs:135-141`). No per-caller secret: a local process as the same user is not refused |
| 4 | `js/path-injection` high | `server/services/agentTools.ts:108` | **Classified, already tested.** `fs.realpath` precedes the containment throw at `:115`, so an in-project symlink can disclose existence before refusal; content stays blocked and the agent can already enumerate the tree | `agentTools.spec.ts:90/:104/:114/:135/:161/:200`, `agent-security.test.ts:73` |
| 45 | `js/request-forgery` critical | `remoteSources/fetchPolicy.ts:320` | **Bounded by pre-existing, tested controls.** Host is a compiled-in constant; exact-origin allowlist `:190-195`, literal-IP and metadata-range blocks `:127-170`, every DNS answer re-checked `:217-225`, manual redirect re-validated `:298-326`, `networkAllowed` gate `:286-288` | `fetchPolicy.spec.ts:32-268`; `routes/remoteSources.spec.ts` zero-egress cases |
| 20 | `js/request-forgery` critical | `server/services/previewRuntime.ts:207` | **Now proved directly.** Probe may only reach loopback; a cross-origin or non-http redirect throws at `:212` before the next request | Two new cases: a fixture that answers `302 -> http://169.254.169.254/latest/meta-data/` and a foreign absolute route in document QA. Both mutation-verified — with the guard removed the probe really does attempt the metadata address |
| 32 | `js/shell-command-injection-from-environment` medium | `server/services/topologyRuntime.ts:545` | **Admission boundary now proved.** Spawns use `shell: false` with an argument vector; `safeCommand` (`:62`) rejects `; & \| \` $ < > CR LF % !` before any `.cmd` wrapper is built, and `safeArgv` (`topologyDetectors.ts:136-138`) does the same for detected commands | New test registers 12 hostile commands through real discovery and asserts zero services; mutation-verified. **Still open:** no test drives `resolveWindowsCommand`'s ComSpec branch itself |
| 28, 27 | `js/incomplete-url-substring-sanitization` high | two `*.spec.ts` files | **Weak pattern removed from test code, not suppressed.** Both now call the exported `isGitHubRemoteUrl`, which compares `URL.hostname` exactly; production was already correct and already asserted against lookalikes | `onlineControlCenter.ts:54-64`, `onlineControlCenter.spec.ts:74-78` |

Windows reparse-point behaviour, recorded as "validate separately" and not done
in the 2026-11-02 audit, is now measured and pinned: on Node 24.21 / Windows 10
19045, unprivileged, both `mklink /J` and `mklink /D` report
`isDirectory()=false, isSymbolicLink()=true`, and the traversal does not descend
into either.

## Task 003 — dependency advisory reconciliation (2026-11-06)

66 Dependabot alerts were open, all reachable through exactly four manifests.
The decisive packaging fact is `package.json → build.files`, an explicit
allowlist of `desktop/**`, `dist/**`, `fixtures/marketplace-first-party/**`,
`fixtures/marketplace-first-party-v110/**`, `LICENSE` and `package.json`.

| Manifest | Alerts | Severity split | Shipped in the installer | Installed on disk | Reachable by KForge code |
|---|---:|---|---|---|---|
| `docs/research/recovered-20261017/opensumi-spike-source/package-lock.json` | 60 | 3 critical, 28 high, 21 medium, 8 low | **No** — outside `build.files` | **No** — `node_modules` absent (whole `docs/` tree is 1.4 MB) | **No** — historical source only; excluded from Vitest discovery and from the build |
| `fixtures/workspace-php/composer.json` | 4 | 1 critical, 1 high, 1 medium, 1 low | **No** | **No** — `vendor/` absent | **No** — read as text for PHP/Laravel detection only |
| `fixtures/workspace-clean/package.json` | 1 | 1 medium | **No** | **No** — `node_modules` absent | **No** — the fixture's own manifest is data, not KForge's dependency graph |
| `package-lock.json` (root) | 1 | 1 medium (`postcss-selector-parser`) | **No** — dev-only chain | Yes, in `node_modules` | Build-time only |

Root production graph is clean and stays reported separately:
`npm audit --omit=dev` → **0 vulnerabilities**; the full graph including
build/development → **9 moderate, 0 high/critical**.

The one root-graph item is real and is **not** claimed as fixed.
`@tailwindcss/typography@0.5.20` — which is the current latest release — pins
`postcss-selector-parser` to exactly `6.0.10`, below the `6.1.5` fix line, so no
upstream upgrade resolves it and `npm audit fix --force` would *downgrade*
typography to 0.5.4, which is older and breaking. It was therefore refused. The
advisory is CPU exhaustion on quadratic selector parsing, reached only while
building KForge's own CSS, and the advisory-bearing package is a devDependency
(`npm ls --omit=dev` resolves empty) that is not in `dist/**` and so is not
shipped. Remaining option, requiring owner-level dependency-policy acceptance:
a narrow `overrides` entry with full gate verification. No ignore, no broad
override, no research deletion to conceal counts.

One hygiene observation recorded rather than acted on: committed fixture state
under `fixtures/.kforge/project-collections.json` and
`fixtures/workspace-clean/.kforge/snapshots/**` carries absolute paths from a
different drive letter (`D:\Knoux Projects\Knoux_Project_Center\...`) that no
longer exist. That is stale fixture evidence, not a security boundary, and
deleting it needs the same cleanup authority as everything else here.

## GitHub Connect status re-checked (2026-11-06)

`connect.knoux.store` did not resolve from this host (`NXDOMAIN` from the
configured resolver) and `curl https://connect.knoux.store/health` failed with
exit code 6 before any HTTP exchange (`http_code=000`). No Vercel token, team or
project identifier is present in this environment, no Vercel MCP tool is
connected, and the `vercel` CLI is not installed, so the project, its runtime,
environment-variable presence, Redis durability and Webhook configuration could
**not** be re-verified in this session. Task 009 remains **BLOCKED_EXTERNAL**.
`apps/github-connect/vercel.json` remains a source-backed readiness artifact
only. No deployment was performed and no live OAuth or Webhook workflow is
claimed.

## Integrated Windows runtime slices and re-measured tally (2026-11-06)

### Merge chain, verified from two sources each time

| PR | Exact-head gates | Merge commit | `origin/main` confirmed by |
|---|---|---|---|
| #75 topology attribution | aggregate 7m44s pass, NSIS 20m22s pass | `8e33495` | `git pull --ff-only` + `git rev-parse HEAD` |
| #76 security boundary tests | aggregate 10m0s pass, NSIS 20m43s pass | `9bfd554` | aggregate gate success observed; NSIS observed success at 00:52 |
| #77 non-blocking DPAPI vault | aggregate 6m55s pass, NSIS 16m40s pass | `4e03366` | `mergeCommit.oid` **and** `git ls-remote origin refs/heads/main` |

A process note worth keeping: while #77 was still open, its `potentialMergeCommit`
value was read as if it were the merge result and reported as a merged `main`.
That object does not exist (`git cat-file` fails on it) and the PR was still
`OPEN`. Corrected the same session. A merge is only ever claimed from
`mergeCommit.oid` plus a remote ref read, never from a prospective SHA.

### CodeQL tally after the merged evidence

Open alerts moved **20 → 18**, closed by CodeQL's own re-analysis of `main`, not
by triage action:

| Alert | Rule | Now |
|---|---|---|
| #27 | `js/incomplete-url-substring-sanitization` | `state=fixed`, `dismissal=none` |
| #28 | `js/incomplete-url-substring-sanitization` | `state=fixed`, `dismissal=none` |

#32 (`js/shell-command-injection-from-environment`, `topologyRuntime.ts:546`) is
**still open**, as are all 15 path-injection and both remaining request-forgery
alerts. The reconciliation table above still describes them accurately; #32's
sink line number shifted by one through the topology edits, which is why it now
reads `:546`.

### Windows DPAPI vault, measured on this host

`credentialVault` reached DPAPI through `execFileSync`, which froze the local API
server for the life of the PowerShell child — twice per save, because `set`
verifies its own write through `reveal`. Measured with a 10 ms heartbeat around
real OS vault operations:

| | before (`execFileSync`) | after (`spawn`, async) |
|---|---:|---:|
| max event-loop stall | 304 ms | **14 ms** |
| heartbeat ticks across the same window | 3 | **58** |
| `set` / `reveal` latency | 618 / 297 ms | 638 / 310 ms |

Latency is unchanged and is not claimed otherwise: it is the PowerShell cold
start, which remains. Real Windows DPAPI acceptance with `KFORGE_REAL_DPAPI=1`
passed here (2 tests, `backend: WINDOWS_DPAPI_CURRENT_USER`, `set=715ms
reveal=303ms`) — this host's current-user store, not an installed
release-candidate claim. The four new seam cases were run against the pre-fix
implementation and **3 of the 4 fail** there; the fourth (protector rejection)
passed before as well and is kept as a boundary, not as evidence of this fix.

### Topology surface re-verified in the real browser after the attribution change

`tests/e2e/topology-lab.spec.ts` passes against the merged code (1 passed, 13.6 s
— discovers, runs, inspects, persists, isolates restarts, propagates failure and
stops a real multi-process app). A separate throwaway capture at the accepted
1440x900 viewport drove a real two-service session through two health ticks and
read the Inspector text back:

```
Port ownership
127.0.0.1:57267 · KFORGE_SESSION · NONE
OS evidence attributes listener 57267 directly to KForge-spawned PID 13216.
Attribution source: netstat -ano -p TCP. Ownership was reused for this health
check instead of re-reading the OS; the last real attribution was captured at
2026-11-06T00:47:55.750Z and is re-verified at most every 30s.
```

Captures retained under `verification/` (ignored path):
`tmp-topology-workbench-1440x900.png`, `tmp-topology-lab-1440x900.png`. The
throwaway spec and its `test-results/` output were removed; the working tree
returned to only the three protected untracked paths.

**Visual verdict: `CAPTURED_NOT_VISUALLY_APPROVED`.** The evidence text renders
and wraps inside the canonical Inspector, but the Topology Lab is very tall at
1440x900 — canvas, embedded Preview and inspector stack — so the Port ownership
block now sits well below the fold, and the added reuse sentence lengthens it
roughly two-and-a-half times. Whether that is acceptable on this surface is a
design decision, not something a green E2E proves. No owner approval is claimed.

### Still open after these three slices

- No test drives `resolveWindowsCommand`'s ComSpec branch itself (#32).
- The loopback API has no per-caller secret; a local process as the same user is
  not refused (alerts 19/17/9 residual risk).
- PowerShell cold-start cost remains in both DPAPI and the container/npm
  ancestry path; consolidating verify-after-write or moving to Electron
  `safeStorage` is a separate authorised slice.
- The recorded Electron smoke `spawnSync` 120 s failure is a different call site
  and untouched.
- K: disk headroom (2.5 GB free) still blocks `npm ci` and any packaged Windows
  installed-lifecycle run on this host.




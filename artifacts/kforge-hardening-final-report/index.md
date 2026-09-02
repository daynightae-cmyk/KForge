# KForge World-Class Hardening Final Report

**Prepared by:** Manus AI  
**Assessment date:** 28 August 2026  
**Scope:** Authorized pre-review hardening of PR #8 only. No merge, release, tag, force push, rewrite, or `main` modification was performed.

## PROJECT

| Field | Evidence |
|---|---|
| Project | **KNOuX Forge** |
| START SHA | `1a4a7ed7fbd402a8a6046da747cd9418fcce97dd` |
| FINAL WIP SHA | `853bd4678762260c84c071fc8786bceddc613bcd` |
| `main` SHA | `fdb1289c51422385b8d7a0928424b4f77e1d0797` |
| Local / remote parity | **PASS** — `HEAD` and `origin/wip/codex-workbench-handoff` are the same SHA; divergence is `0 / 0`. |
| PR #8 | **OPEN / DRAFT / UNMERGED**; its head is the final WIP SHA and its base remains `main`. |
| Advancement over `main` | **24 commits**, **57 files**, `4,668` insertions and `2,331` deletions. |

The final candidate was committed forward as `fix: harden workbench selection and collection mutations`, locally verified in a fresh detached worktree, verified in a separate Windows worktree at the identical SHA, then pushed with a normal fast-forward only. The remote race check confirmed the expected predecessor `1a4a7ed…` before push. [1] [2]

## Structural architecture

| Dimension | Result | Evidence and finding |
|---|---|---|
| STRUCTURAL ARCHITECTURE | **PASS** | `/workspace` renders `KForgeWorkbench`; its Activity Bar, scoped Explorer, central capability surface and contextual Inspector remain distinct. |
| KForgeWorkbench production route | **PASS** | Route is mounted directly in `client/App.tsx`; production Playwright opened it without page errors. |
| Legacy `KForgeWorkspace` | **MIGRATION_REFERENCE** | No production route imports it and no built SPA asset contains it. It remains intentionally named in `selfAudit` and in its migration-oriented test, so it was not deleted. |
| Single inspector | **PASS** | Exactly one canonical `.kw-inspector` is rendered; `Online item details` is contextual state, not a second inspector component. |
| `kw-online-inspector` mounted count | **0** | The stale compatibility class is absent from production source and product E2E selects the canonical inspector by accessible label. |

## Online filtered selection and lifecycle

| Dimension | Result | Evidence and finding |
|---|---|---|
| ONLINE FILTERED SELECTION | **PASS** | The selected Online item is now resolved only from the current filtered `items` collection. A global-but-hidden retained id can no longer control the Inspector. |
| STALE INSPECTOR | **PASS** | New production E2E selects `kforge-json-inspector`, changes to Models, and confirms that the canonical Inspector shows the selected Model rather than the hidden extension. It also confirms inspector context clears when search has no matching row. |
| Action closure safety | **PASS** | Lifecycle actions are recomputed from current `selected` and current Marketplace metadata. Their callback delegates to the existing `operate(kind)` closure, which publishes truthful `RUNNING`, `SUCCESS`, and `FAILED` operation evidence. |
| DISCOVER versus MARKETPLACE | **PASS** | Discover now filters to locally evidenced `recommended` items and uses distinct result/empty-state language. Marketplace remains the full catalog. This replaces the prior semantic alias. |
| MARKETPLACE LIFECYCLE | **PASS** | The real UI route Online → Extensions → `kforge-json-inspector` passed install → health → run → update to `1.1.0` → uninstall, with no API-direct substitute for the acceptance path. |
| Marketplace Offline external contacts | **0** | Production lifecycle and evidence tests observed no external HTTP/HTTPS request in Offline mode. |

### Online 14-view matrix

| View | Status | Semantic proof |
|---|---|---|
| Discover | **PASS** | Recommendation-backed catalog entries only. |
| Marketplace | **PASS** | Full aggregate catalog with item authority and evidence. |
| Extensions | **PASS** | Taxonomy-filtered bundled extension; lifecycle acceptance covers it. |
| Models | **PASS** | Category-filtered model rows; model selection replaces prior Extension inspector context. |
| Agents | **PASS** | Agent-category catalog surface. |
| Tools | **PASS** | Built-in tool-category surface with evidence-backed availability. |
| Integrations | **PASS** | Integration-taxonomy filter. |
| Installed | **PASS** | `installed` metadata filter. |
| Updates | **PASS** | Verified update-evidence filter, not a generic heading. |
| Downloads | **PASS** | Task evidence filtered to download/pull/install/update activity. |
| Providers | **PASS** | Provider and adapter evidence cards. |
| Remote Sources | **PASS** | Remote adapter subset only. |
| Security | **PASS** | Trust, required permissions, and remote-authority risk filter. |
| Activity | **PASS** | Online/Marketplace task-evidence filter. |

## Project collections concurrency

| Dimension | Result | Evidence and finding |
|---|---|---|
| PROJECT COLLECTION TEMP COLLISION | **PASS** | Existing unique temp name (`pid` plus `randomUUID`) remains, preserving write-then-atomic-rename semantics. |
| PROJECT COLLECTION LOST-UPDATE CONCURRENCY | **PASS** | A newly proved defect existed beyond the temp-file collision: independent concurrent writers could each read an old store and atomically rename a complete but stale snapshot over another field. |
| Root cause | Confirmed | `recordProjectOpened`, `recordProjectScanned`, `recordProjectTask`, and `updateProjectCollection` performed independent read-modify-write cycles without serialization. |
| Fix | Confirmed | `withStoreMutationLock` keys a Promise mutex by normalized store path and encloses read, mutation, unique-temp write, and final atomic rename. Different workspace roots remain independent. |
| Regression test | **PASS** | Ten iterations concurrently mutate opened/scanned/task timestamps, favorite, pinned, archived and tags; each verifies all fields, valid JSON and zero orphan temp files. |
| Concurrency iterations | **10 consecutive passes** | The focused mutation test was executed ten independent times after the fix. |

## Functional truth and security controls

| Dimension | Result | Evidence and finding |
|---|---|---|
| REMOTE TRUTH | **PASS** | Remote / Git surfaces present local evidence or explicit unavailable/offline states; no implicit network success is claimed. |
| RELEASE TRUTH | **PASS** | Functional installer status, signing, audit, governance and provenance are independently presented; no single generic “release green” claim is made. |
| SYSTEM TRUTH | **PASS** | Platform mode, trust, permissions, storage and settings exhibit explicit evidence and persisted local state. |
| INTELLIGENCE TRUTH | **PASS** | Product E2E verifies graph, impact, dependencies, architecture and project questions without silent external requests. |
| DEVELOPER TOOLS TRUTH | **PASS** | Existing E2E verifies unavailable commands do not become false successes and execution evidence keeps command/result boundaries visible. |
| Git push | **PASS** | Trust and explicit confirmation are required by the product contract; an unconfirmed push test proves no remote contact occurs. |
| Marketplace install/update/run | **PASS** | Lifecycle eligibility derives from local package identity, installation, adapter evidence, runtime evidence and verified update state. Destructive action requires product confirmation. |
| Project trust and permissions | **PASS** | Untrusted projects remain read-only; capability descriptors make unavailable execution visibly disabled with a reason. |
| Command execution truth | **PASS** | Execution tests assert real exit code/output/failure evidence rather than success placeholders. |
| Path safety | **PASS** | Reviewed service mutations normalize workspace paths; project collection temp writes are unique and atomically renamed. No new traversal finding was identified in the audited mutation paths. |
| Secret safety | **PASS** | Tracked-file scan found only `.env.example`; no high-confidence credential-pattern content was found outside purpose-built redaction coverage. Reports do not print credentials. |

## Verification and stability

| Gate | Result | Exact evidence |
|---|---|---|
| TYPECHECK | **PASS** | Fresh Node `v24.20.0` worktree. |
| LINT | **PASS** | 178 source files checked; no syntax, merge-marker, debugger or TypeScript-suppression finding. |
| VITEST | **PASS** | **28 files**, **133 passed**, **1 skipped**, **0 failed**. |
| PLAYWRIGHT | **PASS** | **37 passed**, **0 failed**, **0 flaky** in the fresh production worktree. |
| TARGETED STABILITY | **PASS** | Online filtered selection: 5 consecutive runs; Marketplace lifecycle: 3; Product Surface Evidence: 3; Quality scan/solution evidence: 5; heterogeneous collection concurrency: 10. |
| Aggregate local gate | **PASS** | `npm ci`, typecheck, lint, tests, build and production E2E passed for the final SHA. |
| Fresh committed-tree verification | **PASS** | Isolated worktree at `853bd46…`, clean before verification, Node 24, lockfile install, typecheck, lint, tests, build, E2E and `verify:gate` all successful. |

## Accessibility, keyboard access, overflow and visual QA

| Dimension | Result | Evidence and finding |
|---|---|---|
| AXE | **0 violations** | Axe passed across Workspace, AI Agents, Online Marketplace, Online Extensions with selected canonical Inspector, Quality Sonar, Developer Tools Terminal, Remote Git, Release Gate, System Settings and System Permissions. |
| Keyboard accessibility | **PASS** | Activity navigation, command-palette focus, Escape dismissal and settings controls are exercised by keyboard E2E. |
| Focus visibility | **PASS** | Keyboard test and dark/light visual review show visible focus/control states; the raw evidence control is now reachable. |
| Remote/Git finding | Fixed | Axe found `scrollable-region-focusable` on a raw JSON `<pre>` within Remote Git. `SimpleFetchSurface` now keeps structured EvidenceRows primary and places raw JSON under **Advanced evidence** with a labeled focusable `pre`. |
| OVERFLOW 1366×768 | **PASS** | Production E2E checked document and body scroll widths on Online Marketplace and Settings. |
| OVERFLOW 1440×900 | **PASS** | Same measured assertion passed. |
| OVERFLOW 1920×1080 | **PASS** | Same measured assertion passed. |
| SCROLL OWNERSHIP | **PASS** | The dense catalog/table uses internal scrolling instead of shell-level horizontal overflow. |
| VISUAL QA LIGHT | **PASS** | Workspace, Discover and Marketplace were reviewed with differentiated Activity Bar, Explorer, central evidence surface and Inspector. |
| VISUAL QA DARK | **PASS** | Settings and Marketplace were reviewed after saving the Dark setting locally; hierarchy, contrast, badges, selected state and local-save message remained clear. |
| SCREENSHOTS REVIEWED | **4** | See `screenshots/` manifest below. |
| VISUAL DEFECTS FIXED | **2** | The accessible advanced-evidence disclosure and Discover/Marketplace semantic differentiation were implemented and retested. |

| Screenshot | Theme | State |
|---|---|---|
| `853bd46-light-workspace-default.webp` | Light | Clean Workspace after removal of agent-created temporary worktree. |
| `853bd46-light-online-marketplace.webp` | Light | Full Marketplace catalog and canonical Inspector. |
| `853bd46-dark-system-settings.webp` | Dark | Settings, persistence confirmation and contrast. |
| `853bd46-dark-online-marketplace.webp` | Dark | Dense Marketplace and evidence Inspector. |

## Offline and network disclosure

| Dimension | Result | Evidence and finding |
|---|---|---|
| OFFLINE CORE | **PASS** | The product defaults to Offline; core workspace and evidenced catalog features remain available without network. |
| UNEXPECTED NETWORK CONTACTS | **0** | Production first-navigation, Product Surface Evidence, Marketplace lifecycle, expanded Axe and targeted Online tests all collected zero unexpected external HTTP/HTTPS contacts. |
| NETWORK DISCLOSURE | **PASS** | Online Control Center and Marketplace distinguish local, cached/catalog-only, remote-required and not-configured states. Opening Online itself does not claim a remote refresh. |

## Dependency, install-script, asset and bundle audit

| Dimension | Result | Evidence and finding |
|---|---|---|
| `npm audit` | **2 moderate** | Full lockfile audit identifies two React Router advisories; the offered upgrade is a major `react-router-dom` move to `7.18.2`. No forced migration was made in this hardening change. |
| `npm audit --omit=dev` | **0 findings** | Package-manager production-only audit returned zero vulnerabilities. |
| DEPENDENCY SECURITY | **REVIEW_REQUIRED** | Functional gates pass, but the two reported moderate advisories require a deliberately designed Router-major upgrade before public-release approval. |
| `@swc/core` postinstall | **EXPECTED** | Native transformer package declares `node postinstall.js`; Node 24 policy blocked unapproved scripts during fresh `npm ci`, yet typecheck/build completed from locked optional native assets. |
| `esbuild` postinstall | **EXPECTED** | Build-tool package declares `node install.js`; it was policy-blocked in the fresh install and the full build still passed. |
| Install-script policy | **PASS** | `npm ci --ignore-scripts` in an isolated audit worktree still built KForge. No script was silently approved or executed as a prerequisite to claim a passing build. |
| OFFICIAL LOGO | **PASS** | Source: `1,583,195` bytes, `1213×1213` RGBA PNG. It is directly imported on the installation route and emitted unchanged into production. |
| INSTALLATION REFERENCE IMAGE | **RETAINED, NOT RUNTIME** | Source: `1,442,410` bytes, `1254×1254` RGB PNG. It has no import and no emitted production asset. It was retained rather than deleted because non-use alone does not justify deleting possible user-authored design reference material. |
| CSS BUNDLE | **173,781 bytes** | Gzip `33,856` bytes. |
| MAIN JS | **212,332 bytes** | Gzip `64,343` bytes. |
| REACT/VENDOR | **153,123 bytes** | Gzip `50,212` bytes. |
| UI CHUNK | **16,085 bytes** | Gzip `5,222` bytes. |
| SERVER BUNDLE | **484,911 bytes** | Production server ESM. |
| BUNDLE QUALITY | **PASS, with logo opportunity noted** | Code chunks are separated and measured. The production logo is the dominant client payload; no unverified lossy or non-lossy optimization was claimed. |

## Windows exact-SHA verification

| Dimension | Result | Evidence |
|---|---|---|
| Windows exact checkout | **PASS** | Isolated Windows worktree was created at `853bd4678762260c84c071fc8786bceddc613bcd`. |
| Windows Node | **PASS** | Node `v24.19.0`. |
| Windows locked dependencies | **PASS** | `npm ci` completed; it reported but did not authorize the known `@swc/core` and `esbuild` scripts. |
| WINDOWS PRODUCTION TYPES | **PASS** | `npm run typecheck` completed successfully. |
| WINDOWS NSIS BUILD | **PASS** | `npm run package:windows` created the artifact below. |
| WINDOWS INSTALLED RUNTIME | **PASS** | Official verifier launched the installed Electron/embedded loopback runtime. |
| WINDOWS NSIS LIFECYCLE | **PASS** | Official verifier passed install, launch, Preview, Marketplace, restart/persisted platform settings, uninstall and reinstall boundary. |
| WINDOWS PACKAGE FUNCTIONALITY | **PASS** | Final local exact-SHA check and the GitHub Windows gate both passed. |
| Artifact | `KNOuX-Forge-Setup-v0.1.0-Windows-x64.exe`, `119,306,842` bytes. |
| SHA-256 | `c4cd4ce49a1f1ab6a5e7893603b3c1e88893bf482c4933cd3c90677aa0194dd4` |
| WINDOWS CODE SIGNING | **UNSIGNED** | `installer-manifest.json` records `signatureState: UNSIGNED`. Functional verification does not substitute for a public-distribution code-signing policy. |

## GitHub governance, provenance and release preparation

| Dimension | Result | Evidence and next state |
|---|---|---|
| GITHUB REPOSITORY DESCRIPTION | **STALE** | The current description remains a Fusion Starter template description, not KNOuX Forge. |
| TOPICS | **EMPTY** | No repository topics were configured. |
| MAIN PROTECTION | **NOT_PROTECTED** | GitHub branch-protection lookup returned “Branch not protected”. No policy was applied automatically. |
| PR BODY | **UPDATED** | This report’s scope, verification, constraints and known blockers are prepared for PR #8 while retaining Draft state. |
| HUMAN REVIEW | **PENDING** | No human approval was created or implied. |
| GITHUB RELEASES | **NONE** | No release was created. |
| SLSA | **ABSENT; REAL PLAN PREPARED** | The active generic OSSF template produced fake `artifact1`/`artifact2` subjects on release. It was removed rather than falsely presented as KForge provenance. |
| FINAL EXACT-SHA GITHUB RUN | **`33120747675`** | Triggered on final SHA `853bd46…`. |
| Aggregate verification | **PASS** | Job `98686694993`, completion after `4m24s`. |
| Windows NSIS | **PASS** | Job `98686694757`, completion after `5m21s`. |

> **Recommended post-review `main` protection plan:** require pull requests, at least one human approval, the exact existing checks **`aggregate verification gate`** and **`Windows NSIS package gate`**, dismissal of stale approvals after pushes, block force pushes and block branch deletion. This is a recommendation only; it was not applied.

> **Real provenance plan:** after a reviewed normal merge and verification of the resulting `main` SHA, build the exact NSIS installer in a GitHub workflow; create `SHA256SUMS.txt`; generate a provenance attestation whose subject is that installer/checksum pair; verify the attestation against the resulting `main` SHA; then attach the installer, checksum, attestation, release notes and known limitations to a human-approved release. The former generic workflow must not be restored.

> **Future release checklist:** (1) human review of PR #8; (2) enable branch protection; (3) normal merge; (4) capture the resulting `main` SHA; (5) rerun the full exact-SHA gates; (6) build NSIS from `main`; (7) generate checksum and real provenance; (8) sign if a certificate is available; (9) create the release and attach verified materials; and (10) publish notes. No step has been executed here beyond preparation.

## Final readiness assessment

| Dimension | Status |
|---|---|
| PRODUCT HARDENING | **PASS** |
| RELEASE ENGINEERING PREPARATION | **PASS, with review-required dimensions recorded** |
| GLOBAL RELEASE READINESS | **REVIEW_REQUIRED** |

The functional product, exact-SHA local verification, Windows installer verification and exact-SHA GitHub gates are green. Global public release readiness remains review-required rather than “ready” because human review is pending, `main` is not protected, the repository description/topics are stale or empty, the Windows installer is unsigned, two moderate Router advisories need an intentional major-version migration decision, and real artifact provenance has not yet been generated. These are accurately distinct from the successful functional gates.

**BLOCKERS:** human PR review and normal merge approval; branch-protection enablement; public-release code-signing decision; dependency-upgrade decision; real KForge artifact provenance after main build; repository metadata refresh before public release.

**NEXT HUMAN ACTION:** review PR #8 at final SHA `853bd4678762260c84c071fc8786bceddc613bcd` while it remains a Draft, then decide whether to request changes or approve it. Do not merge until the governance and release-policy decisions above are explicitly made.

## References

[1]: https://github.com/daynightae-cmyk/KForge/pull/8 "KNOuX Forge PR #8"
[2]: https://github.com/daynightae-cmyk/KForge/actions/runs/33120747675 "Exact-SHA KForge Verification Gate run 33120747675"
[3]: https://github.com/advisories/GHSA-wrjc-x8rr-h8h6 "React Router open-redirect advisory"
[4]: https://github.com/advisories/GHSA-337j-9hxr-rhxg "React Router constructor-injection advisory"

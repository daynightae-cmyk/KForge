# KNOuX Forge capability matrix

Evidence reference captured on 2026-08-30 from GitHub Actions `KForge Verification Gate` Run #208 at SHA `3c1b6f86309b8a3b8a533b0da4e5402df01935f4`. Git history and the exact-SHA Actions run remain the authority for later changes.

`COMPLETE` means the locally implementable, bounded product path and its cited verification are present. It does not convert absent provider evidence into success. `PARTIAL` means a real path exists with a known environment/provider/evidence boundary. `BLOCKED` identifies an external prerequisite that the repository cannot safely invent. `SPECIALIZED` Workbench classification describes a dedicated product surface; it does not mean every external integration behind that surface is configured.

Reference verification at Run #208: workflow-pin verification PASS; typecheck PASS; lint PASS across 224 source files; 30 Vitest files with 146 passed and 1 opt-in benchmark skipped; production build PASS; 58/58 Playwright browser tests PASS; Windows x64 NSIS build and installed-runtime/installer lifecycle PASS.

| Capability | Current real behavior | Verification / evidence | Status |
| --- | --- | --- | --- |
| Workspace and collections | Discovers immediate child repositories and persists recent, favorite, pinned, archived, and label state | Route/service tests plus Projects Workbench E2E | COMPLETE |
| Project Health | Reads persisted evidence without silently scanning, then runs bounded health calculation only after explicit execution | Project Health E2E and route/service evidence | COMPLETE bounded local path |
| Settings | Validates, migrates, atomically persists, reloads, and applies every locally editable domain; unsupported domains are classified | Settings unit tests and Playwright persistence/keyboard evidence | COMPLETE locally |
| System control plane | Separates operating mode, trust, permissions, storage, self-audit, and diagnostics into dedicated surfaces; mutations remain explicit and confirmed | System E2E suite, including trust revocation and storage stale-authority regression | COMPLETE locally |
| Operating mode | Offline, Local First, Online Optional, and Online have distinct metadata-read, remote-transfer, and provider-refresh policies; safe default is Offline | Transition/restart service tests and System Control Plane E2E | COMPLETE locally |
| Network transparency | Important local, remote, and hybrid actions expose execution, network, data class, provider, destination, confirmation, time, and result | Service/route tests plus browser acceptance; offline suite proves zero unexpected external HTTP/HTTPS requests | COMPLETE for tested paths |
| Online Control Center | Reports mode and service states without contacting them merely because the surface opens | Service tests and no-contact browser evidence | COMPLETE local truth |
| Marketplace | Normalizes local/provider evidence, taxonomy, permissions, provenance, lifecycle eligibility, compatibility, and explicit target authority | Service/API tests plus Playwright Install → Health → Run → Update → Uninstall and wrong-target regression | COMPLETE local lifecycle; remote catalogs provider-dependent |
| Remote extension lifecycle | Refuses remote install/update/uninstall claims without a trustworthy package adapter and integrity source | Truthful blocked/unavailable states | BLOCKED — no configured trustworthy remote package adapter |
| Local models | Detects local runtimes, installed/catalog evidence, compatibility, tasks, activation, health, and removal | Model/AI service tests and provider Workbench E2E | PARTIAL — live lifecycle depends on installed provider/runtime |
| Optional cloud AI | Keeps local AI independent; supports explicit server-side provider configuration with disclosure, redaction, confirmation, and contact evidence | Adapter/route tests and no-contact provider E2E | COMPLETE local control path; execution provider-dependent |
| Agents and tasks | Runs registered mission DAGs with persistent evidence, permissions, confirmation, retry, recovery, and rollback | Task, mission, tool, route, and Agent mission E2E | COMPLETE local |
| Graph and impact | Bounded language-aware files, imports, exports, symbols, routes, APIs, dependencies, cycles, responsibility, and transitive impact | Graph tests and Project Intelligence E2E | COMPLETE within visible bounds |
| Quality triage | Problems/Solutions use real findings, deterministic preview, explicit review authority, confirmed apply, and re-verification | Quality scan/solution E2E | COMPLETE for supported deterministic fixes |
| Security quality | Shows real scanner/tool availability and never executes a network security tool before reviewed disclosure | Security Workbench E2E and security-tool tests | COMPLETE bounded truth path |
| Performance quality | Separates observational performance/cache evidence from explicit graph collection and reviewed cache clearing | Performance Workbench E2E and performance route tests | COMPLETE bounded local path |
| Technical debt | Groups real architecture/completeness/mock/documentation findings without inventing a debt score | Technical Debt Workbench E2E | COMPLETE observational path |
| Documentation consistency | Separates claim, observed evidence, actual state, correction preview, confirmed safe apply, and re-audit | Documentation service tests and isolated browser evidence | COMPLETE for supported safe replacements |
| Snapshots and recovery | Creates explicit local recovery points, reviews restore plans without writes, invalidates stale authority, and restores only after fresh review/confirmation | Snapshot service tests and stale-authority E2E | COMPLETE local |
| Developer tests/build/lint | Discovers detected commands without running them and executes only through explicit registered local authority | Dedicated Tests, Build, and Lint Workbench E2E | COMPLETE where command metadata exists |
| Developer runtime | Executes bounded runtime verification through explicit authority and yields process ownership to live Preview when appropriate | Runtime Workbench E2E | COMPLETE where runtime metadata exists |
| Developer logs/diagnostics | Uses real persisted tasks and bounded problem evidence rather than synthetic observability | Developer observability E2E | COMPLETE local evidence |
| Preview | One process manager with start/health/stop/restart, bounded logs, routes, history, ownership isolation, viewport/zoom controls, and real embedded app evidence | Preview service tests plus Preview Studio and canonical Preview Playwright suites | COMPLETE local runtime/browser Workbench; target-app console/network telemetry not claimed |
| Preview Fix and Verify | Requires current failing Preview evidence, plans, snapshots, applies only a verified safe patch, verifies, restarts, and rolls back on failure | End-to-end route test | COMPLETE for supported safe rule |
| Git local | Uses real local Git for status, branches/tags/stashes/history, stage/unstage, and confirmed local commit; no implicit push | Isolated local Git Playwright test | COMPLETE local |
| GitHub remote | Presents repository, pull-request, issue, Actions/checks, and release evidence without remote mutation on read | GitHub Remote Workbench Playwright evidence | COMPLETE read surface; authentication/network dependent |
| Global Search | Searches requested real local entities and exposes COMPLETE, PARTIAL, LIMIT_REACHED, UNAVAILABLE, or NOT_CONFIGURED coverage | API contract and hierarchical-navigation E2E | COMPLETE bounded local coverage |
| Responsive Workbench | Persistent shell with scoped Explorer, canonical Inspector, responsive desktop/mobile behavior, and horizontal-overflow checks | Playwright responsive smoke plus 1366×768, 1440×900, and 1920×1080 overflow checks | COMPLETE for tested viewports |
| Accessibility | Keyboard alternatives, focus behavior, labels, reduced motion, explicit status copy, and Axe checks across critical surfaces | Playwright keyboard suite plus Axe browser analysis | COMPLETE for tested critical surfaces |
| Release Gate | Separates SOURCE, LOCAL, PREVIEW, DESKTOP, WINDOWS_PACKAGE, INSTALLER, GITHUB, CI, and REMOTE verdicts; one domain never manufactures another | Release Gate browser evidence and backend release engine | COMPLETE source separation |
| Release & Distribution | Structured preparation, versioning, artifact presence, package verification, CI identity, and remote release boundaries; no tag/commit/push/publish authority is invented | Release & Distribution E2E plus Axe accessibility | COMPLETE observational/preparation path; publication provider-dependent |
| Windows package/installer | Produces x64 NSIS package, digest evidence, installed-runtime check, lifecycle verification, and CI artifact | Windows gate Run #208; installer SHA-256 `5db31b54ea8b54deb11fcff290598fe2face936f00ac6255f863d4d84facce49` | COMPLETE unsigned package verification |
| Self Audit | Executes the exact KForge-on-KForge observational sequence, checks source mutation, persists atomically, and verifies reload across server instances | Service tests plus browser restart-boundary evidence | COMPLETE local |
| Product identity and run docs | KNOuX Forge package, browser title, README, environment, run commands, ports, routes, architecture, limitations, and dated evidence semantics | Repository documentation truth regression test | COMPLETE repository-content path |

All currently reachable Workbench views in `client/workbench/surfaceTypes.ts` are classified `SPECIALIZED`. That is an information-architecture statement only; external provider availability still follows the evidence boundaries above.

## External and policy blockers

- No configured trustworthy remote extension registry/package adapter and integrity source exists for a real remote extension lifecycle.
- Remote model/update registries, remote documentation, remote CI, remote Preview, product updates, GitHub operations, and cloud AI require their real providers, credentials, network policy, trust, and explicit action. Missing prerequisites remain `OFFLINE`, `NOT_CONFIGURED`, `UNKNOWN`, `UNAVAILABLE`, or `BLOCKED`.
- Target-application browser-console and full browser-network telemetry are not inferred from Playwright acceptance of the KForge Workbench; a dedicated telemetry bridge would be separate evidence.
- Trusted Windows publisher identity is not established. The current installer remains an unsigned development/release artifact for trust purposes even though package digest and lifecycle verification pass.
- At the Run #208 capture point, `main` was not branch-protected and required status-check enforcement was off. CI success proves the tested SHA, not enforcement policy.
- The dependency audit still reports 2 moderate-severity vulnerabilities and pending install-script review for `@swc/core` and `esbuild`; these are not marked fixed.

The repository must continue showing absent provider or policy evidence as `BLOCKED`, `NOT_CONFIGURED`, `OFFLINE`, `UNKNOWN`, or `UNAVAILABLE` until current evidence changes.

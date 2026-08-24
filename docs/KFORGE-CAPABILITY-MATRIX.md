# KNOuX Forge capability matrix

Evidence reviewed on 2026-08-24 against source at `86965fd43aa3230671d66d86630e4269977b0be6` plus the cloud-provider changes in progress. Git history remains the authority for later changes.

`COMPLETE` means the locally implementable product path and its current verification are present. It does not convert absent provider evidence into success. `PARTIAL` means a real path exists with a known local or acceptance gap. `BLOCKED` identifies an external prerequisite that the repository cannot safely invent.

| Capability | Current real behavior | Verification / evidence | Status |
| --- | --- | --- | --- |
| Workspace and collections | Discovers immediate child repositories and persists recent, favorite, pinned, archived, and label state | Route/service tests and built `/api/workspace/projects` response | COMPLETE |
| Settings | Validates, migrates, atomically persists, reloads, and applies every locally editable domain; unsupported domains are classified | Settings unit tests and UI contract tests | COMPLETE locally |
| Operating mode | Offline, Local First, Online Optional, and Online have distinct metadata-read, remote-transfer, and provider-refresh policies; the safe default is Offline | Transition/restart service tests plus route and UI contract tests | COMPLETE locally |
| Network transparency | Important local, remote, and hybrid actions expose execution, network, data class, provider, destination, confirmation, time, and result | Service/route tests; live visual review unavailable | PARTIAL acceptance |
| Project Health | Separates LOCAL, GITHUB, CI, REMOTE_REGISTRY, and PREVIEW evidence before overall recommendation | Route tests and built Self Audit evidence | COMPLETE |
| Online Control Center | Reports mode and 11 services without contacting them when opened | Service tests and UI contract tests | COMPLETE local truth |
| Marketplace | Normalizes local/provider evidence, full taxonomy, details, permissions, provenance, lifecycle eligibility, and project compatibility | Six adapter tests and UI contract tests | COMPLETE local; remote catalogs BLOCKED |
| Extension lifecycle | Refuses to claim install/update/enable/remove without a trustworthy package adapter and verification | Truthful lifecycle states | BLOCKED — no configured remote package adapter |
| Local models | Detects local runtimes, lists installed/catalog evidence, compatibility, tasks, activation, health, and removal | Model Center tests | PARTIAL — provider-dependent live lifecycle |
| Optional cloud AI | Keeps local AI independent; supports explicit OpenAI, Anthropic, Gemini, and OpenRouter server-side configuration with exact preflight disclosure, redaction, confirmation, and contact evidence | Adapter, route, Online Control, and built API tests | COMPLETE locally; live execution provider-dependent |
| Agents and tasks | Runs registered mission DAGs with persistent evidence, permissions, confirmation, retry, recovery, and rollback | Task, mission, tool, and route tests | COMPLETE local |
| Graph and impact | Bounded language-aware files, imports, exports, symbols, routes, APIs, dependencies, cycles, responsibility, and transitive impact | Graph and large-project tests | COMPLETE within visible bounds |
| Preview | One process manager with start/health/stop/restart, bounded logs, routes, history, and contextual references | Preview service and fix/verify route tests | COMPLETE local core; browser telemetry UNAVAILABLE |
| Preview Fix and Verify | Requires current failing Preview evidence, plans, snapshots, applies only a verified safe patch, verifies, restarts, and rolls back on failure | End-to-end route test | COMPLETE for supported safe rule |
| Release Gate | Separates LOCAL, GITHUB, CI, and PREVIEW verdicts; absent remote evidence never becomes local success | Route tests and built Self Audit | COMPLETE source separation |
| Git and GitHub | Uses real local Git; remote reads require a non-Offline mode plus GitHub CLI/auth; transfers require Online Optional or Online; writes remain separately confirmed | Route tests; configured remote/auth dependent | PARTIAL external operations |
| Universal execution | Metadata-backed test/build/runtime/Preview selection for Node, Python, Go, Rust, Maven, Gradle, .NET, and PHP | Golden Matrix route tests | COMPLETE where metadata exists |
| Global Search | Searches requested real local entities and exposes COMPLETE, PARTIAL, LIMIT_REACHED, UNAVAILABLE, or NOT_CONFIGURED coverage | API contract test and built API | COMPLETE bounded local coverage |
| Responsive Online Hub | Desktop three-region, tablet two-region, and contextual mobile browse/detail source contract | UI contract tests | PARTIAL — live width screenshots BLOCKED |
| Accessibility | Keyboard focus alternatives, labels, reduced motion, and explicit status copy exist in the product source | UI contract tests | PARTIAL — live keyboard acceptance BLOCKED |
| Self Audit | Executes the exact 16-stage KForge-on-KForge observational sequence, checks source mutation, persists atomically, and verifies reload only across server instances | Four service tests plus built run/restart/reload with PASSED outcome | COMPLETE local |
| Product identity and run docs | KNOuX Forge package, browser title, README, environment, run commands, ports, routes, architecture, and limitations | Documentation identity regression test | COMPLETE |

## External blockers

- The current environment has no browser automation bridge that can navigate the loopback product, so the required visual, responsive, keyboard, console, and backend-404 acceptance walkthrough is not claimed as passed.
- No configured official extension registry/package adapter and integrity source exists for a real remote extension lifecycle.
- Remote model/update registries, remote documentation, remote CI, remote Preview, and product updates require configured providers and policy. Optional cloud AI has server-side adapters for OpenAI, Anthropic, Gemini, and OpenRouter, but remains `NOT_CONFIGURED` without both credential and explicit model; every request requires Online mode, project trust, an allowing privacy policy, exact disclosure, and separate confirmation.
- GitHub evidence requires a non-Offline mode, GitHub CLI availability, authentication, repository access, and network access. Remote transfers require Online Optional or Online; remote writes additionally require explicit confirmation.

The repository must continue showing these as `BLOCKED`, `NOT_CONFIGURED`, `OFFLINE`, `UNKNOWN`, or `UNAVAILABLE` until current evidence changes.

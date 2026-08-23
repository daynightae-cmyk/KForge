# KNOuX Forge capability matrix

Evidence baseline: `3ed5c2bb4305768ae13ac6c2bd13e777c14e602a`.

This matrix classifies product capability, not component existence. `PARTIAL` means a real path exists but at least one required lifecycle, data source, persistence, or live-browser proof is still missing. `BLOCKED` is reserved for an external prerequisite.

| Capability | Navigation | UI / API / engine | Persistence / truth | Runtime / E2E | Status |
| --- | --- | --- | --- | --- | --- |
| Workspace shell | Explicit renderer | One active surface; stable sidebar/topbar | Real selected-project context | Regression source test | COMPLETE |
| Projects table | Workspace | Dense table, search, filter, sort, actions | Real local discovery and Git evidence | API/runtime verified | COMPLETE |
| Collections | Recent/Favorites/Pinned/Archive | Real collection API | `.kforge/project-collections.json` | Service coverage | COMPLETE |
| Settings | Settings | Real read/patch/reset API; live density, motion, startup and Preview behavior | `.kforge/platform-settings.json`; locked security defaults | Unit + source regression | COMPLETE for configured settings; remaining domains explicit |
| Offline / Online | Offline / Online | Real platform mode | `.kforge/local-platform.json` | Transition regression remains | PARTIAL |
| Privacy / network | Settings / permissions | Secret redaction locked; remote context policy persisted | Redaction engine and policy truth | Full outbound-flow E2E remains | PARTIAL |
| Online Hub IA | 14 Online subviews | Left navigation, replaceable center list, right inspector; remote sources and persisted download/activity evidence | Local/provider/task provenance | API/runtime verified; browser visual gate pending | COMPLETE architecture / PARTIAL E2E |
| Marketplace registry | Marketplace | Local, provider, and declared remote adapters | Truthful unavailable states | Adapter unit coverage | COMPLETE local; remote adapters BLOCKED |
| Extension lifecycle | Extensions | Inspect and permission review | No fabricated install state | No configured remote package adapter | BLOCKED |
| Model lifecycle | Models | Ollama install/activate/remove and compatibility evidence | Local runtime/task evidence | Provider-dependent E2E | PARTIAL |
| Agent / tool catalog | Agents / Tools | Real registered agents and agent tools | Source, trust, permissions | Registry API verified | COMPLETE local catalog |
| Installed / Updates | Installed / Updates | Aggregated verified local items and truthful unknown update state | No fabricated latest version | Remote version comparison unavailable | PARTIAL / BLOCKED remote |
| Security / trust / permissions | Security centers | Project trust, tool permissions, explicit security-tool execution | Persistent trust and evidence | Unit/API coverage | COMPLETE local |
| Tasks / missions | Tasks / Agents | Real task logs, mission recovery, retry, rollback | Persistent task and mission store | Service coverage | COMPLETE local |
| Project intelligence | Graph/Dependencies/Impact/Architecture | Real source and dependency evidence | Recomputed from project files | API coverage | COMPLETE local |
| Quality | Sonar/Problems/Solutions | Normalized real findings and guarded deterministic fixes | Scan/task evidence | Route/service coverage | COMPLETE local |
| Git | Git/Branches/Commits | Real local branch, status, diff, commits, pre-push evidence | Local repository | Remote compare/fetch/pull/push UI incomplete | PARTIAL |
| GitHub | GitHub/PRs/Issues/Actions/Releases | Real API only in Online Optional; dedicated filtered read surfaces | No fake remote state | Authenticated write flows remain unavailable | COMPLETE read-only / PARTIAL writes |
| Preview V2 | Preview | One engine; process lifecycle, session ID, iframe reload, routes, process console, health network evidence, metadata/history | Current server-session evidence | Live HTTP verification required | COMPLETE local core / PARTIAL browser telemetry |
| Release Gate | Release | Local verification, security/completeness blockers, Preview evidence | Task/scan evidence | Source-separated CI/GitHub verdict incomplete | PARTIAL |
| Global search | Ctrl/Cmd+K | Backend project/file/problem/task/Git evidence | No fabricated entities | Marketplace/model/document coverage incomplete | PARTIAL |
| Accessibility | All | Labels, focus, keyboard table/navigation, reduced motion | Preference persisted | Full live keyboard E2E pending | PARTIAL |
| Responsive shell | All | Desktop/tablet responsive; Online stacks contextually | N/A | Mobile drawer remains incomplete | PARTIAL |
| Legacy demo/editor | Production router | Removed from production routes; source retained only as unreferenced legacy code | Cannot produce production mock data | Regression test | COMPLETE isolation |
| Self audit | KForge project | Discovery, scan, graph, tests, build, runtime and gate paths exist | Persistent evidence | Entire chained workflow not yet automated | PARTIAL |

## External blockers

- No configured official extension registry adapter or package signing/integrity source.
- No configured remote model/update registry providing live version and changelog truth.
- GitHub write workflows depend on authenticated user policy and explicit confirmation.
- The Work cloud browser cannot directly navigate to a loopback URL from the isolated runtime; HTTP/API verification remains available in the runtime, while visual browser evidence requires the product preview bridge or an external deployment.

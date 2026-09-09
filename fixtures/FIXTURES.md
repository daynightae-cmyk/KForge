# KForge fixtures manifest

Forensic classification. Production UI must never present development-only
fixtures as genuine detected user projects.

## A — verification fixtures (deterministic tests, never user data)

| Fixture | Purpose |
| --- | --- |
| `fixtures/workspace-node` | Node project detection/graph tests |
| `fixtures/workspace-python` | Python detection tests |
| `fixtures/workspace-go` | Go detection tests |
| `fixtures/workspace-rust` | Rust detection tests |
| `fixtures/workspace-java-maven` | Maven detection tests |
| `fixtures/workspace-java-gradle` | Gradle detection tests |
| `fixtures/workspace-dotnet` | .NET detection tests |
| `fixtures/workspace-php` | PHP detection tests |
| `fixtures/workspace-django` | Django detection tests |
| `fixtures/workspace-clean` | Healthy-project baseline |
| `fixtures/workspace-broken-typescript` | Problem-detection baseline |
| `fixtures/workspace-failing-test` | Failing-test baseline |
| `fixtures/workspace-security` | Secret-scan baseline |
| `fixtures/workspace-documentation` | Documentation-audit baseline |
| `fixtures/workspace-agent-safe` | Agent/tool safety baseline |
| `fixtures/runtime-topology` | Preview/topology orchestration baseline |
| `fixtures/workspace-mock` | Explicit mock-boundary regression (must stay labeled mock) |

## B — first-party marketplace packages (bundled content, clearly labeled)

| Package | Purpose |
| --- | --- |
| `fixtures/marketplace-first-party` | Bundled first-party extension, Install → Health → Run → Update → Uninstall lifecycle |
| `fixtures/marketplace-first-party-v110` | Newer bundled version used only for the Update step |

Both carry their own `manifest.json` with first-party provenance. They are
the only fixtures shipped inside the packaged app (`package.json` `pkg.assets`
and electron-builder `files`).

## C — development-only samples

None currently. Any future sample project added for manual exploration must be
listed here and must not appear in production discovery, search, or health
surfaces without an explicit development-only label.

## D — obsolete / dead artifacts

None currently. Candidates for removal must prove: no import, no dynamic
load, no test reference, no packaging reference, and no E2E reference before
deletion.

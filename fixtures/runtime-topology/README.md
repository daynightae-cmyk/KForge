# Runtime Topology E2E fixtures

These fixtures are executable only after a test copies a scenario into an isolated temporary project and grants project trust. Opening Topology Lab performs discovery only.

- `a-frontend-only`: one browser service.
- `b-frontend-api`: Web depends on API.
- `c-frontend-api-worker`: Web depends on API; API depends on Worker.
- `d-two-entrypoints`: Web and Admin are independently browser-capable.
- `e-port-conflict`: requests port 43123; the test owns that port first.
- `f-service-crash`: exits with code 23 after real spawn.
- `g-missing-runtime`: names an unavailable executable.

The main Playwright topology test builds an equivalent isolated four-service fixture at runtime so PIDs, ports, health, logs, crash evidence, and cleanup are real rather than committed output.

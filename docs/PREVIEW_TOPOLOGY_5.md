# Preview Experience 5.0 — Runtime Topology contract

KForge now treats a runnable workspace as a set of evidence-backed services. Opening Preview performs discovery only. Project code can run only after the project is trusted and the user explicitly starts a service or topology.

## Discovery authority

Automatic discovery currently recognizes runnable `package.json` scripts at the project root and in bounded child packages. Workspace package dependencies become edges only when both packages are runnable. `pnpm-workspace.yaml`, `turbo.json`, and `nx.json` are surfaced as workspace evidence, but KForge does not invent commands from them.

For other runtimes or exact orchestration, use `.kforge/topology.json`:

```json
{
  "services": [
    {
      "id": "api",
      "name": "API",
      "kind": "api",
      "command": ["python", "-m", "uvicorn", "app:api"],
      "port": 4312,
      "health": { "type": "HTTP", "path": "/health" }
    },
    {
      "id": "web",
      "name": "Web",
      "kind": "frontend",
      "script": "dev",
      "dependencies": ["api"],
      "health": { "type": "HTTP" },
      "browserEntrypoint": "/"
    }
  ]
}
```

Commands are argv-only and reject shell metacharacters. Service roots must remain inside the selected project. Unknown dependency IDs are not rendered as edges.

## State and health rules

- A spawned process begins as `STARTING`; it is never healthy merely because a PID exists.
- HTTP/TCP services become `HEALTHY` only from a responding probe.
- Process-only services become `RUNNING` and explicitly do not claim listener health.
- An unexpected exit becomes `FAILED`, retains exit evidence, and degrades active dependents.
- A requested occupied port becomes `PORT_CONFLICT`; no process is spawned and the external listener is not terminated. A newly responding dynamically allocated port remains ownership `UNKNOWN` until OS-level listener PID attribution exists; KForge does not infer ownership from timing alone.
- A topology with both good and bad services is `DEGRADED`; it is not collapsed into success.

## Ownership and shutdown

Each spawned process records session ID, service ID, PID, spawn time, and command evidence. Stop/restart validates that identity and never uses kill-by-port. Windows termination targets only the recorded child tree. Graceful termination is attempted before force escalation. Desktop/server shutdown and project trust revocation await all KForge-owned Preview and topology processes.

## Evidence boundaries

- Environment values are never returned except the safe runtime values `PORT`, `HOST`, `NODE_ENV`, `ASPNETCORE_ENVIRONMENT`, and `ASPNETCORE_URLS`; secret-like names are always redacted.
- Browser traffic attribution remains `NOT_CAPTURED` until a browser instrumentation bridge provides origin/port evidence. Configured dependencies and observed traffic remain separate concepts.
- Docker Compose, Procfile, and automatic Python/.NET/Java/Go/Rust/PHP multi-service expansion are currently unavailable without explicit topology configuration. Existing single-runtime Preview detection remains the compatibility path.
- Restart policy defaults to `MANUAL`; KForge performs no hidden restart loop.

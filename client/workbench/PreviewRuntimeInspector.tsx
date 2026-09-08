import { EvidenceRows, StatusBadge } from "./ui";
import type { CanonicalInspectorProps, RecordRow } from "./surfaceContracts";

export default function PreviewRuntimeInspector({ project, execution, context }: CanonicalInspectorProps) {
  if (context?.kind !== "preview-runtime" || !context.preview) return null;

  const preview = context.preview;
  const health = typeof preview.health === "object" && preview.health !== null ? preview.health as RecordRow : null;
  const capability = typeof preview.capability === "object" && preview.capability !== null ? preview.capability as RecordRow : null;
  const runtime = typeof preview.runtime === "object" && preview.runtime !== null ? preview.runtime as RecordRow : null;
  const telemetry = typeof preview.telemetry === "object" && preview.telemetry !== null ? preview.telemetry as RecordRow : null;
  const embedding = typeof preview.embedding === "object" && preview.embedding !== null ? preview.embedding as RecordRow : null;
  const runtimeVerification = typeof preview.runtimeVerification === "object" && preview.runtimeVerification !== null ? preview.runtimeVerification as RecordRow : null;
  const history = Array.isArray(preview.history) ? preview.history as RecordRow[] : [];
  const healthHistory = Array.isArray(preview.healthHistory) ? preview.healthHistory as RecordRow[] : [];

  return (
    <aside className="kw-inspector kw-preview-inspector" aria-label="Preview runtime Inspector">
      <div className="kw-inspector-scroll" tabIndex={0}>
        <div className="kw-inspector-title">
          <StatusBadge value={String(preview.state || "UNKNOWN")} />
          <div>
            <strong>{context.title || "Preview Studio"}</strong>
            <small>{context.projectName || project?.name || "No project"}</small>
          </div>
        </div>
        <h2>Live session</h2>
        <dl className="kw-preview-evidence-list">
          <div><dt>Session ID</dt><dd>{String(preview.sessionId || "NO_ACTIVE_SESSION")}</dd></div>
          <div><dt>Project</dt><dd>{context.projectName || project?.name || "UNKNOWN"}</dd></div>
          <div><dt>Command</dt><dd><code>{String(preview.command || capability?.command || "NOT_AVAILABLE")}</code></dd></div>
          <div><dt>Source</dt><dd>{String(capability?.source || "Detected project metadata")}</dd></div>
          <div><dt>Endpoint</dt><dd><code>{String(preview.url || "NOT_ALLOCATED")}</code></dd></div>
          <div><dt>Port</dt><dd>{preview.port === undefined ? "NOT_ALLOCATED" : String(preview.port)}</dd></div>
          <div><dt>PID</dt><dd>{preview.pid === undefined ? "NOT_RUNNING" : String(preview.pid)}</dd></div>
          <div><dt>Started</dt><dd>{String(preview.startedAt || "NEVER")}</dd></div>
        </dl>
        <h2>Health</h2>
        {health ? (
          <dl className="kw-preview-evidence-list">
            <div><dt>Result</dt><dd><StatusBadge value={health.ok ? "HEALTHY" : "UNHEALTHY"} /></dd></div>
            <div><dt>HTTP</dt><dd>{health.status === undefined ? "NO_RESPONSE" : String(health.status)}</dd></div>
            <div><dt>Latency</dt><dd>{health.latencyMs === undefined ? "NOT_MEASURED" : `${String(health.latencyMs)} ms`}</dd></div>
            <div><dt>Checked</dt><dd>{String(preview.checkedAt || "NEVER")}</dd></div>
            <div><dt>Samples</dt><dd>{String(healthHistory.length)}</dd></div>
            <div><dt>Detail</dt><dd>{String(health.detail || "No detail")}</dd></div>
          </dl>
        ) : (
          <p className="kw-muted">No health evidence exists.</p>
        )}
        <h2>Security & telemetry</h2>
        <dl className="kw-preview-evidence-list">
          <div><dt>Execution</dt><dd>{String(runtime?.execution || "LOCAL")}</dd></div>
          <div><dt>Network</dt><dd>{String(runtime?.network || "NOT_DISCLOSED")}</dd></div>
          <div><dt>Embedding</dt><dd><StatusBadge value={String(embedding?.state || "UNKNOWN")} /> {String(embedding?.reason || "")}</dd></div>
          <div><dt>Console</dt><dd>{String(telemetry?.console || "NOT_CAPTURED")}</dd></div>
          <div><dt>Probe network</dt><dd>{String(telemetry?.network || "NOT_CAPTURED")}</dd></div>
          <div><dt>Browser console</dt><dd>{telemetry?.browserConsoleCaptured === true ? "CAPTURED" : "NOT_CAPTURED"}</dd></div>
        </dl>
        <h2>Recent operations</h2>
        {history.length ? (
          <ol className="kw-preview-history">
            {history.slice(-8).reverse().map((entry, index) => (
              <li key={`${String(entry.at || index)}:${String(entry.event || index)}`}>
                <StatusBadge value={String(entry.event || "EVENT")} />
                <span>{String(entry.detail || "No detail")}</span>
                <small>{String(entry.at || "")}</small>
              </li>
            ))}
          </ol>
        ) : (
          <p className="kw-muted">No Preview operation has run from this server session.</p>
        )}
        {runtimeVerification && <><h2>Runtime verifier</h2><EvidenceRows value={runtimeVerification} /></>}
        {execution && <><h2>Latest workbench operation</h2><EvidenceRows value={execution as unknown as RecordRow} /></>}
        <h2>Advanced evidence</h2>
        <details><summary>Raw canonical Preview record</summary><pre tabIndex={0}>{JSON.stringify(preview, null, 2)}</pre></details>
      </div>
    </aside>
  );
}

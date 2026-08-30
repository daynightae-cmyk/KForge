import type { ReactNode } from "react";
import { activityLabel, viewLabel } from "./navigation";
import ProjectsSurface from "./projectsSurface";
import ProjectHealthWorkbench from "./ProjectHealthWorkbench";
import ProjectCollectionsWorkbench from "./ProjectCollectionsWorkbench";
import OnlineSurface from "./onlineSurface";
import AISurface from "./aiSurface";
import IntelligenceSurface from "./intelligenceSurface";
import QualitySurface from "./qualitySurface";
import DeveloperSurface from "./developerSurface";
import DeveloperExecutionLedger from "./DeveloperExecutionLedger";
import DeveloperObservabilityWorkbench from "./DeveloperObservabilityWorkbench";
import DeveloperTestsWorkbench from "./DeveloperTestsWorkbench";
import DeveloperBuildWorkbench from "./DeveloperBuildWorkbench";
import DeveloperRuntimeWorkbench from "./DeveloperRuntimeWorkbench";
import DeveloperLintWorkbench from "./DeveloperLintWorkbench";
import PreviewStudioWorkbench from "./PreviewStudioWorkbench";
import RemoteSurface from "./remoteSurface";
import ReleaseSurface from "./releaseSurface";
import SystemSurface from "./systemSurface";
import SystemTrustCenter from "./SystemTrustCenter";
import SystemPermissionsCenter from "./SystemPermissionsCenter";
import SystemControlCenter from "./SystemControlCenter";
import { SURFACE_AUDIT_MATRIX, CANONICAL_INSPECTOR_OWNER, ONLINE_INSPECTOR_POLICY } from "./surfaceAudit";
import { EvidenceRows, StatusBadge } from "./ui";
import { KForgeInspector } from "@/components/ui/KForgeInspector";
// Canonical inspector preserves explicit item.authority?.kind, item.runtimeEvidence?.state, item.runtimeEvidence?.sources, p.required
import type { SurfaceProps, CanonicalInspectorProps, RecordRow, MarketplaceItem } from "./surfaceContracts";

export { SURFACE_AUDIT_MATRIX, CANONICAL_INSPECTOR_OWNER, ONLINE_INSPECTOR_POLICY } from "./surfaceAudit";
export type { ProductSurfaceClass } from "./surfaceAudit";

function isMarketplaceItem(item: unknown): item is MarketplaceItem {
  return typeof item === "object" && item !== null && "id" in item && "name" in item;
}

export function CanonicalInspector(props: CanonicalInspectorProps) {
  const { activity, view, project, execution, context } = props;
  if (context?.kind === "online-item" && isMarketplaceItem(context.item)) {
    return <KForgeInspector context={context} operation={context.operation || null} />;
  }
  if (context?.kind === "preview-runtime" && context.preview) {
    const preview = context.preview;
    const health = typeof preview.health === "object" && preview.health !== null ? preview.health as RecordRow : null;
    const capability = typeof preview.capability === "object" && preview.capability !== null ? preview.capability as RecordRow : null;
    const runtime = typeof preview.runtime === "object" && preview.runtime !== null ? preview.runtime as RecordRow : null;
    const telemetry = typeof preview.telemetry === "object" && preview.telemetry !== null ? preview.telemetry as RecordRow : null;
    const embedding = typeof preview.embedding === "object" && preview.embedding !== null ? preview.embedding as RecordRow : null;
    const runtimeVerification = typeof preview.runtimeVerification === "object" && preview.runtimeVerification !== null ? preview.runtimeVerification as RecordRow : null;
    const history = Array.isArray(preview.history) ? preview.history as RecordRow[] : [];
    const healthHistory = Array.isArray(preview.healthHistory) ? preview.healthHistory as RecordRow[] : [];
    return <aside className="kw-inspector kw-preview-inspector" aria-label="Preview runtime Inspector"><div className="kw-inspector-scroll" tabIndex={0}>
      <div className="kw-inspector-title"><StatusBadge value={String(preview.state || "UNKNOWN")} /><div><strong>{context.title || "Preview Studio"}</strong><small>{context.projectName || project?.name || "No project"}</small></div></div>
      <h2>Live session</h2><dl className="kw-preview-evidence-list"><div><dt>Session ID</dt><dd>{String(preview.sessionId || "NO_ACTIVE_SESSION")}</dd></div><div><dt>Project</dt><dd>{context.projectName || project?.name || "UNKNOWN"}</dd></div><div><dt>Command</dt><dd><code>{String(preview.command || capability?.command || "NOT_AVAILABLE")}</code></dd></div><div><dt>Source</dt><dd>{String(capability?.source || "Detected project metadata")}</dd></div><div><dt>Endpoint</dt><dd><code>{String(preview.url || "NOT_ALLOCATED")}</code></dd></div><div><dt>Port</dt><dd>{preview.port === undefined ? "NOT_ALLOCATED" : String(preview.port)}</dd></div><div><dt>PID</dt><dd>{preview.pid === undefined ? "NOT_RUNNING" : String(preview.pid)}</dd></div><div><dt>Started</dt><dd>{String(preview.startedAt || "NEVER")}</dd></div></dl>
      <h2>Health</h2>{health ? <dl className="kw-preview-evidence-list"><div><dt>Result</dt><dd><StatusBadge value={health.ok ? "HEALTHY" : "UNHEALTHY"} /></dd></div><div><dt>HTTP</dt><dd>{health.status === undefined ? "NO_RESPONSE" : String(health.status)}</dd></div><div><dt>Latency</dt><dd>{health.latencyMs === undefined ? "NOT_MEASURED" : `${String(health.latencyMs)} ms`}</dd></div><div><dt>Checked</dt><dd>{String(preview.checkedAt || "NEVER")}</dd></div><div><dt>Samples</dt><dd>{String(healthHistory.length)}</dd></div><div><dt>Detail</dt><dd>{String(health.detail || "No detail")}</dd></div></dl> : <p className="kw-muted">No health evidence exists.</p>}
      <h2>Security & telemetry</h2><dl className="kw-preview-evidence-list"><div><dt>Execution</dt><dd>{String(runtime?.execution || "LOCAL")}</dd></div><div><dt>Network</dt><dd>{String(runtime?.network || "NOT_DISCLOSED")}</dd></div><div><dt>Embedding</dt><dd><StatusBadge value={String(embedding?.state || "UNKNOWN")} /> {String(embedding?.reason || "")}</dd></div><div><dt>Console</dt><dd>{String(telemetry?.console || "NOT_CAPTURED")}</dd></div><div><dt>Probe network</dt><dd>{String(telemetry?.network || "NOT_CAPTURED")}</dd></div><div><dt>Browser console</dt><dd>{telemetry?.browserConsoleCaptured === true ? "CAPTURED" : "NOT_CAPTURED"}</dd></div></dl>
      <h2>Recent operations</h2>{history.length ? <ol className="kw-preview-history">{history.slice(-8).reverse().map((entry, index) => <li key={`${String(entry.at || index)}:${String(entry.event || index)}`}><StatusBadge value={String(entry.event || "EVENT")} /><span>{String(entry.detail || "No detail")}</span><small>{String(entry.at || "")}</small></li>)}</ol> : <p className="kw-muted">No Preview operation has run in this server session.</p>}
      {runtimeVerification && <><h2>Runtime verifier</h2><EvidenceRows value={runtimeVerification} /></>}
      {execution && <><h2>Latest workbench operation</h2><EvidenceRows value={execution as unknown as RecordRow} /></>}
      <h2>Advanced evidence</h2><details><summary>Raw canonical Preview record</summary><pre tabIndex={0}>{JSON.stringify(preview, null, 2)}</pre></details>
    </div></aside>;
  }
  return <aside className="kw-inspector" aria-label="Context inspector"><div className="kw-inspector-scroll" tabIndex={0}><div className="kw-inspector-title"><StatusBadge value={activity} /><div><strong>Inspector</strong><small>{activityLabel(activity)} / {viewLabel(activity, view)}</small></div></div><h2>Project context</h2>{project ? <EvidenceRows value={project as unknown as RecordRow} /> : <p className="kw-message">No project selected. Online compatibility remains NOT_EVALUATED.</p>}{execution && <><h2>Latest execution</h2><EvidenceRows value={execution as unknown as RecordRow} /></>}<h2>Workbench contract</h2><ul className="kw-contract"><li>One active capability surface</li><li>Explorer is scoped to the Activity</li><li>Inspector is contextual</li><li>Remote contact remains explicit</li></ul></div></aside>;
}

export function WorkbenchSurface(props: SurfaceProps) {
  if (props.activity === "projects" && props.view === "health") return <ProjectHealthWorkbench project={props.project} onRefresh={props.onRefresh} />;
  if (props.activity === "projects" && ["recent", "favorites", "pinned", "archive"].includes(props.view)) return <ProjectCollectionsWorkbench view={props.view as "recent" | "favorites" | "pinned" | "archive"} workspace={props.workspace} project={props.project} onProjectSelect={props.onProjectSelect} onRefresh={props.onRefresh} />;
  if (props.activity === "projects") return <ProjectsSurface {...props} />;
  if (props.activity === "online") return <OnlineSurface {...props} />;
  if (props.activity === "ai") return <AISurface {...props} />;
  if (props.activity === "quality") return <QualitySurface {...props} />;
  if (props.activity === "developer-tools" && props.view === "tests" && props.project) return <DeveloperTestsWorkbench project={props.project} onExecution={props.onExecution} />;
  if (props.activity === "developer-tools" && props.view === "build" && props.project) return <DeveloperBuildWorkbench project={props.project} onExecution={props.onExecution} />;
  if (props.activity === "developer-tools" && props.view === "runtime" && props.project) return <DeveloperRuntimeWorkbench project={props.project} onExecution={props.onExecution} />;
  if (props.activity === "developer-tools" && props.view === "lint" && props.project) return <DeveloperLintWorkbench project={props.project} onExecution={props.onExecution} />;
  if (props.activity === "developer-tools" && props.view === "preview" && props.project) return <PreviewStudioWorkbench project={props.project} onExecution={props.onExecution} onInspectorContext={props.onInspectorContext} />;
  if (props.activity === "developer-tools" && props.view === "logs") return <DeveloperExecutionLedger project={props.project} onExecution={props.onExecution} />;
  if (props.activity === "developer-tools" && props.view === "diagnostics") return <DeveloperObservabilityWorkbench {...props} />;
  if (props.activity === "developer-tools") return <DeveloperSurface {...props} />;
  if (props.activity === "remote") return <RemoteSurface {...props} />;
  if (props.activity === "release") return <ReleaseSurface {...props} />;
  if (props.activity === "system" && props.view === "trust") return <SystemTrustCenter project={props.project} onRefresh={props.onRefresh} />;
  if (props.activity === "system" && props.view === "permissions") return <SystemPermissionsCenter project={props.project} />;
  if (props.activity === "system" && ["online-offline", "self-audit", "system-diagnostics"].includes(props.view)) return <SystemControlCenter view={props.view as "online-offline" | "self-audit" | "system-diagnostics"} project={props.project} />;
  if (props.activity === "system") return <SystemSurface {...props} />;
  return <IntelligenceSurface {...props} />;
}

export function SurfaceTitle({ activity, view, children }: { activity: SurfaceProps["activity"]; view: string; children?: ReactNode }) {
  return <div className="kw-surface-title"><div><span>{activityLabel(activity)}</span><h2>{viewLabel(activity, view)}</h2></div>{children}</div>;
}

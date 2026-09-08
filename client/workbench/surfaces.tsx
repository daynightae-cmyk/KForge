import { lazy, Suspense, type ReactNode } from "react";
import { activityLabel, viewLabel } from "./navigation";
import { SURFACE_AUDIT_MATRIX, CANONICAL_INSPECTOR_OWNER, ONLINE_INSPECTOR_POLICY } from "./surfaceAudit";
import { EvidenceRows, StatusBadge } from "./ui";
import { KForgeInspector } from "@/components/ui/KForgeInspector";
// Canonical inspector preserves explicit item.authority?.kind, item.runtimeEvidence?.state, item.runtimeEvidence?.sources, p.required
import type { SurfaceProps, CanonicalInspectorProps, RecordRow, MarketplaceItem } from "./surfaceContracts";

const ProjectsSurface = lazy(() => import("./projectsSurface"));
const ProjectHealthWorkbench = lazy(() => import("./ProjectHealthWorkbench"));
const ProjectCollectionsWorkbench = lazy(() => import("./ProjectCollectionsWorkbench"));
const OnlineSurface = lazy(() => import("./onlineSurface"));
const AISurface = lazy(() => import("./aiSurface"));
const IntelligenceSurface = lazy(() => import("./intelligenceSurface"));
const QualitySurface = lazy(() => import("./qualitySurface"));
const DeveloperSurface = lazy(() => import("./developerSurface"));
const DeveloperExecutionLedger = lazy(() => import("./DeveloperExecutionLedger"));
const DeveloperObservabilityWorkbench = lazy(() => import("./DeveloperObservabilityWorkbench"));
const DeveloperTestsWorkbench = lazy(() => import("./DeveloperTestsWorkbench"));
const DeveloperBuildWorkbench = lazy(() => import("./DeveloperBuildWorkbench"));
const DeveloperRuntimeWorkbench = lazy(() => import("./DeveloperRuntimeWorkbench"));
const DeveloperLintWorkbench = lazy(() => import("./DeveloperLintWorkbench"));
const PreviewStudioWorkbench = lazy(() => import("./PreviewStudioWorkbench"));
const RemoteSurface = lazy(() => import("./remoteSurface"));
const ReleaseSurface = lazy(() => import("./releaseSurface"));
const SystemSurface = lazy(() => import("./systemSurface"));
const SystemTrustCenter = lazy(() => import("./SystemTrustCenter"));
const SystemPermissionsCenter = lazy(() => import("./SystemPermissionsCenter"));
const SystemControlCenter = lazy(() => import("./SystemControlCenter"));

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
  if (context?.kind === "topology-service" && context.service) {
    return <aside className="kw-inspector" aria-label="Topology service Inspector"><div className="kw-inspector-scroll" tabIndex={0}><div className="kw-inspector-title"><StatusBadge value={String(context.service.state || "UNKNOWN")} /><div><strong>{context.title || "Topology service"}</strong><small>{context.projectName || project?.name || "No project"}</small></div></div><h2>Canonical service evidence</h2><EvidenceRows value={context.service} /><h2>Topology session boundary</h2>{context.topologySession ? <details><summary>Session evidence</summary><pre tabIndex={0}>{JSON.stringify(context.topologySession, null, 2)}</pre></details> : <p className="kw-muted">No execution session exists; discovery does not run project code.</p>}</div></aside>;
  }
  return <aside className="kw-inspector" aria-label="Context inspector"><div className="kw-inspector-scroll" tabIndex={0}><div className="kw-inspector-title"><StatusBadge value={activity} /><div><strong>Inspector</strong><small>{activityLabel(activity)} / {viewLabel(activity, view)}</small></div></div><h2>Project context</h2>{project ? <EvidenceRows value={project as unknown as RecordRow} /> : <p className="kw-message">No project selected. Online compatibility remains NOT_EVALUATED.</p>}{execution && <><h2>Latest execution</h2><EvidenceRows value={execution as unknown as RecordRow} /></>}<h2>Workbench contract</h2><ul className="kw-contract"><li>One active capability surface</li><li>Explorer is scoped to the Activity</li><li>Inspector is contextual</li><li>Remote contact remains explicit</li></ul></div></aside>;
}

function SurfaceLoading({ activity, view }: Pick<SurfaceProps, "activity" | "view">) {
  return <div className="kw-message" role="status" aria-live="polite" aria-busy="true">Loading {activityLabel(activity)} / {viewLabel(activity, view)}…</div>;
}

export function WorkbenchSurface(props: SurfaceProps) {
  let surface: ReactNode;
  if (props.activity === "projects" && props.view === "health") surface = <ProjectHealthWorkbench project={props.project} onRefresh={props.onRefresh} />;
  else if (props.activity === "projects" && ["recent", "favorites", "pinned", "archive"].includes(props.view)) surface = <ProjectCollectionsWorkbench view={props.view as "recent" | "favorites" | "pinned" | "archive"} workspace={props.workspace} project={props.project} onProjectSelect={props.onProjectSelect} onRefresh={props.onRefresh} />;
  else if (props.activity === "projects") surface = <ProjectsSurface {...props} />;
  else if (props.activity === "online") surface = <OnlineSurface {...props} />;
  else if (props.activity === "ai") surface = <AISurface {...props} />;
  else if (props.activity === "quality") surface = <QualitySurface {...props} />;
  else if (props.activity === "developer-tools" && props.view === "tests" && props.project) surface = <DeveloperTestsWorkbench project={props.project} onExecution={props.onExecution} />;
  else if (props.activity === "developer-tools" && props.view === "build" && props.project) surface = <DeveloperBuildWorkbench project={props.project} onExecution={props.onExecution} />;
  else if (props.activity === "developer-tools" && props.view === "runtime" && props.project) surface = <DeveloperRuntimeWorkbench project={props.project} onExecution={props.onExecution} />;
  else if (props.activity === "developer-tools" && props.view === "lint" && props.project) surface = <DeveloperLintWorkbench project={props.project} onExecution={props.onExecution} />;
  else if (props.activity === "developer-tools" && props.view === "preview" && props.project) surface = <PreviewStudioWorkbench project={props.project} onExecution={props.onExecution} onInspectorContext={props.onInspectorContext} />;
  else if (props.activity === "developer-tools" && props.view === "logs") surface = <DeveloperExecutionLedger project={props.project} onExecution={props.onExecution} />;
  else if (props.activity === "developer-tools" && props.view === "diagnostics") surface = <DeveloperObservabilityWorkbench {...props} />;
  else if (props.activity === "developer-tools") surface = <DeveloperSurface {...props} />;
  else if (props.activity === "remote") surface = <RemoteSurface {...props} />;
  else if (props.activity === "release") surface = <ReleaseSurface {...props} />;
  else if (props.activity === "system" && props.view === "trust") surface = <SystemTrustCenter project={props.project} onRefresh={props.onRefresh} />;
  else if (props.activity === "system" && props.view === "permissions") surface = <SystemPermissionsCenter project={props.project} />;
  else if (props.activity === "system" && ["online-offline", "self-audit", "system-diagnostics"].includes(props.view)) surface = <SystemControlCenter view={props.view as "online-offline" | "self-audit" | "system-diagnostics"} project={props.project} />;
  else if (props.activity === "system") surface = <SystemSurface {...props} />;
  else surface = <IntelligenceSurface {...props} />;

  return <Suspense fallback={<SurfaceLoading activity={props.activity} view={props.view} />}>{surface}</Suspense>;
}

export function SurfaceTitle({ activity, view, children }: { activity: SurfaceProps["activity"]; view: string; children?: ReactNode }) {
  return <div className="kw-surface-title"><div><span>{activityLabel(activity)}</span><h2>{viewLabel(activity, view)}</h2></div>{children}</div>;
}

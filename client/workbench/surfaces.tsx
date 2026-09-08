import { lazy, Suspense, type ReactNode } from "react";
import { activityLabel, viewLabel } from "./navigation";
import { SURFACE_AUDIT_MATRIX, CANONICAL_INSPECTOR_OWNER, ONLINE_INSPECTOR_POLICY } from "./surfaceAudit";
import type { SurfaceProps } from "./surfaceContracts";

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

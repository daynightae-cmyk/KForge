import { useState, type ReactNode } from "react";
import type { KForgeActivity, WorkspaceResponse, ProjectSummary, KForgePlatformSettings, WorkspaceActionDescriptor, WorkspaceResponse } from "@shared/workspace";
import { ACTIVITIES, KFORGE_ACTIVITY_IDS, ONLINE_EXPLORER_VIEWS, activityDefinition, activityLabel, defaultView, viewLabel } from "./navigation";
import ProjectsSurface from "./projectsSurface";
import OnlineSurface from "./onlineSurface";
import AISurface from "./aiSurface";
import IntelligenceSurface from "./intelligenceSurface";
import QualitySurface from "./qualitySurface";
import DeveloperSurface from "./developerSurface";
import RemoteSurface from "./remoteSurface";
import ReleaseSurface from "./releaseSurface";
import SystemSurface from "./systemSurface";
import { SURFACE_AUDIT_MATRIX, CANONICAL_INSPECTOR_OWNER, ONLINE_INSPECTOR_POLICY } from "./surfaceAudit";
import { EvidenceRows, EvidenceCards, StatusBadge, EmptyState, EvidenceTable, AdvancedEvidence, type RecordRow, type TaskRow, type ExecutionSnapshot, type SurfaceProps } from "./ui";

export { SURFACE_AUDIT_MATRIX, CANONICAL_INSPECTOR_OWNER, ONLINE_INSPECTOR_POLICY } from "./surfaceAudit";
export type { ProductSurfaceClass } from "./surfaceAudit";

export type InspectorContext = {
  kind: "online-item" | "project" | "execution" | null;
  item?: RecordRow | null;
  title?: string;
  view?: string;
  compatibility?: string;
  projectName?: string;
  action?: string;
  operation?: RecordRow | null;
};

export function CanonicalInspector({ activity, view, project, execution, context }: SurfaceProps & { context?: InspectorContext | null }) {
  if (context?.kind === "online-item" && context.item) {
    const item = context.item;
    return <aside className="kw-inspector" aria-label="Online item details"><div className="kw-inspector-scroll" tabIndex={0}><div className="kw-inspector-title"><StatusBadge value={context.item?.name || "ITEM"} /><div><strong>{context.title || "Online item"}</strong><small>Online / {viewLabel("online", context.view || view)}</small></div></div><h2>Overview</h2><p>{String(item.description || item.overview || "No description supplied by verified metadata.")}</p><EvidenceRows value={{ category: item.category, version: item.version, health: item.healthState }} /><h2>Authority</h2><EvidenceRows value={{ authority: item.authority?.kind, originalAuthority: item.authority?.originalKind }} /><h2>Source</h2><EvidenceRows value={{ source: item.source }} /><h2>Availability</h2><EvidenceRows value={{ availability: item.availability, unavailableReason: item.unavailableReason }} /><h2>Runtime Evidence</h2><EvidenceRows value={{ runtimeEvidence: item.runtimeEvidence?.state, runtimeSources: item.runtimeEvidence?.sources?.join(", ") }} /><h2>Compatibility</h2><EvidenceRows value={{ state: context.compatibility || (project ? item.projectCompatibility?.state : "NOT_EVALUATED"), project: context.projectName || (project?.name || "No project selected"), source: item.projectCompatibility?.source }} /><h2>Permissions</h2>{(item.permissions || []).filter((p: any) => p.required).length ? <ul className="kw-contract">{(item.permissions || []).filter((p: any) => p.required).map((permission: any) => <li key={permission.id}><strong>{permission.id}</strong> — {permission.detail}</li>)}</ul> : <p className="kw-muted">No required permission was declared by verified metadata.</p>}<h2>Trust</h2><EvidenceRows value={{ trust: item.trust }} /><h2>Integrity</h2><EvidenceRows value={{ integrity: item.integrity?.state, value: item.integrity?.value, source: item.integrity?.source }} /><h2>Freshness</h2><EvidenceRows value={{ freshness: item.freshness?.state, checkedAt: item.freshness?.at }} /><h2>Lifecycle</h2>{(item.lifecycle || []).length ? (item.lifecycle || []).slice(0, 12).map((stage: any) => <div className="kw-lifecycle" key={stage.id}><StatusBadge value={stage.state} /><span>{stage.label}</span></div>) : <p className="kw-muted">No lifecycle evidence is available.</p>}<h2>Actions</h2><div className="kw-operation-actions">{(context.action ? [context.action] : []).map((action) => <button key={action.id || action} disabled={action.disabled} title={action.reason} onClick={() => action.invoke?.()}>{action.label}</button>)}</div>{context.operation && <div className="kw-operation-result" role="status"><pre>{JSON.stringify(context.operation, null, 2)}</pre></div>}</div></aside>;
  }
  const currentContext = context || { kind: null };
  return <aside className="kw-inspector" aria-label="Context inspector"><div className="kw-inspector-scroll" tabIndex={0}><div className="kw-inspector-title"><StatusBadge value={activity} /><div><strong>Inspector</strong><small>{activityLabel(activity)} / {viewLabel(activity, view)}</small></div></div><h2>Project context</h2>{project ? <EvidenceRows value={project as unknown as RecordRow} /> : <p className="kw-muted">No project selected. Online compatibility remains NOT_EVALUATED.</p>}{execution && <><h2>Latest execution</h2><EvidenceRows value={execution as unknown as RecordRow} /></>}<h2>Workbench contract</h2><ul className="kw-contract"><li>One active capability surface</li><li>Explorer is scoped to the Activity</li><li>Inspector is contextual</li><li>Remote contact remains explicit</li></ul></div></aside>;
}

export function WorkbenchSurface(props: SurfaceProps) {
  if (props.activity === "projects") return <ProjectsSurface {...props} />;
  if (props.activity === "online") return <OnlineSurface {...props} />;
  if (props.activity === "ai") return <AISurface {...props} />;
  if (props.activity === "quality") return <QualitySurface {...props} />;
  if (props.activity === "developer-tools") return <DeveloperSurface {...props} />;
  if (props.activity === "remote") return <RemoteSurface {...props} />;
  if (props.activity === "release") return <ReleaseSurface {...props} />;
  if (props.activity === "system") return <SystemSurface {...props} />;
  return <IntelligenceSurface {...props} />;
}

export { InspectorContext, CanonicalInspector, WorkbenchSurface };

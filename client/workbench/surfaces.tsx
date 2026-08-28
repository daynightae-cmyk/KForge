import type { ReactNode } from "react";
import { activityLabel, viewLabel } from "./navigation";
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
import { EvidenceRows, StatusBadge } from "./ui";
import { KForgeInspector } from "@/components/ui/KForgeInspector";
import type { SurfaceProps, CanonicalInspectorProps, InspectorContext, RecordRow, MarketplaceItem } from "./surfaceContracts";

export { SURFACE_AUDIT_MATRIX, CANONICAL_INSPECTOR_OWNER, ONLINE_INSPECTOR_POLICY } from "./surfaceAudit";
export type { ProductSurfaceClass } from "./surfaceAudit";

function isMarketplaceItem(item: unknown): item is MarketplaceItem {
  return typeof item === "object" && item !== null && "id" in item && "name" in item;
}

export function CanonicalInspector(props: CanonicalInspectorProps) {
  const { activity, view, project, execution, context } = props;
  if (context?.kind === "online-item" && isMarketplaceItem(context.item)) {
    const item = context.item;
    const actions = context.actions ?? [];
    return <KForgeInspector context={context} operation={context.operation || null} />;
  }
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

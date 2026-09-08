import { lazy, Suspense } from "react";
import { activityLabel, viewLabel } from "./navigation";
import { EvidenceRows, StatusBadge } from "./ui";
import type { CanonicalInspectorProps, RecordRow } from "./surfaceContracts";

const OnlineItemInspector = lazy(() =>
  import("@/components/ui/KForgeInspector").then(({ KForgeInspector }) => ({ default: KForgeInspector })),
);
const PreviewRuntimeInspector = lazy(() => import("./PreviewRuntimeInspector"));

function InspectorLoading({ label = "Inspector" }: { label?: string }) {
  return (
    <aside className="kw-inspector" aria-label={`${label} loading`} aria-busy="true">
      <div className="kw-inspector-scroll" tabIndex={0}>
        <p className="kw-muted" role="status">Loading {label.toLowerCase()}…</p>
      </div>
    </aside>
  );
}

export default function CanonicalInspector(props: CanonicalInspectorProps) {
  const { activity, view, project, execution, context } = props;

  if (context?.kind === "online-item" && context.item && typeof context.item === "object") {
    return (
      <Suspense fallback={<InspectorLoading label="Online Inspector" />}>
        <OnlineItemInspector context={context} operation={context.operation || null} />
      </Suspense>
    );
  }

  if (context?.kind === "preview-runtime" && context.preview) {
    return (
      <Suspense fallback={<InspectorLoading label="Preview Inspector" />}>
        <PreviewRuntimeInspector {...props} />
      </Suspense>
    );
  }

  if (context?.kind === "topology-service" && context.service) {
    return (
      <aside className="kw-inspector" aria-label="Topology service Inspector">
        <div className="kw-inspector-scroll" tabIndex={0}>
          <div className="kw-inspector-title">
            <StatusBadge value={String(context.service.state || "UNKNOWN")} />
            <div>
              <strong>{context.title || "Topology service"}</strong>
              <small>{context.projectName || project?.name || "No project"}</small>
            </div>
          </div>
          <h2>Canonical service evidence</h2>
          <EvidenceRows value={context.service} />
          <h2>Topology session boundary</h2>
          {context.topologySession ? (
            <details>
              <summary>Session evidence</summary>
              <pre tabIndex={0}>{JSON.stringify(context.topologySession, null, 2)}</pre>
            </details>
          ) : (
            <p className="kw-muted">No execution session exists; discovery does not run project code.</p>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="kw-inspector" aria-label="Context inspector">
      <div className="kw-inspector-scroll" tabIndex={0}>
        <div className="kw-inspector-title">
          <StatusBadge value={activity} />
          <div>
            <strong>Inspector</strong>
            <small>{activityLabel(activity)} / {viewLabel(activity, view)}</small>
          </div>
        </div>
        <h2>Project context</h2>
        {project ? (
          <EvidenceRows value={project as unknown as RecordRow} />
        ) : (
          <p className="kw-message">No project selected. Online compatibility remains NOT_EVALUATED.</p>
        )}
        {execution && (
          <>
            <h2>Latest execution</h2>
            <EvidenceRows value={execution as unknown as RecordRow} />
          </>
        )}
        <h2>Workbench contract</h2>
        <ul className="kw-contract">
          <li>One active capability surface</li>
          <li>Explorer is scoped to the Activity</li>
          <li>Inspector is contextual</li>
          <li>Remote contact remains explicit</li>
        </ul>
      </div>
    </aside>
  );
}

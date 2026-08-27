import type { SurfaceProps } from "./surfaceContracts";
import { EmptyState } from "./ui";
import { viewLabel } from "./navigation";
import { SimpleFetchSurface } from "./surfaceShared";

function RemoteSurface({ view, project, onExecution }: SurfaceProps) {
  if (!project) return <EmptyState title="No project selected" detail="Git and GitHub evidence requires project context." />;
  return <SimpleFetchSurface url={["git", "branches", "commits"].includes(view) ? `/api/workspace/projects/${encodeURIComponent(project.id)}/git` : `/api/workspace/projects/${encodeURIComponent(project.id)}/github`} title={viewLabel("remote", view)} onError={(text) => onExecution({ label: viewLabel("remote", view), state: "UNAVAILABLE", source: "GitHub read-only adapter", message: text })} />;
}

export default RemoteSurface;

import { useState } from "react";
import type { SurfaceProps, RecordRow } from "./surfaceContracts";
import type { ProjectSummary } from "@shared/workspace";
import { fetchEvidence } from "./api";
import { EmptyState, StatusBadge } from "./ui";
import ReleaseDistributionWorkbench from "./ReleaseDistributionWorkbench";

function ReleaseSurface({ view, project, onExecution }: SurfaceProps) {
  if (!project) return <EmptyState title="No project selected" detail="Release evidence is project scoped." />;
  if (view === "release-gate") return <ReleaseGate project={project} onExecution={onExecution} />;
  if (view === "release-preparation" || view === "artifacts" || view === "versioning") return <ReleaseDistributionWorkbench project={project} view={view} />;
  return <EmptyState title="Specialized release surface unavailable" detail="This Release view has no canonical specialized implementation. KForge does not fall back to raw JSON as the primary release UX." />;
}

function ReleaseGate({ project, onExecution }: { project: ProjectSummary; onExecution: SurfaceProps["onExecution"] }) {
  const [data, setData] = useState<RecordRow | null>(null);
  const [message, setMessage] = useState("");
  const order = ["SOURCE", "LOCAL", "PREVIEW", "DESKTOP", "WINDOWS_PACKAGE", "INSTALLER", "GITHUB", "CI", "REMOTE"];

  const run = async () => {
    onExecution({ label: "Release Gate", state: "RUNNING", source: "KForge release evidence engine" });
    const response = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/release-gate`, { method: "POST" });
    if (response.data.verdicts) {
      setData(response.data);
      setMessage(response.ok ? "" : "Release Gate is blocked; independent source verdicts remain visible.");
      onExecution({ label: "Release Gate", state: String(response.data.readiness || "UNKNOWN"), source: "KForge release evidence engine" });
    } else {
      setMessage(String(response.data.error || "Release Gate failed."));
    }
  };

  const verdicts = (data?.verdicts || {}) as Record<string, RecordRow>;
  return <section className="kw-release-gate">
    <div className="kw-toolbar"><h2>Release Gate</h2><button onClick={() => void run()}>Run Release Gate</button></div>
    {message && <p className="kw-message" role="status">{message}</p>}
    {data ? <div className="kw-release-grid">{order.map((kind) => {
      const verdict = verdicts[kind] || {};
      return <article key={kind}><strong>{kind}</strong><StatusBadge value={verdict.state} /><p>{String(verdict.source || "No source evidence")}</p><small>{String(verdict.timestamp || "NO_TIMESTAMP")} · {String(verdict.freshness || "UNKNOWN")}</small><details><summary>Domain evidence</summary><pre>{JSON.stringify(verdict, null, 2)}</pre></details></article>;
    })}</div> : <EmptyState title="No release verification loaded" detail="Run the gate to collect independent evidence domains. A Windows PASS never implies CI PASS." />}
  </section>;
}

export default ReleaseSurface;

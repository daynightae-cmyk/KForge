import { useEffect, useState } from "react";
import type { SurfaceProps, RecordRow, TaskRow } from "./surfaceContracts";
import type { ProjectSummary } from "@shared/workspace";
import { fetchJson, fetchEvidence, jsonRequest, waitForTask } from "./api";
import { EmptyState, StatusBadge, EvidenceCards } from "./ui";
import { viewLabel } from "./navigation";
import QualityTriageWorkbench from "./QualityTriageWorkbench";
import DocumentationConsistencyWorkbench from "./DocumentationConsistencyWorkbench";
import SnapshotRecoveryWorkbench from "./SnapshotRecoveryWorkbench";
import SecurityQualityWorkbench from "./SecurityQualityWorkbench";
import PerformanceQualityWorkbench from "./PerformanceQualityWorkbench";
import TechnicalDebtWorkbench from "./TechnicalDebtWorkbench";

function QualitySurface({ view, project, onNavigate }: SurfaceProps) {
  if (!project) return <EmptyState title="No project selected" detail={`${viewLabel("quality", view)} needs project context.`} />;
  if (view === "problems" || view === "solutions") return <QualityTriageWorkbench project={project} view={view} onNavigate={onNavigate} />;
  if (view === "snapshots") return <SnapshotRecoveryWorkbench project={project} />;
  if (view === "documentation") return <DocumentationConsistencyWorkbench project={project} />;
  if (view === "security") return <SecurityQualityWorkbench project={project} />;
  if (view === "performance") return <PerformanceQualityWorkbench project={project} />;
  if (view === "technical-debt") return <TechnicalDebtWorkbench project={project} />;
  return <QualityEvidence project={project} view={view} />;
}

function QualityEvidence({ project, view }: { project: ProjectSummary; view: string }) {
  const [problems, setProblems] = useState<RecordRow[]>([]);
  const [tools, setTools] = useState<RecordRow[]>([]);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<RecordRow | null>(null);

  const refresh = async () => {
    try {
      const [p, s] = await Promise.all([
        fetchJson<{ problems: RecordRow[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/problems`),
        fetchJson<{ tools: RecordRow[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/security/tools`),
      ]);
      setProblems(p.problems || []);
      setTools(s.tools || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Quality evidence unavailable.");
    }
  };

  useEffect(() => { void refresh(); }, [project.id]);

  const runScan = async () => {
    setMessage("Running bounded KForge scan…");
    try {
      const started = await fetchJson<{ task: TaskRow }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/tasks`, jsonRequest({ action: "scan" }));
      const task = await waitForTask(started.task.id);
      setResult({ task });
      await refresh();
      setMessage("Current scan evidence loaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Scan failed.");
    }
  };

  const applyIssue = async (issue: RecordRow) => {
    const id = String(issue.id || "");
    if (!id) return;
    const preview = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/problems/${encodeURIComponent(id)}/preview`, jsonRequest({}));
    if (!preview.ok) {
      setResult({ issue: issue.title, previewState: "NOT_AVAILABLE", ...preview.data });
      return;
    }
    setResult({ issue: issue.title, preview: preview.data });
    if (!window.confirm(`Apply the reviewed deterministic fix for ${String(issue.title || id)} and verify it?`)) return;
    const applied = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/problems/${encodeURIComponent(id)}/apply`, jsonRequest({ confirmed: true, verify: true }));
    setResult({ issue: issue.title, preview: preview.data, applied: applied.data, status: applied.status });
    await refresh();
  };

  return (
    <section className="kw-surface-section">
      <div className="kw-toolbar">
        <h2>{view === "sonar" ? "KForge Sonar" : viewLabel("quality", view)}</h2>
        {view === "sonar" && <button onClick={() => void runScan()}>Run current scan</button>}
        <button onClick={() => void refresh()}>Refresh evidence</button>
      </div>
      {view === "sonar" && <p>No tool is downloaded or run silently. Security tools and scanner findings keep UNAVAILABLE/BLOCKED states when evidence is absent.</p>}
      {view === "sonar" ? <><h3>Security Tool Manager</h3><EvidenceCards rows={tools} /></> : null}
      <h3>Current normalized findings</h3>
      {problems.length ? (
        <div className="kw-quality-list">
          {problems.map((issue, index) => (
            <article className="kw-quality-card" key={String(issue.id || index)}>
              <h2>{String(issue.title || `Finding ${index + 1}`)}</h2>
              <div className="kw-row-badges"><StatusBadge value={issue.severity} /><StatusBadge value={issue.category} /></div>
              <p>{String(issue.description || issue.risk || "No description")}</p>
              <small>{String(issue.file || issue.source || "Local scanner evidence")}</small>
              {["problems", "solutions"].includes(view) && <div className="kw-quality-actions"><button onClick={() => void applyIssue(issue)}>Preview verified fix</button></div>}
              <details><summary>Finding evidence</summary><pre>{JSON.stringify(issue, null, 2)}</pre></details>
            </article>
          ))}
        </div>
      ) : <EmptyState title="No matching scan evidence" detail="The current local scan produced no finding for this view; KForge does not invent one." />}
      {message && <p className="kw-message" role="status">{message}</p>}
      {result && <div className="kw-operation-result"><pre>{JSON.stringify(result, null, 2)}</pre></div>}
    </section>
  );
}

export default QualitySurface;

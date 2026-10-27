import { useEffect, useMemo, useState } from "react";
import type { SurfaceProps, RecordRow, TaskRow } from "./surfaceContracts";
import type { ProjectSummary } from "@shared/workspace";
import { fetchJson, fetchEvidence, jsonRequest, waitForTask } from "./api";
import { EmptyState, StatusBadge } from "./ui";
import { Gauge, Layers, ShieldCheck, TriangleAlert } from "lucide-react";
import { viewLabel } from "./navigation";
import QualityTriageWorkbench from "./QualityTriageWorkbench";
import DocumentationConsistencyWorkbench from "./DocumentationConsistencyWorkbench";
import SnapshotRecoveryWorkbench from "./SnapshotRecoveryWorkbench";
import SecurityQualityWorkbench from "./SecurityQualityWorkbench";
import PerformanceQualityWorkbench from "./PerformanceQualityWorkbench";
import TechnicalDebtWorkbench from "./TechnicalDebtWorkbench";
import { ProjectRequired } from "./ProjectStartActions";

function QualitySurface({ view, project, onNavigate }: SurfaceProps) {
  if (!project) return <ProjectRequired detail={`${viewLabel("quality", view)} needs project context.`} />;
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
  const [scannedAt, setScannedAt] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<RecordRow | null>(null);

  const refresh = async () => {
    try {
      const [p, s] = await Promise.all([
        fetchJson<{ problems: RecordRow[]; scannedAt?: string }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/problems`),
        fetchJson<{ tools: RecordRow[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/security/tools`),
      ]);
      setProblems(p.problems || []);
      setScannedAt(p.scannedAt || "");
      setTools(s.tools || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Quality evidence unavailable.");
    } finally {
      setLoaded(true);
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

  const severityCounts = useMemo(() => {
    const normalize = (value: unknown) => String(value || "unknown").toLowerCase();
    return {
      critical: problems.filter((issue) => ["critical", "blocker"].includes(normalize(issue.severity))).length,
      high: problems.filter((issue) => ["high", "major"].includes(normalize(issue.severity))).length,
      medium: problems.filter((issue) => ["medium", "moderate"].includes(normalize(issue.severity))).length,
      low: problems.filter((issue) => ["low", "minor", "info"].includes(normalize(issue.severity))).length,
      unknown: problems.filter((issue) => !["critical", "blocker", "high", "major", "medium", "moderate", "low", "minor", "info"].includes(normalize(issue.severity))).length,
    };
  }, [problems]);
  const availableTools = tools.filter((tool) => tool.available === true || String(tool.state || "").toUpperCase() === "AVAILABLE").length;
  const total = Math.max(problems.length, 1);

  return <div className="kf-stack kw-sonar" aria-label="KForge Sonar">
    <header className="kf-hero-band kw-sonar-banner">
      <div className="kw-sonar-banner__copy"><small>QUALITY INTELLIGENCE</small><h2>KForge Sonar</h2><p>No tool is downloaded or run silently. Security tools and scanner findings keep UNAVAILABLE/BLOCKED states when evidence is absent.</p></div>
      <div className="kw-sonar-banner__actions">
        <span className="kf-chip">{!loaded ? "Analyzing local evidence…" : scannedAt ? `Scan ${new Date(scannedAt).toLocaleString()}` : "No scan timestamp"}</span>
        <button className="kf-btn" onClick={() => void refresh()}>Refresh evidence</button>
        <button className="kf-btn kf-btn--primary" onClick={() => void runScan()}>Run current scan</button>
      </div>
    </header>

    <section className="kf-stat-grid" aria-label="Quality findings summary">
      <article className="kf-stat"><span className="kf-tile kf-tile--red"><ShieldCheck size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Normalized findings</span><strong className="kf-stat__value">{loaded ? problems.length : "…"}</strong><span className="kf-stat__foot">{loaded ? `${severityCounts.critical + severityCounts.high} critical / high` : "Reading findings…"}</span></div></article>
      <article className="kf-stat"><span className="kf-tile kf-tile--amber"><TriangleAlert size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Elevated severity</span><strong className="kf-stat__value">{loaded ? severityCounts.high + severityCounts.medium : "…"}</strong><span className="kf-stat__foot">{loaded ? `${severityCounts.high} high · ${severityCounts.medium} medium` : "Reading severity…"}</span></div></article>
      <article className="kf-stat"><span className="kf-tile"><ShieldCheck size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Security tools</span><strong className="kf-stat__value">{loaded ? availableTools : "…"}<small> / {loaded ? tools.length : "…"}</small></strong><span className="kf-stat__foot">{loaded ? "Explicit availability evidence" : "Reading tool evidence…"}</span></div></article>
      <article className="kf-stat"><span className="kf-tile kf-tile--blue"><Gauge size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Last scan</span><strong className="kf-stat__value" style={{ fontSize: 16 }}>{!loaded ? "…" : scannedAt ? new Date(scannedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "NOT_SCANNED"}</strong><span className="kf-stat__foot">{!loaded ? "Reading scan timestamp…" : scannedAt ? `${new Date(scannedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · bounded local analysis` : "Bounded local analysis"}</span></div></article>
    </section>

    <div className="kw-sonar-layout">
      <section className="kf-card" aria-label="Severity distribution">
        <header className="kf-card__head"><div className="kf-card__title"><span className="kf-tile kf-tile--amber"><Layers size={17} /></span><div><h2>Severity distribution</h2><p>Normalized local findings by severity.</p></div></div><span className="kf-chip">{loaded ? `${problems.length} findings` : "Reading"}</span></header>
        <div className="kw-sonar-bars">{!loaded ? <p className="kw-message">Running the bounded local quality analysis…</p> : ([["Critical", severityCounts.critical, "critical"], ["High", severityCounts.high, "high"], ["Medium", severityCounts.medium, "medium"], ["Low / info", severityCounts.low, "low"], ["Unknown", severityCounts.unknown, "unknown"]] as const).map(([label, count, kind]) => <div className="kw-sonar-bar" key={kind}><span>{label}</span><div className="kf-progress"><i data-kind={kind} style={{ width: `${Math.round((count / total) * 100)}%` }} /></div><strong>{count}</strong></div>)}</div>
      </section>
      <section className="kf-card" aria-label="Security Tool Manager">
        <header className="kf-card__head"><div className="kf-card__title"><span className="kf-tile"><ShieldCheck size={17} /></span><div><h2>Security Tool Manager</h2><p>Tool availability and execution state.</p></div></div></header>
        <div className="kf-card__body">{!loaded ? <p className="kf-muted">Reading security tool availability and blocked reasons…</p> : tools.length ? <div className="kw-sonar-tools">{tools.slice(0, 6).map((tool, index) => <article key={String(tool.id || tool.name || index)}><StatusBadge value={tool.available === true ? "AVAILABLE" : tool.state || "UNAVAILABLE"} /><div><strong>{String(tool.name || tool.id || `Tool ${index + 1}`)}</strong><small>{String(tool.version || tool.reason || tool.detail || "No version evidence recorded.")}</small></div></article>)}</div> : <p className="kf-muted">No security tool is registered as available. KForge does not invent a scanner.</p>}</div>
      </section>
    </div>

    <section className="kf-card" aria-label="Current normalized findings">
      <header className="kf-card__head"><div className="kf-card__title"><span className="kf-tile kf-tile--red"><ShieldCheck size={17} /></span><div><h2>Current normalized findings</h2><p>Security, maintainability and correctness evidence from the current bounded scan.</p></div></div></header>
      {!loaded ? <div className="kf-card__body"><p className="kw-message">Reading normalized findings, tool availability and scan coverage…</p></div> : problems.length ? <div className="kw-sonar-findings">{problems.map((issue, index) => (
        <article className="kw-sonar-finding" key={String(issue.id || index)}>
          <span className={`kw-sonar-finding__severity is-${String(issue.severity || "unknown").toLowerCase()}`} aria-hidden="true" />
          <div className="kw-sonar-finding__main">
            <div className="kw-sonar-finding__title"><strong>{String(issue.title || `Finding ${index + 1}`)}</strong><StatusBadge value={issue.severity} /><StatusBadge value={issue.category} /></div>
            <p>{String(issue.description || issue.risk || "No description")}</p>
            <small>{String(issue.file || issue.source || "Local scanner evidence")}{issue.rule ? ` · ${String(issue.rule)}` : ""}</small>
          </div>
          <div className="kw-sonar-finding__actions">
            {["problems", "solutions"].includes(view) ? <button className="kf-btn" onClick={() => void applyIssue(issue)}>Preview verified fix</button> : null}
            <details><summary>Evidence</summary><pre>{JSON.stringify(issue, null, 2)}</pre></details>
          </div>
        </article>
      ))}</div> : <div className="kf-card__body"><EmptyState title="No matching scan evidence" detail="The current local scan produced no finding for this view; KForge does not invent one." /></div>}
    </section>

    {message && <p className="kw-message" role="status">{message}</p>}
    {result && <div className="kw-operation-result"><pre>{JSON.stringify(result, null, 2)}</pre></div>}
  </div>;
}

export default QualitySurface;

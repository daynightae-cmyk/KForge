import { useEffect, useMemo, useState } from "react";
import type { BoundedEvidenceCoverage, ProjectHealth, ProjectSummary, ReleaseDecisionState, ToolAvailability, WorkspaceStatus } from "@shared/workspace";
import type { SurfaceProps } from "./surfaceContracts";
import { fetchJson } from "./api";
import { AdvancedEvidence, EmptyState, StatusBadge } from "./ui";
import { Activity, CalendarClock, Gauge, GitBranch, HeartPulse, ShieldCheck } from "lucide-react";
import { ProjectRequired } from "./ProjectStartActions";

type PersistedHealthSummary = {
  path: string;
  scannedAt: string;
  score: number | null;
  evidenceCoverage: number;
  releaseState: ReleaseDecisionState;
  securityStatus: WorkspaceStatus;
  buildStatus: WorkspaceStatus;
  testStatus: WorkspaceStatus;
  source: "persisted-project-health";
};

type HealthResponse = {
  projectId: string;
  health: ProjectHealth;
  scannedAt: string;
  issueCount: number;
  coverage: Record<string, BoundedEvidenceCoverage>;
  tools: ToolAvailability[];
  persistedSummary: PersistedHealthSummary;
};

type HealthEvidenceResponse = { summaries: PersistedHealthSummary[] };

function ProjectHealthWorkbench({ project, onRefresh }: { project?: ProjectSummary; onRefresh: SurfaceProps["onRefresh"] }) {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [persisted, setPersisted] = useState<PersistedHealthSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("No health scan has been run from this Workbench session.");

  useEffect(() => {
    setData(null);
    setPersisted(null);
    setRunning(false);
    setMessage("No health scan has been run from this Workbench session.");
    if (!project) return;
    void fetchJson<HealthEvidenceResponse>("/api/workspace/projects/health-evidence")
      .then((response) => setPersisted(response.summaries.find((entry) => entry.path === project.path) || null))
      .catch(() => setPersisted(null));
  }, [project?.id, project?.path]);

  const runHealthScan = async () => {
    if (!project || running) return;
    setRunning(true);
    setMessage("Running the explicitly requested bounded Project Health scan…");
    try {
      const result = await fetchJson<HealthResponse>(`/api/workspace/projects/${encodeURIComponent(project.id)}/health/scan`, { method: "POST" });
      setData(result);
      setPersisted(result.persistedSummary);
      setMessage(`Project Health scan recorded ${result.issueCount} finding(s) and persisted its bounded summary locally. UNKNOWN and unavailable evidence remain explicit.`);
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Project Health scan failed.");
    } finally {
      setRunning(false);
    }
  };

  const summary = useMemo(() => {
    const metrics = data?.health.metrics || [];
    return {
      pass: metrics.filter((entry) => entry.status === "pass").length,
      warning: metrics.filter((entry) => entry.status === "warning").length,
      fail: metrics.filter((entry) => entry.status === "fail").length,
      unknown: metrics.filter((entry) => ["unknown", "unavailable"].includes(entry.status)).length,
    };
  }, [data]);

  if (!project) return <ProjectRequired detail="Project Health is project-scoped. Select a local project before running a bounded scan." />;

  return <section className="space-y-4" aria-label="KForge Project Health Workbench" data-health-scan-state={running ? "RUNNING" : data ? "SCANNED" : "NOT_RUN_THIS_SESSION"}>
    <header className="kf-hero-band kw-health-banner">
      <div className="kw-health-banner__copy">
        <small>LOCAL PROJECT HEALTH</small>
        <h2>{project.name}</h2>
        <p><span>{project.path}</span><code>{project.branch || "NO_GIT"}</code><StatusBadge value={project.trust} /></p>
      </div>
      <div className="kw-health-banner__actions">
        <StatusBadge value={data ? data.health.release.state : persisted?.releaseState || "NOT_RUN_THIS_SESSION"} />
        <button className="kf-btn kf-btn--primary" onClick={() => void runHealthScan()} disabled={running}><HeartPulse size={14} />{running ? "Scanning…" : "Run Project Health scan"}</button>
      </div>
    </header>
    <p className="kw-health-note">Opening this surface reads persisted local summary evidence only; it never starts a scan. A fresh health calculation runs only after explicit execution.</p>

    <section className="kf-stat-grid" aria-label="Project health prior evidence">
      <article className="kf-stat"><span className="kf-tile"><CalendarClock size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Persisted evidence</span><strong className="kf-stat__value" style={{ fontSize: 16 }}>{persisted?.scannedAt ? new Date(persisted.scannedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "NEVER"}</strong><span className="kf-stat__foot">{persisted?.scannedAt ? `persisted-project-health · ${new Date(persisted.scannedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : "No persisted summary"}</span></div></article>
      <article className="kf-stat"><span className="kf-tile"><Gauge size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Persisted health score</span><strong className="kf-stat__value">{persisted?.score ?? "—"}<small>{persisted ? " / 100" : " not scanned"}</small></strong><span className="kf-stat__foot">{persisted ? <StatusBadge value={persisted.releaseState} /> : "Run a scan to calculate"}</span></div></article>
      <article className="kf-stat"><span className="kf-tile kf-tile--green"><ShieldCheck size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Trust</span><span className="kw-health-badge"><StatusBadge value={project.trust} /></span><span className="kf-stat__foot">Execution remains permission-gated</span></div></article>
      <article className="kf-stat"><span className="kf-tile kf-tile--amber"><GitBranch size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Git working changes</span><strong className="kf-stat__value">{project.modifiedFiles + project.untrackedFiles}<small> files</small></strong><span className="kf-stat__foot">{project.ahead} ahead · {project.behind} behind</span></div></article>
    </section>

    {!data ? <EmptyState title="No current-session health evidence" detail={persisted ? "A persisted summary is visible above, but it is not promoted to a fresh current-session scan. Run Project Health explicitly to refresh metrics, coverage and release evidence." : "Run Project Health scan explicitly to calculate metrics, evidence coverage, release readiness and source freshness. KForge does not manufacture a score from stale or unrelated state."} /> : <>
      <section className="kf-stat-grid" aria-label="Project health summary">
        <article className="kf-stat"><span className="kf-tile"><HeartPulse size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Health score</span><strong className="kf-stat__value">{data.health.score ?? "UNKNOWN"}</strong><span className="kf-stat__foot">Bounded calculation</span></div></article>
        <article className="kf-stat"><span className="kf-tile"><Activity size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Evidence coverage</span><strong className="kf-stat__value">{data.health.evidenceCoverage}<small>%</small></strong><span className="kf-stat__foot">Measured evidence share</span></div></article>
        <article className="kf-stat"><span className="kf-tile kf-tile--green"><ShieldCheck size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Passed metrics</span><strong className="kf-stat__value">{summary.pass}</strong><span className="kf-stat__foot">Current scan</span></div></article>
        <article className="kf-stat kw-stat-warn"><span className="kf-tile kf-tile--amber"><Gauge size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Warning / failed</span><strong className="kf-stat__value">{summary.warning + summary.fail}</strong><span className="kf-stat__foot">Needs review</span></div></article>
        <article className="kf-stat"><span className="kf-tile kf-tile--blue"><GitBranch size={18} /></span><div className="kf-stat__body"><span className="kf-stat__label">Unknown / unavailable</span><strong className="kf-stat__value">{summary.unknown}</strong><span className="kf-stat__foot">Never promoted to pass</span></div></article>
      </section>

      <section className="rounded-lg border bg-card p-4" aria-label="Project health metrics">
        <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Measured health metrics</h3><span className="text-xs text-muted-foreground">Scanned {data.scannedAt}</span></div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">{data.health.metrics.map((metric) => <article key={metric.key} className="rounded-md border p-3 text-xs"><div className="flex flex-wrap items-center gap-2"><strong className="mr-auto">{metric.label}</strong><StatusBadge value={metric.status} /><span>{metric.score ?? "UNKNOWN"}</span></div><dl className="mt-3 grid gap-2 sm:grid-cols-2"><div><dt className="text-muted-foreground">Freshness</dt><dd>{metric.freshness}</dd></div><div><dt className="text-muted-foreground">Evidence source</dt><dd>{metric.evidenceSource}</dd></div><div><dt className="text-muted-foreground">Weight</dt><dd>{metric.weight}</dd></div><div><dt className="text-muted-foreground">Evidence age</dt><dd>{metric.evidenceAgeMs} ms</dd></div></dl>{metric.evidence.length ? <p className="mt-2 text-muted-foreground">{metric.evidence.slice(0, 3).join(" · ")}</p> : <p className="mt-2 text-muted-foreground">No positive evidence recorded.</p>}{metric.findings.length ? <ul className="mt-2 list-disc pl-4 text-muted-foreground">{metric.findings.slice(0, 4).map((finding) => <li key={finding}>{finding}</li>)}</ul> : null}</article>)}</div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border bg-card p-4" aria-label="Project health release decision"><div className="flex items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Release decision</h3><StatusBadge value={data.health.release.state} /></div><p className="mt-3 text-xs text-muted-foreground">Release readiness is evidence-driven. Missing checks remain blockers or warnings according to the calculated health contract.</p>{data.health.release.blockers.length ? <ul className="mt-3 list-disc pl-4 text-xs">{data.health.release.blockers.map((entry, index) => <li key={`${entry.title}:${index}`}>{entry.title} · {entry.source}</li>)}</ul> : <p className="mt-3 text-xs">No release blockers recorded by this health calculation.</p>}{data.health.release.warnings.length ? <ul className="mt-3 list-disc pl-4 text-xs text-muted-foreground">{data.health.release.warnings.map((entry, index) => <li key={`${entry.title}:${index}`}>{entry.title} · {entry.source}</li>)}</ul> : null}</section>
        <section className="rounded-lg border bg-card p-4" aria-label="Project health evidence sources"><h3 className="text-sm font-semibold">Evidence sources</h3><div className="mt-3 grid gap-2">{Object.values(data.health.sources).map((source) => <article key={source.kind} className="rounded-md border p-3 text-xs"><div className="flex items-center gap-2"><strong className="mr-auto">{source.kind}</strong><StatusBadge value={source.state} /></div><dl className="mt-2 grid gap-1"><div><dt className="text-muted-foreground">Freshness</dt><dd>{source.freshness}</dd></div><div><dt className="text-muted-foreground">Network</dt><dd>{source.network}</dd></div><div><dt className="text-muted-foreground">Provider</dt><dd>{source.provider}</dd></div><div><dt className="text-muted-foreground">Timestamp</dt><dd>{source.timestamp || "NOT_AVAILABLE"}</dd></div></dl>{source.blocker ? <p className="mt-2 text-muted-foreground">{source.blocker}</p> : null}</article>)}</div></section>
      </div>

      <section className="rounded-lg border bg-card p-4" aria-label="Project health coverage and tools"><div className="grid gap-4 lg:grid-cols-2"><div><h3 className="text-sm font-semibold">Bounded scan coverage</h3><div className="mt-3 grid gap-2">{Object.entries(data.coverage).map(([key, coverage]) => <article key={key} className="rounded-md border p-3 text-xs"><div className="flex items-center gap-2"><strong className="mr-auto">{key}</strong><StatusBadge value={coverage.state} /></div><p className="mt-2 text-muted-foreground">{coverage.scannedCount} scanned · limit {coverage.limit} · {coverage.reason}</p></article>)}</div></div><div><h3 className="text-sm font-semibold">Tool availability</h3><div className="mt-3 grid gap-2">{data.tools.map((tool) => <article key={tool.name} className="rounded-md border p-3 text-xs"><div className="flex items-center gap-2"><strong className="mr-auto">{tool.name}</strong><StatusBadge value={tool.available ? "AVAILABLE" : "UNAVAILABLE"} /></div><p className="mt-2 text-muted-foreground">{tool.version || tool.reason || "No version evidence recorded."}</p></article>)}</div></div></div><div className="mt-4"><AdvancedEvidence value={data} label="Advanced · Raw Project Health evidence" /></div></section>
    </>}

    {message && <p className="kw-message" role="status">{message}</p>}
  </section>;
}

export default ProjectHealthWorkbench;

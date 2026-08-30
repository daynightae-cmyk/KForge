import { useEffect, useMemo, useState } from "react";
import type { BoundedEvidenceCoverage, ProjectHealth, ProjectSummary, ToolAvailability } from "@shared/workspace";
import type { SurfaceProps } from "./surfaceContracts";
import { fetchJson } from "./api";
import { AdvancedEvidence, EmptyState, StatusBadge } from "./ui";

type HealthResponse = {
  projectId: string;
  health: ProjectHealth;
  scannedAt: string;
  issueCount: number;
  coverage: Record<string, BoundedEvidenceCoverage>;
  tools: ToolAvailability[];
};

function ProjectHealthWorkbench({ project, onRefresh }: { project?: ProjectSummary; onRefresh: SurfaceProps["onRefresh"] }) {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("No health scan has been run from this Workbench session.");

  useEffect(() => {
    setData(null);
    setRunning(false);
    setMessage("No health scan has been run from this Workbench session.");
  }, [project?.id]);

  const runHealthScan = async () => {
    if (!project || running) return;
    setRunning(true);
    setMessage("Running the bounded local Project Health scan…");
    try {
      const result = await fetchJson<HealthResponse>(`/api/workspace/projects/${encodeURIComponent(project.id)}/health`);
      setData(result);
      setMessage(`Project Health scan recorded ${result.issueCount} finding(s). UNKNOWN and unavailable evidence remain explicit.`);
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

  if (!project) return <EmptyState title="No project selected" detail="Project Health is project-scoped. Select a local project before running a bounded scan." />;

  return <section className="space-y-4" aria-label="KForge Project Health Workbench" data-health-scan-state={running ? "RUNNING" : data ? "SCANNED" : "NOT_RUN_THIS_SESSION"}>
    <header className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold">Project Health Workbench</h2>
        <p className="mt-1 text-xs text-muted-foreground">Opening this surface does not run a scan. Health evidence is created only after explicit execution and is never inferred from project discovery alone.</p>
      </div>
      <StatusBadge value={data ? data.health.release.state : "NOT_RUN_THIS_SESSION"} />
      <button onClick={() => void runHealthScan()} disabled={running}>{running ? "Scanning…" : "Run Project Health scan"}</button>
    </header>

    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Project health prior evidence">
      <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Last recorded scan</span><strong className="mt-1 block text-sm">{project.lastScannedAt || "NEVER"}</strong></article>
      <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Summary health score</span><strong className="mt-1 block text-sm">{project.healthScore ?? "NOT_CALCULATED_IN_SUMMARY"}</strong></article>
      <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Trust</span><div className="mt-1"><StatusBadge value={project.trust} /></div></article>
      <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Git working changes</span><strong className="mt-1 block text-sm">{project.modifiedFiles + project.untrackedFiles}</strong></article>
    </section>

    {!data ? <EmptyState title="No current-session health evidence" detail="Run Project Health scan explicitly to calculate metrics, evidence coverage, release readiness and source freshness. KForge does not manufacture a score from stale or unrelated state." /> : <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Project health summary">
        <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Health score</span><strong className="mt-1 block text-lg">{data.health.score ?? "UNKNOWN"}</strong></article>
        <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Coverage</span><strong className="mt-1 block text-lg">{data.health.evidenceCoverage}%</strong></article>
        <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Passed metrics</span><strong className="mt-1 block text-lg">{summary.pass}</strong></article>
        <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Warning / failed</span><strong className="mt-1 block text-lg">{summary.warning + summary.fail}</strong></article>
        <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Unknown / unavailable</span><strong className="mt-1 block text-lg">{summary.unknown}</strong></article>
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

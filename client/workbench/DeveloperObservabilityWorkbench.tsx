import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CircleAlert, Clock3, RefreshCcw, Search, ScrollText, Stethoscope } from "lucide-react";
import type { ProjectHealth, ProjectSummary, ScanIssue } from "@shared/workspace";
import type { SurfaceProps } from "./surfaceContracts";
import { fetchJson } from "./api";
import { AdvancedEvidence, EmptyState, StatusBadge } from "./ui";

type TaskKind = "scan" | "audit" | "test" | "build" | "typecheck" | "runtime" | "git" | "github" | "clone" | "agent" | "snapshot";
type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "blocked" | "retrying";
type TaskLog = { at: string; message: string; stream: "system" | "stdout" | "stderr" };

type DeveloperTask = {
  id: string;
  projectId: string;
  kind: TaskKind;
  status: TaskStatus;
  progress: number;
  logs: TaskLog[];
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number;
  error?: string;
  output?: string;
  artifacts?: string[];
  retryOf?: string;
  interrupted?: boolean;
};

type TasksResponse = { tasks: DeveloperTask[] };
type ProblemsResponse = {
  projectId: string;
  scannedAt: string;
  problems: ScanIssue[];
  health: ProjectHealth;
  coverage: unknown;
};

type Props = Pick<SurfaceProps, "view" | "project" | "onExecution">;

const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40";
const fieldClass = "h-9 rounded-md border border-border bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-ring";

function formatDate(value?: string) {
  if (!value) return "UNKNOWN";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function formatDuration(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "RUNNING / UNKNOWN";
  if (value < 1_000) return `${Math.max(0, Math.round(value))} ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`;
}

function taskEvidence(task: DeveloperTask) {
  return task.error || task.logs.at(-1)?.message || task.output || "No output was persisted for this task.";
}

function severityRank(value: ScanIssue["severity"]) {
  return ({ critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const)[value] ?? 5;
}

function DeveloperLogs({ project, onExecution }: { project: ProjectSummary; onExecution: SurfaceProps["onExecution"] }) {
  const [tasks, setTasks] = useState<DeveloperTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const endpoint = `/api/workspace/tasks?projectId=${encodeURIComponent(project.id)}`;

  const load = useCallback(async (explicit = false) => {
    if (explicit) {
      setRefreshing(true);
      onExecution({ label: "Refresh developer task evidence", state: "RUNNING", source: "Persisted local task store" });
    }
    try {
      const response = await fetchJson<TasksResponse>(endpoint);
      setTasks(response.tasks || []);
      setSelectedId((current) => current && response.tasks.some((task) => task.id === current) ? current : response.tasks[0]?.id || "");
      setNotice("");
      if (explicit) onExecution({ label: "Refresh developer task evidence", state: "PASS", source: "Persisted local task store", message: `${response.tasks.length} task record(s) loaded.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Task evidence unavailable.";
      setNotice(message);
      if (explicit) onExecution({ label: "Refresh developer task evidence", state: "FAILED", source: "Persisted local task store", message });
    } finally {
      setLoading(false);
      if (explicit) setRefreshing(false);
    }
  }, [endpoint, onExecution]);

  useEffect(() => {
    setLoading(true);
    setTasks([]);
    setSelectedId("");
    setNotice("");
    void load(false);
  }, [load, project.id]);

  const kinds = useMemo(() => [...new Set(tasks.map((task) => task.kind))].sort(), [tasks]);
  const statuses = useMemo(() => [...new Set(tasks.map((task) => task.status))].sort(), [tasks]);
  const visible = useMemo(() => tasks.filter((task) => {
    const haystack = `${task.kind} ${task.status} ${task.error || ""} ${task.output || ""} ${task.logs.map((entry) => entry.message).join(" ")}`.toLowerCase();
    return (kind === "all" || task.kind === kind) && (status === "all" || task.status === status) && (!query.trim() || haystack.includes(query.trim().toLowerCase()));
  }), [kind, query, status, tasks]);
  const selected = tasks.find((task) => task.id === selectedId) || visible[0] || null;
  const active = tasks.filter((task) => ["queued", "running", "retrying"].includes(task.status)).length;
  const failed = tasks.filter((task) => ["failed", "blocked"].includes(task.status)).length;

  if (loading) return <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground" role="status">Loading persisted developer task evidence…</div>;

  return <section className="space-y-4" aria-label="KForge Developer Logs">
    <header className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
      <ScrollText size={16} />
      <div className="mr-auto min-w-0"><h2 className="text-sm font-semibold">Developer Logs</h2><p className="mt-1 text-xs text-muted-foreground">Persisted local task evidence for {project.name}. This surface performs no remote contact.</p></div>
      <span className="rounded-md bg-muted px-2 py-1 text-[11px]">{tasks.length} total</span>
      <span className="rounded-md bg-muted px-2 py-1 text-[11px]">{active} active</span>
      <span className="rounded-md bg-muted px-2 py-1 text-[11px]">{failed} failed/blocked</span>
      <button className={buttonClass} onClick={() => void load(true)} disabled={refreshing}><RefreshCcw size={13} className={refreshing ? "animate-spin" : ""} />Refresh logs</button>
    </header>

    {notice && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs" role="alert">{notice}</div>}

    <div className="flex flex-wrap gap-2 rounded-lg border bg-card p-3" role="search" aria-label="Developer log filters">
      <label className="relative min-w-[220px] flex-1"><Search size={13} className="pointer-events-none absolute left-3 top-3 text-muted-foreground" /><span className="sr-only">Search developer logs</span><input className={`${fieldClass} w-full pl-8`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search kind, state, error or output" /></label>
      <label><span className="sr-only">Task kind</span><select className={fieldClass} value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">All kinds</option>{kinds.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label>
      <label><span className="sr-only">Task status</span><select className={fieldClass} value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All states</option>{statuses.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label>
    </div>

    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
      <section className="min-w-0 overflow-hidden rounded-lg border bg-card" aria-label="Persisted developer tasks">
        <div className="flex items-center gap-2 border-b px-4 py-3"><Activity size={14} /><h3 className="text-sm font-semibold">Persisted tasks</h3><span className="text-xs text-muted-foreground">{visible.length} visible</span></div>
        {visible.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-muted/40 text-muted-foreground"><tr><th className="px-4 py-2 font-medium">Kind</th><th className="px-3 py-2 font-medium">State</th><th className="px-3 py-2 font-medium">Progress</th><th className="px-3 py-2 font-medium">Started</th><th className="px-3 py-2 font-medium">Duration</th><th className="px-3 py-2 font-medium">Evidence</th></tr></thead><tbody className="divide-y">{visible.map((task) => <tr key={task.id} data-task-kind={task.kind} className={task.id === selected?.id ? "bg-muted/40" : "hover:bg-muted/20"}><td className="px-4 py-3"><button className="font-mono font-semibold hover:underline" onClick={() => setSelectedId(task.id)} aria-label={`Inspect ${task.kind} task`}>{task.kind}</button></td><td className="px-3 py-3"><StatusBadge value={task.status} /></td><td className="px-3 py-3">{task.progress}%</td><td className="px-3 py-3">{formatDate(task.startedAt)}</td><td className="px-3 py-3">{formatDuration(task.durationMs)}</td><td className="max-w-[360px] truncate px-3 py-3" title={taskEvidence(task)}>{taskEvidence(task)}</td></tr>)}</tbody></table></div> : <p className="p-5 text-sm text-muted-foreground">No persisted task evidence matches the current filters.</p>}
      </section>

      <aside className="min-w-0 rounded-lg border bg-card p-4" aria-label="Selected task evidence">
        {selected ? <><div className="flex items-start gap-2"><Clock3 size={14} className="mt-0.5 shrink-0" /><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">{selected.kind} task</h3><code className="mt-1 block truncate text-[10px] text-muted-foreground" title={selected.id}>{selected.id}</code></div><StatusBadge value={selected.status} /></div><dl className="mt-4 grid gap-2 text-xs"><div><dt className="text-muted-foreground">Started</dt><dd>{formatDate(selected.startedAt)}</dd></div><div><dt className="text-muted-foreground">Finished</dt><dd>{formatDate(selected.finishedAt)}</dd></div><div><dt className="text-muted-foreground">Duration</dt><dd>{formatDuration(selected.durationMs)}</dd></div><div><dt className="text-muted-foreground">Exit code</dt><dd>{selected.exitCode ?? "NOT_RECORDED"}</dd></div></dl><h4 className="mt-4 text-xs font-semibold">Recorded log stream</h4>{selected.logs.length ? <ol className="mt-2 max-h-72 space-y-2 overflow-auto pr-1 text-[11px]">{selected.logs.slice(-30).map((entry, index) => <li key={`${entry.at}:${index}`} className="rounded-md bg-muted/40 p-2"><div className="mb-1 flex items-center gap-2"><StatusBadge value={entry.stream} /><time className="text-muted-foreground" dateTime={entry.at}>{formatDate(entry.at)}</time></div><pre className="whitespace-pre-wrap break-words font-mono">{entry.message}</pre></li>)}</ol> : <p className="mt-2 text-xs text-muted-foreground">No log lines were persisted.</p>}<div className="mt-4"><AdvancedEvidence value={selected} label="Advanced · Raw persisted task record" /></div></> : <p className="text-sm text-muted-foreground">Select a task to inspect its persisted evidence.</p>}
      </aside>
    </div>
  </section>;
}

function DeveloperDiagnostics({ project, onExecution }: { project: ProjectSummary; onExecution: SurfaceProps["onExecution"] }) {
  const [data, setData] = useState<ProblemsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("all");
  const [category, setCategory] = useState("all");
  const endpoint = `/api/workspace/projects/${encodeURIComponent(project.id)}/problems`;

  const load = useCallback(async (explicit = false) => {
    if (explicit) {
      setRefreshing(true);
      onExecution({ label: "Refresh project diagnostics", state: "RUNNING", source: "KForge project scan engine" });
    }
    try {
      const response = await fetchJson<ProblemsResponse>(endpoint);
      setData(response);
      setNotice("");
      if (explicit) onExecution({ label: "Refresh project diagnostics", state: "PASS", source: "KForge project scan engine", message: `${response.problems.length} diagnostic finding(s) loaded from the current scan.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Project diagnostics unavailable.";
      setNotice(message);
      if (explicit) onExecution({ label: "Refresh project diagnostics", state: "FAILED", source: "KForge project scan engine", message });
    } finally {
      setLoading(false);
      if (explicit) setRefreshing(false);
    }
  }, [endpoint, onExecution]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setNotice("");
    void load(false);
  }, [load, project.id]);

  const problems = useMemo(() => [...(data?.problems || [])].sort((left, right) => severityRank(left.severity) - severityRank(right.severity) || left.priority.localeCompare(right.priority)), [data?.problems]);
  const categories = useMemo(() => [...new Set(problems.map((problem) => problem.category))].sort(), [problems]);
  const visible = useMemo(() => problems.filter((problem) => {
    const haystack = `${problem.title} ${problem.message} ${problem.description} ${problem.file || ""} ${problem.source} ${problem.category}`.toLowerCase();
    return (severity === "all" || problem.severity === severity) && (category === "all" || problem.category === category) && (!query.trim() || haystack.includes(query.trim().toLowerCase()));
  }), [category, problems, query, severity]);
  const blockers = problems.filter((problem) => ["critical", "high"].includes(problem.severity)).length;

  if (loading) return <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground" role="status">Running bounded local diagnostic read…</div>;
  if (!data) return <EmptyState title="Developer diagnostics unavailable" detail={notice || "KForge could not read the latest project scan."} action={<button className={buttonClass} onClick={() => void load(true)}>Retry diagnostics</button>} />;

  return <section className="space-y-4" aria-label="KForge Developer Diagnostics">
    <header className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
      <Stethoscope size={16} />
      <div className="mr-auto min-w-0"><h2 className="text-sm font-semibold">Developer Diagnostics</h2><p className="mt-1 text-xs text-muted-foreground">Latest bounded local scan evidence for {project.name}. No synthetic success state is generated.</p></div>
      <span className="rounded-md bg-muted px-2 py-1 text-[11px]">Health {data.health.score ?? "NOT_MEASURED"}</span>
      <span className="rounded-md bg-muted px-2 py-1 text-[11px]">{problems.length} findings</span>
      <span className="rounded-md bg-muted px-2 py-1 text-[11px]">{blockers} critical/high</span>
      <button className={buttonClass} onClick={() => void load(true)} disabled={refreshing}><RefreshCcw size={13} className={refreshing ? "animate-spin" : ""} />Refresh diagnostics</button>
    </header>

    {notice && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs" role="alert">{notice}</div>}

    <section className="rounded-lg border bg-card" aria-label="Health metrics">
      <div className="flex items-center gap-2 border-b px-4 py-3"><Activity size={14} /><h3 className="text-sm font-semibold">Health metrics</h3><span className="text-xs text-muted-foreground">Scanned {formatDate(data.scannedAt)}</span></div>
      <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">{data.health.metrics.map((metric) => <article key={metric.key} className="rounded-md border bg-background/60 p-3"><div className="flex items-center justify-between gap-2"><strong className="text-xs">{metric.label}</strong><StatusBadge value={metric.status} /></div><div className="mt-2 flex items-end gap-2"><span className="text-xl font-semibold">{metric.score ?? "—"}</span><span className="pb-0.5 text-[10px] text-muted-foreground">score · {metric.freshness}</span></div><p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">{metric.findings[0] || metric.evidence[0] || "No diagnostic finding recorded for this metric."}</p><p className="mt-2 truncate text-[10px] text-muted-foreground" title={metric.evidenceSource}>{metric.evidenceSource}</p></article>)}</div>
    </section>

    <div className="flex flex-wrap gap-2 rounded-lg border bg-card p-3" role="search" aria-label="Diagnostic filters">
      <label className="relative min-w-[220px] flex-1"><Search size={13} className="pointer-events-none absolute left-3 top-3 text-muted-foreground" /><span className="sr-only">Search diagnostics</span><input className={`${fieldClass} w-full pl-8`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search finding, file, source or category" /></label>
      <label><span className="sr-only">Diagnostic severity</span><select className={fieldClass} value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="all">All severities</option>{["critical", "high", "medium", "low", "info"].map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label>
      <label><span className="sr-only">Diagnostic category</span><select className={fieldClass} value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label>
    </div>

    <section className="overflow-hidden rounded-lg border bg-card" aria-label="Project diagnostic findings">
      <div className="flex items-center gap-2 border-b px-4 py-3"><CircleAlert size={14} /><h3 className="text-sm font-semibold">Findings</h3><span className="text-xs text-muted-foreground">{visible.length} visible</span></div>
      {visible.length ? <div className="overflow-x-auto"><table className="w-full min-w-[940px] text-left text-xs"><thead className="bg-muted/40 text-muted-foreground"><tr><th className="px-4 py-2 font-medium">Severity</th><th className="px-3 py-2 font-medium">Priority</th><th className="px-3 py-2 font-medium">Category</th><th className="px-3 py-2 font-medium">Finding</th><th className="px-3 py-2 font-medium">Location</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Fixability</th></tr></thead><tbody className="divide-y">{visible.map((problem) => <tr key={problem.id}><td className="px-4 py-3"><StatusBadge value={problem.severity} /></td><td className="px-3 py-3 font-mono">{problem.priority}</td><td className="px-3 py-3">{problem.category}</td><td className="max-w-[390px] px-3 py-3"><strong className="block text-xs">{problem.title}</strong><span className="mt-1 block text-[11px] text-muted-foreground">{problem.message || problem.description}</span><span className="mt-1 block text-[10px] text-muted-foreground">Source · {problem.source}</span></td><td className="px-3 py-3 font-mono text-[11px]">{problem.file ? `${problem.file}${problem.line ? `:${problem.line}` : ""}` : "PROJECT"}</td><td className="px-3 py-3"><StatusBadge value={problem.status} /></td><td className="px-3 py-3"><StatusBadge value={problem.fixability} /></td></tr>)}</tbody></table></div> : <p className="p-5 text-sm text-muted-foreground">No diagnostic findings match the current filters.</p>}
    </section>

    <div className="rounded-lg border bg-card px-4 py-3"><AdvancedEvidence value={{ scannedAt: data.scannedAt, coverage: data.coverage, health: data.health, problems: data.problems }} label="Advanced · Raw bounded scan evidence" /></div>
  </section>;
}

export default function DeveloperObservabilityWorkbench({ view, project, onExecution }: Props) {
  if (!project) return <EmptyState title="No project selected" detail="Developer observability requires explicit project context." />;
  if (view === "logs") return <DeveloperLogs project={project} onExecution={onExecution} />;
  if (view === "diagnostics") return <DeveloperDiagnostics project={project} onExecution={onExecution} />;
  return <EmptyState title="Unknown developer observability view" detail={`No observability surface is registered for '${view}'.`} />;
}

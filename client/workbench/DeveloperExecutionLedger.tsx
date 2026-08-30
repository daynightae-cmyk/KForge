import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Clock3, RefreshCcw, Search, ShieldCheck } from "lucide-react";
import type { ProjectSummary } from "@shared/workspace";
import type { SurfaceProps } from "./surfaceContracts";
import { fetchJson } from "./api";
import { AdvancedEvidence, EmptyState, StatusBadge } from "./ui";

type TaskLog = { at: string; message: string; stream: "system" | "stdout" | "stderr" };
type DeveloperTask = {
  id: string;
  projectId: string;
  kind: string;
  status: string;
  progress: number;
  logs: TaskLog[];
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number;
  error?: string;
  output?: string;
};

type LedgerTransparency = {
  execution: "LOCAL" | "REMOTE" | "HYBRID";
  network: "REQUIRED" | "NOT_REQUIRED";
  dataClasses: string[];
  projectSourceSent: boolean;
  secretRedaction: true;
  provider: string;
  destination: string;
  purpose: string;
  confirmation: "NOT_REQUIRED" | "REQUIRED" | "CONFIRMED";
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  result: "NOT_STARTED" | "PENDING" | "SUCCEEDED" | "FAILED" | "BLOCKED";
  reason?: string;
};

type LedgerRecord = {
  id: string;
  projectId: string;
  action: string;
  at: string;
  ok: boolean;
  httpStatus: number;
  message: string;
  exitCode: number | null;
  transparency: LedgerTransparency;
  source: "workspace-action-response";
  persisted: true;
};

type LedgerResponse = { projectId: string; records: LedgerRecord[]; store: { state: "READY" | "ERROR"; source: string; recordCount: number; lastError: string | null } };
type TasksResponse = { tasks: DeveloperTask[] };

const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40";
const fieldClass = "h-9 rounded-md border border-border bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-ring";

function formatDate(value?: string | null) {
  if (!value) return "UNKNOWN";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function formatDuration(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "UNKNOWN";
  if (value < 1_000) return `${Math.max(0, Math.round(value))} ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`;
}

function taskEvidence(task: DeveloperTask) {
  return task.error || task.logs.at(-1)?.message || task.output || "No output was persisted for this task.";
}

export default function DeveloperExecutionLedger({ project, onExecution }: { project?: ProjectSummary; onExecution: SurfaceProps["onExecution"] }) {
  const [tasks, setTasks] = useState<DeveloperTask[]>([]);
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("all");
  const [result, setResult] = useState("all");
  const [selectedLedgerId, setSelectedLedgerId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");

  const load = useCallback(async (explicit = false) => {
    if (!project) return;
    if (explicit) {
      setRefreshing(true);
      onExecution({ label: "Refresh execution evidence", state: "RUNNING", source: "Persisted local evidence stores" });
    }
    try {
      const [taskResponse, ledgerResponse] = await Promise.all([
        fetchJson<TasksResponse>(`/api/workspace/tasks?projectId=${encodeURIComponent(project.id)}`),
        fetchJson<LedgerResponse>(`/api/workspace/projects/${encodeURIComponent(project.id)}/execution-ledger`),
      ]);
      setTasks(taskResponse.tasks || []);
      setLedger(ledgerResponse);
      setSelectedTaskId((current) => current && taskResponse.tasks.some((task) => task.id === current) ? current : taskResponse.tasks[0]?.id || "");
      setSelectedLedgerId((current) => current && ledgerResponse.records.some((entry) => entry.id === current) ? current : ledgerResponse.records[0]?.id || "");
      setNotice(ledgerResponse.store.state === "ERROR" ? ledgerResponse.store.lastError || "Execution evidence store reported an error." : "");
      if (explicit) onExecution({ label: "Refresh execution evidence", state: ledgerResponse.store.state === "READY" ? "PASS" : "FAILED", source: "Persisted local evidence stores", message: `${ledgerResponse.records.length} action record(s) and ${taskResponse.tasks.length} task record(s) loaded.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Execution evidence unavailable.";
      setNotice(message);
      if (explicit) onExecution({ label: "Refresh execution evidence", state: "FAILED", source: "Persisted local evidence stores", message });
    } finally {
      setLoading(false);
      if (explicit) setRefreshing(false);
    }
  }, [onExecution, project]);

  useEffect(() => {
    setTasks([]);
    setLedger(null);
    setLoading(true);
    setNotice("");
    setSelectedLedgerId("");
    setSelectedTaskId("");
    void load(false);
  }, [load, project?.id]);

  const actions = useMemo(() => [...new Set((ledger?.records || []).map((entry) => entry.action))].sort(), [ledger?.records]);
  const results = useMemo(() => [...new Set((ledger?.records || []).map((entry) => entry.transparency.result))].sort(), [ledger?.records]);
  const visibleLedger = useMemo(() => (ledger?.records || []).filter((entry) => {
    const haystack = `${entry.action} ${entry.message} ${entry.transparency.result} ${entry.transparency.execution} ${entry.transparency.network} ${entry.transparency.confirmation} ${entry.transparency.provider} ${entry.transparency.destination}`.toLowerCase();
    return (action === "all" || entry.action === action) && (result === "all" || entry.transparency.result === result) && (!query.trim() || haystack.includes(query.trim().toLowerCase()));
  }), [action, ledger?.records, query, result]);
  const selectedLedger = (ledger?.records || []).find((entry) => entry.id === selectedLedgerId) || visibleLedger[0] || null;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) || tasks[0] || null;
  const networkAttempts = (ledger?.records || []).filter((entry) => entry.transparency.network === "REQUIRED").length;
  const confirmed = (ledger?.records || []).filter((entry) => entry.transparency.confirmation === "CONFIRMED").length;
  const failed = (ledger?.records || []).filter((entry) => ["FAILED", "BLOCKED"].includes(entry.transparency.result)).length;

  if (!project) return <EmptyState title="No project selected" detail="Developer execution evidence is project scoped." />;
  if (loading) return <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground" role="status">Loading persisted developer task and execution evidence…</div>;

  return <section className="space-y-4" aria-label="KForge Developer Logs">
    <header className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
      <ShieldCheck size={16} />
      <div className="mr-auto min-w-0"><h2 className="text-sm font-semibold">Developer Logs</h2><p className="mt-1 text-xs text-muted-foreground">Persisted local task evidence plus bounded Workspace action transparency for {project.name}. Opening and refreshing this surface performs no remote contact.</p></div>
      <StatusBadge value={ledger?.store.state || "UNKNOWN"} />
      <button className={buttonClass} onClick={() => void load(true)} disabled={refreshing}><RefreshCcw size={13} className={refreshing ? "animate-spin" : ""} />Refresh logs</button>
    </header>

    {notice && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs" role="alert">{notice}</div>}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Execution ledger summary">
      <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Persisted actions</span><strong className="mt-1 block text-lg">{ledger?.records.length || 0}</strong></article>
      <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Persisted tasks</span><strong className="mt-1 block text-lg">{tasks.length}</strong></article>
      <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Network-required attempts</span><strong className="mt-1 block text-lg">{networkAttempts}</strong></article>
      <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Confirmed writes</span><strong className="mt-1 block text-lg">{confirmed}</strong></article>
      <article className="rounded-lg border bg-card p-3"><span className="text-xs text-muted-foreground">Failed / blocked</span><strong className="mt-1 block text-lg">{failed}</strong></article>
    </section>

    <div className="flex flex-wrap gap-2 rounded-lg border bg-card p-3" role="search" aria-label="Execution ledger filters">
      <label className="relative min-w-[220px] flex-1"><Search size={13} className="pointer-events-none absolute left-3 top-3 text-muted-foreground" /><span className="sr-only">Search execution ledger</span><input className={`${fieldClass} w-full pl-8`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search action, provider, result or destination" /></label>
      <label><span className="sr-only">Action filter</span><select className={fieldClass} value={action} onChange={(event) => setAction(event.target.value)}><option value="all">All actions</option>{actions.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
      <label><span className="sr-only">Result filter</span><select className={fieldClass} value={result} onChange={(event) => setResult(event.target.value)}><option value="all">All results</option>{results.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
    </div>

    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
      <section className="min-w-0 overflow-hidden rounded-lg border bg-card" aria-label="Persisted execution ledger">
        <div className="flex items-center gap-2 border-b px-4 py-3"><Activity size={14} /><h3 className="text-sm font-semibold">Persistent execution ledger</h3><span className="text-xs text-muted-foreground">{visibleLedger.length} visible</span></div>
        {visibleLedger.length ? <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-muted/40 text-muted-foreground"><tr><th className="px-4 py-2 font-medium">Action</th><th className="px-3 py-2 font-medium">Result</th><th className="px-3 py-2 font-medium">Execution</th><th className="px-3 py-2 font-medium">Network</th><th className="px-3 py-2 font-medium">Confirmation</th><th className="px-3 py-2 font-medium">Recorded</th><th className="px-3 py-2 font-medium">Evidence</th></tr></thead><tbody className="divide-y">{visibleLedger.map((entry) => <tr key={entry.id} data-ledger-action={entry.action} className={entry.id === selectedLedger?.id ? "bg-muted/40" : "hover:bg-muted/20"}><td className="px-4 py-3"><button className="font-mono font-semibold hover:underline" onClick={() => setSelectedLedgerId(entry.id)} aria-label={`Inspect ${entry.action} execution`}>{entry.action}</button></td><td className="px-3 py-3"><StatusBadge value={entry.transparency.result} /></td><td className="px-3 py-3">{entry.transparency.execution}</td><td className="px-3 py-3">{entry.transparency.network}</td><td className="px-3 py-3">{entry.transparency.confirmation}</td><td className="px-3 py-3">{formatDate(entry.at)}</td><td className="max-w-[320px] truncate px-3 py-3" title={entry.message}>{entry.message}</td></tr>)}</tbody></table></div> : <p className="p-5 text-sm text-muted-foreground">No persisted Workspace action evidence matches the current filters. KForge does not create synthetic ledger entries.</p>}
      </section>

      <aside className="min-w-0 rounded-lg border bg-card p-4" aria-label="Selected execution evidence">
        {selectedLedger ? <><div className="flex items-start gap-2"><Clock3 size={14} className="mt-0.5 shrink-0" /><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">{selectedLedger.action} execution</h3><code className="mt-1 block truncate text-[10px] text-muted-foreground" title={selectedLedger.id}>{selectedLedger.id}</code></div><StatusBadge value={selectedLedger.transparency.result} /></div><dl className="mt-4 grid gap-2 text-xs"><div><dt className="text-muted-foreground">Execution</dt><dd>{selectedLedger.transparency.execution}</dd></div><div><dt className="text-muted-foreground">Network</dt><dd>{selectedLedger.transparency.network}</dd></div><div><dt className="text-muted-foreground">Confirmation</dt><dd>{selectedLedger.transparency.confirmation}</dd></div><div><dt className="text-muted-foreground">Project source sent</dt><dd>{selectedLedger.transparency.projectSourceSent ? "YES" : "NO"}</dd></div><div><dt className="text-muted-foreground">Provider</dt><dd>{selectedLedger.transparency.provider}</dd></div><div><dt className="text-muted-foreground">Destination</dt><dd className="break-words">{selectedLedger.transparency.destination}</dd></div><div><dt className="text-muted-foreground">Duration</dt><dd>{formatDuration(selectedLedger.transparency.durationMs)}</dd></div><div><dt className="text-muted-foreground">HTTP / exit</dt><dd>{selectedLedger.httpStatus} / {selectedLedger.exitCode ?? "NOT_RECORDED"}</dd></div></dl><p className="mt-4 rounded-md bg-muted/40 p-3 text-xs">{selectedLedger.message}</p><div className="mt-4"><AdvancedEvidence value={selectedLedger} label="Advanced · Raw persisted execution record" /></div></> : <p className="text-sm text-muted-foreground">Select an action record to inspect its persisted transparency evidence.</p>}
      </aside>
    </div>

    <section className="rounded-lg border bg-card" aria-label="Persisted developer tasks">
      <div className="flex items-center gap-2 border-b px-4 py-3"><Activity size={14} /><h3 className="text-sm font-semibold">Persisted local task evidence</h3><span className="text-xs text-muted-foreground">{tasks.length} task record(s)</span></div>
      {tasks.length ? <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]"><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="text-muted-foreground"><tr><th className="pb-2 font-medium">Kind</th><th className="pb-2 font-medium">State</th><th className="pb-2 font-medium">Started</th><th className="pb-2 font-medium">Evidence</th></tr></thead><tbody className="divide-y">{tasks.map((task) => <tr key={task.id} data-task-kind={task.kind}><td className="py-3"><button className="font-mono font-semibold hover:underline" onClick={() => setSelectedTaskId(task.id)} aria-label={`Inspect ${task.kind} task`}>{task.kind}</button></td><td className="py-3"><StatusBadge value={task.status} /></td><td className="py-3">{formatDate(task.startedAt)}</td><td className="max-w-[340px] truncate py-3" title={taskEvidence(task)}>{taskEvidence(task)}</td></tr>)}</tbody></table></div><aside className="rounded-md border p-3" aria-label="Selected task evidence">{selectedTask ? <><div className="flex items-center gap-2"><strong className="mr-auto text-xs">{selectedTask.kind} task</strong><StatusBadge value={selectedTask.status} /></div><code className="mt-2 block break-all text-[10px] text-muted-foreground">{selectedTask.id}</code><p className="mt-3 text-xs">{taskEvidence(selectedTask)}</p><div className="mt-3"><AdvancedEvidence value={selectedTask} label="Advanced · Raw persisted task record" /></div></> : <p className="text-xs text-muted-foreground">No task selected.</p>}</aside></div> : <p className="p-5 text-sm text-muted-foreground">No persisted task evidence exists for this project.</p>}
    </section>

    <p className="text-xs text-muted-foreground">Ledger source: {ledger?.store.source || "NOT_AVAILABLE"}. Raw command output is not duplicated into the execution ledger; detailed task output remains owned by the canonical task store.</p>
  </section>;
}

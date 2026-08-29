import { useCallback, useEffect, useMemo, useState } from "react";
import type { CommandResult, ProjectProfile, ProjectSummary, WorkspaceActionDescriptor } from "@shared/workspace";
import type { SurfaceProps } from "./surfaceContracts";
import { fetchJson, jsonRequest } from "./api";
import { AdvancedEvidence, EmptyState, StatusBadge } from "./ui";

type ActionsResponse = { actions: WorkspaceActionDescriptor[] };
type ProfileResponse = { profile: ProjectProfile };
type PreviewEvidence = {
  state: "idle" | "starting" | "running" | "failed" | "stopped" | "blocked" | "unavailable";
  sessionId?: string;
  command?: string;
  url?: string;
  pid?: number;
  port?: number;
  startedAt?: string;
  checkedAt?: string;
  health?: { ok: boolean; status?: number; latencyMs?: number; detail: string };
  embedding?: { state: "ALLOWED" | "BLOCKED" | "UNKNOWN"; reason?: string };
};
type PreviewResponse = { preview: PreviewEvidence };
type RunState = "NOT_RUN_THIS_SESSION" | "RUNNING" | "PASSED" | "FAILED" | "BLOCKED_BY_LIVE_PREVIEW";

function formatDuration(result: CommandResult | null) {
  if (!result) return "NOT_MEASURED";
  const started = new Date(result.startedAt).getTime();
  const completed = new Date(result.completedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return "UNKNOWN";
  const milliseconds = Math.max(0, completed - started);
  return milliseconds < 1_000 ? `${milliseconds} ms` : `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}

function DeveloperRuntimeWorkbench({ project, onExecution }: { project: ProjectSummary; onExecution: SurfaceProps["onExecution"] }) {
  const [descriptor, setDescriptor] = useState<WorkspaceActionDescriptor | null>(null);
  const [profile, setProfile] = useState<ProjectProfile | null>(null);
  const [preview, setPreview] = useState<PreviewEvidence | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runState, setRunState] = useState<RunState>("NOT_RUN_THIS_SESSION");
  const [result, setResult] = useState<CommandResult | null>(null);
  const [message, setMessage] = useState("");

  const actionsEndpoint = `/api/workspace/projects/${encodeURIComponent(project.id)}/actions`;
  const profileEndpoint = `/api/workspace/projects/${encodeURIComponent(project.id)}/profile`;
  const previewEndpoint = `/api/workspace/projects/${encodeURIComponent(project.id)}/preview`;

  const loadDiscovery = useCallback(async (explicit = false) => {
    if (explicit) setRefreshing(true);
    try {
      const [actions, profileResponse, previewResponse] = await Promise.all([
        fetchJson<ActionsResponse>(actionsEndpoint),
        fetchJson<ProfileResponse>(profileEndpoint),
        fetchJson<PreviewResponse>(previewEndpoint),
      ]);
      setDescriptor(actions.actions.find((entry) => entry.id === "runtime") || null);
      setProfile(profileResponse.profile);
      setPreview(previewResponse.preview);
      setMessage(explicit ? "Runtime discovery and Preview ownership evidence refreshed. No runtime command was executed." : "");
    } catch (error) {
      setDescriptor(null);
      setProfile(null);
      setPreview(null);
      setMessage(error instanceof Error ? error.message : "Runtime discovery evidence unavailable.");
    } finally {
      setLoading(false);
      if (explicit) setRefreshing(false);
    }
  }, [actionsEndpoint, previewEndpoint, profileEndpoint]);

  useEffect(() => {
    setLoading(true);
    setDescriptor(null);
    setProfile(null);
    setPreview(null);
    setRunState("NOT_RUN_THIS_SESSION");
    setResult(null);
    setMessage("");
    void loadDiscovery(false);
  }, [loadDiscovery, project.id]);

  const runtimeEvidence = useMemo(() => profile?.commandEvidence.find((entry) => entry.kind === "runtime" && entry.known)
    || profile?.commandEvidence.find((entry) => entry.kind === "dev" && entry.known)
    || profile?.commandEvidence.find((entry) => entry.kind === "production" && entry.known)
    || null, [profile]);
  const previewOwnsProcess = preview?.state === "starting" || preview?.state === "running";
  const trusted = project.trust === "trusted";
  const available = Boolean(descriptor?.enabled && !previewOwnsProcess);

  useEffect(() => {
    if (previewOwnsProcess && runState === "NOT_RUN_THIS_SESSION") setRunState("BLOCKED_BY_LIVE_PREVIEW");
    if (!previewOwnsProcess && runState === "BLOCKED_BY_LIVE_PREVIEW") setRunState("NOT_RUN_THIS_SESSION");
  }, [previewOwnsProcess, runState]);

  const runRuntime = async () => {
    if (!descriptor?.enabled || runState === "RUNNING") return;
    if (previewOwnsProcess) {
      setRunState("BLOCKED_BY_LIVE_PREVIEW");
      setMessage("Canonical Preview already owns a live project process. Runtime verification will not launch a duplicate process; use Preview Health for the active session.");
      return;
    }
    setRunState("RUNNING");
    setResult(null);
    setMessage("Running the detected runtime verification…");
    onExecution({ label: descriptor.label, command: descriptor.command, state: "RUNNING", source: descriptor.source });
    try {
      const data = await fetchJson<CommandResult>(actionsEndpoint, jsonRequest({ action: "runtime" }));
      setResult(data);
      setRunState(data.ok ? "PASSED" : "FAILED");
      setMessage(data.message);
      onExecution({
        label: descriptor.label,
        command: descriptor.command,
        state: data.ok ? "PASS" : "FAILED",
        source: descriptor.source,
        startedAt: data.startedAt,
        completedAt: data.completedAt,
        output: data.output,
        message: data.message,
        exitCode: data.exitCode,
      });
      const previewResponse = await fetchJson<PreviewResponse>(previewEndpoint).catch(() => null);
      if (previewResponse) setPreview(previewResponse.preview);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Runtime verification failed.";
      setRunState("FAILED");
      setMessage(detail);
      onExecution({ label: descriptor.label, command: descriptor.command, state: "FAILED", source: descriptor.source, message: detail });
    }
  };

  if (loading) return <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground" role="status">Reconciling runtime authority and Preview ownership…</div>;
  if (!descriptor) return <EmptyState title="Runtime capability unavailable" detail={message || "KForge could not resolve runtime capability evidence for this project."} action={<button onClick={() => void loadDiscovery(true)}>Retry discovery</button>} />;

  return <section className="space-y-4" aria-label="KForge Runtime Workbench" data-runtime-run-state={runState}>
    <header className="rounded-xl border bg-card/95 p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold">Runtime Workbench 2.0</h2><StatusBadge value={runState} />{previewOwnsProcess ? <StatusBadge value="PREVIEW_OWNS_PROCESS" /> : null}</div>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">Runtime is an explicit verification workflow. For HTTP projects KForge starts the detected command, probes loopback health, records real output, then stops that verification process. Preview Studio owns the persistent live application process.</p>
        </div>
        <button onClick={() => void loadDiscovery(true)} disabled={refreshing || runState === "RUNNING"}>{refreshing ? "Refreshing…" : "Refresh evidence"}</button>
        <button onClick={() => void runRuntime()} disabled={!available || runState === "RUNNING"}>{runState === "RUNNING" ? "Verifying runtime…" : "Verify detected runtime"}</button>
      </div>
    </header>

    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
      <section className="min-w-0 rounded-xl border bg-card p-4" aria-label="Runtime discovery evidence">
        <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Detected runtime authority</h3><StatusBadge value={descriptor.state} /><StatusBadge value={trusted ? "TRUSTED" : "UNTRUSTED"} /></div>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Command</dt><dd><code>{descriptor.command || "NO_EXECUTABLE_EVIDENCE"}</code></dd></div>
          <div><dt className="text-muted-foreground">Evidence source</dt><dd>{descriptor.source}</dd></div>
          <div><dt className="text-muted-foreground">Runtime entrypoint</dt><dd>{profile?.runtimeEntrypoint || "NOT_DETECTED"}</dd></div>
          <div><dt className="text-muted-foreground">Package manager</dt><dd>{profile?.packageManager || "NOT_APPLICABLE"}</dd></div>
          <div><dt className="text-muted-foreground">Execution</dt><dd>LOCAL</dd></div>
          <div><dt className="text-muted-foreground">Network requirement</dt><dd>{descriptor.requiresNetwork ? "REQUIRED" : "NOT_REQUIRED"}</dd></div>
          <div><dt className="text-muted-foreground">Permission</dt><dd>{descriptor.requiredPermission}</dd></div>
          <div><dt className="text-muted-foreground">Persistent process owner</dt><dd>Preview Studio only</dd></div>
        </dl>
        {!descriptor.enabled ? <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs" role="alert">{descriptor.unavailableReason || "No verified runtime command is executable for this project."}</div> : null}
        {runtimeEvidence ? <div className="mt-4"><AdvancedEvidence value={runtimeEvidence} label="Advanced · Runtime command discovery evidence" /></div> : null}
      </section>

      <aside className="min-w-0 rounded-xl border bg-card p-4" aria-label="Live Preview ownership evidence">
        <div className="flex items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Live-process ownership</h3><StatusBadge value={preview?.state || "IDLE"} /></div>
        <p className="mt-2 text-xs text-muted-foreground">KForge keeps one conceptual owner for the long-running app process: Preview Studio. Runtime verification will not intentionally compete with an active Preview session.</p>
        <dl className="mt-4 grid gap-2 text-xs">
          <div><dt className="text-muted-foreground">Preview session</dt><dd>{preview?.sessionId || "NO_ACTIVE_SESSION"}</dd></div>
          <div><dt className="text-muted-foreground">PID</dt><dd>{preview?.pid ?? "NOT_RUNNING"}</dd></div>
          <div><dt className="text-muted-foreground">Port</dt><dd>{preview?.port ?? "NOT_ALLOCATED"}</dd></div>
          <div><dt className="text-muted-foreground">Endpoint</dt><dd className="break-all"><code>{preview?.url || "NOT_ALLOCATED"}</code></dd></div>
          <div><dt className="text-muted-foreground">Health</dt><dd>{preview?.health ? `${preview.health.ok ? "HEALTHY" : "UNHEALTHY"}${preview.health.status ? ` · HTTP ${preview.health.status}` : ""}${preview.health.latencyMs !== undefined ? ` · ${preview.health.latencyMs} ms` : ""}` : "NOT_CHECKED"}</dd></div>
          <div><dt className="text-muted-foreground">Embedding</dt><dd>{preview?.embedding?.state || "UNKNOWN"}</dd></div>
        </dl>
        {previewOwnsProcess ? <div className="mt-4 rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-xs" role="status">A live Preview session owns PID {preview?.pid ?? "unknown"}. Runtime verification is disabled here to avoid starting a parallel project process.</div> : null}
      </aside>
    </div>

    <section className="rounded-xl border bg-card p-4" aria-label="Runtime verification evidence">
      <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Current-session verification</h3><StatusBadge value={runState} /></div>
      {result ? <>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-muted-foreground">Result</dt><dd>{result.ok ? "PASS" : "FAILED"}</dd></div>
          <div><dt className="text-muted-foreground">Exit code</dt><dd>{result.exitCode ?? "NOT_RECORDED"}</dd></div>
          <div><dt className="text-muted-foreground">Duration</dt><dd>{formatDuration(result)}</dd></div>
          <div><dt className="text-muted-foreground">Evidence source</dt><dd>{result.evidenceSource || "live"}</dd></div>
        </dl>
        <h4 className="mt-4 text-xs font-semibold">Runtime process / probe output</h4>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 font-mono text-[11px]" tabIndex={0} aria-label="Runtime verification output">{result.output || "The runtime verification produced no stdout/stderr output."}</pre>
        <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div><strong>Execution</strong><p>{result.transparency.execution}</p></div>
          <div><strong>Network</strong><p>{result.transparency.network}</p></div>
          <div><strong>Provider</strong><p>{result.transparency.provider}</p></div>
          <div><strong>Destination</strong><p className="break-all">{result.transparency.destination}</p></div>
        </div>
        <div className="mt-4"><AdvancedEvidence value={result} label="Advanced · Raw runtime verification evidence" /></div>
      </> : <p className="mt-3 text-sm text-muted-foreground">No runtime verification has been executed from this Workbench in the current session. Discovery or an existing Preview session is never converted into a synthetic PASS.</p>}
    </section>

    {message && <p className="kw-message" role="status">{message}</p>}
  </section>;
}

export default DeveloperRuntimeWorkbench;

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CommandResult, ProjectProfile, ProjectSummary, WorkspaceActionDescriptor } from "@shared/workspace";
import type { SurfaceProps } from "./surfaceContracts";
import { fetchJson, jsonRequest } from "./api";
import { AdvancedEvidence, EmptyState, StatusBadge } from "./ui";

type ActionsResponse = { actions: WorkspaceActionDescriptor[] };
type ProfileResponse = { profile: ProjectProfile };

type RunState = "NOT_RUN_THIS_SESSION" | "RUNNING" | "PASSED" | "FAILED";

function formatDuration(result: CommandResult | null) {
  if (!result) return "NOT_MEASURED";
  const started = new Date(result.startedAt).getTime();
  const completed = new Date(result.completedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return "UNKNOWN";
  const milliseconds = Math.max(0, completed - started);
  return milliseconds < 1_000 ? `${milliseconds} ms` : `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}

function DeveloperTestsWorkbench({ project, onExecution }: { project: ProjectSummary; onExecution: SurfaceProps["onExecution"] }) {
  const [descriptor, setDescriptor] = useState<WorkspaceActionDescriptor | null>(null);
  const [profile, setProfile] = useState<ProjectProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runState, setRunState] = useState<RunState>("NOT_RUN_THIS_SESSION");
  const [result, setResult] = useState<CommandResult | null>(null);
  const [message, setMessage] = useState("");

  const actionsEndpoint = `/api/workspace/projects/${encodeURIComponent(project.id)}/actions`;
  const profileEndpoint = `/api/workspace/projects/${encodeURIComponent(project.id)}/profile`;

  const loadDiscovery = useCallback(async (explicit = false) => {
    if (explicit) setRefreshing(true);
    try {
      const [actions, profileResponse] = await Promise.all([
        fetchJson<ActionsResponse>(actionsEndpoint),
        fetchJson<ProfileResponse>(profileEndpoint),
      ]);
      setDescriptor(actions.actions.find((entry) => entry.id === "test") || null);
      setProfile(profileResponse.profile);
      setMessage(explicit ? "Test discovery evidence refreshed. No test command was executed." : "");
    } catch (error) {
      setDescriptor(null);
      setProfile(null);
      setMessage(error instanceof Error ? error.message : "Test discovery evidence unavailable.");
    } finally {
      setLoading(false);
      if (explicit) setRefreshing(false);
    }
  }, [actionsEndpoint, profileEndpoint]);

  useEffect(() => {
    setLoading(true);
    setDescriptor(null);
    setProfile(null);
    setRunState("NOT_RUN_THIS_SESSION");
    setResult(null);
    setMessage("");
    void loadDiscovery(false);
  }, [loadDiscovery, project.id]);

  const testEvidence = useMemo(() => profile?.commandEvidence.find((entry) => entry.kind === "test") || null, [profile]);
  const testFrameworks = useMemo(() => (profile?.framework || []).filter((entry) => /vitest|jest|pytest|mocha|junit|maven|gradle|go|rust|\.net|node/i.test(entry)), [profile?.framework]);
  const available = Boolean(descriptor?.enabled);
  const trusted = project.trust === "trusted";

  const runTests = async () => {
    if (!descriptor?.enabled || runState === "RUNNING") return;
    setRunState("RUNNING");
    setResult(null);
    setMessage("Running the detected local test command…");
    onExecution({ label: descriptor.label, command: descriptor.command, state: "RUNNING", source: descriptor.source });
    try {
      const data = await fetchJson<CommandResult>(actionsEndpoint, jsonRequest({ action: "test" }));
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
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Test execution failed.";
      setRunState("FAILED");
      setMessage(detail);
      onExecution({ label: descriptor.label, command: descriptor.command, state: "FAILED", source: descriptor.source, message: detail });
    }
  };

  if (loading) return <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground" role="status">Loading test discovery evidence…</div>;
  if (!descriptor) return <EmptyState title="Test capability unavailable" detail={message || "KForge could not resolve test capability evidence for this project."} action={<button onClick={() => void loadDiscovery(true)}>Retry discovery</button>} />;

  return <section className="space-y-4" aria-label="KForge Tests Workbench" data-test-run-state={runState}>
    <header className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold">Tests Workbench</h2>
        <p className="mt-1 text-xs text-muted-foreground">KForge discovers test authority from local project metadata. Opening or refreshing this surface never runs the test command.</p>
      </div>
      <StatusBadge value={runState} />
      <button onClick={() => void loadDiscovery(true)} disabled={refreshing || runState === "RUNNING"}>{refreshing ? "Refreshing…" : "Refresh discovery"}</button>
      <button onClick={() => void runTests()} disabled={!available || runState === "RUNNING"}>{runState === "RUNNING" ? "Running tests…" : "Run detected tests"}</button>
    </header>

    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)]">
      <section className="min-w-0 rounded-lg border bg-card p-4" aria-label="Test discovery evidence">
        <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Detected test capability</h3><StatusBadge value={descriptor.state} /><StatusBadge value={trusted ? "TRUSTED" : "UNTRUSTED"} /></div>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Command</dt><dd><code>{descriptor.command || "NO_EXECUTABLE_EVIDENCE"}</code></dd></div>
          <div><dt className="text-muted-foreground">Evidence source</dt><dd>{descriptor.source}</dd></div>
          <div><dt className="text-muted-foreground">Permission</dt><dd>{descriptor.requiredPermission}</dd></div>
          <div><dt className="text-muted-foreground">Network requirement</dt><dd>{descriptor.requiresNetwork ? "REQUIRED" : "NOT_REQUIRED"}</dd></div>
          <div><dt className="text-muted-foreground">Test roots</dt><dd>{profile?.testRoots.length ? profile.testRoots.join(", ") : "No conventional test root detected"}</dd></div>
          <div><dt className="text-muted-foreground">Detected test technology</dt><dd>{testFrameworks.length ? testFrameworks.join(", ") : "No named test framework detected"}</dd></div>
        </dl>
        {!available ? <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs" role="alert">{descriptor.unavailableReason || (!trusted ? "Project trust is required before local process execution." : "No verified test command is available for this project profile.")}</div> : null}
        {testEvidence ? <div className="mt-4"><AdvancedEvidence value={testEvidence} label="Advanced · Test command discovery evidence" /></div> : null}
      </section>

      <aside className="min-w-0 rounded-lg border bg-card p-4" aria-label="Test execution authority">
        <h3 className="text-sm font-semibold">Execution authority</h3>
        <p className="mt-2 text-xs text-muted-foreground">Tests are local process execution. KForge does not infer a pass state from discovery and does not start tests until you click Run detected tests.</p>
        <dl className="mt-4 grid gap-2 text-xs">
          <div><dt className="text-muted-foreground">Current project trust</dt><dd>{project.trust}</dd></div>
          <div><dt className="text-muted-foreground">Executable state</dt><dd>{descriptor.enabled ? "ENABLED" : "DISABLED"}</dd></div>
          <div><dt className="text-muted-foreground">Confirmation</dt><dd>{descriptor.requiresConfirmation ? "REQUIRED" : "NOT_REQUIRED"}</dd></div>
          <div><dt className="text-muted-foreground">Project summary test state</dt><dd>{project.testStatus}</dd></div>
        </dl>
        <p className="mt-3 text-[11px] text-muted-foreground">Project summary state is displayed as separate prior evidence; this Workbench reports the current session as NOT_RUN_THIS_SESSION until an explicit run completes.</p>
      </aside>
    </div>

    <section className="rounded-lg border bg-card p-4" aria-label="Test run evidence">
      <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Current session run evidence</h3><StatusBadge value={runState} /></div>
      {result ? <>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-muted-foreground">Result</dt><dd>{result.ok ? "PASS" : "FAILED"}</dd></div>
          <div><dt className="text-muted-foreground">Exit code</dt><dd>{result.exitCode ?? "NOT_RECORDED"}</dd></div>
          <div><dt className="text-muted-foreground">Duration</dt><dd>{formatDuration(result)}</dd></div>
          <div><dt className="text-muted-foreground">Evidence source</dt><dd>{result.evidenceSource || "live"}</dd></div>
        </dl>
        <h4 className="mt-4 text-xs font-semibold">Test process output</h4>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 font-mono text-[11px]" tabIndex={0} aria-label="Test process output">{result.output || "The test command produced no stdout/stderr output."}</pre>
        <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          <div><strong>Execution</strong><p>{result.transparency.execution}</p></div>
          <div><strong>Network</strong><p>{result.transparency.network}</p></div>
          <div><strong>Provider</strong><p>{result.transparency.provider}</p></div>
          <div><strong>Destination</strong><p>{result.transparency.destination}</p></div>
        </div>
        <div className="mt-4"><AdvancedEvidence value={result} label="Advanced · Raw test execution evidence" /></div>
      </> : <p className="mt-3 text-sm text-muted-foreground">No test command has been run from this Workbench in the current session. KForge does not manufacture a result from command discovery.</p>}
    </section>

    {message && <p className="kw-message" role="status">{message}</p>}
  </section>;
}

export default DeveloperTestsWorkbench;

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

function DeveloperBuildWorkbench({ project, onExecution }: { project: ProjectSummary; onExecution: SurfaceProps["onExecution"] }) {
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
      setDescriptor(actions.actions.find((entry) => entry.id === "build") || null);
      setProfile(profileResponse.profile);
      setMessage(explicit ? "Build discovery evidence refreshed. No build command was executed." : "");
    } catch (error) {
      setDescriptor(null);
      setProfile(null);
      setMessage(error instanceof Error ? error.message : "Build discovery evidence unavailable.");
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

  const buildEvidence = useMemo(() => profile?.commandEvidence.find((entry) => entry.kind === "build") || null, [profile]);
  const buildTechnologies = useMemo(() => [...new Set([...(profile?.languages || []), ...(profile?.framework || [])])], [profile?.framework, profile?.languages]);
  const available = Boolean(descriptor?.enabled);
  const trusted = project.trust === "trusted";

  const runBuild = async () => {
    if (!descriptor?.enabled || runState === "RUNNING") return;
    const confirmed = descriptor.requiresConfirmation ? window.confirm(`${descriptor.label} requires confirmation before local process execution.`) : false;
    if (descriptor.requiresConfirmation && !confirmed) return;
    setRunState("RUNNING");
    setResult(null);
    setMessage("Running the detected local build command…");
    onExecution({ label: descriptor.label, command: descriptor.command, state: "RUNNING", source: descriptor.source });
    try {
      const data = await fetchJson<CommandResult>(actionsEndpoint, jsonRequest({ action: "build", confirmed }));
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
      const detail = error instanceof Error ? error.message : "Build execution failed.";
      setRunState("FAILED");
      setMessage(detail);
      onExecution({ label: descriptor.label, command: descriptor.command, state: "FAILED", source: descriptor.source, message: detail });
    }
  };

  if (loading) return <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground" role="status">Loading build discovery evidence…</div>;
  if (!descriptor) return <EmptyState title="Build capability unavailable" detail={message || "KForge could not resolve build capability evidence for this project."} action={<button onClick={() => void loadDiscovery(true)}>Retry discovery</button>} />;

  return <section className="space-y-4" aria-label="KForge Build Workbench" data-build-run-state={runState}>
    <header className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold">Build Workbench</h2>
        <p className="mt-1 text-xs text-muted-foreground">KForge discovers build authority from local project metadata. Opening or refreshing this surface never executes the build.</p>
      </div>
      <StatusBadge value={runState} />
      <button onClick={() => void loadDiscovery(true)} disabled={refreshing || runState === "RUNNING"}>{refreshing ? "Refreshing…" : "Refresh discovery"}</button>
      <button onClick={() => void runBuild()} disabled={!available || runState === "RUNNING"}>{runState === "RUNNING" ? "Building…" : "Run detected build"}</button>
    </header>

    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)]">
      <section className="min-w-0 rounded-lg border bg-card p-4" aria-label="Build discovery evidence">
        <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Detected build capability</h3><StatusBadge value={descriptor.state} /><StatusBadge value={trusted ? "TRUSTED" : "UNTRUSTED"} /></div>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Command</dt><dd><code>{descriptor.command || "NO_EXECUTABLE_EVIDENCE"}</code></dd></div>
          <div><dt className="text-muted-foreground">Evidence source</dt><dd>{descriptor.source}</dd></div>
          <div><dt className="text-muted-foreground">Permission</dt><dd>{descriptor.requiredPermission}</dd></div>
          <div><dt className="text-muted-foreground">Network requirement</dt><dd>{descriptor.requiresNetwork ? "REQUIRED" : "NOT_REQUIRED"}</dd></div>
          <div><dt className="text-muted-foreground">Package manager</dt><dd>{profile?.packageManager || "NOT_DETECTED"}</dd></div>
          <div><dt className="text-muted-foreground">Workspace kind</dt><dd>{profile?.workspaceKind || "UNKNOWN"}</dd></div>
          <div><dt className="text-muted-foreground">Build technology</dt><dd>{buildTechnologies.length ? buildTechnologies.join(", ") : "No named build technology detected"}</dd></div>
          <div><dt className="text-muted-foreground">Source roots</dt><dd>{profile?.sourceRoots.length ? profile.sourceRoots.join(", ") : "No conventional source root detected"}</dd></div>
          <div><dt className="text-muted-foreground">Manifests</dt><dd>{profile?.manifests.length ? profile.manifests.join(", ") : "None detected"}</dd></div>
          <div><dt className="text-muted-foreground">Lockfiles</dt><dd>{profile?.lockfiles.length ? profile.lockfiles.join(", ") : "None detected"}</dd></div>
        </dl>
        {!available ? <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs" role="alert">{descriptor.unavailableReason || (!trusted ? "Project trust is required before local process execution." : "No verified build command is available for this project profile.")}</div> : null}
        {buildEvidence ? <div className="mt-4"><AdvancedEvidence value={buildEvidence} label="Advanced · Build command discovery evidence" /></div> : null}
      </section>

      <aside className="min-w-0 rounded-lg border bg-card p-4" aria-label="Build execution authority">
        <h3 className="text-sm font-semibold">Execution authority</h3>
        <p className="mt-2 text-xs text-muted-foreground">A build may create or replace generated files according to the detected project command. KForge does not infer success, artifacts, or remote publication from discovery alone.</p>
        <dl className="mt-4 grid gap-2 text-xs">
          <div><dt className="text-muted-foreground">Current project trust</dt><dd>{project.trust}</dd></div>
          <div><dt className="text-muted-foreground">Executable state</dt><dd>{descriptor.enabled ? "ENABLED" : "DISABLED"}</dd></div>
          <div><dt className="text-muted-foreground">Confirmation</dt><dd>{descriptor.requiresConfirmation ? "REQUIRED" : "NOT_REQUIRED"}</dd></div>
          <div><dt className="text-muted-foreground">Project summary build state</dt><dd>{project.buildStatus}</dd></div>
          <div><dt className="text-muted-foreground">Source files discovered</dt><dd>{profile?.sourceFileCount ?? "UNKNOWN"}</dd></div>
          <div><dt className="text-muted-foreground">Deployment descriptors</dt><dd>{profile?.deployment.length ? profile.deployment.join(", ") : "NONE_DETECTED"}</dd></div>
        </dl>
        <p className="mt-3 text-[11px] text-muted-foreground">Project summary build state is separate prior evidence. This Workbench remains NOT_RUN_THIS_SESSION until an explicit build completes here.</p>
      </aside>
    </div>

    <section className="rounded-lg border bg-card p-4" aria-label="Build run evidence">
      <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Current session build evidence</h3><StatusBadge value={runState} /></div>
      {result ? <>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-muted-foreground">Result</dt><dd>{result.ok ? "PASS" : "FAILED"}</dd></div>
          <div><dt className="text-muted-foreground">Exit code</dt><dd>{result.exitCode ?? "NOT_RECORDED"}</dd></div>
          <div><dt className="text-muted-foreground">Duration</dt><dd>{formatDuration(result)}</dd></div>
          <div><dt className="text-muted-foreground">Evidence source</dt><dd>{result.evidenceSource || "live"}</dd></div>
        </dl>
        <h4 className="mt-4 text-xs font-semibold">Build process output</h4>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 font-mono text-[11px]" tabIndex={0} aria-label="Build process output">{result.output || "The build command produced no stdout/stderr output."}</pre>
        <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          <div><strong>Execution</strong><p>{result.transparency.execution}</p></div>
          <div><strong>Network</strong><p>{result.transparency.network}</p></div>
          <div><strong>Provider</strong><p>{result.transparency.provider}</p></div>
          <div><strong>Destination</strong><p>{result.transparency.destination}</p></div>
        </div>
        <div className="mt-4"><AdvancedEvidence value={result} label="Advanced · Raw build execution evidence" /></div>
      </> : <p className="mt-3 text-sm text-muted-foreground">No build command has been run from this Workbench in the current session. KForge does not manufacture a build result from command discovery or prior project health.</p>}
    </section>

    {message && <p className="kw-message" role="status">{message}</p>}
  </section>;
}

export default DeveloperBuildWorkbench;

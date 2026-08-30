import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectProfile, ProjectSummary } from "@shared/workspace";
import type { RecordRow, SurfaceProps } from "./surfaceContracts";
import { fetchJson, jsonRequest } from "./api";
import { AdvancedEvidence, EmptyState, StatusBadge } from "./ui";

type ProfileResponse = { profile: ProjectProfile };
type ToolEvidence = RecordRow & {
  name: string;
  permission?: string;
  description?: string;
  status?: string;
  unavailableReason?: string;
  requiresConfirmation?: boolean;
  evidence?: RecordRow;
};
type ToolsResponse = { tools: ToolEvidence[] };
type LintRunResult = {
  ok: boolean;
  tool: string;
  permission: string;
  output: unknown;
  message: string;
};
type RunState = "NOT_RUN_THIS_SESSION" | "RUNNING" | "PASSED" | "FAILED";

function stringifyOutput(value: unknown) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "No lint output was returned.";
  return JSON.stringify(value, null, 2);
}

function DeveloperLintWorkbench({ project, onExecution }: { project: ProjectSummary; onExecution: SurfaceProps["onExecution"] }) {
  const [profile, setProfile] = useState<ProjectProfile | null>(null);
  const [tool, setTool] = useState<ToolEvidence | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runState, setRunState] = useState<RunState>("NOT_RUN_THIS_SESSION");
  const [result, setResult] = useState<LintRunResult | null>(null);
  const [message, setMessage] = useState("");

  const profileEndpoint = `/api/workspace/projects/${encodeURIComponent(project.id)}/profile`;
  const toolsEndpoint = `/api/workspace/projects/${encodeURIComponent(project.id)}/agent/tools`;
  const runEndpoint = `${toolsEndpoint}/lint`;

  const loadDiscovery = useCallback(async (explicit = false) => {
    if (explicit) setRefreshing(true);
    try {
      const [profileResponse, toolsResponse] = await Promise.all([
        fetchJson<ProfileResponse>(profileEndpoint),
        fetchJson<ToolsResponse>(toolsEndpoint),
      ]);
      setProfile(profileResponse.profile);
      setTool(toolsResponse.tools.find((entry) => entry.name === "lint") || null);
      setMessage(explicit ? "Lint discovery evidence refreshed. No lint command was executed." : "");
    } catch (error) {
      setProfile(null);
      setTool(null);
      setMessage(error instanceof Error ? error.message : "Lint discovery evidence unavailable.");
    } finally {
      setLoading(false);
      if (explicit) setRefreshing(false);
    }
  }, [profileEndpoint, toolsEndpoint]);

  useEffect(() => {
    setLoading(true);
    setProfile(null);
    setTool(null);
    setRunState("NOT_RUN_THIS_SESSION");
    setResult(null);
    setMessage("");
    void loadDiscovery(false);
  }, [loadDiscovery, project.id]);

  const lintScript = profile?.scripts.lint || "";
  const lintCommand = lintScript ? `${profile?.packageManager || "npm"} run lint` : "NO_LINT_COMMAND_DETECTED";
  const lintSource = lintScript ? "package.json#scripts.lint" : "Project profile / Agent Tool registry";
  const available = Boolean(tool && tool.status === "AVAILABLE" && lintScript && project.trust === "trusted");
  const technologies = useMemo(() => [...new Set([...(profile?.languages || []), ...(profile?.framework || [])])], [profile?.framework, profile?.languages]);

  const runLint = async () => {
    if (!available || runState === "RUNNING") return;
    if (tool?.requiresConfirmation && !window.confirm("Run the detected local lint command?")) return;
    setRunState("RUNNING");
    setResult(null);
    setMessage("Running the detected local lint command…");
    onExecution({ label: "Lint", command: lintCommand, state: "RUNNING", source: lintSource });
    try {
      const data = await fetchJson<LintRunResult>(runEndpoint, jsonRequest({}));
      setResult(data);
      setRunState(data.ok ? "PASSED" : "FAILED");
      setMessage(data.message);
      onExecution({
        label: "Lint",
        command: lintCommand,
        state: data.ok ? "PASS" : "FAILED",
        source: lintSource,
        output: stringifyOutput(data.output),
        message: data.message,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Lint execution failed.";
      setRunState("FAILED");
      setMessage(detail);
      onExecution({ label: "Lint", command: lintCommand, state: "FAILED", source: lintSource, message: detail });
    }
  };

  if (loading) return <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground" role="status">Loading lint discovery evidence…</div>;
  if (!tool) return <EmptyState title="Lint capability unavailable" detail={message || "KForge could not resolve the registered lint tool for this project."} action={<button onClick={() => void loadDiscovery(true)}>Retry discovery</button>} />;

  return <section className="space-y-4" aria-label="KForge Lint Workbench" data-lint-run-state={runState}>
    <header className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold">Lint Workbench</h2>
        <p className="mt-1 text-xs text-muted-foreground">Lint authority comes from the selected local project profile and registered KForge tool handler. Opening or refreshing this surface never executes lint.</p>
      </div>
      <StatusBadge value={runState} />
      <button onClick={() => void loadDiscovery(true)} disabled={refreshing || runState === "RUNNING"}>{refreshing ? "Refreshing…" : "Refresh discovery"}</button>
      <button onClick={() => void runLint()} disabled={!available || runState === "RUNNING"}>{runState === "RUNNING" ? "Linting…" : "Run detected lint"}</button>
    </header>

    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)]">
      <section className="min-w-0 rounded-lg border bg-card p-4" aria-label="Lint discovery evidence">
        <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Detected lint capability</h3><StatusBadge value={tool.status || "UNKNOWN"} /><StatusBadge value={project.trust === "trusted" ? "TRUSTED" : "UNTRUSTED"} /></div>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Command</dt><dd><code>{lintCommand}</code></dd></div>
          <div><dt className="text-muted-foreground">Evidence source</dt><dd>{lintSource}</dd></div>
          <div><dt className="text-muted-foreground">Script</dt><dd><code>{lintScript || "NOT_DETECTED"}</code></dd></div>
          <div><dt className="text-muted-foreground">Package manager</dt><dd>{profile?.packageManager || "NOT_DETECTED"}</dd></div>
          <div><dt className="text-muted-foreground">Permission</dt><dd>{tool.permission || "UNKNOWN"}</dd></div>
          <div><dt className="text-muted-foreground">Handler eligibility</dt><dd>{String((tool.evidence as RecordRow | undefined)?.handler || "UNKNOWN")}</dd></div>
          <div><dt className="text-muted-foreground">Runtime evidence</dt><dd>{String((tool.evidence as RecordRow | undefined)?.runtime || "UNKNOWN")}</dd></div>
          <div><dt className="text-muted-foreground">Workspace kind</dt><dd>{profile?.workspaceKind || "UNKNOWN"}</dd></div>
          <div><dt className="text-muted-foreground">Technologies</dt><dd>{technologies.length ? technologies.join(", ") : "NONE_NAMED"}</dd></div>
          <div><dt className="text-muted-foreground">Source roots</dt><dd>{profile?.sourceRoots.length ? profile.sourceRoots.join(", ") : "NONE_DETECTED"}</dd></div>
        </dl>
        {!available ? <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs" role="alert">{tool.unavailableReason || (!lintScript ? "No explicit lint script exists in the detected project profile." : project.trust !== "trusted" ? "Project trust is required before local lint execution." : "The lint handler is not executable for the current project evidence.")}</div> : null}
        <div className="mt-4"><AdvancedEvidence value={{ tool, profile: { packageManager: profile?.packageManager, scripts: profile?.scripts, commandEvidence: profile?.commandEvidence } }} label="Advanced · Lint discovery evidence" /></div>
      </section>

      <aside className="min-w-0 rounded-lg border bg-card p-4" aria-label="Lint execution authority">
        <h3 className="text-sm font-semibold">Execution authority</h3>
        <p className="mt-2 text-xs text-muted-foreground">KForge runs only the explicit project lint script through the bounded registered tool handler. There is no unrestricted shell field and no automatic formatter write.</p>
        <dl className="mt-4 grid gap-2 text-xs">
          <div><dt className="text-muted-foreground">Project trust</dt><dd>{project.trust}</dd></div>
          <div><dt className="text-muted-foreground">Network requirement</dt><dd>NOT_REQUIRED</dd></div>
          <div><dt className="text-muted-foreground">Remote provider</dt><dd>NONE</dd></div>
          <div><dt className="text-muted-foreground">Source mutation authority</dt><dd>NOT_GRANTED_BY_LINT_WORKBENCH</dd></div>
          <div><dt className="text-muted-foreground">Formatting</dt><dd>SEPARATE_CONFIRMATION_GATED_TOOL</dd></div>
        </dl>
      </aside>
    </div>

    <section className="rounded-lg border bg-card p-4" aria-label="Lint run evidence">
      <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Current session lint evidence</h3><StatusBadge value={runState} /></div>
      {result ? <>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
          <div><dt className="text-muted-foreground">Result</dt><dd>{result.ok ? "PASS" : "FAILED"}</dd></div>
          <div><dt className="text-muted-foreground">Tool</dt><dd>{result.tool}</dd></div>
          <div><dt className="text-muted-foreground">Permission</dt><dd>{result.permission}</dd></div>
        </dl>
        <h4 className="mt-4 text-xs font-semibold">Lint process evidence</h4>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 font-mono text-[11px]" tabIndex={0} aria-label="Lint process output">{stringifyOutput(result.output)}</pre>
        <p className="mt-2 text-[11px] text-muted-foreground">The Agent Tool result does not expose a synthetic test count, duration, or exit code; KForge leaves those fields unclaimed.</p>
        <div className="mt-4"><AdvancedEvidence value={result} label="Advanced · Raw lint tool evidence" /></div>
      </> : <p className="mt-3 text-sm text-muted-foreground">No lint command has been run from this Workbench in the current session. Discovery evidence is not converted into a PASS result.</p>}
    </section>

    {message && <p className="kw-message" role="status">{message}</p>}
  </section>;
}

export default DeveloperLintWorkbench;

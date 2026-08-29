import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronsUpDown, CircleStop, Clipboard, ExternalLink, HeartPulse, Home, Maximize2, Pause, Play, RefreshCcw, RotateCw, Search, Terminal, Trash2 } from "lucide-react";
import type { SurfaceProps, RecordRow } from "./surfaceContracts";
import type { ProjectSummary, WorkspaceAction, WorkspaceActionDescriptor, CommandResult } from "@shared/workspace";
import { fetchJson, jsonRequest } from "./api";
import { EmptyState, StatusBadge, EvidenceRows } from "./ui";
import { KForgeServiceCard } from "@/components/ui/KForgeServiceCard";
import { viewLabel } from "./navigation";
import { SimpleFetchSurface } from "./surfaceShared";

function DeveloperSurface({ view, project, onExecution, onInspectorContext }: SurfaceProps) {
  if (!project) return <EmptyState title="No project selected" detail="Developer execution requires explicit project context." />;
  if (view === "terminal") return <CommandTerminal project={project} onExecution={onExecution} />;
  if (["tests", "build", "runtime"].includes(view)) return <ActionSurface project={project} action={view === "tests" ? "test" : view as WorkspaceAction} onExecution={onExecution} />;
  if (view === "lint") return <LintSurface project={project} onExecution={onExecution} />;
  if (view === "preview") return <PreviewSurface project={project} onExecution={onExecution} onInspectorContext={onInspectorContext} />;
  return <SimpleFetchSurface url={view === "logs" ? `/api/workspace/tasks?projectId=${encodeURIComponent(project.id)}` : `/api/workspace/projects/${encodeURIComponent(project.id)}/problems`} title={viewLabel("developer-tools", view)} />;
}

function CommandTerminal({ project, onExecution }: { project: ProjectSummary; onExecution: SurfaceProps["onExecution"] }) {
  const [actions, setActions] = useState<WorkspaceActionDescriptor[]>([]); const [message, setMessage] = useState("Loading registered commands…");
  useEffect(() => { void fetchJson<{ actions: WorkspaceActionDescriptor[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/actions`).then((data) => { setActions(data.actions); setMessage(""); }).catch((error) => setMessage(error instanceof Error ? error.message : "Action evidence unavailable.")); }, [project.id]);
  const run = async (descriptor: WorkspaceActionDescriptor) => { if (!descriptor.enabled) return; const confirmed = descriptor.requiresConfirmation ? window.confirm(`${descriptor.label} requires confirmation.`) : false; if (descriptor.requiresConfirmation && !confirmed) return; onExecution({ label: descriptor.label, command: descriptor.command, state: "RUNNING", source: descriptor.source }); try { const data = await fetchJson<CommandResult>(`/api/workspace/projects/${encodeURIComponent(project.id)}/actions`, jsonRequest({ action: descriptor.id, confirmed })); onExecution({ label: descriptor.label, command: descriptor.command, state: data.ok ? "PASS" : "FAILED", source: descriptor.source, startedAt: data.startedAt, completedAt: data.completedAt, output: data.output, message: data.message, exitCode: data.exitCode }); } catch (error) { onExecution({ label: descriptor.label, command: descriptor.command, state: "FAILED", source: descriptor.source, message: error instanceof Error ? error.message : "Execution failed." }); } };
  return <section className="kw-terminal"><div className="kw-terminal-header"><Terminal size={18} /><div><strong>KForge Command Terminal</strong><small>Working directory · {project.path}</small></div></div><p>Only registered KForge actions are executable. There is no unrestricted shell input.</p>{message && <p className="kw-message">{message}</p>}<div className="kw-command-table"><div className="kw-command-head"><span>Command</span><span>State</span><span>Permission</span><span>Evidence source</span><span /></div>{actions.map((descriptor) => <div key={descriptor.id}><span><strong>{descriptor.label}</strong><code>{descriptor.command || "NO_EXECUTABLE_EVIDENCE"}</code></span><StatusBadge value={descriptor.state} /><span>{descriptor.requiredPermission}</span><span>{descriptor.source}<small>{descriptor.unavailableReason}</small></span><button disabled={!descriptor.enabled} onClick={() => void run(descriptor)}>Run</button></div>)}</div></section>;
}

function ActionSurface({ project, action, onExecution }: { project: ProjectSummary; action: WorkspaceAction; onExecution: SurfaceProps["onExecution"] }) {
  const [descriptor, setDescriptor] = useState<WorkspaceActionDescriptor | null>(null);
  useEffect(() => { void fetchJson<{ actions: WorkspaceActionDescriptor[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/actions`).then((data) => setDescriptor(data.actions.find((entry) => entry.id === action) || null)); }, [project.id, action]);
  if (!descriptor) return <p className="kw-message">Loading action eligibility…</p>;
  const run = async () => { if (!descriptor.enabled) return; onExecution({ label: descriptor.label, command: descriptor.command, state: "RUNNING", source: descriptor.source }); try { const data = await fetchJson<CommandResult>(`/api/workspace/projects/${encodeURIComponent(project.id)}/actions`, jsonRequest({ action })); onExecution({ label: descriptor.label, command: descriptor.command, state: data.ok ? "PASS" : "FAILED", source: descriptor.source, output: data.output, message: data.message, exitCode: data.exitCode }); } catch (error) { onExecution({ label: descriptor.label, state: "FAILED", source: descriptor.source, message: error instanceof Error ? error.message : "Action failed." }); } };
  return (
    <KForgeServiceCard
      title={descriptor.label}
      subtitle={descriptor.command ? `Detected executable` : descriptor.source || "Project profile evidence"}
      status={String(descriptor.enabled ? (descriptor.state || "AVAILABLE") : "UNAVAILABLE")}
      command={String(descriptor.command || "No executable evidence detected")}
      lastRun={undefined}
      durationMs={undefined}
      available={descriptor.enabled}
      reason={descriptor.unavailableReason || (!descriptor.enabled ? descriptor.unavailableReason || "Not available for current project profile." : undefined)}
      disabled={!descriptor.enabled}
      onRun={descriptor.enabled ? () => void run() : undefined}
      onConfigure={undefined}
    />
  );
}

function LintSurface({ project, onExecution }: { project: ProjectSummary; onExecution: SurfaceProps["onExecution"] }) {
  const [tool, setTool] = useState<RecordRow | null>(null); useEffect(() => { void fetchJson<{ tools: RecordRow[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/agent/tools`).then((data) => setTool(data.tools.find((entry) => entry.name === "lint") || null)); }, [project.id]); const enabled = ["AVAILABLE", "AVAILABLE_WITH_CONFIRMATION"].includes(String(tool?.status));
  const run = async () => { onExecution({ label: "Lint", state: "RUNNING", source: "Agent tool registry" }); try { const data = await fetchJson<{ ok: boolean; message: string; output: unknown }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/agent/tools/lint`, jsonRequest({})); onExecution({ label: "Lint", state: data.ok ? "PASS" : "FAILED", source: "Agent tool registry", message: data.message, output: typeof data.output === "string" ? data.output : JSON.stringify(data.output, null, 2) }); } catch (error) { onExecution({ label: "Lint", state: "FAILED", source: "Agent tool registry", message: error instanceof Error ? error.message : "Lint failed." }); } };
  return (
    <KForgeServiceCard
      title="Lint"
      subtitle={String(tool?.command || "No lint command detected")}
      status={String(tool ? (tool.status || "NOT_EVALUATED") : "NOT_EVALUATED")}
      command={String(tool?.command || "No executable evidence")}
      available={enabled}
      reason={!enabled ? (String(tool?.unavailableReason || "No lint script found in package.json")) : undefined}
      disabled={!enabled}
      onRun={enabled ? () => void run() : undefined}
    />
  );
}

type PreviewStatus = {
  projectId: string;
  sessionId?: string;
  state: "idle" | "starting" | "running" | "failed" | "stopped" | "blocked" | "unavailable";
  command?: string;
  port?: number;
  url?: string;
  pid?: number;
  startedAt?: string;
  stoppedAt?: string;
  checkedAt?: string;
  health?: { ok: boolean; status?: number; latencyMs?: number; detail: string };
  routes: Array<{ path: string; source: string; checkedAt: string }>;
  history: Array<{ at: string; event: string; detail: string }>;
  logs: string[];
  runtime: RecordRow;
  telemetry: RecordRow;
  embedding: { state: "ALLOWED" | "BLOCKED" | "UNKNOWN"; reason?: string };
  error?: string;
};

type PreviewCapability = { available: boolean; command?: string; source?: string; reason?: string };
type PreviewResponse = { preview: PreviewStatus; capability?: PreviewCapability; trust?: string };
type ViewportId = "responsive" | "desktop" | "laptop" | "tablet" | "mobile";

const PREVIEW_VIEWPORTS: Record<ViewportId, { label: string; width?: number; height?: number }> = {
  responsive: { label: "Responsive" },
  desktop: { label: "Desktop", width: 1440, height: 900 },
  laptop: { label: "Laptop", width: 1366, height: 768 },
  tablet: { label: "Tablet", width: 768, height: 1024 },
  mobile: { label: "Mobile", width: 390, height: 844 },
};

function PreviewSurface({ project, onExecution, onInspectorContext }: {
  project: ProjectSummary;
  onExecution: SurfaceProps["onExecution"];
  onInspectorContext?: SurfaceProps["onInspectorContext"];
}) {
  const [data, setData] = useState<PreviewStatus | null>(null);
  const [capability, setCapability] = useState<PreviewCapability | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [viewport, setViewport] = useState<ViewportId>("responsive");
  const [zoom, setZoom] = useState(100);
  const [frameVersion, setFrameVersion] = useState(0);
  const [routeHistory, setRouteHistory] = useState<string[]>(["/"]);
  const [routeIndex, setRouteIndex] = useState(0);
  const [routeInput, setRouteInput] = useState("/");
  const [logsOpen, setLogsOpen] = useState(true);
  const [logsPaused, setLogsPaused] = useState(false);
  const [pausedLogs, setPausedLogs] = useState<string[]>([]);
  const [clearedLogOffset, setClearedLogOffset] = useState(0);
  const [logQuery, setLogQuery] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);

  const previewEndpoint = `/api/workspace/projects/${encodeURIComponent(project.id)}/preview`;
  const load = useCallback(async () => {
    const result = await fetchJson<PreviewResponse>(previewEndpoint);
    setData(result.preview);
    setCapability(result.capability || null);
    return result.preview;
  }, [previewEndpoint]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setCapability(null);
    setNotice("");
    setRouteHistory(["/"]);
    setRouteIndex(0);
    setRouteInput("/");
    void load().catch((error) => setNotice(error instanceof Error ? error.message : "Preview evidence unavailable.")).finally(() => setLoading(false));
  }, [load, project.id]);

  useEffect(() => {
    if (!data || !["starting", "running"].includes(data.state)) return;
    const timer = window.setInterval(() => {
      void fetchJson<PreviewResponse>(`${previewEndpoint}/health`, { method: "POST" }).then((result) => setData(result.preview)).catch(() => undefined);
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [data?.state, previewEndpoint]);

  useEffect(() => {
    if (!data || !onInspectorContext) return;
    onInspectorContext({
      kind: "preview-runtime",
      title: `${project.name} Preview`,
      projectName: project.name,
      preview: { ...data, capability: capability || undefined },
    });
  }, [capability, data, onInspectorContext, project.name]);

  const perform = async (operation: "start" | "health" | "restart" | "stop") => {
    setBusy(operation);
    setNotice("");
    onExecution({ label: `Preview ${operation}`, command: data?.command || capability?.command, state: "RUNNING", source: "Canonical Preview runtime" });
    try {
      const result = await fetchJson<PreviewResponse>(`${previewEndpoint}/${operation}`, { method: "POST" });
      setData(result.preview);
      onExecution({
        label: `Preview ${operation}`,
        command: result.preview.command || capability?.command,
        state: result.preview.state.toUpperCase(),
        source: "Canonical Preview runtime",
        message: result.preview.error || result.preview.health?.detail,
        output: result.preview.logs.join("\n"),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Preview operation failed.";
      setNotice(message);
      onExecution({ label: `Preview ${operation}`, state: "FAILED", source: "Canonical Preview runtime", message });
      await load().catch(() => undefined);
    } finally { setBusy(""); }
  };

  const baseUrl = data?.url;
  const activeRoute = routeHistory[routeIndex] || "/";
  const currentUrl = useMemo(() => {
    if (!baseUrl) return "";
    try { return new URL(activeRoute, baseUrl).toString(); }
    catch { return baseUrl; }
  }, [activeRoute, baseUrl]);
  const frameUrl = currentUrl ? `${currentUrl}${currentUrl.includes("?") ? "&" : "?"}__kforge_reload=${frameVersion}` : "";
  const profile = PREVIEW_VIEWPORTS[viewport];
  const canMutate = project.trust === "trusted";
  const canStart = Boolean(capability?.available && canMutate && data && !["starting", "running"].includes(data.state));
  const canStop = Boolean(canMutate && data && ["starting", "running"].includes(data.state));
  const canRestart = Boolean(canMutate && data && ["starting", "running", "failed", "stopped"].includes(data.state) && capability?.available);
  const embedBlocked = data?.embedding?.state === "BLOCKED";
  const liveFrame = Boolean(currentUrl && data?.state === "running" && data.health?.ok && !embedBlocked);

  const navigateRoute = (value: string) => {
    if (!baseUrl) return;
    try {
      const candidate = new URL(value.trim() || "/", baseUrl);
      if (candidate.origin !== new URL(baseUrl).origin) throw new Error("Preview navigation is limited to the active project origin.");
      const route = `${candidate.pathname}${candidate.search}${candidate.hash}` || "/";
      const next = [...routeHistory.slice(0, routeIndex + 1), route];
      setRouteHistory(next);
      setRouteIndex(next.length - 1);
      setRouteInput(route);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Invalid Preview route."); }
  };

  const visibleLogs = (logsPaused ? pausedLogs : (data?.logs || []))
    .slice(clearedLogOffset)
    .filter((line) => !errorsOnly || /error|failed|exception|fatal/i.test(line))
    .filter((line) => !logQuery || line.toLowerCase().includes(logQuery.toLowerCase()));

  if (loading) return <div className="kw-preview-loading" role="status"><RefreshCcw className="kw-spin" size={18} /><strong>Reconciling canonical Preview evidence…</strong><small>{project.path}</small></div>;

  return <section className="kw-preview" aria-label="KForge Preview Workbench" data-preview-state={data?.state || "unknown"}>
    <div className="kw-preview-toolbar" role="toolbar" aria-label="Preview controls">
      <div className="kw-preview-nav">
        <button aria-label="Preview back" title="Back" disabled={routeIndex === 0} onClick={() => { const next = routeIndex - 1; setRouteIndex(next); setRouteInput(routeHistory[next]); }}><ArrowLeft size={15} /></button>
        <button aria-label="Preview forward" title="Forward" disabled={routeIndex >= routeHistory.length - 1} onClick={() => { const next = routeIndex + 1; setRouteIndex(next); setRouteInput(routeHistory[next]); }}><ArrowRight size={15} /></button>
        <button aria-label="Reload preview frame" title="Reload" disabled={!liveFrame} onClick={() => setFrameVersion((value) => value + 1)}><RotateCw size={15} /></button>
        <button aria-label="Preview home" title="Root route" disabled={!baseUrl} onClick={() => navigateRoute("/")}><Home size={15} /></button>
      </div>
      <form className="kw-preview-location" onSubmit={(event) => { event.preventDefault(); navigateRoute(routeInput); }}>
        <span aria-hidden="true">{data?.port ? `:${data.port}` : "—"}</span>
        <input aria-label="Preview URL or route" value={baseUrl ? routeInput : "No active Preview URL"} disabled={!baseUrl} onChange={(event) => setRouteInput(event.target.value)} />
      </form>
      <div className="kw-preview-toolset">
        <select aria-label="Preview viewport" value={viewport} onChange={(event) => setViewport(event.target.value as ViewportId)}>{Object.entries(PREVIEW_VIEWPORTS).map(([id, item]) => <option key={id} value={id}>{item.label}{item.width ? ` ${item.width}×${item.height}` : ""}</option>)}</select>
        <select aria-label="Preview zoom" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>{[50, 75, 100, 125].map((value) => <option key={value} value={value}>{value}%</option>)}</select>
        <button aria-label="Fit preview" title="Fit preview" onClick={() => { setViewport("responsive"); setZoom(100); }}><Maximize2 size={15} /></button>
        <button aria-label="Copy preview URL" title="Copy URL" disabled={!currentUrl} onClick={() => void navigator.clipboard.writeText(currentUrl).then(() => setNotice("Current Preview URL copied.")).catch(() => setNotice("Clipboard access is unavailable."))}><Clipboard size={15} /></button>
        <button aria-label="Open preview externally" title="Open external" disabled={!currentUrl} onClick={() => window.open(currentUrl, "_blank", "noopener,noreferrer")}><ExternalLink size={15} /></button>
      </div>
    </div>

    <div className="kw-preview-status" role="status">
      <StatusBadge value={data?.state || "NOT_EVALUATED"} />
      <StatusBadge value={data?.health?.ok ? "HEALTHY" : data?.checkedAt ? "UNHEALTHY" : "NOT_CHECKED"} />
      <span>{data?.port ? `localhost:${data.port}` : "No port"}</span>
      <span>{data?.pid ? `PID ${data.pid}` : "No process"}</span>
      <span>{data?.health?.latencyMs !== undefined ? `${data.health.latencyMs} ms` : "Latency not measured"}</span>
      <span>{data?.checkedAt ? `Checked ${new Date(data.checkedAt).toLocaleTimeString()}` : "Never checked"}</span>
      <div className="kw-preview-runtime-actions">
        <button disabled={!canStart || Boolean(busy)} title={!canMutate ? "Trust the project before starting Preview." : capability?.reason} onClick={() => void perform("start")}><Play size={14} />Run</button>
        <button disabled={!data || Boolean(busy)} onClick={() => void perform("health")}><HeartPulse size={14} />Health</button>
        <button disabled={!canRestart || Boolean(busy)} onClick={() => void perform("restart")}><RefreshCcw size={14} />Restart</button>
        <button disabled={!canStop || Boolean(busy)} onClick={() => void perform("stop")}><CircleStop size={14} />Stop</button>
      </div>
    </div>

    {notice && <div className="kw-preview-notice" role="alert">{notice}</div>}

    <div className="kw-preview-canvas" data-viewport={viewport}>
      {liveFrame ? <div className="kw-preview-frame-stage"><div className="kw-preview-frame-size" style={profile.width ? { width: profile.width, height: profile.height, transform: `scale(${zoom / 100})` } : { width: "100%", height: "100%" }}><iframe key={frameUrl} title={`${project.name} live Preview`} aria-label="Preview application frame" src={frameUrl} sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts" referrerPolicy="no-referrer" /></div></div>
        : embedBlocked && data?.state === "running" ? <div className="kw-preview-state is-error"><strong>PREVIEW_EMBED_BLOCKED</strong><code>{currentUrl}</code><span>{data.embedding.reason || "The Preview response blocks framing."}</span><small>The runtime remains healthy. Use Open external to view the exact current URL.</small></div>
        : data?.state === "starting" ? <div className="kw-preview-state"><RefreshCcw className="kw-spin" size={22} /><strong>Starting detected Preview runtime</strong><code>{data.command || capability?.command}</code><span>{data.port ? `Local port ${data.port} allocated` : "Allocating a local port"}</span><small>{data.health?.detail || "Waiting for the first health probe…"}</small></div>
          : ["failed", "blocked"].includes(data?.state || "") ? <div className="kw-preview-state is-error"><strong>Preview failed</strong><code>{data?.command || capability?.command || "No command"}</code><span>{data?.error || data?.health?.detail || "The runtime did not produce healthy evidence."}</span><small>Use Restart after reviewing the process logs below.</small></div>
            : <div className="kw-preview-state"><strong>{capability?.available ? "Preview is stopped" : "PREVIEW_NOT_AVAILABLE"}</strong><code>{capability?.command || "No supported HTTP Preview command detected"}</code><span>{!canMutate ? "Project trust is required before process execution." : capability?.reason || data?.health?.detail}</span><small>KForge will render the actual application only after backend-confirmed RUNNING + HEALTHY evidence.</small></div>}
    </div>

    <div className={`kw-preview-logs ${logsOpen ? "is-open" : ""}`}>
      <div className="kw-preview-logs-toolbar">
        <button aria-expanded={logsOpen} onClick={() => setLogsOpen((open) => !open)}><ChevronsUpDown size={14} />Runtime logs <span>{data?.logs.length || 0}</span></button>
        {logsOpen && <><label><Search size={13} /><input aria-label="Filter Preview logs" value={logQuery} onChange={(event) => setLogQuery(event.target.value)} placeholder="Filter logs" /></label><label><input type="checkbox" checked={errorsOnly} onChange={(event) => setErrorsOnly(event.target.checked)} /> Errors only</label><button onClick={() => { setLogsPaused((paused) => { if (!paused) setPausedLogs(data?.logs || []); return !paused; }); }}><Pause size={13} />{logsPaused ? "Resume" : "Pause"}</button><button onClick={() => setClearedLogOffset((logsPaused ? pausedLogs : data?.logs || []).length)}><Trash2 size={13} />Clear view</button></>}
      </div>
      {logsOpen && <pre tabIndex={0} aria-label="Preview process logs">{visibleLogs.length ? visibleLogs.join("\n") : "No visible process log lines."}</pre>}
    </div>
  </section>;
}

export default DeveloperSurface;

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowLeft, ArrowRight, Clipboard, ExternalLink, Expand, Home, Monitor, Pause, Play, RefreshCcw, RotateCw, Search, ShieldCheck, Smartphone, Square, Tablet, TerminalSquare, Trash2, TriangleAlert } from "lucide-react";
import type { CommandResult, ProjectSummary, WorkspaceActionDescriptor } from "@shared/workspace";
import type { SurfaceProps, RecordRow } from "./surfaceContracts";
import { fetchJson, jsonRequest } from "./api";
import { AdvancedEvidence, EmptyState, StatusBadge } from "./ui";

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
  healthHistory: Array<{ checkedAt: string; ok: boolean; status?: number; latencyMs?: number; detail: string }>;
  startupTimeline: Array<{ at: string; phase: string; detail: string }>;
  routes: Array<{ path: string; source: string; checkedAt: string }>;
  history: Array<{ at: string; event: string; detail: string }>;
  runtime: RecordRow;
  telemetry: RecordRow;
  embedding: { state: "ALLOWED" | "BLOCKED" | "UNKNOWN"; reason?: string };
  logs: string[];
  error?: string;
};

type PreviewCapability = { available: boolean; command?: string; source?: string; reason?: string };
type PreviewResponse = { preview: PreviewStatus; capability?: PreviewCapability; trust?: string };
type ActionsResponse = { actions: WorkspaceActionDescriptor[] };
type PreviewInspection = {
  projectId: string;
  sessionId?: string;
  checkedAt: string;
  route: string;
  url?: string;
  state: "COMPLETED" | "UNAVAILABLE" | "FAILED";
  source: "loopback-html-response" | "none";
  httpStatus?: number;
  contentType?: string;
  findings: Array<{ id: string; category: "accessibility" | "document" | "responsive"; state: "PASS" | "WARNING" | "NOT_TESTED"; detail: string; evidence: string }>;
  limitations: string[];
  error?: string;
};
type ViewportId = "responsive" | "desktop" | "laptop" | "tablet" | "mobile";
type DockTab = "console" | "problems" | "network" | "routes" | "health" | "qa" | "session";
type ZoomValue = "fit" | 50 | 75 | 100 | 125;
type RuntimeRunState = "NOT_RUN" | "RUNNING" | "PASSED" | "FAILED" | "BLOCKED_BY_PREVIEW";
type PreviewTab = { id: string; title: string; history: string[]; index: number };

const VIEWPORTS: Record<ViewportId, { label: string; width?: number; height?: number; icon: typeof Monitor }> = {
  responsive: { label: "Responsive", icon: Monitor },
  desktop: { label: "Desktop · 1440×900", width: 1440, height: 900, icon: Monitor },
  laptop: { label: "Laptop · 1366×768", width: 1366, height: 768, icon: Monitor },
  tablet: { label: "Tablet · 768×1024", width: 768, height: 1024, icon: Tablet },
  mobile: { label: "Mobile · 390×844", width: 390, height: 844, icon: Smartphone },
};

function PreviewStudioWorkbench({ project, onExecution, onInspectorContext }: {
  project: ProjectSummary;
  onExecution: SurfaceProps["onExecution"];
  onInspectorContext?: SurfaceProps["onInspectorContext"];
}) {
  const [data, setData] = useState<PreviewStatus | null>(null);
  const [capability, setCapability] = useState<PreviewCapability | null>(null);
  const [runtimeDescriptor, setRuntimeDescriptor] = useState<WorkspaceActionDescriptor | null>(null);
  const [runtimeResult, setRuntimeResult] = useState<CommandResult | null>(null);
  const [runtimeRunState, setRuntimeRunState] = useState<RuntimeRunState>("NOT_RUN");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [viewport, setViewport] = useState<ViewportId>("responsive");
  const [portrait, setPortrait] = useState(true);
  const [zoom, setZoom] = useState<ZoomValue>("fit");
  const [fitScale, setFitScale] = useState(1);
  const [frameVersion, setFrameVersion] = useState(0);
  const [tabs, setTabs] = useState<PreviewTab[]>([{ id: "preview-1", title: "App", history: ["/"], index: 0 }]);
  const [activeTabId, setActiveTabId] = useState("preview-1");
  const [routeInput, setRouteInput] = useState("/");
  const [dockTab, setDockTab] = useState<DockTab>("console");
  const [dockOpen, setDockOpen] = useState(true);
  const [logsPaused, setLogsPaused] = useState(false);
  const [pausedLogs, setPausedLogs] = useState<string[]>([]);
  const [clearedLogOffset, setClearedLogOffset] = useState(0);
  const [logQuery, setLogQuery] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [inspection, setInspection] = useState<PreviewInspection | null>(null);
  const [inspectionBusy, setInspectionBusy] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const previewEndpoint = `/api/workspace/projects/${encodeURIComponent(project.id)}/preview`;
  const actionsEndpoint = `/api/workspace/projects/${encodeURIComponent(project.id)}/actions`;

  const load = useCallback(async () => {
    const [previewResponse, actions] = await Promise.all([
      fetchJson<PreviewResponse>(previewEndpoint),
      fetchJson<ActionsResponse>(actionsEndpoint),
    ]);
    setData(previewResponse.preview);
    setCapability(previewResponse.capability || null);
    setRuntimeDescriptor(actions.actions.find((entry) => entry.id === "runtime") || null);
    return previewResponse.preview;
  }, [actionsEndpoint, previewEndpoint]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setCapability(null);
    setRuntimeDescriptor(null);
    setRuntimeResult(null);
    setRuntimeRunState("NOT_RUN");
    setNotice("");
    setInspection(null);
    setTabs([{ id: "preview-1", title: "App", history: ["/"], index: 0 }]);
    setActiveTabId("preview-1");
    setRouteInput("/");
    setFrameVersion(0);
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
      title: `${project.name} Preview Studio`,
      projectName: project.name,
      preview: { ...data, capability: capability || undefined, runtimeVerification: runtimeResult || undefined },
    });
  }, [capability, data, onInspectorContext, project.name, runtimeResult]);

  const baseUrl = data?.url;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];
  const routeHistory = activeTab?.history || ["/"];
  const routeIndex = activeTab?.index || 0;
  const activeRoute = routeHistory[routeIndex] || "/";
  const currentUrl = useMemo(() => {
    if (!baseUrl) return "";
    try { return new URL(activeRoute, baseUrl).toString(); }
    catch { return baseUrl; }
  }, [activeRoute, baseUrl]);
  const frameKey = currentUrl ? `${currentUrl}::${frameVersion}` : `preview-frame::${frameVersion}`;
  const profile = VIEWPORTS[viewport];
  const fixedViewport = Boolean(profile.width && profile.height);
  const viewportWidth = fixedViewport ? (portrait ? profile.width! : profile.height!) : undefined;
  const viewportHeight = fixedViewport ? (portrait ? profile.height! : profile.width!) : undefined;
  const canMutate = project.trust === "trusted";
  const previewActive = Boolean(data && ["starting", "running"].includes(data.state));
  const canStart = Boolean(capability?.available && canMutate && data && !previewActive && runtimeRunState !== "RUNNING");
  const canHealth = Boolean(data?.url && previewActive);
  const canStop = Boolean(canMutate && previewActive);
  const canRestart = Boolean(canMutate && data && ["starting", "running", "failed", "stopped"].includes(data.state) && capability?.available);
  const embedAllowed = data?.embedding?.state === "ALLOWED";
  const liveFrame = Boolean(currentUrl && data?.state === "running" && data.health?.ok && embedAllowed);

  useEffect(() => {
    if (!fixedViewport || zoom !== "fit" || !viewportWidth || !viewportHeight || !stageRef.current) {
      setFitScale(typeof zoom === "number" ? zoom / 100 : 1);
      return;
    }
    const node = stageRef.current;
    const measure = () => {
      const width = Math.max(1, node.clientWidth - 48);
      const height = Math.max(1, node.clientHeight - 48);
      setFitScale(Math.min(1, width / viewportWidth, height / viewportHeight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [fixedViewport, viewportHeight, viewportWidth, zoom]);

  useEffect(() => {
    if (!previewActive && runtimeRunState === "BLOCKED_BY_PREVIEW") setRuntimeRunState("NOT_RUN");
    if (previewActive && runtimeRunState === "NOT_RUN") setRuntimeRunState("BLOCKED_BY_PREVIEW");
  }, [previewActive, runtimeRunState]);

  const perform = async (operation: "start" | "health" | "restart" | "stop") => {
    setBusy(operation);
    setNotice("");
    onExecution({ label: `Preview ${operation}`, command: data?.command || capability?.command, state: "RUNNING", source: "Canonical Preview runtime" });
    try {
      const result = await fetchJson<PreviewResponse>(`${previewEndpoint}/${operation}`, { method: "POST" });
      setData(result.preview);
      if (operation === "start" || operation === "restart") {
        setRuntimeRunState("BLOCKED_BY_PREVIEW");
        setRuntimeResult(null);
      }
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

  const verifyRuntime = async () => {
    if (!runtimeDescriptor?.enabled || runtimeRunState === "RUNNING") return;
    if (previewActive) {
      setRuntimeRunState("BLOCKED_BY_PREVIEW");
      setNotice("Preview Studio already owns the live app process. Use Health for this session instead of launching a second runtime verification process.");
      return;
    }
    setRuntimeRunState("RUNNING");
    setRuntimeResult(null);
    setNotice("Running short-lived runtime verification…");
    onExecution({ label: runtimeDescriptor.label, command: runtimeDescriptor.command, state: "RUNNING", source: runtimeDescriptor.source });
    try {
      const result = await fetchJson<CommandResult>(actionsEndpoint, jsonRequest({ action: "runtime" }));
      setRuntimeResult(result);
      setRuntimeRunState(result.ok ? "PASSED" : "FAILED");
      setNotice(result.message);
      onExecution({ label: runtimeDescriptor.label, command: runtimeDescriptor.command, state: result.ok ? "PASS" : "FAILED", source: runtimeDescriptor.source, startedAt: result.startedAt, completedAt: result.completedAt, output: result.output, message: result.message, exitCode: result.exitCode });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Runtime verification failed.";
      setRuntimeRunState("FAILED");
      setNotice(message);
      onExecution({ label: runtimeDescriptor.label, command: runtimeDescriptor.command, state: "FAILED", source: runtimeDescriptor.source, message });
    }
  };

  const navigateRoute = (value: string) => {
    if (!baseUrl) return;
    try {
      const candidate = new URL(value.trim() || "/", baseUrl);
      if (candidate.origin !== new URL(baseUrl).origin) throw new Error("Preview navigation is limited to the active project loopback origin.");
      const route = `${candidate.pathname}${candidate.search}${candidate.hash}` || "/";
      setTabs((current) => current.map((tab) => tab.id === activeTabId ? { ...tab, title: route === "/" ? "App" : route.split("/").filter(Boolean).pop()?.slice(0, 22) || "App", history: [...tab.history.slice(0, tab.index + 1), route], index: tab.index + 1 } : tab));
      setRouteInput(route);
      setNotice("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Invalid Preview route."); }
  };

  const goHistory = (direction: -1 | 1) => {
    const nextIndex = routeIndex + direction;
    if (nextIndex < 0 || nextIndex >= routeHistory.length) return;
    setTabs((current) => current.map((tab) => tab.id === activeTabId ? { ...tab, index: nextIndex } : tab));
    setRouteInput(routeHistory[nextIndex] || "/");
  };

  const addTab = () => {
    const id = `preview-${Date.now()}`;
    setTabs((current) => [...current, { id, title: "New preview", history: ["/"], index: 0 }]);
    setActiveTabId(id);
    setRouteInput("/");
  };

  const closeTab = (id: string) => {
    setTabs((current) => {
      if (current.length === 1) return current;
      const index = current.findIndex((tab) => tab.id === id);
      const next = current.filter((tab) => tab.id !== id);
      if (id === activeTabId) {
        const fallback = next[Math.max(0, index - 1)] || next[0];
        setActiveTabId(fallback.id);
        setRouteInput(fallback.history[fallback.index] || "/");
      }
      return next;
    });
  };

  const copyUrl = async () => {
    if (!currentUrl) return;
    try { await navigator.clipboard.writeText(currentUrl); setNotice("Preview URL copied."); }
    catch { setNotice("Clipboard access is unavailable in this runtime."); }
  };

  const fullscreen = async () => {
    if (!stageRef.current) return;
    try { await stageRef.current.requestFullscreen(); }
    catch { setNotice("Fullscreen could not be entered in this host runtime."); }
  };

  const visibleLogs = (logsPaused ? pausedLogs : (data?.logs || []))
    .slice(clearedLogOffset)
    .filter((line) => !errorsOnly || /error|failed|exception|fatal|warn/i.test(line))
    .filter((line) => !logQuery || line.toLowerCase().includes(logQuery.toLowerCase()));

  const runtimeProblems = useMemo(() => {
    if (!data) return [];
    const items: Array<{ id: string; severity: "error" | "warning" | "info"; title: string; detail: string }> = [];
    if (data.error) items.push({ id: "runtime-error", severity: "error", title: "Runtime reported an error", detail: data.error });
    if (data.checkedAt && !data.health?.ok) items.push({ id: "health-failure", severity: "error", title: "Health probe is not responding", detail: data.health?.detail || "No responding health evidence." });
    if (data.embedding.state !== "ALLOWED") items.push({ id: "embedding", severity: data.embedding.state === "BLOCKED" ? "warning" : "info", title: "Inline inspection is limited", detail: data.embedding.reason || "The framing policy is not proven." });
    const warningLogs = data.logs.filter((line) => /error|failed|exception|fatal|warn/i.test(line)).slice(-20);
    warningLogs.forEach((line, index) => items.push({ id: `log-${index}`, severity: /error|failed|exception|fatal/i.test(line) ? "error" : "warning", title: "Process output", detail: line }));
    return items;
  }, [data]);

  const runInspection = async () => {
    setInspectionBusy(true);
    setNotice("");
    try {
      const result = await fetchJson<{ inspection: PreviewInspection }>(`${previewEndpoint}/inspect`, jsonRequest({ route: activeRoute }));
      setInspection(result.inspection);
      setDockTab("qa");
      setDockOpen(true);
      setNotice(result.inspection.state === "COMPLETED" ? "Document evidence captured from the active loopback response." : result.inspection.error || "Document inspection is unavailable.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Document inspection failed."); }
    finally { setInspectionBusy(false); }
  };

  if (loading) return <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground" role="status"><span className="inline-flex items-center gap-2"><RefreshCcw className="animate-spin" size={16} /> Reconciling Preview Studio runtime evidence…</span></div>;
  if (!data) return <EmptyState title="Preview evidence unavailable" detail={notice || "KForge could not read the canonical Preview runtime."} action={<button onClick={() => void load()}>Retry</button>} />;

  const ViewportIcon = profile.icon;
  const stageWidth = fixedViewport && viewportWidth ? Math.round(viewportWidth * fitScale) : undefined;
  const stageHeight = fixedViewport && viewportHeight ? Math.round(viewportHeight * fitScale) : undefined;

  return <section className="flex min-h-0 flex-col gap-3" aria-label="KForge Preview Workbench" data-preview-state={data.state} data-preview-studio="3">
    <header className="rounded-xl border bg-card shadow-sm">
      <div className="flex min-h-10 items-center gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${data.state === "running" && data.health?.ok ? "bg-emerald-500" : data.state === "starting" ? "bg-amber-500" : "bg-muted-foreground/40"}`} aria-hidden="true" />
          <strong className="truncate text-xs">App Preview</strong>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">{project.name}</span>
        </div>
        <div className="kw-preview-status flex flex-wrap items-center justify-end gap-1.5 text-[11px]">
          <StatusBadge value={data.state.toUpperCase()} />
          <StatusBadge value={data.health?.ok ? "HEALTHY" : data.checkedAt ? "UNHEALTHY" : "NOT_CHECKED"} />
          <StatusBadge value={data.embedding.state} />
        </div>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto border-b px-2 py-1">
        <div className="flex items-center gap-1" role="tablist" aria-label="Preview browser tabs">
          {tabs.map((tab) => <button key={tab.id} role="tab" aria-selected={tab.id === activeTabId} className={`shrink-0 rounded-md border text-xs ${tab.id === activeTabId ? "bg-background" : "bg-muted/20"}`} onClick={() => { setActiveTabId(tab.id); setRouteInput(tab.history[tab.index] || "/"); }}>{tab.title}</button>)}
        </div>
        <button className="shrink-0" aria-label="New Preview tab" onClick={addTab}>＋</button>
        <button className="shrink-0" aria-label="Close active Preview tab" disabled={tabs.length === 1} onClick={() => closeTab(activeTabId)}>×</button>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">One runtime · {tabs.length} route context{tabs.length === 1 ? "" : "s"}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2" role="toolbar" aria-label="Preview controls">
        <button aria-label="Preview back" title="Back" disabled={routeIndex === 0} onClick={() => goHistory(-1)}><ArrowLeft size={15} /></button>
        <button aria-label="Preview forward" title="Forward" disabled={routeIndex >= routeHistory.length - 1} onClick={() => goHistory(1)}><ArrowRight size={15} /></button>
        <button aria-label="Preview home" title="Home" disabled={!baseUrl} onClick={() => navigateRoute("/")}><Home size={15} /></button>
        <button aria-label="Reload preview frame" title="Reload frame" disabled={!currentUrl} onClick={() => setFrameVersion((value) => value + 1)}><RefreshCcw size={15} /></button>
        <form className="mx-1 flex min-w-[220px] flex-1 items-center gap-2 rounded-md border bg-background px-2" onSubmit={(event) => { event.preventDefault(); navigateRoute(routeInput); }}>
          <span className="text-[10px] font-semibold text-emerald-800 dark:text-emerald-300">LOCAL</span>
          <input aria-label="Preview address" className="min-w-0 flex-1 border-0 bg-transparent px-0 py-1.5 text-xs outline-none" value={routeInput} disabled={!baseUrl} onChange={(event) => setRouteInput(event.target.value)} placeholder="/" />
        </form>
        <button aria-label="Copy preview URL" title="Copy URL" disabled={!currentUrl} onClick={() => void copyUrl()}><Clipboard size={15} /></button>
        <button aria-label="Open preview in new tab" title="Open externally" disabled={!currentUrl} onClick={() => currentUrl && window.open(currentUrl, "_blank", "noopener,noreferrer")}><ExternalLink size={15} /></button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <button disabled={!canStart || Boolean(busy)} onClick={() => void perform("start")}><Play size={14} /> Run</button>
        <button disabled={!canHealth || Boolean(busy)} onClick={() => void perform("health")}><RefreshCcw size={14} /> Health</button>
        <button disabled={!canRestart || Boolean(busy)} onClick={() => void perform("restart")}><RotateCw size={14} /> Restart</button>
        <button disabled={!canStop || Boolean(busy)} onClick={() => void perform("stop")}><Square size={14} /> Stop</button>
      </div>
    </header>

    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card/80 px-3 py-2" aria-label="Preview device laboratory">
      <ViewportIcon size={15} className="text-muted-foreground" />
      <label className="sr-only" htmlFor="preview-viewport">Preview viewport</label>
      <select id="preview-viewport" aria-label="Preview viewport" value={viewport} onChange={(event) => { setViewport(event.target.value as ViewportId); setZoom("fit"); }}>
        {Object.entries(VIEWPORTS).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
      </select>
      <button aria-label="Rotate viewport" title="Rotate viewport" disabled={!fixedViewport} onClick={() => setPortrait((value) => !value)}><RotateCw size={14} /> Rotate</button>
      <label className="text-xs text-muted-foreground" htmlFor="preview-zoom">Zoom</label>
      <select id="preview-zoom" aria-label="Preview zoom" value={String(zoom)} onChange={(event) => setZoom(event.target.value === "fit" ? "fit" : Number(event.target.value) as ZoomValue)}>
        <option value="fit">Fit</option><option value="50">50%</option><option value="75">75%</option><option value="100">100%</option><option value="125">125%</option>
      </select>
      <span className="text-[11px] text-muted-foreground">{fixedViewport && viewportWidth && viewportHeight ? `${viewportWidth}×${viewportHeight} · ${Math.round(fitScale * 100)}% rendered` : "Fluid canvas"}</span>
      <button className="ml-auto" aria-label="Fullscreen Preview canvas" onClick={() => void fullscreen()}><Expand size={14} /> Fullscreen</button>
      <button aria-label="Inspect delivered Preview document" disabled={!liveFrame || inspectionBusy} onClick={() => void runInspection()}><ShieldCheck size={14} /> {inspectionBusy ? "Inspecting…" : "Inspect HTML"}</button>
    </div>

    <div className="grid min-h-[560px] flex-1 gap-3 xl:grid-rows-[minmax(420px,1fr)_auto]">
      <div ref={stageRef} className="relative min-h-[420px] overflow-auto rounded-xl border bg-muted/20 p-6" aria-label="Preview canvas">
        <div className="pointer-events-none absolute inset-0 opacity-30" style={{ backgroundImage: "radial-gradient(currentColor 0.6px, transparent 0.6px)", backgroundSize: "16px 16px" }} aria-hidden="true" />
        <div className="relative flex min-h-full items-start justify-center">
          {liveFrame ? <div className="relative overflow-hidden rounded-lg border bg-background shadow-2xl" style={fixedViewport && stageWidth && stageHeight ? { width: stageWidth, height: stageHeight } : { width: "100%", minHeight: 520 }}>
            <iframe
              key={frameKey}
              aria-label="Preview application frame"
              src={currentUrl}
              className="origin-top-left border-0 bg-white"
              style={fixedViewport && viewportWidth && viewportHeight ? { width: viewportWidth, height: viewportHeight, transform: `scale(${fitScale})` } : { width: "100%", height: "100%", minHeight: 520 }}
              sandbox="allow-forms allow-modals allow-popups allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
            />
          </div> : <div className="relative m-auto max-w-xl rounded-2xl border bg-card/95 p-7 text-center shadow-lg">
            {data.state === "unavailable" || !capability?.available ? <>
              <StatusBadge value="PREVIEW_NOT_AVAILABLE" />
              <h3 className="mt-4 text-base font-semibold">No HTTP Preview command detected</h3>
              <p className="mt-2 text-sm text-muted-foreground">{capability?.reason || data.error || "KForge will not invent an embeddable application when project metadata does not prove one."}</p>
            </> : data.embedding.state !== "ALLOWED" && data.state === "running" ? <>
              <StatusBadge value={data.embedding.state} />
              <h3 className="mt-4 text-base font-semibold">Embedding is not proven safe</h3>
              <p className="mt-2 text-sm text-muted-foreground">{data.embedding.reason || "Preview response framing policy could not be proven to allow KForge."}</p>
              <button className="mt-4" disabled={!currentUrl} onClick={() => currentUrl && window.open(currentUrl, "_blank", "noopener,noreferrer")}><ExternalLink size={14} /> Open local app externally</button>
            </> : data.state === "stopped" ? <>
              <StatusBadge value="STOPPED" />
              <h3 className="mt-4 text-base font-semibold">Preview is stopped</h3>
              <p className="mt-2 text-sm text-muted-foreground">The previous session has ended. Start a new canonical Preview session when you want the live app again.</p>
              <button className="mt-4" aria-label="Start Preview from canvas" disabled={!canStart} onClick={() => void perform("start")}><Play size={14} /> Run</button>
            </> : <>
              <StatusBadge value={data.state.toUpperCase()} />
              <h3 className="mt-4 text-base font-semibold">{data.state === "starting" ? "Starting local app…" : "Preview Studio is ready"}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{data.state === "starting" ? data.health?.detail || "Waiting for loopback health." : "Start the detected local HTTP runtime. KForge allocates the port and never contacts a remote host for core Preview."}</p>
              {data.state !== "starting" ? <button className="mt-4" aria-label="Start Preview from canvas" disabled={!canStart} onClick={() => void perform("start")}><Play size={14} /> Run</button> : null}
            </>}
          </div>}
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border bg-card" aria-label="Preview evidence dock">
        <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
          <button aria-pressed={dockTab === "console"} onClick={() => { setDockTab("console"); setDockOpen(true); }}><TerminalSquare size={14} /> Console <span className="text-[10px] text-muted-foreground">{data.logs.length}</span></button>
          <button aria-pressed={dockTab === "problems"} onClick={() => { setDockTab("problems"); setDockOpen(true); }}><TriangleAlert size={14} /> Problems <span className="text-[10px] text-muted-foreground">{runtimeProblems.length}</span></button>
          <button aria-pressed={dockTab === "network"} onClick={() => { setDockTab("network"); setDockOpen(true); }}><Activity size={14} /> Network <span className="text-[10px] text-muted-foreground">{data.healthHistory.length}</span></button>
          <button aria-pressed={dockTab === "routes"} onClick={() => { setDockTab("routes"); setDockOpen(true); }}>Routes <span className="text-[10px] text-muted-foreground">{data.routes.length}</span></button>
          <button aria-pressed={dockTab === "health"} onClick={() => { setDockTab("health"); setDockOpen(true); }}>Health timeline <span className="text-[10px] text-muted-foreground">{data.healthHistory.length}</span></button>
          <button aria-pressed={dockTab === "qa"} onClick={() => { setDockTab("qa"); setDockOpen(true); }}><ShieldCheck size={14} /> Visual &amp; A11y QA</button>
          <button aria-pressed={dockTab === "session"} onClick={() => { setDockTab("session"); setDockOpen(true); }}>Session</button>
          <button className="ml-auto" aria-expanded={dockOpen} onClick={() => setDockOpen((value) => !value)}>{dockOpen ? "Collapse" : "Expand"}</button>
        </div>

        {dockOpen && dockTab === "console" ? <div className="kw-preview-logs p-3" aria-label="Preview console output">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-md border bg-background px-2"><Search size={13} /><input className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-xs outline-none" aria-label="Filter Preview logs" value={logQuery} onChange={(event) => setLogQuery(event.target.value)} placeholder="Filter process output…" /></div>
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={errorsOnly} onChange={(event) => setErrorsOnly(event.target.checked)} /> Errors / warnings</label>
            <button aria-label={logsPaused ? "Resume Preview logs" : "Pause Preview logs"} onClick={() => { if (!logsPaused) setPausedLogs(data.logs); setLogsPaused((value) => !value); }}>{logsPaused ? <Play size={13} /> : <Pause size={13} />} {logsPaused ? "Resume" : "Pause"}</button>
            <button aria-label="Clear visible Preview logs" onClick={() => setClearedLogOffset((logsPaused ? pausedLogs : data.logs).length)}><Trash2 size={13} /> Clear view</button>
          </div>
          <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/35 p-3 font-mono text-[11px]" tabIndex={0}>{visibleLogs.length ? visibleLogs.join("\n") : "No visible process output. Clearing this view never deletes canonical runtime evidence."}</pre>
          <p className="mt-2 text-[11px] text-muted-foreground">Captured source: process stdout/stderr. Browser console is {data.telemetry.browserConsoleCaptured === true ? "captured" : "NOT_CAPTURED"}; KForge does not fabricate browser console events.</p>
        </div> : null}

        {dockOpen && dockTab === "problems" ? <div className="p-3" aria-label="Preview runtime problems">
          {runtimeProblems.length ? <div className="grid gap-2">{runtimeProblems.map((item) => <article key={item.id} className="rounded-lg border p-3 text-xs"><div className="flex items-center gap-2"><StatusBadge value={item.severity.toUpperCase()} /><strong>{item.title}</strong></div><p className="mt-2 break-words text-muted-foreground">{item.detail}</p></article>)}</div> : <p className="text-sm text-muted-foreground">No problems are derived from current process output, health, or embedding evidence. This is not a static-analysis claim.</p>}
        </div> : null}

        {dockOpen && dockTab === "network" ? <div className="p-3" aria-label="Preview network observations">
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-xs"><strong>Observed channel · loopback health probes only</strong><p className="mt-1 text-muted-foreground">KForge has not installed a browser request bridge, so this panel does not claim application request waterfalls, transfer sizes, initiators, cache state, or throttling.</p></div>
          <div className="mt-3 grid gap-2">{data.healthHistory.slice(-20).reverse().map((item) => <div key={`${item.checkedAt}:${item.status ?? "none"}`} className="grid gap-2 rounded-lg border p-2 text-xs sm:grid-cols-[120px_80px_90px_minmax(0,1fr)]"><span>{new Date(item.checkedAt).toLocaleTimeString()}</span><span>{item.status ? `HTTP ${item.status}` : "NO HTTP"}</span><span>{item.latencyMs !== undefined ? `${item.latencyMs} ms` : "not measured"}</span><span>{item.detail}</span></div>)}</div>
        </div> : null}

        {dockOpen && dockTab === "routes" ? <div className="p-3" aria-label="Preview discovered routes">
          <div className="flex flex-wrap gap-2">{data.routes.length ? data.routes.map((route) => <button key={`${route.path}:${route.checkedAt}`} aria-pressed={activeRoute === route.path} onClick={() => navigateRoute(route.path)}><code>{route.path}</code><span className="ml-2 text-[10px] text-muted-foreground">{route.source}</span></button>) : <p className="text-sm text-muted-foreground">No route evidence exists yet.</p>}</div>
          <p className="mt-3 text-[11px] text-muted-foreground">Routes are derived only from same-origin links observed during the local health probe.</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Address navigation is constrained to {baseUrl ? new URL(baseUrl).origin : "the allocated loopback origin"}. KForge will not navigate this iframe to an external origin.</p>
        </div> : null}

        {dockOpen && dockTab === "health" ? <div className="p-3" aria-label="Preview health history">
          {data.healthHistory.length ? <div className="grid gap-2">{data.healthHistory.slice(-12).reverse().map((item) => <div key={`${item.checkedAt}:${item.status ?? "none"}`} className="grid gap-2 rounded-lg border p-2 text-xs sm:grid-cols-[120px_90px_90px_minmax(0,1fr)]"><span>{new Date(item.checkedAt).toLocaleTimeString()}</span><StatusBadge value={item.ok ? "HEALTHY" : "UNHEALTHY"} /><span>{item.latencyMs !== undefined ? `${item.latencyMs} ms` : "NO LATENCY"}</span><span className="truncate" title={item.detail}>{item.status ? `HTTP ${item.status} · ` : ""}{item.detail}</span></div>)}</div> : <p className="text-sm text-muted-foreground">No health samples exist yet.</p>}
        </div> : null}

        {dockOpen && dockTab === "qa" ? <div className="p-3" aria-label="Preview visual and accessibility QA">
          <div className="flex flex-wrap items-center gap-2"><div><h3 className="text-sm font-semibold">Delivered-document QA</h3><p className="text-xs text-muted-foreground">Evidence is captured from the active route's loopback HTML response.</p></div><button className="ml-auto" disabled={!liveFrame || inspectionBusy} onClick={() => void runInspection()}>{inspectionBusy ? "Inspecting…" : "Run inspection"}</button></div>
          {inspection ? <><div className="mt-3 flex flex-wrap items-center gap-2"><StatusBadge value={inspection.state} /><span className="text-xs">{inspection.route}</span><span className="text-xs text-muted-foreground">{new Date(inspection.checkedAt).toLocaleString()}</span></div>{inspection.error ? <p className="mt-3 text-xs text-destructive">{inspection.error}</p> : null}<div className="mt-3 grid gap-2 lg:grid-cols-2">{inspection.findings.map((finding) => <article key={finding.id} className="rounded-lg border p-3 text-xs"><div className="flex items-center gap-2"><StatusBadge value={finding.state} /><strong>{finding.category}</strong></div><p className="mt-2">{finding.detail}</p><code className="mt-2 block break-words text-[10px] text-muted-foreground">{finding.evidence}</code></article>)}</div><div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs"><strong>Truth boundary</strong>{inspection.limitations.map((item) => <p key={item} className="mt-1 text-muted-foreground">{item}</p>)}</div></> : <p className="mt-3 text-sm text-muted-foreground">No QA evidence has been captured for this route. Run inspection while the canonical Preview is healthy.</p>}
        </div> : null}

        {dockOpen && dockTab === "session" ? <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.75fr)]" aria-label="Preview session evidence">
          <div className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Canonical live session</h3><StatusBadge value={data.state.toUpperCase()} /></div>
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Session ID</dt><dd className="break-all">{data.sessionId || "NO_ACTIVE_SESSION"}</dd></div>
              <div><dt className="text-muted-foreground">PID</dt><dd>{data.pid ?? "NOT_RUNNING"}</dd></div>
              <div><dt className="text-muted-foreground">Port</dt><dd>{data.port ?? "NOT_ALLOCATED"}</dd></div>
              <div><dt className="text-muted-foreground">Started</dt><dd>{data.startedAt ? new Date(data.startedAt).toLocaleString() : "NEVER"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-muted-foreground">Command</dt><dd><code className="break-all">{data.command || capability?.command || "NOT_AVAILABLE"}</code></dd></div>
              <div><dt className="text-muted-foreground">Source</dt><dd>{capability?.source || "Detected project metadata"}</dd></div>
              <div><dt className="text-muted-foreground">Embedding</dt><dd>{data.embedding.state}</dd></div>
            </dl>
            <div className="mt-3"><h4 className="text-xs font-semibold">Startup timeline</h4><ol className="mt-2 grid gap-1.5">{data.startupTimeline.length ? data.startupTimeline.map((entry) => <li key={`${entry.at}:${entry.phase}`} className="grid gap-1 rounded border p-2 text-[11px] sm:grid-cols-[90px_90px_minmax(0,1fr)]"><span>{new Date(entry.at).toLocaleTimeString()}</span><strong>{entry.phase}</strong><span className="text-muted-foreground">{entry.detail}</span></li>) : <li className="text-xs text-muted-foreground">No startup events exist for this session.</li>}</ol></div>
            <div className="mt-3"><AdvancedEvidence value={{ runtime: data.runtime, telemetry: data.telemetry, embedding: data.embedding, history: data.history }} label="Advanced · Preview session evidence" /></div>
          </div>

          <div className="rounded-lg border p-3" aria-label="Runtime verification integration">
            <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-semibold">Runtime verifier</h3><StatusBadge value={runtimeRunState} /></div>
            <p className="mt-2 text-xs text-muted-foreground">This is the short-lived runtime verification authority. It is deliberately disabled while Preview owns the long-running app process.</p>
            <dl className="mt-3 grid gap-2 text-xs"><div><dt className="text-muted-foreground">Detected command</dt><dd><code>{runtimeDescriptor?.command || "NO_RUNTIME_EVIDENCE"}</code></dd></div><div><dt className="text-muted-foreground">Network</dt><dd>{runtimeDescriptor?.requiresNetwork ? "REQUIRED" : "NOT_REQUIRED"}</dd></div></dl>
            <button className="mt-3" disabled={!runtimeDescriptor?.enabled || previewActive || runtimeRunState === "RUNNING"} onClick={() => void verifyRuntime()}>{runtimeRunState === "RUNNING" ? "Verifying…" : "Verify runtime"}</button>
            {previewActive ? <p className="mt-2 text-[11px] text-muted-foreground">Disabled: Preview session {data.sessionId || "active"} owns PID {data.pid ?? "unknown"}. Health is the correct evidence source while it is live.</p> : null}
            {runtimeResult ? <div className="mt-3"><AdvancedEvidence value={runtimeResult} label="Advanced · Runtime verification result" /></div> : null}
          </div>
        </div> : null}
      </section>
    </div>

    <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border bg-card/70 px-3 py-2 text-[11px] text-muted-foreground">
      <span>Command · <code>{data.command || capability?.command || "NOT_AVAILABLE"}</code></span>
      <span>Source · {capability?.source || "UNKNOWN"}</span>
      <span>PID · {data.pid ?? "—"}</span>
      <span>Port · {data.port ?? "—"}</span>
      <span>Health · {data.health?.latencyMs !== undefined ? `${data.health.latencyMs} ms` : "not measured"}</span>
      <span>Network · loopback only</span>
    </footer>

    {notice ? <p className="kw-message" role="status">{notice}</p> : null}
  </section>;
}

export default PreviewStudioWorkbench;

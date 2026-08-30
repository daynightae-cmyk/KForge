import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Maximize2, Minimize2, Monitor, PanelBottom, PanelRight, Play, RefreshCcw, RotateCw, Smartphone, Square, Tablet, X } from "lucide-react";
import type { ProjectSummary } from "@shared/workspace";
import { fetchJson } from "./api";
import { StatusBadge } from "./ui";

type PreviewStatus = {
  projectId: string;
  sessionId?: string;
  state: "idle" | "starting" | "running" | "failed" | "stopped" | "blocked" | "unavailable";
  command?: string;
  url?: string;
  pid?: number;
  port?: number;
  checkedAt?: string;
  health?: { ok: boolean; status?: number; latencyMs?: number; detail: string };
  embedding: { state: "ALLOWED" | "BLOCKED" | "UNKNOWN"; reason?: string };
  error?: string;
};

type PreviewCapability = { available: boolean; command?: string; source?: string; reason?: string };
type PreviewResponse = { preview: PreviewStatus; capability?: PreviewCapability; trust?: string };
type DockLayout = "floating" | "side" | "bottom";
type Viewport = "fluid" | "desktop" | "tablet" | "mobile";
type PersistedDock = { open: boolean; minimized: boolean; layout: DockLayout; viewport: Viewport; routes: Record<string, string[]>; routeIndexes: Record<string, number> };

const STORAGE_KEY = "kforge:persistent-preview:v1";
const VIEWPORTS: Record<Viewport, { label: string; width?: number; height?: number; icon: typeof Monitor }> = {
  fluid: { label: "Fluid", icon: Monitor },
  desktop: { label: "Desktop 1440×900", width: 1440, height: 900, icon: Monitor },
  tablet: { label: "Tablet 768×1024", width: 768, height: 1024, icon: Tablet },
  mobile: { label: "Mobile 390×844", width: 390, height: 844, icon: Smartphone },
};

const defaults: PersistedDock = { open: true, minimized: false, layout: "floating", viewport: "fluid", routes: {}, routeIndexes: {} };

function readPersisted(): PersistedDock {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<PersistedDock>;
    return {
      open: parsed.open !== false,
      minimized: parsed.minimized === true,
      layout: ["floating", "side", "bottom"].includes(String(parsed.layout)) ? parsed.layout as DockLayout : "floating",
      viewport: ["fluid", "desktop", "tablet", "mobile"].includes(String(parsed.viewport)) ? parsed.viewport as Viewport : "fluid",
      routes: parsed.routes && typeof parsed.routes === "object" ? parsed.routes : {},
      routeIndexes: parsed.routeIndexes && typeof parsed.routeIndexes === "object" ? parsed.routeIndexes : {},
    };
  } catch { return defaults; }
}

function persist(value: PersistedDock) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); }
  catch { /* Host storage can be disabled; the dock remains functional for this session. */ }
}

export default function PersistentPreviewDock({ project, fullWorkbenchActive, inspectorOpen, onOpenWorkbench }: {
  project?: ProjectSummary;
  fullWorkbenchActive: boolean;
  inspectorOpen: boolean;
  onOpenWorkbench: () => void;
}) {
  const [dock, setDock] = useState<PersistedDock>(() => readPersisted());
  const [data, setData] = useState<PreviewStatus | null>(null);
  const [capability, setCapability] = useState<PreviewCapability | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [frameVersion, setFrameVersion] = useState(0);
  const projectId = project?.id || "";
  const endpoint = projectId ? `/api/workspace/projects/${encodeURIComponent(projectId)}/preview` : "";
  const routeHistory = projectId ? dock.routes[projectId] || ["/"] : ["/"];
  const routeIndex = projectId ? Math.min(dock.routeIndexes[projectId] || 0, routeHistory.length - 1) : 0;
  const activeRoute = routeHistory[routeIndex] || "/";
  const [routeInput, setRouteInput] = useState(activeRoute);

  const updateDock = useCallback((recipe: (current: PersistedDock) => PersistedDock) => {
    setDock((current) => { const next = recipe(current); persist(next); return next; });
  }, []);

  const load = useCallback(async () => {
    if (!endpoint) { setData(null); setCapability(null); return null; }
    const result = await fetchJson<PreviewResponse>(endpoint);
    setData(result.preview);
    setCapability(result.capability || null);
    return result.preview;
  }, [endpoint]);

  useEffect(() => {
    setData(null); setCapability(null); setNotice(""); setFrameVersion(0);
    const history = projectId ? dock.routes[projectId] || ["/"] : ["/"];
    const index = projectId ? Math.min(dock.routeIndexes[projectId] || 0, history.length - 1) : 0;
    setRouteInput(history[index] || "/");
    if (projectId) void load().catch((error) => setNotice(error instanceof Error ? error.message : "Preview evidence unavailable."));
  }, [projectId, load]);

  useEffect(() => {
    if (!endpoint || !data || !["starting", "running"].includes(data.state)) return;
    const timer = window.setInterval(() => void fetchJson<PreviewResponse>(`${endpoint}/health`, { method: "POST" }).then((result) => setData(result.preview)).catch(() => undefined), 2_500);
    return () => window.clearInterval(timer);
  }, [data?.state, endpoint]);

  const currentUrl = useMemo(() => {
    if (!data?.url) return "";
    try { return new URL(activeRoute, data.url).toString(); }
    catch { return data.url; }
  }, [activeRoute, data?.url]);
  const profile = VIEWPORTS[dock.viewport];
  const live = Boolean(data?.state === "running" && data.health?.ok && data.embedding.state === "ALLOWED" && currentUrl);
  const canStart = Boolean(project?.trust === "trusted" && capability?.available && data && !["starting", "running"].includes(data.state));
  const canStop = Boolean(project?.trust === "trusted" && data && ["starting", "running"].includes(data.state));

  const operate = async (operation: "start" | "health" | "restart" | "stop") => {
    if (!endpoint) return;
    setBusy(operation); setNotice("");
    try {
      const result = await fetchJson<PreviewResponse>(`${endpoint}/${operation}`, { method: "POST" });
      setData(result.preview);
      if (operation === "start" || operation === "restart") setFrameVersion((value) => value + 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `Preview ${operation} failed.`);
      await load().catch(() => undefined);
    } finally { setBusy(""); }
  };

  const navigate = (value: string) => {
    if (!projectId || !data?.url) return;
    try {
      const candidate = new URL(value.trim() || "/", data.url);
      if (candidate.origin !== new URL(data.url).origin) throw new Error("Persistent Preview navigation is limited to the active loopback origin.");
      const route = `${candidate.pathname}${candidate.search}${candidate.hash}` || "/";
      updateDock((current) => {
        const history = current.routes[projectId] || ["/"];
        const index = Math.min(current.routeIndexes[projectId] || 0, history.length - 1);
        const nextHistory = [...history.slice(0, index + 1), route].slice(-40);
        return { ...current, routes: { ...current.routes, [projectId]: nextHistory }, routeIndexes: { ...current.routeIndexes, [projectId]: nextHistory.length - 1 } };
      });
      setRouteInput(route); setNotice("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Invalid Preview route."); }
  };

  const historyMove = (direction: -1 | 1) => {
    if (!projectId) return;
    const next = routeIndex + direction;
    if (next < 0 || next >= routeHistory.length) return;
    updateDock((current) => ({ ...current, routeIndexes: { ...current.routeIndexes, [projectId]: next } }));
    setRouteInput(routeHistory[next] || "/");
  };

  if (!dock.open) return <button className="kw-persistent-preview-launcher" aria-label="Open persistent Preview" onClick={() => updateDock((current) => ({ ...current, open: true, minimized: false }))}><Monitor size={17} /><span>Preview</span>{data?.state === "running" && data.health?.ok ? <i aria-label="Preview healthy" /> : null}</button>;

  return <aside className="kw-persistent-preview" data-layout={dock.layout} data-minimized={dock.minimized} data-inspector-open={inspectorOpen} aria-label="Persistent Preview Dock">
    <header className="kw-persistent-preview__header">
      <div><span className={`kw-preview-live-dot ${data?.state === "running" && data.health?.ok ? "is-live" : ""}`} /><strong>Persistent Preview</strong><small>{project?.name || "No project"}</small></div>
      <div className="kw-persistent-preview__actions">
        <StatusBadge value={data?.state?.toUpperCase() || "NO_PROJECT"} />
        <button aria-label="Floating Preview layout" aria-pressed={dock.layout === "floating"} onClick={() => updateDock((current) => ({ ...current, layout: "floating", minimized: false }))}><Maximize2 size={13} /></button>
        <button aria-label="Right-side Preview layout" aria-pressed={dock.layout === "side"} onClick={() => updateDock((current) => ({ ...current, layout: "side", minimized: false }))}><PanelRight size={13} /></button>
        <button aria-label="Bottom Preview layout" aria-pressed={dock.layout === "bottom"} onClick={() => updateDock((current) => ({ ...current, layout: "bottom", minimized: false }))}><PanelBottom size={13} /></button>
        <button aria-label={dock.minimized ? "Restore persistent Preview" : "Minimize persistent Preview"} onClick={() => updateDock((current) => ({ ...current, minimized: !current.minimized }))}>{dock.minimized ? <Maximize2 size={13} /> : <Minimize2 size={13} />}</button>
        <button aria-label="Close persistent Preview" onClick={() => updateDock((current) => ({ ...current, open: false }))}><X size={13} /></button>
      </div>
    </header>

    {!dock.minimized ? <>
      <div className="kw-persistent-preview__browser" role="toolbar" aria-label="Persistent Preview browser controls">
        <button aria-label="Persistent Preview back" disabled={routeIndex === 0} onClick={() => historyMove(-1)}><ArrowLeft size={13} /></button>
        <button aria-label="Persistent Preview forward" disabled={routeIndex >= routeHistory.length - 1} onClick={() => historyMove(1)}><ArrowRight size={13} /></button>
        <button aria-label="Reload persistent Preview frame" disabled={!currentUrl} onClick={() => setFrameVersion((value) => value + 1)}><RefreshCcw size={13} /></button>
        <form onSubmit={(event) => { event.preventDefault(); navigate(routeInput); }}><span>LOCAL</span><input aria-label="Persistent Preview address" value={routeInput} disabled={!data?.url} onChange={(event) => setRouteInput(event.target.value)} /></form>
        <button aria-label="Open Preview externally" disabled={!currentUrl} onClick={() => currentUrl && window.open(currentUrl, "_blank", "noopener,noreferrer")}><ExternalLink size={13} /></button>
      </div>
      <div className="kw-persistent-preview__tools">
        <select aria-label="Persistent Preview viewport" value={dock.viewport} onChange={(event) => updateDock((current) => ({ ...current, viewport: event.target.value as Viewport }))}>{Object.entries(VIEWPORTS).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select>
        <button disabled={!canStart || Boolean(busy)} onClick={() => void operate("start")}><Play size={12} />Run</button>
        <button disabled={!data?.url || !["starting", "running"].includes(data.state) || Boolean(busy)} onClick={() => void operate("health")}><RefreshCcw size={12} />Health</button>
        <button disabled={project?.trust !== "trusted" || !capability?.available || !data || !["starting", "running", "failed", "stopped"].includes(data.state) || Boolean(busy)} onClick={() => void operate("restart")}><RotateCw size={12} />Restart</button>
        <button disabled={!canStop || Boolean(busy)} onClick={() => void operate("stop")}><Square size={12} />Stop</button>
        <button className="kw-persistent-preview__open-full" onClick={onOpenWorkbench}>Open Workbench</button>
      </div>
      <div className="kw-persistent-preview__stage" data-viewport={dock.viewport}>
        {fullWorkbenchActive ? <div className="kw-persistent-preview__state"><Monitor size={26} /><strong>Full Preview Workbench active</strong><span>The dock keeps this project and route context without mounting a duplicate frame.</span></div> : live ? <div className="kw-persistent-preview__frame" style={profile.width && profile.height ? { aspectRatio: `${profile.width} / ${profile.height}` } : undefined}><iframe key={`${currentUrl}:${frameVersion}`} title="Persistent application Preview" src={currentUrl} sandbox="allow-forms allow-modals allow-popups allow-scripts allow-same-origin" referrerPolicy="no-referrer" style={profile.width && profile.height ? { width: profile.width, height: profile.height } : undefined} /></div> : <div className="kw-persistent-preview__state"><Monitor size={26} /><strong>{!project ? "Select a project" : data?.state === "unavailable" || capability?.available === false ? "No HTTP Preview detected" : data?.embedding.state !== "ALLOWED" && data?.state === "running" ? "Inline embedding limited" : data?.state === "starting" ? "Starting local Preview…" : "Preview ready"}</strong><span>{!project ? "The dock follows the global project context." : capability?.reason || data?.embedding.reason || data?.health?.detail || data?.error || "Run the detected trusted local application."}</span>{canStart ? <button onClick={() => void operate("start")}><Play size={13} />Run Preview</button> : null}</div>}
      </div>
      <footer className="kw-persistent-preview__status"><span>Session <code>{data?.sessionId?.slice(0, 8) || "—"}</code></span><span>PID {data?.pid ?? "—"}</span><span>Port {data?.port ?? "—"}</span><span>{data?.health?.latencyMs !== undefined ? `${data.health.latencyMs} ms` : "not measured"}</span><span>viewport simulation</span></footer>
      {notice ? <p className="kw-persistent-preview__notice" role="status">{notice}</p> : null}
    </> : null}
  </aside>;
}

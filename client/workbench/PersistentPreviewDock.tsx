import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Maximize2, Minimize2, Monitor, PanelBottom, PanelRight, Play, RefreshCcw, RotateCw, Smartphone, Square, Tablet, X } from "lucide-react";
import type { ProjectSummary } from "@shared/workspace";
import type { RuntimeService, RuntimeTopologyDiscovery, TopologySession } from "@shared/topology";
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
type TopologyResponse = { discovery?: RuntimeTopologyDiscovery; session?: TopologySession };
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

const defaults: PersistedDock = { open: true, minimized: false, layout: "bottom", viewport: "fluid", routes: {}, routeIndexes: {} };

function readPersisted(): PersistedDock {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<PersistedDock>;
    return {
      open: parsed.open !== false,
      minimized: parsed.minimized === true,
      layout: ["floating", "side", "bottom"].includes(String(parsed.layout)) ? parsed.layout as DockLayout : "bottom",
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
  const [topology, setTopology] = useState<TopologySession | null>(null);
  const [topologyDiscovery, setTopologyDiscovery] = useState<RuntimeTopologyDiscovery | null>(null);
  const [selectedTopologyService, setSelectedTopologyService] = useState("");
  const projectId = project?.id || "";
  const endpoint = projectId ? `/api/workspace/projects/${encodeURIComponent(projectId)}/preview` : "";
  const topologyEndpoint = projectId ? `/api/workspace/projects/${encodeURIComponent(projectId)}/topology` : "";
  const [routeInput, setRouteInput] = useState("/");

  const updateDock = useCallback((recipe: (current: PersistedDock) => PersistedDock) => {
    setDock((current) => { const next = recipe(current); persist(next); return next; });
  }, []);

  const load = useCallback(async () => {
    if (!endpoint) { setData(null); setCapability(null); return null; }
    const [result, topologyResult] = await Promise.all([fetchJson<PreviewResponse>(endpoint), fetchJson<TopologyResponse>(topologyEndpoint)]);
    setData(result.preview);
    setCapability(result.capability || null);
    setTopology(topologyResult.session || null);
    setTopologyDiscovery(topologyResult.discovery || null);
    const topologyServices = topologyResult.session?.services || topologyResult.discovery?.services || [];
    let persisted = "";
    try { persisted = localStorage.getItem(`kforge:topology-entrypoint:${projectId}`) || ""; } catch { /* optional storage */ }
    setSelectedTopologyService(topologyServices.some((service) => service.id === persisted && service.browserEntrypoint) ? persisted : topologyServices.find((service) => service.browserEntrypoint)?.id || "");
    return result.preview;
  }, [endpoint, projectId, topologyEndpoint]);

  useEffect(() => {
    setData(null); setCapability(null); setTopology(null); setTopologyDiscovery(null); setNotice(""); setFrameVersion(0);
    const history = projectId ? dock.routes[projectId] || ["/"] : ["/"];
    const index = projectId ? Math.min(dock.routeIndexes[projectId] || 0, history.length - 1) : 0;
    setRouteInput(history[index] || "/");
    if (projectId) void load().catch((error) => setNotice(error instanceof Error ? error.message : "Preview evidence unavailable."));
  }, [projectId, load]);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId: string; serviceId: string }>).detail;
      if (detail?.projectId === projectId) setSelectedTopologyService(detail.serviceId);
    };
    window.addEventListener("kforge-topology-entrypoint", listener);
    return () => window.removeEventListener("kforge-topology-entrypoint", listener);
  }, [projectId]);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId: string; session: TopologySession }>).detail;
      if (detail?.projectId === projectId) setTopology(detail.session);
    };
    window.addEventListener("kforge-topology-session", listener);
    return () => window.removeEventListener("kforge-topology-session", listener);
  }, [projectId]);

  useEffect(() => {
    if (!endpoint || !data || !["starting", "running"].includes(data.state)) return;
    const timer = window.setInterval(() => void fetchJson<PreviewResponse>(`${endpoint}/health`, { method: "POST" }).then((result) => setData(result.preview)).catch(() => undefined), 2_500);
    return () => window.clearInterval(timer);
  }, [data?.state, endpoint]);

  useEffect(() => {
    if (!topologyEndpoint || !topology || !["STARTING", "RUNNING", "HEALTHY", "DEGRADED"].includes(topology.state)) return;
    const timer = window.setInterval(() => void fetchJson<TopologyResponse>(`${topologyEndpoint}/health`, { method: "POST" }).then((result) => result.session && setTopology(result.session)).catch(() => undefined), 2_500);
    return () => window.clearInterval(timer);
  }, [topology?.state, topologyEndpoint]);

  const topologyServices = topology?.services || topologyDiscovery?.services || [];
  const topologyEntrypoints = topologyServices.filter((service) => Boolean(service.browserEntrypoint));
  const topologyService = topologyEntrypoints.find((service) => service.id === selectedTopologyService) || topologyEntrypoints[0];
  const routeKey = topologyService ? `${projectId}:${topologyService.id}` : projectId;
  const routeHistory = routeKey ? dock.routes[routeKey] || [topologyService?.browserEntrypoint || "/"] : ["/"];
  const routeIndex = routeKey ? Math.min(dock.routeIndexes[routeKey] || 0, routeHistory.length - 1) : 0;
  const activeRoute = routeHistory[routeIndex] || topologyService?.browserEntrypoint || "/";
  const topologyUrl = useMemo(() => {
    if (!topologyService?.port.allocated || !topologyService.browserEntrypoint) return "";
    return new URL(topologyService.browserEntrypoint, `http://127.0.0.1:${topologyService.port.allocated}`).toString();
  }, [topologyService?.browserEntrypoint, topologyService?.port.allocated]);

  const currentUrl = useMemo(() => {
    if (topologyUrl) { try { return new URL(activeRoute, topologyUrl).toString(); } catch { return topologyUrl; } }
    if (!data?.url) return "";
    try { return new URL(activeRoute, data.url).toString(); }
    catch { return data.url; }
  }, [activeRoute, data?.url, topologyUrl]);

  useEffect(() => { setRouteInput(activeRoute); }, [activeRoute, routeKey]);
  const profile = VIEWPORTS[dock.viewport];
  const live = Boolean(topologyService ? ["HEALTHY", "RUNNING"].includes(topologyService.state) && currentUrl : data?.state === "running" && data.health?.ok && data.embedding.state === "ALLOWED" && currentUrl);
  const topologyMode = topologyServices.length > 1 || Boolean(topologyDiscovery?.evidenceSources.some((source) => source.includes(".kforge/topology.json")));
  useEffect(() => {
    if (!topologyMode || !topologyEndpoint || topology && ["STARTING", "RUNNING", "HEALTHY", "DEGRADED"].includes(topology.state)) return;
    const timer = window.setInterval(() => void fetchJson<TopologyResponse>(topologyEndpoint).then((result) => { setTopology(result.session || null); if (result.discovery) setTopologyDiscovery(result.discovery); }).catch(() => undefined), 10_000);
    return () => window.clearInterval(timer);
  }, [topology?.state, topologyEndpoint, topologyMode]);
  const canStart = topologyMode
    ? Boolean(project?.trust === "trusted" && (!topology || !["STARTING", "RUNNING", "HEALTHY", "DEGRADED"].includes(topology.state)))
    : Boolean(project?.trust === "trusted" && capability?.available && data && !["starting", "running"].includes(data.state));
  const canStop = topologyMode
    ? Boolean(project?.trust === "trusted" && topology && ["STARTING", "RUNNING", "HEALTHY", "DEGRADED"].includes(topology.state))
    : Boolean(project?.trust === "trusted" && data && ["starting", "running"].includes(data.state));

  const operate = async (operation: "start" | "health" | "restart" | "stop") => {
    if (!endpoint) return;
    setBusy(operation); setNotice("");
    try {
      if (topologyMode) {
        const result = await fetchJson<TopologyResponse>(`${topologyEndpoint}/${operation}`, { method: "POST" });
        setTopology(result.session || null);
        if (operation === "start" || operation === "restart") setFrameVersion((value) => value + 1);
        return;
      }
      const result = await fetchJson<PreviewResponse>(`${endpoint}/${operation}`, { method: "POST" });
      setData(result.preview);
      if (operation === "start" || operation === "restart") setFrameVersion((value) => value + 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `Preview ${operation} failed.`);
      await load().catch(() => undefined);
    } finally { setBusy(""); }
  };

  const navigate = (value: string) => {
    const base = topologyUrl || data?.url;
    if (!routeKey || !base) return;
    try {
      const candidate = new URL(value.trim() || "/", base);
      if (candidate.origin !== new URL(base).origin) throw new Error("Persistent Preview navigation is limited to the active loopback origin.");
      const route = `${candidate.pathname}${candidate.search}${candidate.hash}` || "/";
      updateDock((current) => {
        const history = current.routes[routeKey] || [topologyService?.browserEntrypoint || "/"];
        const index = Math.min(current.routeIndexes[routeKey] || 0, history.length - 1);
        const nextHistory = [...history.slice(0, index + 1), route].slice(-40);
        return { ...current, routes: { ...current.routes, [routeKey]: nextHistory }, routeIndexes: { ...current.routeIndexes, [routeKey]: nextHistory.length - 1 } };
      });
      setRouteInput(route); setNotice("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Invalid Preview route."); }
  };

  const historyMove = (direction: -1 | 1) => {
    if (!routeKey) return;
    const next = routeIndex + direction;
    if (next < 0 || next >= routeHistory.length) return;
    updateDock((current) => ({ ...current, routeIndexes: { ...current.routeIndexes, [routeKey]: next } }));
    setRouteInput(routeHistory[next] || "/");
  };

  if (!dock.open) return <button className="kw-persistent-preview-launcher" aria-label="Open persistent Preview" onClick={() => updateDock((current) => ({ ...current, open: true, minimized: false }))}><Monitor size={17} /><span>Preview</span>{data?.state === "running" && data.health?.ok ? <i aria-label="Preview healthy" /> : null}</button>;

  return <aside className="kw-persistent-preview" data-layout={dock.layout} data-minimized={dock.minimized} data-inspector-open={inspectorOpen} aria-label="Persistent Preview Dock">
    <header className="kw-persistent-preview__header">
      <div><span className={`kw-preview-live-dot ${live ? "is-live" : ""}`} /><strong>Persistent Preview</strong><small>{topologyService ? `${project?.name || "Project"} · ${topologyService.browserLabel || topologyService.name}` : project?.name || "No project"}</small></div>
      <div className="kw-persistent-preview__actions">
        <StatusBadge value={topologyService?.state || data?.state?.toUpperCase() || "NO_PROJECT"} />
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
        <form onSubmit={(event) => { event.preventDefault(); navigate(routeInput); }}><span>LOCAL</span><input aria-label="Persistent Preview address" value={routeInput} disabled={!currentUrl} onChange={(event) => setRouteInput(event.target.value)} /></form>
        <button aria-label="Open Preview externally" disabled={!currentUrl} onClick={() => currentUrl && window.open(currentUrl, "_blank", "noopener,noreferrer")}><ExternalLink size={13} /></button>
      </div>
      <div className="kw-persistent-preview__tools">
        {topologyEntrypoints.length > 1 ? <select aria-label="Persistent Preview topology entrypoint" value={topologyService?.id || ""} onChange={(event) => { const serviceId = event.target.value; setSelectedTopologyService(serviceId); try { localStorage.setItem(`kforge:topology-entrypoint:${projectId}`, serviceId); } catch { /* Optional browser storage. */ } }}>{topologyEntrypoints.map((service: RuntimeService) => <option key={service.id} value={service.id}>{service.browserLabel || service.name}</option>)}</select> : null}
        <select aria-label="Persistent Preview viewport" value={dock.viewport} onChange={(event) => updateDock((current) => ({ ...current, viewport: event.target.value as Viewport }))}>{Object.entries(VIEWPORTS).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select>
        <button disabled={!canStart || Boolean(busy)} onClick={() => void operate("start")}><Play size={12} />Run</button>
        <button disabled={topologyMode ? !topology || Boolean(busy) : !data?.url || !["starting", "running"].includes(data.state) || Boolean(busy)} onClick={() => void operate("health")}><RefreshCcw size={12} />Health</button>
        <button disabled={topologyMode ? project?.trust !== "trusted" || !topology || Boolean(busy) : project?.trust !== "trusted" || !capability?.available || !data || !["starting", "running", "failed", "stopped"].includes(data.state) || Boolean(busy)} onClick={() => void operate("restart")}><RotateCw size={12} />Restart</button>
        <button disabled={!canStop || Boolean(busy)} onClick={() => void operate("stop")}><Square size={12} />Stop</button>
        <button className="kw-persistent-preview__open-full" onClick={onOpenWorkbench}>Open Workbench</button>
      </div>
      <div className="kw-persistent-preview__stage" data-viewport={dock.viewport}>
        {fullWorkbenchActive ? <div className="kw-persistent-preview__state"><Monitor size={26} /><strong>Full Preview Workbench active</strong><span>The dock keeps this project and route context without mounting a duplicate frame.</span></div> : live ? <div className="kw-persistent-preview__frame" style={profile.width && profile.height ? { aspectRatio: `${profile.width} / ${profile.height}` } : undefined}><iframe key={`${currentUrl}:${frameVersion}`} title="Persistent application Preview" src={currentUrl} sandbox="allow-forms allow-modals allow-popups allow-scripts allow-same-origin" referrerPolicy="no-referrer" style={profile.width && profile.height ? { width: profile.width, height: profile.height } : undefined} /></div> : <div className="kw-persistent-preview__state"><Monitor size={26} /><strong>{!project ? "Select a project" : data?.state === "unavailable" || capability?.available === false ? "No HTTP Preview detected" : data?.embedding.state !== "ALLOWED" && data?.state === "running" ? "Inline embedding limited" : data?.state === "starting" ? "Starting local Preview…" : "Preview ready"}</strong><span>{!project ? "The dock follows the global project context." : capability?.reason || data?.embedding.reason || data?.health?.detail || data?.error || "Run the detected trusted local application."}</span>{canStart ? <button onClick={() => void operate("start")}><Play size={13} />Run Preview</button> : null}</div>}
      </div>
      <footer className="kw-persistent-preview__status"><span>Session <code>{(topology?.id || data?.sessionId)?.slice(0, 8) || "—"}</code></span><span>PID {topologyService?.processId ?? data?.pid ?? "—"}</span><span>Port {topologyService?.port.allocated ?? data?.port ?? "—"}</span><span>{topologyService?.health.latencyMs !== undefined ? `${topologyService.health.latencyMs} ms` : data?.health?.latencyMs !== undefined ? `${data.health.latencyMs} ms` : "not measured"}</span><span>{topologyService ? "topology entrypoint" : "viewport simulation"}</span></footer>
      {notice ? <p className="kw-persistent-preview__notice" role="status">{notice}</p> : null}
    </> : null}
  </aside>;
}

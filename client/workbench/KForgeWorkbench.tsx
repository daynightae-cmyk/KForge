import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity, Archive, ArrowLeft, Bot, Boxes, BrainCircuit, Bug, Building2, Camera, ChevronRight, CircleDot,
  Clock3, Cloud, Code2, Download, FileSearch, FolderKanban, FolderOpen, Gauge, GitBranch, GitCommit, Github,
  GitPullRequest, Globe2, HardDrive, HeartPulse, KeyRound, Layers, ListChecks, MonitorPlay, Network,
  Package, PackagePlus, Pin, Play, Puzzle, Radar, RefreshCw, Rocket, ScanSearch, ScrollText, Search, Settings2,
  ShieldCheck, SlidersHorizontal, Star, Stethoscope, Store, Tag, Tags, Terminal, TestTube2, Wifi, Workflow, Wrench,
  X, Zap,
} from "lucide-react";
import type { KForgeActivity, KForgePlatformSettings, ProjectSummary, WorkspaceResponse } from "@shared/workspace";
import { ACTIVITIES, KFORGE_ACTIVITY_IDS, ONLINE_EXPLORER_VIEWS, activityDefinition, activityLabel, defaultView, viewLabel } from "./navigation";
import { ACTIVITY_PURPOSE, browseWorkbenchDomains, resolveWorkbenchTarget, searchWorkbenchServices, serviceDefinition } from "./serviceDirectory";
import { fetchJson, jsonRequest } from "./api";
import { StatusBadge } from "./ui";
import type { ExecutionSnapshot, InspectorContext, RecordRow } from "./surfaceContracts";
import { WorkbenchSurface } from "./surfaces";
import PersistentPreviewDock from "./PersistentPreviewDock";
import { PROJECT_OPENED_EVENT } from "./ProjectStartActions";
import ProjectContextExplorer from "./ProjectContextExplorer";
import LivingMarkGate from "@/components/brand/LivingMarkGate";
import brandSymbol from "../assets/knoux-forge-symbol.webp";
import "./workbench.css";
import "./rebirth.css";
import "./rebirth-screens.css";
import "./rebirth-graph.css";
import "./rebirth-apps.css";

const CanonicalInspector = lazy(() => import("./CanonicalInspector"));

export { KFORGE_ACTIVITY_IDS, ONLINE_EXPLORER_VIEWS };

const icons: Record<KForgeActivity, ReactNode> = {
  projects: <FolderKanban size={20} />,
  ai: <Bot size={20} />,
  online: <Cloud size={20} />,
  intelligence: <BrainCircuit size={20} />,
  quality: <ShieldCheck size={20} />,
  "developer-tools": <Terminal size={20} />,
  remote: <GitBranch size={20} />,
  release: <Rocket size={20} />,
  system: <Settings2 size={20} />,
};

/**
 * Explorer glyphs are presentation-only. They mirror the canonical view label and
 * never substitute for the label text or the service definition authority.
 */
const viewIcons: Record<string, ReactNode> = {
  workspace: <FolderKanban size={15} />, health: <HeartPulse size={15} />,
  recent: <Clock3 size={15} />, favorites: <Star size={15} />, pinned: <Pin size={15} />, archive: <Archive size={15} />,
  "open-project": <FolderOpen size={15} />, "import-project": <Download size={15} />,
  providers: <Cloud size={15} />, models: <Boxes size={15} />, agents: <Bot size={15} />, tasks: <ListChecks size={15} />,
  discover: <Search size={15} />, marketplace: <Store size={15} />, extensions: <Puzzle size={15} />, tools: <Wrench size={15} />,
  integrations: <Layers size={15} />, installed: <Package size={15} />, updates: <RefreshCw size={15} />, downloads: <Download size={15} />,
  "remote-sources": <Globe2 size={15} />, documentation: <ScrollText size={15} />, security: <ShieldCheck size={15} />, activity: <Activity size={15} />,
  "project-graph": <Network size={15} />, dependencies: <Workflow size={15} />, "impact-analysis": <Zap size={15} />,
  "code-understanding": <Code2 size={15} />, "ask-kforge": <Bot size={15} />, architecture: <Building2 size={15} />,
  sonar: <Radar size={15} />, problems: <Bug size={15} />, solutions: <Wrench size={15} />, performance: <Gauge size={15} />,
  "technical-debt": <Layers size={15} />, snapshots: <Camera size={15} />,
  terminal: <Terminal size={15} />, tests: <TestTube2 size={15} />, build: <Package size={15} />, runtime: <Play size={15} />,
  lint: <ScanSearch size={15} />, logs: <ScrollText size={15} />, diagnostics: <Stethoscope size={15} />, preview: <MonitorPlay size={15} />,
  git: <GitBranch size={15} />, branches: <GitBranch size={15} />, commits: <GitCommit size={15} />, github: <Github size={15} />,
  "pull-requests": <GitPullRequest size={15} />, issues: <CircleDot size={15} />, actions: <Workflow size={15} />, releases: <Tag size={15} />,
  "release-gate": <ShieldCheck size={15} />, "release-preparation": <PackagePlus size={15} />, artifacts: <Package size={15} />, versioning: <Tags size={15} />,
  settings: <Settings2 size={15} />, trust: <ShieldCheck size={15} />, permissions: <KeyRound size={15} />, storage: <HardDrive size={15} />,
  "online-offline": <Wifi size={15} />, "self-audit": <FileSearch size={15} />, "system-diagnostics": <Activity size={15} />,
};

async function refreshSettings(): Promise<KForgePlatformSettings> {
  return (await fetchJson<{ settings: KForgePlatformSettings }>("/api/workspace/settings")).settings;
}

function applyAppearance(settings: KForgePlatformSettings) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  const theme = settings.appearance.theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : settings.appearance.theme;
  root.classList.add(theme);
  root.dataset.kfDensity = settings.appearance.density;
  root.dataset.kfReducedMotion = String(settings.appearance.reducedMotion);
}

function surfaceDescription(activity: KForgeActivity, view: string, project?: ProjectSummary) {
  const service = serviceDefinition(activity, view);
  return `${service?.description || ACTIVITY_PURPOSE[activity]}${service?.context === "project" && !project ? " Select a project to continue." : ""}`;
}

/**
 * Presentation-only split of a service title so the leading word carries the ink
 * role and the remainder carries the brand gradient, matching the approved
 * installation identity. The rendered text content is unchanged.
 */
function titleAccentSplit(label: string) {
  const boundary = label.indexOf(" ");
  if (boundary < 0) return { lead: label, accent: "" };
  return { lead: label.slice(0, boundary), accent: label.slice(boundary + 1) };
}

export default function KForgeWorkbench() {
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [settings, setSettings] = useState<KForgePlatformSettings | null>(null);
  const [activity, setActivity] = useState<KForgeActivity>("projects");
  const [view, setView] = useState("workspace");
  const [projectId, setProjectId] = useState("");
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [execution, setExecution] = useState<ExecutionSnapshot | null>(null);
  const [inspectorContext, setInspectorContext] = useState<InspectorContext | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [searchRows, setSearchRows] = useState<Array<RecordRow & { target?: string; projectId?: string }>>([]);
  const [navigationHistory, setNavigationHistory] = useState<Array<{ activity: KForgeActivity; view: string }>>([]);
  const visitedViews = useRef<Partial<Record<KForgeActivity, string>>>({});
  const paletteServices = useMemo(() => searchWorkbenchServices(paletteQuery), [paletteQuery]);
  const paletteDomains = useMemo(() => browseWorkbenchDomains(), []);
  const paletteInput = useRef<HTMLInputElement | null>(null);
  const palettePanel = useRef<HTMLDivElement | null>(null);
  const activeProject = workspace?.projects.find((project) => project.id === projectId);
  const current = activityDefinition(activity);
  const titleParts = titleAccentSplit(viewLabel(activity, view));
  const platformMode = workspace?.localPlatform.mode ?? "unavailable";
  const contextLabel = activeProject?.name || "Global context";

  const refreshWorkspace = async () => {
    try {
      const next = await fetchJson<WorkspaceResponse>("/api/workspace/projects");
      setWorkspace(next);
      if (projectId && !next.projects.some((project) => project.id === projectId)) setProjectId("");
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Workspace refresh failed."); }
  };

  useEffect(() => {
    void (async () => {
      try {
        const [nextWorkspace, nextSettings] = await Promise.all([fetchJson<WorkspaceResponse>("/api/workspace/projects"), refreshSettings()]);
        setWorkspace(nextWorkspace); setSettings(nextSettings); applyAppearance(nextSettings);
        setActivity(nextSettings.general.startupActivity);
        setView(nextSettings.general.startupActivity === "online" ? nextSettings.general.startupOnlineView : defaultView(nextSettings.general.startupActivity));
      } catch (error) { setMessage(error instanceof Error ? error.message : "KForge initialization failed."); }
      finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen(true); }
      if (event.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    const opened = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; name?: string }>).detail;
      if (!detail?.projectId) return;
      setProjectId(detail.projectId);
      setMessage(`${detail.name || "Project"} is now the active project.`);
      void refreshWorkspace();
    };
    window.addEventListener(PROJECT_OPENED_EVENT, opened);
    return () => window.removeEventListener(PROJECT_OPENED_EVENT, opened);
  }, []);
  useEffect(() => { if (paletteOpen) requestAnimationFrame(() => paletteInput.current?.focus()); }, [paletteOpen]);
  useEffect(() => {
    if (!paletteOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !palettePanel.current) return;
      const focusable = [...palettePanel.current.querySelectorAll<HTMLElement>('input, button, [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !palettePanel.current.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trap, true);
    return () => { document.removeEventListener("keydown", trap, true); previous?.focus(); };
  }, [paletteOpen]);
  useEffect(() => {
    if (!paletteOpen || paletteQuery.trim().length < 2) { setSearchRows([]); return; }
    const timer = window.setTimeout(() => void fetchJson<{ results: Array<RecordRow & { target?: string; projectId?: string }> }>(`/api/workspace/search?q=${encodeURIComponent(paletteQuery.trim())}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`).then((data) => setSearchRows(data.results || [])).catch(() => setSearchRows([])), 160);
    return () => window.clearTimeout(timer);
  }, [paletteOpen, paletteQuery, projectId]);
  useEffect(() => {
    const navigate = (event: Event) => deepNavigate(String((event as CustomEvent<{ target?: string }>).detail?.target || ""));
    window.addEventListener("kforge:navigate", navigate);
    return () => window.removeEventListener("kforge:navigate", navigate);
  });

  const navigate = (nextActivity: KForgeActivity, nextView: string) => {
    if (nextActivity !== activity || nextView !== view) {
      setNavigationHistory(history => [...history.slice(-49), { activity, view }]);
    }
    visitedViews.current[nextActivity] = nextView;
    setActivity(nextActivity);
    setView(nextView);
    setExecution(null);
    if (nextActivity !== activity || nextView !== view) setInspectorContext(null);
  };
  const changeActivity = (next: KForgeActivity) => navigate(next, visitedViews.current[next] || (next === "online" && settings ? settings.general.startupOnlineView : defaultView(next)));
  const goBack = () => {
    const previous = navigationHistory.at(-1);
    if (!previous) return;
    setNavigationHistory(history => history.slice(0, -1));
    visitedViews.current[previous.activity] = previous.view;
    setActivity(previous.activity); setView(previous.view);
    setExecution(null); setInspectorContext(null);
  };
  const deepNavigate = (target: string) => {
    const destination = resolveWorkbenchTarget(target);
    if (destination) navigate(destination.activity, destination.id);
    else setMessage(`No workbench destination is registered for "${target}".`);
  };
  const changeProject = (next: string) => {
    setProjectId(next);
    setInspectorContext(null);
  };
  const changeMode = async (mode: string) => { try { await fetchJson("/api/workspace/platform/mode", jsonRequest({ mode })); await refreshWorkspace(); } catch (error) { setMessage(error instanceof Error ? error.message : "Platform mode change failed."); } };
  const groupedViews = useMemo(() => { const groups = new Map<string, typeof current.views>(); for (const item of current.views) groups.set(item.group || current.label, [...(groups.get(item.group || current.label) || []), item]); return [...groups.entries()]; }, [current]);
  const previewPaletteCommands = useMemo(() => {
    if (!/preview/i.test(paletteQuery)) return [] as Array<{ label: string; operation?: "start" | "health" | "restart" | "stop" }>;
    const commands: Array<{ label: string; operation?: "start" | "health" | "restart" | "stop" }> = [{ label: "Preview: Open" }];
    if (projectId) commands.push({ label: "Preview: Start", operation: "start" }, { label: "Preview: Health", operation: "health" }, { label: "Preview: Restart", operation: "restart" }, { label: "Preview: Stop", operation: "stop" });
    return commands;
  }, [paletteQuery, projectId]);
  const runPreviewPaletteCommand = async (command: { label: string; operation?: "start" | "health" | "restart" | "stop" }) => {
    navigate("developer-tools", "preview");
    setPaletteOpen(false);
    setPaletteQuery("");
    if (!command.operation || !projectId) return;
    setExecution({ label: command.label, state: "RUNNING", source: "Canonical Preview runtime" });
    try {
      const result = await fetchJson<{ preview: RecordRow }>(`/api/workspace/projects/${encodeURIComponent(projectId)}/preview/${command.operation}`, { method: "POST" });
      setExecution({ label: command.label, state: String(result.preview.state || "COMPLETED").toUpperCase(), source: "Canonical Preview runtime", command: String(result.preview.command || ""), message: String((result.preview.health as RecordRow | undefined)?.detail || result.preview.error || "") });
      setInspectorContext({ kind: "preview-runtime", title: `${activeProject?.name || "Project"} Preview`, projectName: activeProject?.name, preview: result.preview });
    } catch (error) {
      setExecution({ label: command.label, state: "FAILED", source: "Canonical Preview runtime", message: error instanceof Error ? error.message : "Preview command failed." });
    }
  };

  if (loading) return <div className="kw-loading">Loading KNOuX Forge workbench…</div>;
  // The Living Mark is presentation only. It is mounted inside the workbench as an ambient
  // background layer and never replaces, wraps, or gates any navigation or capability surface.
  const livingMarkReducedMotion = settings?.appearance.reducedMotion === true;
  // Approved Living Mark placement: the ambient mark is a Projects → Workspace brand layer
  // without a project context, mirroring the design scope the mark was approved for.
  const livingMarkVisible = activity === "projects" && view === "workspace" && !projectId;
  return <div className="kw-shell" data-activity={activity} data-mode={platformMode} data-workbench="kforge" data-living-mark={livingMarkVisible ? "workspace" : "off"}>
    <div className="kw-shell-glow" aria-hidden="true" />
    <header className="kw-topbar">
      <div className="kw-brand"><span className="kw-brand-mark"><img src={brandSymbol} alt="" /></span><div><strong>KNOuX Forge</strong><small>Engineering Workbench</small></div><span className="kw-brand-edition">FORGE</span></div>
      <div className="kw-topbar-center">
        <label className="kw-project-switcher"><FolderKanban size={14} /><span><small>ACTIVE PROJECT</small><select aria-label="Project context" value={projectId} onChange={(event) => changeProject(event.target.value)}><option value="">No project context</option>{(workspace?.projects || []).filter((project) => !project.archived).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></span></label>
        <button className="kw-command-trigger" onClick={() => setPaletteOpen(true)}><Search size={15} /><span><strong>Search KForge</strong><small>Projects, evidence, commands</small></span><kbd>Ctrl K</kbd></button>
      </div>
      <div className="kw-topbar-meta"><span className="kw-mode-beacon" data-mode={platformMode}><i aria-hidden="true" /><span>{platformMode.replace(/-/g, " ")}</span></span><select aria-label="Platform mode" value={workspace?.localPlatform.mode || "offline"} onChange={(event) => void changeMode(event.target.value)}><option value="offline">Offline</option><option value="local-first">Local First</option><option value="online-optional">Online Optional</option><option value="online">Online</option></select><StatusBadge value={activeProject?.trust || "NO_PROJECT"} /><button aria-label="Open settings" onClick={() => navigate("system", "settings")}><Settings2 size={16} /></button><button aria-label="Toggle inspector" onClick={() => setInspectorOpen((open) => !open)}><SlidersHorizontal size={16} /></button></div>
    </header>
    <aside className="kw-activity-bar" aria-label="KForge activities">{ACTIVITIES.map((item) => <button key={item.id} data-workbench-activity={item.id} data-label={item.label} aria-label={item.label} aria-current={activity === item.id ? "page" : undefined} title={item.label} className={activity === item.id ? "is-active" : ""} onClick={() => changeActivity(item.id)}>{icons[item.id]}</button>)}</aside>
    {explorerOpen ? <aside className="kw-explorer" aria-label={`${current.label} Explorer`}>
      <div className="kw-explorer-heading"><div><small>Explorer</small><strong>{activeProject ? activeProject.name : current.label}</strong></div><button aria-label="Collapse explorer" onClick={() => setExplorerOpen(false)}><ChevronRight size={15} /></button></div>
      <div className="kw-explorer-scroll">
        <p className="kw-explorer-purpose">{ACTIVITY_PURPOSE[activity]}</p>
        <div className={activeProject ? "kw-explorer-capabilities" : ""}>
          {groupedViews.map(([group, views]) => <section key={group}><h2>{group}</h2>{views.map((item) => <button key={item.id} title={serviceDefinition(activity, item.id)?.description} data-workbench-view={item.id} aria-current={view === item.id ? "page" : undefined} className={view === item.id ? "is-active" : ""} onClick={() => navigate(activity, item.id)}><span className="kw-explorer-item-icon" aria-hidden="true">{viewIcons[item.id] || <CircleDot size={15} />}</span><span>{item.label}</span><ChevronRight size={12} aria-hidden="true" /></button>)}</section>)}
        </div>
        {activeProject ? <details className="kw-explorer-project-details"><summary>Project context · {activeProject.name}</summary><ProjectContextExplorer project={activeProject} onNavigate={deepNavigate} /></details> : null}
      </div>
      <footer className="kw-explorer-brand"><span className="kw-explorer-brand__mark" aria-hidden="true"><img src={brandSymbol} alt="" /></span><span className="kw-explorer-brand__copy"><bdi dir="rtl" lang="ar">هندسة أفضل لمستقبل أكثر إشراقًا</bdi><small>Engineering a brighter tomorrow, together.</small></span></footer>
    </aside> : <button className="kw-explorer-restore" aria-label="Open explorer" onClick={() => setExplorerOpen(true)}><ChevronRight size={15} /></button>}
    <main className="kw-workbench" aria-label="KForge workbench" data-workbench-surface={`${activity}:${view}`}><LivingMarkGate mode="workspace" visible={livingMarkVisible} reducedMotion={livingMarkReducedMotion} /><nav className="kw-breadcrumb" aria-label="Workbench breadcrumb"><div className="kw-context-orbit"><button className="kw-navigation-back" aria-label="Back to previous view" disabled={!navigationHistory.length} onClick={goBack}><ArrowLeft size={14} /></button><span className="kw-context-project">{contextLabel}</span><span className="kw-context-dot" aria-hidden="true" /><span>{activityLabel(activity)}</span><ChevronRight size={13} /><strong>{viewLabel(activity, view)}</strong></div><span className="kw-breadcrumb-state">{activeProject?.trust || "NO_PROJECT"}</span></nav><div className="kw-surface-heading"><div><p>KNOuX / {activityLabel(activity)}</p><h1>{titleParts.lead}{titleParts.accent ? <span className="kw-title-accent"> {titleParts.accent}</span> : null}</h1><small>{surfaceDescription(activity, view, activeProject)}</small></div><button onClick={() => void refreshWorkspace()}><RefreshCw size={15} />Refresh</button></div>{message && <div className="kw-message" role="status">{message}</div>}<div className="kw-workbench-scroll" tabIndex={0} role="region" aria-label="Workbench surface content"><WorkbenchSurface activity={activity} view={view} workspace={workspace} project={activeProject} settings={settings} onProjectSelect={changeProject} onRefresh={refreshWorkspace} onSettings={(next) => { setSettings(next); applyAppearance(next); }} onNavigate={navigate} onExecution={setExecution} onInspectorContext={setInspectorContext} /></div>{activity === "developer-tools" && view !== "preview" && <div className="kw-bottom-panel" aria-label="Developer execution panel"><div><strong>EXECUTION</strong><span>{execution?.state || "IDLE"}</span></div>{execution ? <><code>{execution.command || "KForge registered operation"}</code><small>{execution.message || execution.source}</small><pre>{execution.output || "No process output captured."}</pre></> : <p>No developer command has run from this workbench session.</p>}</div>}</main>
    {inspectorOpen && <Suspense fallback={<aside className="kw-inspector" aria-label="Context inspector loading" aria-busy="true"><div className="kw-inspector-scroll"><p className="kw-muted" role="status">Loading inspector…</p></div></aside>}><CanonicalInspector activity={activity} view={view} project={activeProject} execution={execution} context={inspectorContext} /></Suspense>}
    <PersistentPreviewDock project={activeProject} fullWorkbenchActive={activity === "developer-tools" && view === "preview"} inspectorOpen={inspectorOpen} onOpenWorkbench={() => navigate("developer-tools", "preview")} />
    {paletteOpen && <div className="kw-palette-backdrop" role="dialog" aria-modal="true" aria-label="KForge command palette"><div className="kw-palette" ref={palettePanel}><div className="kw-palette-input"><Search size={17} /><input ref={paletteInput} value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} aria-label="Search KForge services, projects, files, symbols, problems and tasks" placeholder="Search services, projects, files, tasks…" /><button aria-label="Close command palette" onClick={() => setPaletteOpen(false)}><X size={16} /></button></div><div className="kw-palette-results">
      <section aria-label="Services">
        <h2 className="kw-palette-section-title">{paletteQuery.trim() ? `${paletteServices.length} matching service${paletteServices.length === 1 ? "" : "s"}` : "Go to a domain"}</h2>
        {paletteQuery.trim()
          ? paletteServices.map((service) => <button key={service.target} data-service-target={service.target} onClick={() => { navigate(service.activity, service.id); setPaletteOpen(false); setPaletteQuery(""); }}><strong>{service.label}</strong><span>{service.activityLabel} · {service.group || service.activityLabel}</span><small>{service.description}</small><small>{service.context === "project" ? (activeProject ? `Project · ${activeProject.name}` : "Requires a project · open to select one") : service.context === "optional" ? "Global · optional project context" : "Global service"}</small></button>)
          : paletteDomains.map((domain) => <button key={domain.id} data-service-target={`${domain.id}:${domain.firstView}`} onClick={() => { navigate(domain.id, domain.firstView); setPaletteOpen(false); setPaletteQuery(""); }}><strong>{domain.label}</strong><span>{domain.serviceCount} services</span><small>{domain.purpose}</small><small>{domain.projectScoped ? "Includes project-scoped services" : "Global services"}</small></button>)}
      </section>
      {previewPaletteCommands.map((command) => <button key={command.label} onClick={() => void runPreviewPaletteCommand(command)}><strong>{command.label}</strong><span>{command.operation ? "Canonical local Preview operation" : "Developer Tools / Preview"}</span><small>{command.operation && !projectId ? "Requires project context" : "KForge command registry"}</small></button>)}
      {searchRows.map((row, index) => <button key={`${String(row.entity || "result")}:${String(row.entityId || index)}`} onClick={() => { if (row.projectId) setProjectId(String(row.projectId)); deepNavigate(String(row.target || "Workspace")); setPaletteOpen(false); setPaletteQuery(""); }}><strong>{String(row.title || "Result")}</strong><span>{String(row.entity || "Evidence")} · {String(row.detail || "")}</span><small>{String(row.source || "")}</small></button>)}
      {paletteQuery.length >= 2 && !searchRows.length && !previewPaletteCommands.length && !paletteServices.length && <p>No bounded local result matched this query.</p>}
    </div></div></div>}
  </div>;
}

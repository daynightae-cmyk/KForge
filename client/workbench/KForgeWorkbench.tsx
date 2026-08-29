import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bot, BrainCircuit, ChevronRight, Cloud, FolderKanban, GitBranch, RefreshCw, Rocket, Search, Settings2, ShieldCheck, SlidersHorizontal, Terminal, X } from "lucide-react";
import type { KForgeActivity, KForgePlatformSettings, ProjectSummary, WorkspaceResponse } from "@shared/workspace";
import { ACTIVITIES, KFORGE_ACTIVITY_IDS, ONLINE_EXPLORER_VIEWS, activityDefinition, activityLabel, defaultView, viewLabel } from "./navigation";
import { fetchJson, jsonRequest } from "./api";
import { StatusBadge } from "./ui";
import type { ExecutionSnapshot, InspectorContext, RecordRow } from "./surfaceContracts";
import { WorkbenchSurface, CanonicalInspector } from "./surfaces";
import "./workbench.css";

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
  if (activity === "online") return project ? `Global Online evidence with optional compatibility context from ${project.name}.` : "Global Online evidence; compatibility is NOT_EVALUATED because no project is selected.";
  if (!project && !["system", "ai", "projects"].includes(activity)) return "Select a project context to load project-specific evidence.";
  if (view === "workspace") return "Dense engineering table with search, sorting, selection, Git, health and trust evidence.";
  if (view === "release-gate") return "Independent SOURCE, LOCAL, PREVIEW, DESKTOP, WINDOWS_PACKAGE, INSTALLER, GITHUB, CI and REMOTE evidence.";
  if (view === "terminal") return "Registered project commands only; unrestricted shell execution is not exposed.";
  return `Evidence-backed ${viewLabel(activity, view)} surface.`;
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
  const paletteInput = useRef<HTMLInputElement | null>(null);
  const activeProject = workspace?.projects.find((project) => project.id === projectId);
  const current = activityDefinition(activity);

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
  useEffect(() => { if (paletteOpen) requestAnimationFrame(() => paletteInput.current?.focus()); }, [paletteOpen]);
  useEffect(() => {
    if (!paletteOpen || paletteQuery.trim().length < 2) { setSearchRows([]); return; }
    const timer = window.setTimeout(() => void fetchJson<{ results: Array<RecordRow & { target?: string; projectId?: string }> }>(`/api/workspace/search?q=${encodeURIComponent(paletteQuery.trim())}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`).then((data) => setSearchRows(data.results || [])).catch(() => setSearchRows([])), 160);
    return () => window.clearTimeout(timer);
  }, [paletteOpen, paletteQuery, projectId]);

  const navigate = (nextActivity: KForgeActivity, nextView: string) => {
    setActivity(nextActivity);
    setView(nextView);
    setExecution(null);
    if (nextActivity !== activity || nextView !== view) setInspectorContext(null);
  };
  const changeActivity = (next: KForgeActivity) => navigate(next, next === "online" && settings ? settings.general.startupOnlineView : defaultView(next));
  const deepNavigate = (target: string) => {
    const map: Record<string, [KForgeActivity, string]> = { Workspace: ["projects", "workspace"], Agents: ["ai", "agents"], Models: ["ai", "models"], Tasks: ["ai", "tasks"], Marketplace: ["online", "marketplace"], Extensions: ["online", "extensions"], "Project graph": ["intelligence", "project-graph"], Dependencies: ["intelligence", "dependencies"], Architecture: ["intelligence", "architecture"], Problems: ["quality", "problems"], Documentation: ["quality", "documentation"], "KForge Sonar": ["quality", "sonar"], Tests: ["developer-tools", "tests"], Build: ["developer-tools", "build"], Runtime: ["developer-tools", "runtime"], Preview: ["developer-tools", "preview"], Git: ["remote", "git"], GitHub: ["remote", "github"], "Release Gate": ["release", "release-gate"], Settings: ["system", "settings"] };
    const destination = map[target] || ["projects", "workspace"]; navigate(destination[0], destination[1]);
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
  return <div className="kw-shell" data-activity={activity} data-workbench="kforge">
    <header className="kw-topbar"><div className="kw-brand"><span className="kw-brand-mark">K</span><div><strong>KNOuX Forge</strong><small>Engineering Workbench</small></div></div><button className="kw-command-trigger" onClick={() => setPaletteOpen(true)}><Search size={15} /><span>Search KForge</span><kbd>Ctrl K</kbd></button><div className="kw-topbar-meta"><select aria-label="Project context" value={projectId} onChange={(event) => changeProject(event.target.value)}><option value="">No project context</option>{(workspace?.projects || []).filter((project) => !project.archived).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><select aria-label="Platform mode" value={workspace?.localPlatform.mode || "offline"} onChange={(event) => void changeMode(event.target.value)}><option value="offline">Offline</option><option value="local-first">Local First</option><option value="online-optional">Online Optional</option><option value="online">Online</option></select><StatusBadge value={activeProject?.trust || "NO_PROJECT"} /><button aria-label="Toggle inspector" onClick={() => setInspectorOpen((open) => !open)}><SlidersHorizontal size={16} /></button></div></header>
    <aside className="kw-activity-bar" aria-label="KForge activities">{ACTIVITIES.map((item) => <button key={item.id} data-workbench-activity={item.id} aria-label={item.label} title={item.label} className={activity === item.id ? "is-active" : ""} onClick={() => changeActivity(item.id)}>{icons[item.id]}</button>)}</aside>
    {explorerOpen ? <aside className="kw-explorer" aria-label={`${current.label} Explorer`}><div className="kw-explorer-heading"><div><small>Explorer</small><strong>{current.label}</strong></div><button aria-label="Collapse explorer" onClick={() => setExplorerOpen(false)}><ChevronRight size={15} /></button></div><div className="kw-explorer-scroll">{groupedViews.map(([group, views]) => <section key={group}><h2>{group}</h2>{views.map((item) => <button key={item.id} data-workbench-view={item.id} className={view === item.id ? "is-active" : ""} onClick={() => navigate(activity, item.id)}>{item.label}</button>)}</section>)}</div></aside> : <button className="kw-explorer-restore" aria-label="Open explorer" onClick={() => setExplorerOpen(true)}><ChevronRight size={15} /></button>}
    <main className="kw-workbench" aria-label="KForge workbench" data-workbench-surface={`${activity}:${view}`}><nav className="kw-breadcrumb" aria-label="Workbench breadcrumb"><span>{activityLabel(activity)}</span><ChevronRight size={13} /><strong>{viewLabel(activity, view)}</strong></nav><div className="kw-surface-heading"><div><p>KNOuX / {activityLabel(activity)}</p><h1>{viewLabel(activity, view)}</h1><small>{surfaceDescription(activity, view, activeProject)}</small></div><button onClick={() => void refreshWorkspace()}><RefreshCw size={15} />Refresh</button></div>{message && <div className="kw-message" role="status">{message}</div>}<div className="kw-workbench-scroll"><WorkbenchSurface activity={activity} view={view} workspace={workspace} project={activeProject} settings={settings} onProjectSelect={changeProject} onRefresh={refreshWorkspace} onSettings={(next) => { setSettings(next); applyAppearance(next); }} onNavigate={navigate} onExecution={setExecution} onInspectorContext={setInspectorContext} /></div>{activity === "developer-tools" && view !== "preview" && <div className="kw-bottom-panel" aria-label="Developer execution panel"><div><strong>EXECUTION</strong><span>{execution?.state || "IDLE"}</span></div>{execution ? <><code>{execution.command || "KForge registered operation"}</code><small>{execution.message || execution.source}</small><pre>{execution.output || "No process output captured."}</pre></> : <p>No developer command has run from this workbench session.</p>}</div>}</main>
    {inspectorOpen && <CanonicalInspector activity={activity} view={view} project={activeProject} execution={execution} context={inspectorContext} />}
    {paletteOpen && <div className="kw-palette-backdrop" role="dialog" aria-modal="true" aria-label="KForge command palette"><div className="kw-palette"><div className="kw-palette-input"><Search size={17} /><input ref={paletteInput} value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Projects, files, symbols, problems, tasks, models…" /><button aria-label="Close command palette" onClick={() => setPaletteOpen(false)}><X size={16} /></button></div><div className="kw-palette-results">{previewPaletteCommands.map((command) => <button key={command.label} onClick={() => void runPreviewPaletteCommand(command)}><strong>{command.label}</strong><span>{command.operation ? "Canonical local Preview operation" : "Developer Tools / Preview"}</span><small>{command.operation && !projectId ? "Requires project context" : "KForge command registry"}</small></button>)}{searchRows.map((row, index) => <button key={`${String(row.entity || "result")}:${String(row.entityId || index)}`} onClick={() => { if (row.projectId) setProjectId(String(row.projectId)); deepNavigate(String(row.target || "Workspace")); setPaletteOpen(false); setPaletteQuery(""); }}><strong>{String(row.title || "Result")}</strong><span>{String(row.entity || "Evidence")} · {String(row.detail || "")}</span><small>{String(row.source || "")}</small></button>)}{paletteQuery.length >= 2 && !searchRows.length && !previewPaletteCommands.length && <p>No bounded local result matched this query.</p>}</div></div></div>}
  </div>;
}

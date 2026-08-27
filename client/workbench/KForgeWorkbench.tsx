import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bot, BrainCircuit, ChevronRight, Cloud, FolderKanban, GitBranch, RefreshCw, Rocket, Search,
  Settings2, ShieldCheck, SlidersHorizontal, Terminal, X,
} from "lucide-react";
import type {
  CommandResult, KForgeActivity, KForgeOnlineView, KForgePlatformSettings, ProjectSummary,
  WorkspaceAction, WorkspaceActionDescriptor, WorkspaceResponse,
} from "@shared/workspace";
import { ACTIVITIES, KFORGE_ACTIVITY_IDS, ONLINE_EXPLORER_VIEWS, activityDefinition, activityLabel, defaultView, viewLabel } from "./navigation";
import { fetchEvidence, fetchJson, jsonRequest, waitForTask } from "./api";
import "./workbench.css";

export { KFORGE_ACTIVITY_IDS, ONLINE_EXPLORER_VIEWS };

type RecordRow = Record<string, unknown>;
type TaskRow = RecordRow & { id: string; projectId: string; kind: string; status: string; progress?: number; startedAt?: string; finishedAt?: string; durationMs?: number; output?: string; error?: string; logs?: Array<{ at?: string; message?: string }> };
type MarketplaceItem = RecordRow & {
  id: string; name: string; category: string; taxonomy?: string[]; description?: string; overview?: string; source?: string; version?: string;
  capabilities?: string[]; requirements?: string[]; installed?: boolean; enabled?: boolean; installAction?: string; trust?: string; availability?: string;
  authority?: { kind?: string; originalKind?: string }; projectCompatibility?: { state?: string; evidence?: string[]; source?: string };
  permissions?: Array<{ id: string; required: boolean; detail: string }>; runtimeEvidence?: { state?: string; sources?: string[] };
  healthState?: string; freshness?: { state?: string; at?: string | null }; unavailableReason?: string;
  integrity?: { state?: string; value?: string; source?: string }; updateState?: { state?: string; value?: string; source?: string };
  lifecycle?: Array<{ id: string; label: string; state: string; evidence: string }>;
};
type MarketplaceData = { items?: MarketplaceItem[]; providers?: RecordRow[]; adapters?: RecordRow[]; categories?: RecordRow[] };
type ExecutionSnapshot = { label: string; command?: string; state: string; source?: string; startedAt?: string; completedAt?: string; output?: string; message?: string; exitCode?: number };
type SurfaceProps = {
  activity: KForgeActivity; view: string; workspace: WorkspaceResponse | null; project?: ProjectSummary; settings: KForgePlatformSettings | null;
  onProjectSelect: (id: string) => void; onRefresh: () => Promise<void>; onSettings: (settings: KForgePlatformSettings) => void;
  onNavigate: (activity: KForgeActivity, view: string) => void; onExecution: (execution: ExecutionSnapshot | null) => void;
};

const icons: Record<KForgeActivity, ReactNode> = {
  projects: <FolderKanban size={20} />, ai: <Bot size={20} />, online: <Cloud size={20} />, intelligence: <BrainCircuit size={20} />,
  quality: <ShieldCheck size={20} />, "developer-tools": <Terminal size={20} />, remote: <GitBranch size={20} />, release: <Rocket size={20} />, system: <Settings2 size={20} />,
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

function StatusBadge({ value }: { value?: unknown }) {
  const normalized = String(value ?? "UNKNOWN").toUpperCase().replace(/\s+/g, "_");
  return <span className={`kw-badge kw-badge--${normalized.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{normalized}</span>;
}

function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <section className="kw-empty" aria-label={title}><h2>{title}</h2><p>{detail}</p>{action}</section>;
}

function primitiveRows(value: RecordRow | null | undefined) {
  return Object.entries(value || {}).filter(([, entry]) => entry === null || ["string", "number", "boolean", "undefined"].includes(typeof entry));
}

function EvidenceRows({ value }: { value: RecordRow | null | undefined }) {
  const rows = primitiveRows(value);
  if (!rows.length) return <p className="kw-muted">No scalar evidence fields are available.</p>;
  return <dl className="kw-evidence-list">{rows.map(([key, entry]) => <div key={key}><dt>{key.replace(/([A-Z])/g, " $1")}</dt><dd>{entry === null || entry === undefined || entry === "" ? "UNKNOWN" : String(entry)}</dd></div>)}</dl>;
}

function EvidenceCards({ rows }: { rows: RecordRow[] }) {
  if (!rows.length) return <p className="kw-muted">No evidence rows are available.</p>;
  return <div className="kw-card-grid">{rows.map((row, index) => <article className="kw-evidence-card" key={String(row.id || row.name || row.label || index)}><strong>{String(row.name || row.label || row.id || `Evidence ${index + 1}`)}</strong><EvidenceRows value={row} /><details><summary>Advanced · Raw Evidence</summary><pre>{JSON.stringify(row, null, 2)}</pre></details></article>)}</div>;
}

function TaskTable({ tasks }: { tasks: TaskRow[] }) {
  if (!tasks.length) return <EmptyState title="No persisted tasks" detail="Tasks appear only after a real operation creates evidence." />;
  return <div className="kw-table-wrap" aria-label="Persisted task evidence"><table className="kw-table"><thead><tr><th>Task</th><th>Project</th><th>State</th><th>Progress</th><th>Started</th><th>Duration</th><th>Evidence</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.id}><td><strong>{task.kind}</strong><small>{task.id}</small></td><td>{task.projectId}</td><td><StatusBadge value={task.status} /></td><td>{task.progress ?? 0}%</td><td>{task.startedAt ? new Date(task.startedAt).toLocaleString() : "UNKNOWN"}</td><td>{task.durationMs ? `${task.durationMs} ms` : "UNKNOWN / RUNNING"}</td><td><span>{task.error || task.logs?.at(-1)?.message || task.output?.slice(0, 140) || "No output yet"}</span><details className="kw-task-detail"><summary>Task evidence</summary><pre>{JSON.stringify(task, null, 2)}</pre></details></td></tr>)}</tbody></table></div>;
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

  const navigate = (nextActivity: KForgeActivity, nextView: string) => { setActivity(nextActivity); setView(nextView); setExecution(null); };
  const changeActivity = (next: KForgeActivity) => navigate(next, next === "online" && settings ? settings.general.startupOnlineView : defaultView(next));
  const deepNavigate = (target: string) => {
    const map: Record<string, [KForgeActivity, string]> = { Workspace: ["projects", "workspace"], Agents: ["ai", "agents"], Models: ["ai", "models"], Tasks: ["ai", "tasks"], Marketplace: ["online", "marketplace"], Extensions: ["online", "extensions"], "Project graph": ["intelligence", "project-graph"], Dependencies: ["intelligence", "dependencies"], Architecture: ["intelligence", "architecture"], Problems: ["quality", "problems"], Documentation: ["quality", "documentation"], "KForge Sonar": ["quality", "sonar"], Tests: ["developer-tools", "tests"], Build: ["developer-tools", "build"], Runtime: ["developer-tools", "runtime"], Git: ["remote", "git"], GitHub: ["remote", "github"], "Release Gate": ["release", "release-gate"], Settings: ["system", "settings"] };
    const destination = map[target] || ["projects", "workspace"]; navigate(destination[0], destination[1]);
  };
  const changeMode = async (mode: string) => { try { await fetchJson("/api/workspace/platform/mode", jsonRequest({ mode })); await refreshWorkspace(); } catch (error) { setMessage(error instanceof Error ? error.message : "Platform mode change failed."); } };
  const groupedViews = useMemo(() => { const groups = new Map<string, typeof current.views>(); for (const item of current.views) groups.set(item.group || current.label, [...(groups.get(item.group || current.label) || []), item]); return [...groups.entries()]; }, [current]);

  if (loading) return <div className="kw-loading">Loading KNOuX Forge workbench…</div>;
  return <div className="kw-shell" data-activity={activity} data-workbench="kforge">
    <header className="kw-topbar"><div className="kw-brand"><span className="kw-brand-mark">K</span><div><strong>KNOuX Forge</strong><small>Engineering Workbench</small></div></div><button className="kw-command-trigger" onClick={() => setPaletteOpen(true)}><Search size={15} /><span>Search KForge</span><kbd>Ctrl K</kbd></button><div className="kw-topbar-meta"><select aria-label="Project context" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">No project context</option>{(workspace?.projects || []).filter((project) => !project.archived).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><select aria-label="Platform mode" value={workspace?.localPlatform.mode || "offline"} onChange={(event) => void changeMode(event.target.value)}><option value="offline">Offline</option><option value="local-first">Local First</option><option value="online-optional">Online Optional</option><option value="online">Online</option></select><StatusBadge value={activeProject?.trust || "NO_PROJECT"} /><button aria-label="Toggle inspector" onClick={() => setInspectorOpen((open) => !open)}><SlidersHorizontal size={16} /></button></div></header>
    <aside className="kw-activity-bar" aria-label="KForge activities">{ACTIVITIES.map((item) => <button key={item.id} data-workbench-activity={item.id} aria-label={item.label} title={item.label} className={activity === item.id ? "is-active" : ""} onClick={() => changeActivity(item.id)}>{icons[item.id]}</button>)}</aside>
    {explorerOpen ? <aside className="kw-explorer" aria-label={`${current.label} Explorer`}><div className="kw-explorer-heading"><div><small>Explorer</small><strong>{current.label}</strong></div><button aria-label="Collapse explorer" onClick={() => setExplorerOpen(false)}><ChevronRight size={15} /></button></div><div className="kw-explorer-scroll">{groupedViews.map(([group, views]) => <section key={group}><h2>{group}</h2>{views.map((item) => <button key={item.id} data-workbench-view={item.id} className={view === item.id ? "is-active" : ""} onClick={() => navigate(activity, item.id)}>{item.label}</button>)}</section>)}</div></aside> : <button className="kw-explorer-restore" aria-label="Open explorer" onClick={() => setExplorerOpen(true)}><ChevronRight size={15} /></button>}
    <main className="kw-workbench" data-workbench-surface={`${activity}:${view}`}><nav className="kw-breadcrumb" aria-label="Workbench breadcrumb"><span>{activityLabel(activity)}</span><ChevronRight size={13} /><strong>{viewLabel(activity, view)}</strong></nav><div className="kw-surface-heading"><div><p>KNOuX / {activityLabel(activity)}</p><h1>{viewLabel(activity, view)}</h1><small>{surfaceDescription(activity, view, activeProject)}</small></div><button onClick={() => void refreshWorkspace()}><RefreshCw size={15} />Refresh</button></div>{message && <div className="kw-message" role="status">{message}</div>}<div className="kw-workbench-scroll"><WorkbenchSurface activity={activity} view={view} workspace={workspace} project={activeProject} settings={settings} onProjectSelect={setProjectId} onRefresh={refreshWorkspace} onSettings={(next) => { setSettings(next); applyAppearance(next); }} onNavigate={navigate} onExecution={setExecution} /></div>{activity === "developer-tools" && <div className="kw-bottom-panel" aria-label="Developer execution panel"><div><strong>EXECUTION</strong><span>{execution?.state || "IDLE"}</span></div>{execution ? <><code>{execution.command || "KForge registered operation"}</code><small>{execution.message || execution.source}</small><pre>{execution.output || "No process output captured."}</pre></> : <p>No developer command has run from this workbench session.</p>}</div>}</main>
    {inspectorOpen && <aside className="kw-inspector" aria-label="Context inspector"><div className="kw-inspector-scroll"><div className="kw-inspector-title"><SlidersHorizontal size={17} /><div><strong>Inspector</strong><small>{activityLabel(activity)} / {viewLabel(activity, view)}</small></div></div><h2>Project context</h2>{activeProject ? <EvidenceRows value={activeProject as unknown as RecordRow} /> : <p className="kw-muted">No project selected. Online compatibility remains NOT_EVALUATED.</p>}{execution && <><h2>Latest execution</h2><EvidenceRows value={execution as unknown as RecordRow} /></>}<h2>Workbench contract</h2><ul className="kw-contract"><li>One active capability surface</li><li>Explorer is scoped to the Activity</li><li>Inspector is contextual</li><li>Remote contact remains explicit</li></ul></div></aside>}
    {paletteOpen && <div className="kw-palette-backdrop" role="dialog" aria-modal="true" aria-label="KForge command palette"><div className="kw-palette"><div className="kw-palette-input"><Search size={17} /><input ref={paletteInput} value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Projects, files, symbols, problems, tasks, models…" /><button aria-label="Close command palette" onClick={() => setPaletteOpen(false)}><X size={16} /></button></div><div className="kw-palette-results">{searchRows.map((row, index) => <button key={`${String(row.entity || "result")}:${String(row.entityId || index)}`} onClick={() => { if (row.projectId) setProjectId(String(row.projectId)); deepNavigate(String(row.target || "Workspace")); setPaletteOpen(false); setPaletteQuery(""); }}><strong>{String(row.title || "Result")}</strong><span>{String(row.entity || "Evidence")} · {String(row.detail || "")}</span><small>{String(row.source || "")}</small></button>)}{paletteQuery.length >= 2 && !searchRows.length && <p>No bounded local result matched this query.</p>}</div></div></div>}
  </div>;
}

function surfaceDescription(activity: KForgeActivity, view: string, project?: ProjectSummary) {
  if (activity === "online") return project ? `Global Online evidence with optional compatibility context from ${project.name}.` : "Global Online evidence; compatibility is NOT_EVALUATED because no project is selected.";
  if (!project && !["system", "ai", "projects"].includes(activity)) return "Select a project context to load project-specific evidence.";
  if (view === "workspace") return "Dense engineering table with search, sorting, selection, Git, health and trust evidence.";
  if (view === "release-gate") return "Independent SOURCE, LOCAL, PREVIEW, DESKTOP, WINDOWS_PACKAGE, INSTALLER, GITHUB, CI and REMOTE evidence.";
  if (view === "terminal") return "Registered project commands only; unrestricted shell execution is not exposed.";
  return `Evidence-backed ${viewLabel(activity, view)} surface.`;
}

function WorkbenchSurface(props: SurfaceProps) {
  if (props.activity === "projects") return <ProjectsSurface {...props} />;
  if (props.activity === "online") return <OnlineSurface {...props} />;
  if (props.activity === "ai") return <AISurface {...props} />;
  if (props.activity === "quality") return <QualitySurface {...props} />;
  if (props.activity === "developer-tools") return <DeveloperSurface {...props} />;
  if (props.activity === "remote") return <RemoteSurface {...props} />;
  if (props.activity === "release") return <ReleaseSurface {...props} />;
  if (props.activity === "system") return <SystemSurface {...props} />;
  return <IntelligenceSurface {...props} />;
}

function ProjectsSurface({ view, workspace, project, onProjectSelect, onRefresh }: SurfaceProps) {
  const [query, setQuery] = useState(""); const [sort, setSort] = useState<"activity" | "name" | "health">("activity"); const [selected, setSelected] = useState<string[]>([]);
  const [pathInput, setPathInput] = useState(""); const [remoteUrl, setRemoteUrl] = useState(""); const [targetName, setTargetName] = useState(""); const [message, setMessage] = useState("");
  const rows = useMemo(() => { let list = [...(workspace?.projects || [])]; if (view === "recent") list = list.filter((entry) => entry.categories.recent); if (view === "favorites") list = list.filter((entry) => entry.favorite); if (view === "pinned") list = list.filter((entry) => entry.pinned); if (view === "archive") list = list.filter((entry) => entry.archived); else list = list.filter((entry) => !entry.archived); list = list.filter((entry) => `${entry.name} ${entry.path} ${entry.projectType} ${entry.branch} ${entry.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase())); list.sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "health" ? (b.healthScore ?? -1) - (a.healthScore ?? -1) : b.lastActivity.localeCompare(a.lastActivity)); return list; }, [workspace, view, query, sort]);
  if (view === "open-project") return <section className="kw-form-surface"><h2>Open Project</h2><p>Register an existing local directory without remote contact.</p><input aria-label="Local project path" value={pathInput} onChange={(e) => setPathInput(e.target.value)} /><button onClick={() => void fetchJson<{ project: ProjectSummary }>("/api/workspace/projects/open", jsonRequest({ path: pathInput.trim() })).then(async (data) => { onProjectSelect(data.project.id); await onRefresh(); setMessage(`Opened ${data.project.name}.`); }).catch((error) => setMessage(error instanceof Error ? error.message : "Open project failed."))}>Open project</button>{message && <p>{message}</p>}</section>;
  if (view === "import-project") return <section className="kw-form-surface"><h2>Import Repository</h2><p>Clone is policy-controlled and always requires explicit confirmation.</p><input aria-label="Repository HTTPS URL" value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} /><input aria-label="Destination folder" value={targetName} onChange={(e) => setTargetName(e.target.value)} /><button onClick={() => void (async () => { if (!window.confirm(`Clone ${remoteUrl}?`)) return; try { const data = await fetchJson<{ project: ProjectSummary }>("/api/workspace/projects/clone", jsonRequest({ remoteUrl, targetName, confirmed: true })); onProjectSelect(data.project.id); await onRefresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed."); } })()}>Clone with confirmation</button>{message && <p>{message}</p>}</section>;
  const allSelected = rows.length > 0 && rows.every((row) => selected.includes(row.id));
  return <section className="kw-projects"><div className="kw-table-toolbar"><label><Search size={14} /><input aria-label="Search local projects" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects, paths, types, branches…" /></label><select aria-label="Sort projects" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="activity">Last activity</option><option value="name">Project</option><option value="health">Health</option></select><label className="kw-select-all"><input type="checkbox" aria-label="Select all filtered projects" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? rows.map((row) => row.id) : [])} />Select all</label><span>{rows.length} project(s)</span></div>{selected.length > 0 && <div className="kw-bulk-bar"><strong>{selected.length} selected</strong><button onClick={() => setSelected([])}>Clear selection</button></div>}{rows.length ? <div className="kw-table-wrap" aria-label="Projects engineering table"><table className="kw-table" data-testid="project-table"><thead><tr><th>Bulk</th><th>Project</th><th>Type</th><th>Branch</th><th>Trust</th><th>Git</th><th>Health</th><th>Last Activity</th></tr></thead><tbody>{rows.map((entry) => <tr key={entry.id} data-project-path={entry.path} data-project-id={entry.id} className={project?.id === entry.id ? "is-selected" : ""}><td><input type="checkbox" aria-label={`Select ${entry.name} for bulk actions`} checked={selected.includes(entry.id)} onChange={(e) => setSelected((current) => e.target.checked ? [...new Set([...current, entry.id])] : current.filter((id) => id !== entry.id))} /></td><td><button className="kw-project-select" aria-label={`Open project context ${entry.name}`} onClick={() => onProjectSelect(entry.id)}><strong>{entry.name}</strong><small>{entry.path}</small>{entry.tags.length ? <small>{entry.tags.join(" · ")}</small> : null}</button></td><td>{entry.projectType}</td><td><code>{entry.branch}</code></td><td><StatusBadge value={entry.trust} /></td><td><span>{entry.modifiedFiles + entry.untrackedFiles} changed</span><small>{entry.ahead} ahead · {entry.behind} behind</small></td><td>{entry.healthScore ?? "NOT_SCANNED"}</td><td>{new Date(entry.lastActivity).toLocaleString()}</td></tr>)}</tbody></table></div> : <EmptyState title={view === "pinned" ? "No pinned projects" : "No projects found"} detail="Open or import a project to populate this engineering table." />}</section>;
}

function OnlineSurface({ view, project }: SurfaceProps) {
  const [market, setMarket] = useState<MarketplaceData>({}); const [control, setControl] = useState<RecordRow | null>(null); const [tasks, setTasks] = useState<TaskRow[]>([]); const [selectedId, setSelectedId] = useState(""); const [query, setQuery] = useState(""); const [message, setMessage] = useState("Loading Online evidence…"); const [operation, setOperation] = useState<RecordRow | null>(null);
  const refresh = async () => { try { const [m, c, t] = await Promise.all([fetchJson<MarketplaceData>(project ? `/api/workspace/projects/${encodeURIComponent(project.id)}/marketplace` : "/api/workspace/marketplace"), fetchJson<RecordRow>("/api/workspace/online/control-center"), fetchJson<{ tasks: TaskRow[] }>("/api/workspace/tasks")]); setMarket(m); setControl(c); setTasks(t.tasks || []); if (!selectedId && m.items?.[0]) setSelectedId(m.items[0].id); setMessage(""); } catch (error) { setMessage(error instanceof Error ? error.message : "Online evidence failed."); } };
  useEffect(() => { void refresh(); }, [project?.id]);
  const items = useMemo(() => { let list = market.items || []; if (view === "extensions") list = list.filter((item) => item.taxonomy?.includes("extensions")); if (view === "models") list = list.filter((item) => item.category === "models"); if (view === "agents") list = list.filter((item) => item.category === "agents"); if (view === "tools") list = list.filter((item) => item.category === "tools"); if (view === "integrations") list = list.filter((item) => item.taxonomy?.includes("integrations")); if (view === "installed") list = list.filter((item) => item.installed); if (view === "updates") list = list.filter((item) => item.updateState?.state === "VERIFIED" && /UPDATE_AVAILABLE/i.test(item.updateState.value || "")); if (view === "security") list = list.filter((item) => item.trust !== "TRUSTED" || (item.permissions || []).some((permission) => permission.required) || ["REMOTE_REGISTRY", "CACHED_REMOTE"].includes(item.authority?.kind || "")); return list.filter((item) => `${item.name} ${item.description || ""} ${item.source || ""} ${(item.capabilities || []).join(" ")}`.toLowerCase().includes(query.toLowerCase())); }, [market, view, query]);
  const selected = (market.items || []).find((item) => item.id === selectedId) || items[0];
  if (view === "providers" || view === "remote-sources") { const rows = view === "providers" ? [...(market.providers || []), ...(market.adapters || [])] : (market.adapters || []).filter((row) => row.kind === "remote"); return <section className="kw-online"><OnlineContext project={project} control={control} /><div className="kw-toolbar"><h2>{viewLabel("online", view)}</h2><button onClick={() => void refresh()}>Refresh evidence</button></div><EvidenceCards rows={rows} /></section>; }
  if (view === "downloads" || view === "activity") { const list = tasks.filter((task) => view === "downloads" ? /download|pull|install|update/i.test(JSON.stringify(task)) : /online|marketplace|download|install|update|provider/i.test(JSON.stringify(task))); return <section className="kw-online"><OnlineContext project={project} control={control} /><TaskTable tasks={list} /></section>; }
  const operate = async (kind: "install" | "health" | "run" | "update" | "uninstall") => { if (!selected) return; const destructive = ["install", "run", "update", "uninstall"].includes(kind); if (destructive && !window.confirm(`${kind} ${selected.name}? Review the displayed authority, integrity, permissions and trust evidence first.`)) return; setOperation({ state: "RUNNING", operation: kind }); try { const url = `/api/workspace/marketplace/items/${encodeURIComponent(selected.id)}/${kind}`; const result = kind === "health" ? await fetchEvidence(url) : await fetchEvidence(url, jsonRequest({ confirmed: true })); setOperation({ operation: kind, status: result.status, ...result.data }); await refresh(); } catch (error) { setOperation({ operation: kind, state: "FAILED", error: error instanceof Error ? error.message : "Operation failed" }); } };
  return <section className="kw-online"><OnlineContext project={project} control={control} /><div className="kw-online-toolbar"><label><Search size={14} /><input aria-label="Search Online catalog" value={query} onChange={(e) => setQuery(e.target.value)} /></label><span>{items.length} result(s)</span><button onClick={() => void refresh()}>Refresh local evidence</button></div>{message && <p className="kw-message">{message}</p>}{items.length ? <div className="kw-online-layout"><div className="kw-online-results">{items.map((item) => <button key={item.id} className={selected?.id === item.id ? "is-selected" : ""} onClick={() => { setSelectedId(item.id); setOperation(null); }}><div><strong>{item.name}</strong><span>{item.category} · {item.version || "version UNKNOWN"}</span></div><p>{item.description || item.overview || "No description supplied."}</p><div className="kw-row-badges"><StatusBadge value={item.authority?.kind} /><StatusBadge value={item.availability} /><StatusBadge value={project ? item.projectCompatibility?.state || "UNKNOWN" : "NOT_EVALUATED"} /></div></button>)}</div>{selected && <aside className="kw-online-inspector" aria-label="Online item details"><h2>{selected.name}</h2><EvidenceRows value={{ authority: selected.authority?.kind, source: selected.source, availability: selected.availability, runtimeEvidence: selected.runtimeEvidence?.state, health: selected.healthState, compatibility: project ? selected.projectCompatibility?.state : "NOT_EVALUATED", trust: selected.trust, freshness: selected.freshness?.state, integrity: selected.integrity?.state, update: selected.updateState?.value }} />{selected.unavailableReason && <p className="kw-warning">{selected.unavailableReason}</p>}<h3>Permissions</h3><ul>{(selected.permissions || []).filter((permission) => permission.required).map((permission) => <li key={permission.id}><strong>{permission.id}</strong> — {permission.detail}</li>)}</ul><h3>Lifecycle</h3>{(selected.lifecycle || []).slice(0, 10).map((stage) => <div className="kw-lifecycle" key={stage.id}><StatusBadge value={stage.state} /><span>{stage.label}</span></div>)}<div className="kw-operation-actions">{!selected.installed && selected.installAction !== "NOT_AVAILABLE" && <button onClick={() => void operate("install")}>Install local package</button>}{selected.installed && <><button onClick={() => void operate("health")}>Health check</button><button onClick={() => void operate("run")}>Run local package</button>{selected.updateState?.state === "VERIFIED" && /UPDATE_AVAILABLE/i.test(selected.updateState.value || "") && <button onClick={() => void operate("update")}>Update local package</button>}<button onClick={() => void operate("uninstall")}>Uninstall local package</button></>}</div>{operation && <div className="kw-operation-result" role="status"><pre>{JSON.stringify(operation, null, 2)}</pre></div>}</aside>}</div> : <EmptyState title={view === "updates" ? "No verified update evidence" : `No ${viewLabel("online", view).toLowerCase()} evidence`} detail={view === "updates" ? "Updates require installedVersion, verifiedLatestVersion and version comparison." : "No verified source item matches this view."} />}</section>;
}

function OnlineContext({ project, control }: { project?: ProjectSummary; control: RecordRow | null }) {
  return <div className="kw-online-context"><div><Cloud size={17} /><strong>Online is global</strong><span>Opening this surface performs no remote catalog refresh.</span></div><div><span>Compatibility</span><StatusBadge value={project ? "PROJECT_CONTEXT" : "NOT_EVALUATED"} /><small>{project ? project.name : "No project selected"}</small></div><div><span>Control Center</span><StatusBadge value={control?.mode || "UNKNOWN"} /><small>{control ? "Policy evidence loaded" : "Loading policy evidence"}</small></div></div>;
}

function AISurface(props: SurfaceProps) {
  const { view, project } = props;
  if (view === "agents") return project ? <AgentMissionSurface project={project} /> : <SimpleFetchSurface url="/api/workspace/marketplace" title="Global agent catalog" />;
  if (view === "tasks") return <AITasks />;
  return <AISource view={view} />;
}

function AISource({ view }: { view: string }) {
  const [data, setData] = useState<RecordRow | null>(null); const [message, setMessage] = useState("Loading AI evidence…");
  useEffect(() => { void fetchJson<RecordRow>(view === "providers" ? "/api/workspace/ai/providers" : "/api/workspace/ai/models").then((next) => { setData(next); setMessage(""); }).catch((error) => setMessage(error instanceof Error ? error.message : "AI evidence unavailable.")); }, [view]);
  if (message) return <p className="kw-message">{message}</p>; if (!data) return null;
  if (view === "providers") return <section className="kw-surface-section"><h2>Provider runtime and configuration evidence</h2><p>Local project context stays on this machine. Opening Providers does not contact cloud providers or expose credentials.</p><EvidenceCards rows={(data.providers as RecordRow[] || [])} /></section>;
  return <section className="kw-surface-section"><h2>Local Model Center</h2><p>Installed runtime inventory is distinct from catalog recommendations. Unknown capabilities remain UNKNOWN.</p><h3>Provider evidence</h3><EvidenceCards rows={(data.providers as RecordRow[] || [])} /><h3>Recommended catalog models</h3><EvidenceCards rows={(data.recommendations as RecordRow[] || [])} /><details><summary>Hardware and model-family evidence</summary><pre>{JSON.stringify({ hardware: data.hardware, families: data.families, onboarding: data.onboarding, active: data.active }, null, 2)}</pre></details></section>;
}

function AgentMissionSurface({ project }: { project: ProjectSummary }) {
  const [tools, setTools] = useState<RecordRow[]>([]); const [message, setMessage] = useState(""); const [started, setStarted] = useState<TaskRow | null>(null);
  useEffect(() => { void fetchJson<{ tools: RecordRow[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/agent/tools`).then((data) => setTools(data.tools || [])).catch((error) => setMessage(error instanceof Error ? error.message : "Agent evidence unavailable.")); }, [project.id]);
  const start = async () => { setMessage("Starting typed audit mission…"); try { const data = await fetchJson<{ task: TaskRow }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/agent/missions`, jsonRequest({ mission: "audit" })); setStarted(data.task); setMessage(`Mission task ${data.task.id} started. Open Tasks to follow its persisted event log.`); } catch (error) { setMessage(error instanceof Error ? error.message : "Mission start failed."); } };
  return <section className="kw-agent-panel"><h2>KForge Engineer missions</h2><p>Read · Plan · Patch · Verify. Trust is enforced server-side; write-capable steps remain snapshot/confirmation gated.</p><h3>Agent permissions and tool eligibility</h3><EvidenceCards rows={tools} /><div className="kw-agent-actions"><button onClick={() => void start()}>Start mission</button></div>{message && <p className="kw-message" role="status">{message}</p>}{started && <details open><summary>Started mission evidence</summary><pre>{JSON.stringify(started, null, 2)}</pre></details>}</section>;
}

function AITasks() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  useEffect(() => { let active = true; const refresh = () => void fetchJson<{ tasks: TaskRow[] }>("/api/workspace/tasks").then((data) => { if (active) setTasks((data.tasks || []).filter((task) => task.kind === "agent" || task.projectId === "ai-center")); }).catch(() => undefined); refresh(); const timer = window.setInterval(refresh, 700); return () => { active = false; window.clearInterval(timer); }; }, []);
  return <section className="kw-surface-section"><h2>Task Center</h2><TaskTable tasks={tasks} /></section>;
}

function QualitySurface({ view, project }: SurfaceProps) {
  if (!project) return <EmptyState title="No project selected" detail={`${viewLabel("quality", view)} needs project context.`} />;
  if (view === "snapshots") return <SnapshotSurface project={project} />;
  if (view === "documentation") return <DocumentationSurface project={project} />;
  return <QualityEvidence project={project} view={view} />;
}

function QualityEvidence({ project, view }: { project: ProjectSummary; view: string }) {
  const [problems, setProblems] = useState<RecordRow[]>([]); const [tools, setTools] = useState<RecordRow[]>([]); const [message, setMessage] = useState(""); const [result, setResult] = useState<RecordRow | null>(null);
  const refresh = async () => { try { const [p, s] = await Promise.all([fetchJson<{ problems: RecordRow[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/problems`), fetchJson<{ tools: RecordRow[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/security/tools`)]); setProblems(p.problems || []); setTools(s.tools || []); } catch (error) { setMessage(error instanceof Error ? error.message : "Quality evidence unavailable."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  const runScan = async () => { setMessage("Running bounded KForge scan…"); try { const started = await fetchJson<{ task: TaskRow }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/tasks`, jsonRequest({ action: "scan" })); const task = await waitForTask(started.task.id); setResult({ task }); await refresh(); setMessage("Current scan evidence loaded."); } catch (error) { setMessage(error instanceof Error ? error.message : "Scan failed."); } };
  const applyIssue = async (issue: RecordRow) => { const id = String(issue.id || ""); if (!id) return; const preview = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/problems/${encodeURIComponent(id)}/preview`, jsonRequest({})); if (!preview.ok) { setResult({ issue: issue.title, previewState: "NOT_AVAILABLE", ...preview.data }); return; } setResult({ issue: issue.title, preview: preview.data }); if (!window.confirm(`Apply the reviewed deterministic fix for ${String(issue.title || id)} and verify it?`)) return; const applied = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/problems/${encodeURIComponent(id)}/apply`, jsonRequest({ confirmed: true, verify: true })); setResult({ issue: issue.title, preview: preview.data, applied: applied.data, status: applied.status }); await refresh(); };
  const visible = view === "security" ? problems.filter((issue) => issue.category === "security") : view === "performance" ? problems.filter((issue) => issue.category === "performance") : view === "technical-debt" ? problems.filter((issue) => ["completeness", "mock", "documentation"].includes(String(issue.category))) : problems;
  return <section className="kw-surface-section"><div className="kw-toolbar"><h2>{view === "sonar" ? "KForge Sonar" : viewLabel("quality", view)}</h2>{view === "sonar" && <button onClick={() => void runScan()}>Run current scan</button>}<button onClick={() => void refresh()}>Refresh evidence</button></div>{view === "sonar" && <p>No tool is downloaded or run silently. Security tools and scanner findings keep UNAVAILABLE/BLOCKED states when evidence is absent.</p>}{view === "sonar" || view === "security" ? <><h3>Security Tool Manager</h3><EvidenceCards rows={tools} /></> : null}<h3>{view === "solutions" ? "Solutions Engine · current evidence" : "Current normalized findings"}</h3>{visible.length ? <div className="kw-quality-list">{visible.map((issue, index) => <article className="kw-quality-card" key={String(issue.id || index)}><h2>{String(issue.title || `Finding ${index + 1}`)}</h2><div className="kw-row-badges"><StatusBadge value={issue.severity} /><StatusBadge value={issue.category} /></div><p>{String(issue.description || issue.risk || "No description")}</p><small>{String(issue.file || issue.source || "Local scanner evidence")}</small>{["problems", "solutions"].includes(view) && <div className="kw-quality-actions"><button onClick={() => void applyIssue(issue)}>Preview verified fix</button></div>}<details><summary>Finding evidence</summary><pre>{JSON.stringify(issue, null, 2)}</pre></details></article>)}</div> : <EmptyState title="No matching scan evidence" detail="The current local scan produced no finding for this view; KForge does not invent one." />}{message && <p className="kw-message" role="status">{message}</p>}{result && <div className="kw-operation-result"><pre>{JSON.stringify(result, null, 2)}</pre></div>}</section>;
}

function DocumentationSurface({ project }: { project: ProjectSummary }) {
  const [data, setData] = useState<RecordRow | null>(null); const [message, setMessage] = useState(""); const [result, setResult] = useState<RecordRow | null>(null);
  const refresh = () => fetchJson<RecordRow>(`/api/workspace/projects/${encodeURIComponent(project.id)}/documentation`).then(setData).catch((error) => setMessage(error instanceof Error ? error.message : "Documentation evidence unavailable."));
  useEffect(() => { void refresh(); }, [project.id]);
  const audit = (data?.audit || {}) as RecordRow; const findings = (audit.findings || []) as RecordRow[];
  const apply = async (finding: RecordRow) => { const id = String(finding.id || ""); const preview = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/documentation/${encodeURIComponent(id)}/preview`, jsonRequest({})); setResult({ preview: preview.data }); if (!preview.ok || !window.confirm(`Apply and verify the reviewed documentation fix for ${String(finding.sourceDocument || id)}?`)) return; const applied = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/documentation/${encodeURIComponent(id)}/apply`, jsonRequest({ confirmed: true })); setResult({ preview: preview.data, applied: applied.data }); await refresh(); };
  return <section className="kw-surface-section"><h2>Documentation Audit</h2><p>Local documentation claims are compared with detected manifests and commands. Source edits require explicit confirmation and re-audit.</p>{findings.length ? <div className="kw-quality-list">{findings.map((finding, index) => <article className="kw-quality-card" key={String(finding.id || index)}><h2>{String(finding.sourceDocument || finding.claim || `Finding ${index + 1}`)}</h2><p>{String(finding.claim || "")}</p><small>Actual: {String(finding.actualState || "UNKNOWN")}</small><button onClick={() => void apply(finding)}>Preview + Apply + Verify</button><details><summary>Documentation evidence</summary><pre>{JSON.stringify(finding, null, 2)}</pre></details></article>)}</div> : <EmptyState title="No semantic contradictions" detail="No documentation finding exists in the current local evidence." />}{message && <p className="kw-message">{message}</p>}{result && <div className="kw-operation-result"><pre>{JSON.stringify(result, null, 2)}</pre></div>}</section>;
}

function SnapshotSurface({ project }: { project: ProjectSummary }) {
  const [snapshots, setSnapshots] = useState<RecordRow[]>([]); const [files, setFiles] = useState(""); const [reason, setReason] = useState(""); const [message, setMessage] = useState("");
  const refresh = () => fetchJson<{ snapshots: RecordRow[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/snapshots`).then((data) => setSnapshots(data.snapshots || [])).catch((error) => setMessage(error instanceof Error ? error.message : "Snapshot evidence unavailable."));
  useEffect(() => { void refresh(); }, [project.id]);
  const create = async () => { if (!window.confirm("Create this explicit local snapshot?")) return; try { const data = await fetchJson<RecordRow>(`/api/workspace/projects/${encodeURIComponent(project.id)}/snapshots`, jsonRequest({ files: files.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean), reason: reason.trim() || "KForge manual snapshot", confirmed: true })); setMessage(`Snapshot created: ${String((data.snapshot as RecordRow | undefined)?.id || "recorded")}`); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Snapshot failed."); } };
  const restore = async (snapshot: RecordRow) => { if (!window.confirm(`Restore snapshot ${String(snapshot.id)}?`)) return; try { await fetchJson(`/api/workspace/projects/${encodeURIComponent(project.id)}/snapshots/${encodeURIComponent(String(snapshot.id))}/restore`, jsonRequest({ confirmed: true })); setMessage(`Snapshot ${String(snapshot.id)} restored.`); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Restore failed."); } };
  return <section className="kw-surface-section"><h2>Snapshot & Recovery</h2><div className="kw-snapshot-form"><label>Files to snapshot<input aria-label="Files to snapshot" value={files} onChange={(e) => setFiles(e.target.value)} placeholder="src/file.ts, config.txt" /></label><label>Snapshot reason<input aria-label="Snapshot reason" value={reason} onChange={(e) => setReason(e.target.value)} /></label><button onClick={() => void create()}>Create snapshot</button></div>{message && <p className="kw-message" role="status">{message}</p>}<div className="kw-quality-list">{snapshots.map((snapshot, index) => <article className="kw-quality-card" key={String(snapshot.id || index)}><h2>{String(snapshot.reason || snapshot.id || `Snapshot ${index + 1}`)}</h2><EvidenceRows value={snapshot} /><button onClick={() => void restore(snapshot)}>Restore snapshot</button><details><summary>Snapshot evidence</summary><pre>{JSON.stringify(snapshot, null, 2)}</pre></details></article>)}</div></section>;
}

function DeveloperSurface({ view, project, onExecution }: SurfaceProps) {
  if (!project) return <EmptyState title="No project selected" detail="Developer execution requires explicit project context." />;
  if (view === "terminal") return <CommandTerminal project={project} onExecution={onExecution} />;
  if (["tests", "build", "runtime"].includes(view)) return <ActionSurface project={project} action={view === "tests" ? "test" : view as WorkspaceAction} onExecution={onExecution} />;
  if (view === "lint") return <LintSurface project={project} onExecution={onExecution} />;
  if (view === "preview") return <PreviewSurface project={project} onExecution={onExecution} />;
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
  return <section className="kw-action-surface"><div><h2>{descriptor.label}</h2><StatusBadge value={descriptor.state} /></div><EvidenceRows value={descriptor as unknown as RecordRow} />{descriptor.unavailableReason && <p className="kw-warning">{descriptor.unavailableReason}</p>}<button disabled={!descriptor.enabled} onClick={() => void run()}>Run verified {action}</button></section>;
}

function LintSurface({ project, onExecution }: { project: ProjectSummary; onExecution: SurfaceProps["onExecution"] }) {
  const [tool, setTool] = useState<RecordRow | null>(null); useEffect(() => { void fetchJson<{ tools: RecordRow[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/agent/tools`).then((data) => setTool(data.tools.find((entry) => entry.name === "lint") || null)); }, [project.id]); const enabled = ["AVAILABLE", "AVAILABLE_WITH_CONFIRMATION"].includes(String(tool?.status));
  const run = async () => { onExecution({ label: "Lint", state: "RUNNING", source: "Agent tool registry" }); try { const data = await fetchJson<{ ok: boolean; message: string; output: unknown }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/agent/tools/lint`, jsonRequest({})); onExecution({ label: "Lint", state: data.ok ? "PASS" : "FAILED", source: "Agent tool registry", message: data.message, output: typeof data.output === "string" ? data.output : JSON.stringify(data.output, null, 2) }); } catch (error) { onExecution({ label: "Lint", state: "FAILED", source: "Agent tool registry", message: error instanceof Error ? error.message : "Lint failed." }); } };
  return <section className="kw-action-surface"><div><h2>Lint</h2><StatusBadge value={tool?.status} /></div><EvidenceRows value={tool} /><button disabled={!enabled} onClick={() => void run()}>Run detected lint command</button></section>;
}

function PreviewSurface({ project, onExecution }: { project: ProjectSummary; onExecution: SurfaceProps["onExecution"] }) {
  const [data, setData] = useState<RecordRow | null>(null); const refresh = () => fetchJson<{ preview: RecordRow }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/preview`).then((result) => setData(result.preview)); useEffect(() => { void refresh(); }, [project.id]); const op = async (name: string) => { onExecution({ label: `Preview ${name}`, state: "RUNNING", source: "Shared Preview runtime" }); try { const result = await fetchJson<{ preview: RecordRow }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/preview/${name}`, { method: "POST" }); setData(result.preview); onExecution({ label: `Preview ${name}`, state: String(result.preview.state || "COMPLETED"), source: "Shared Preview runtime", output: String(result.preview.stdout || result.preview.output || "") }); } catch (error) { onExecution({ label: `Preview ${name}`, state: "FAILED", source: "Shared Preview runtime", message: error instanceof Error ? error.message : "Preview failed." }); } };
  return <section className="kw-preview"><h2>KNOuX Forge Preview Engine</h2><p>One shared Preview runtime. No second engine is created by this surface.</p><EvidenceRows value={data} /><div className="kw-inline-actions">{["start", "health", "restart", "stop"].map((name) => <button key={name} onClick={() => void op(name)}>{name}</button>)}</div>{data && <pre>{JSON.stringify(data, null, 2)}</pre>}</section>;
}

function RemoteSurface({ view, project, onExecution }: SurfaceProps) {
  if (!project) return <EmptyState title="No project selected" detail="Git and GitHub evidence requires project context." />;
  return <SimpleFetchSurface url={["git", "branches", "commits"].includes(view) ? `/api/workspace/projects/${encodeURIComponent(project.id)}/git` : `/api/workspace/projects/${encodeURIComponent(project.id)}/github`} title={viewLabel("remote", view)} onError={(text) => onExecution({ label: viewLabel("remote", view), state: "UNAVAILABLE", source: "GitHub read-only adapter", message: text })} />;
}

function ReleaseSurface({ view, project, onExecution }: SurfaceProps) {
  if (!project) return <EmptyState title="No project selected" detail="Release evidence is project scoped." />;
  if (view === "release-gate") return <ReleaseGate project={project} onExecution={onExecution} />;
  return <ReleasePreparation project={project} view={view} />;
}

function ReleaseGate({ project, onExecution }: { project: ProjectSummary; onExecution: SurfaceProps["onExecution"] }) {
  const [data, setData] = useState<RecordRow | null>(null); const [message, setMessage] = useState(""); const order = ["SOURCE", "LOCAL", "PREVIEW", "DESKTOP", "WINDOWS_PACKAGE", "INSTALLER", "GITHUB", "CI", "REMOTE"];
  const run = async () => { onExecution({ label: "Release Gate", state: "RUNNING", source: "KForge release evidence engine" }); const response = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/release-gate`, { method: "POST" }); if (response.data.verdicts) { setData(response.data); setMessage(response.ok ? "" : "Release Gate is blocked; independent source verdicts remain visible."); onExecution({ label: "Release Gate", state: String(response.data.readiness || "UNKNOWN"), source: "KForge release evidence engine" }); } else setMessage(String(response.data.error || "Release Gate failed.")); };
  const verdicts = (data?.verdicts || {}) as Record<string, RecordRow>;
  return <section className="kw-release-gate"><div className="kw-toolbar"><h2>Release Gate</h2><button onClick={() => void run()}>Run Release Gate</button></div>{message && <p className="kw-message">{message}</p>}{data ? <div className="kw-release-grid">{order.map((kind) => { const verdict = verdicts[kind] || {}; return <article key={kind}><strong>{kind}</strong><StatusBadge value={verdict.state} /><p>{String(verdict.source || "No source evidence")}</p><small>{String(verdict.timestamp || "NO_TIMESTAMP")} · {String(verdict.freshness || "UNKNOWN")}</small><details><summary>Domain evidence</summary><pre>{JSON.stringify(verdict, null, 2)}</pre></details></article>; })}</div> : <EmptyState title="No release verification loaded" detail="Run the gate to collect independent evidence domains. A Windows PASS never implies CI PASS." />}</section>;
}

function ReleasePreparation({ project, view }: { project: ProjectSummary; view: string }) {
  const [data, setData] = useState<RecordRow | null>(null); useEffect(() => { void fetchJson<{ preparation: RecordRow }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/release/preparation`).then((result) => setData(result.preparation)); }, [project.id]); if (!data) return <p className="kw-message">Loading release preparation evidence…</p>; if (view === "artifacts") { const artifacts = (data.artifacts || []) as string[]; return <section className="kw-surface-section"><h2>Structured artifacts</h2>{artifacts.length ? <div className="kw-table-wrap"><table className="kw-table"><thead><tr><th>Artifact</th><th>Type</th><th>Source</th><th>Version</th><th>Git SHA</th><th>Created</th><th>Size</th><th>SHA-256</th><th>Signature</th><th>Verification</th></tr></thead><tbody>{artifacts.map((artifact) => <tr key={artifact}><td>{artifact}</td><td>directory</td><td>Local release preparation</td><td>{String(data.version || "UNKNOWN")}</td><td>UNKNOWN</td><td>UNKNOWN</td><td>UNKNOWN</td><td>UNKNOWN</td><td>UNKNOWN</td><td><StatusBadge value="NOT_VERIFIED" /></td></tr>)}</tbody></table></div> : <EmptyState title="No release artifacts detected" detail="Raw JSON is not treated as a verified artifact." />}</section>; } return <section className="kw-surface-section"><h2>{viewLabel("release", view)}</h2><pre>{JSON.stringify(data, null, 2)}</pre></section>;
}

function SystemSurface(props: SurfaceProps) {
  const { view, project, workspace, settings, onSettings, onRefresh } = props;
  if (view === "settings") return settings ? <SettingsSurface settings={settings} onSettings={onSettings} /> : <p className="kw-message">Settings unavailable.</p>;
  if (view === "self-audit") return project ? <SelfAudit project={project} /> : <EmptyState title="No project selected" detail="Self Audit is project scoped." />;
  if (view === "system-diagnostics") return <SystemDiagnostics />;
  if (view === "trust") return project ? <section className="kw-action-surface"><h2>{project.name}</h2><StatusBadge value={project.trust} /><p>Trust enables local process and write-capable operations, not remote writes.</p>{project.trust !== "trusted" && <button onClick={() => void (async () => { if (!window.confirm(`Trust ${project.name}?`)) return; await fetchJson(`/api/workspace/projects/${encodeURIComponent(project.id)}/trust`, jsonRequest({ confirmed: true })); await onRefresh(); })()}>Trust project with confirmation</button>}</section> : <EmptyState title="No project selected" detail="Trust is contextual." />;
  if (view === "online-offline") return <section className="kw-surface-section"><h2>Operating policy</h2><EvidenceRows value={workspace?.localPlatform as unknown as RecordRow} /><p>Remote metadata and transfers remain policy-controlled; Offline mode does not silently contact providers.</p></section>;
  if (!project) return <EmptyState title="No project selected" detail={`${viewLabel("system", view)} needs project context.`} />;
  return <SimpleFetchSurface url={view === "permissions" ? `/api/workspace/projects/${encodeURIComponent(project.id)}/agent/tools` : view === "storage" ? `/api/workspace/projects/${encodeURIComponent(project.id)}/cache` : "/api/workspace/platform"} title={viewLabel("system", view)} />;
}

function SettingsSurface({ settings, onSettings }: { settings: KForgePlatformSettings; onSettings: (settings: KForgePlatformSettings) => void }) {
  const [draft, setDraft] = useState(settings); const [message, setMessage] = useState(""); useEffect(() => setDraft(settings), [settings]);
  const save = async () => { try { const data = await fetchJson<{ settings: KForgePlatformSettings }>("/api/workspace/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: 3, general: { startupActivity: draft.general.startupActivity, startupOnlineView: draft.general.startupOnlineView }, appearance: draft.appearance, preview: draft.preview, privacy: { remoteContextPolicy: draft.privacy.remoteContextPolicy }, git: {} }) }); onSettings(data.settings); setDraft(data.settings); setMessage("Settings v3 saved locally."); } catch (error) { setMessage(error instanceof Error ? error.message : "Settings save failed."); } };
  return <section className="kw-settings"><h2>Settings v3</h2><div className="kw-settings-grid"><label>Startup activity<select aria-label="Startup activity" value={draft.general.startupActivity} onChange={(e) => setDraft({ ...draft, general: { ...draft.general, startupActivity: e.target.value as KForgeActivity } })}>{ACTIVITIES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label><label>Startup Online view<select aria-label="Startup Online view" value={draft.general.startupOnlineView} onChange={(e) => setDraft({ ...draft, general: { ...draft.general, startupOnlineView: e.target.value as KForgeOnlineView } })}>{activityDefinition("online").views.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label><label>Theme<select aria-label="Theme" value={draft.appearance.theme} onChange={(e) => setDraft({ ...draft, appearance: { ...draft.appearance, theme: e.target.value as "light" | "dark" | "system" } })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Information density<select aria-label="Information density" value={draft.appearance.density} onChange={(e) => setDraft({ ...draft, appearance: { ...draft.appearance, density: e.target.value as "compact" | "comfortable" } })}><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></label><label className="kw-checkbox"><input aria-label="Reduce motion" type="checkbox" checked={draft.appearance.reducedMotion} onChange={(e) => setDraft({ ...draft, appearance: { ...draft.appearance, reducedMotion: e.target.checked } })} />Reduce motion</label><label>Remote context policy<select aria-label="Remote context policy" value={draft.privacy.remoteContextPolicy} onChange={(e) => setDraft({ ...draft, privacy: { ...draft.privacy, remoteContextPolicy: e.target.value as "blocked" | "ask" } })}><option value="ask">Ask</option><option value="blocked">Blocked</option></select></label></div><div className="kw-security-invariants"><ShieldCheck size={18} /><div><strong>Enforced invariants</strong><span>secretRedaction = true · confirmRemoteWrites = true · Git mutation remains confirmation-gated</span></div></div><button onClick={() => void save()}>Save settings</button>{message && <p className="kw-message" role="status">{message}</p>}</section>;
}

function SelfAudit({ project }: { project: ProjectSummary }) {
  const [data, setData] = useState<RecordRow | null>(null); const [message, setMessage] = useState("No persisted Self Audit evidence loaded.");
  const read = async () => { const response = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/self-audit`); if (response.ok) { setData((response.data.selfAudit || response.data) as RecordRow); setMessage(""); } };
  useEffect(() => { void read(); }, [project.id]);
  const run = async () => { setMessage("Running observational KForge Self Audit…"); const response = await fetchEvidence(`/api/workspace/projects/${encodeURIComponent(project.id)}/self-audit`, { method: "POST" }); if (response.ok) { setData((response.data.selfAudit || response.data) as RecordRow); setMessage("Self Audit evidence persisted. Persistence/restart boundary remains explicit."); } else setMessage(String(response.data.error || "Self Audit failed.")); };
  return <section className="kw-self-audit kw-surface-section"><h2>KForge Self Audit</h2><p>This is observational: it never applies a fix, starts Preview, or contacts a remote provider implicitly. Source mutation is NONE.</p><button onClick={() => void run()}>Run KForge Self Audit</button>{message && <p className="kw-message" role="status">{message}</p>}{data && <><EvidenceRows value={data} /><pre>{JSON.stringify(data, null, 2)}</pre></>}</section>;
}

function SystemDiagnostics() {
  const [rows, setRows] = useState<RecordRow[]>([]); const [message, setMessage] = useState("Loading measured diagnostics…");
  const refresh = async () => { try { const [workspace, platform, providers, models] = await Promise.all([fetchJson<WorkspaceResponse>("/api/workspace/projects"), fetchJson<RecordRow>("/api/workspace/platform"), fetchJson<{ providers: RecordRow[] }>("/api/workspace/ai/providers"), fetchJson<RecordRow>("/api/workspace/ai/models")]); const modelProviders = (models.providers as RecordRow[] || []); setRows([{ id: "projects", name: "Projects & repositories", state: workspace.projects.length ? "AVAILABLE" : "NOT_CONFIGURED", count: workspace.projects.length }, { id: "search", name: "Search & file inspection", state: "AVAILABLE", source: "Registered bounded local adapters" }, { id: "commands", name: "Tests, build & terminal", state: "EVIDENCE_DEPENDENT", source: "Project action descriptors" }, { id: "platform", name: "Local platform", ...platform }, ...providers.providers, ...modelProviders, { id: "models", name: "Local models", state: String((models.ollama as RecordRow | undefined)?.serviceReachable ? "REACHABLE" : "NOT_DETECTED"), source: "Local provider inventory" }]); setMessage(""); } catch (error) { setMessage(error instanceof Error ? error.message : "Diagnostics unavailable."); } };
  useEffect(() => { void refresh(); }, []);
  return <section className="kw-surface-section"><div className="kw-toolbar"><h2>System Diagnostics</h2><button onClick={() => void refresh()}>Refresh diagnostics</button></div><p>Missing tools remain UNAVAILABLE / NOT_DETECTED rather than being represented as successful.</p>{message && <p className="kw-message">{message}</p>}<div className="kw-system-grid">{rows.map((row, index) => <article key={String(row.id || row.name || index)}><strong>{String(row.name || row.label || row.id || `Capability ${index + 1}`)}</strong><EvidenceRows value={row} /><details><summary>Diagnostic evidence</summary><pre>{JSON.stringify(row, null, 2)}</pre></details></article>)}</div></section>;
}

function IntelligenceSurface({ view, project }: SurfaceProps) {
  if (!project) return <EmptyState title="No project selected" detail={`${viewLabel("intelligence", view)} needs project context.`} />;
  if (view === "impact-analysis") return <ImpactAnalysis project={project} />;
  if (view === "ask-kforge") return <AskKForge project={project} />;
  const url = view === "dependencies" ? `/api/workspace/projects/${encodeURIComponent(project.id)}/profile` : view === "architecture" ? `/api/workspace/projects/${encodeURIComponent(project.id)}/architecture` : `/api/workspace/projects/${encodeURIComponent(project.id)}/graph`;
  return <SimpleFetchSurface url={url} title={viewLabel("intelligence", view)} />;
}

function ImpactAnalysis({ project }: { project: ProjectSummary }) {
  const [target, setTarget] = useState(""); const [data, setData] = useState<RecordRow | null>(null); const [message, setMessage] = useState("");
  return <section className="kw-form-surface"><h2>Impact Analysis</h2><input aria-label="Impact target" value={target} onChange={(e) => setTarget(e.target.value)} /><button disabled={!target.trim()} onClick={() => void fetchJson<RecordRow>(`/api/workspace/projects/${encodeURIComponent(project.id)}/graph/impact?target=${encodeURIComponent(target.trim())}`).then(setData).catch((error) => setMessage(error instanceof Error ? error.message : "Impact analysis failed."))}>Analyze impact</button>{message && <p className="kw-message">{message}</p>}{data && <pre>{JSON.stringify(data, null, 2)}</pre>}</section>;
}

function AskKForge({ project }: { project: ProjectSummary }) {
  const [question, setQuestion] = useState(""); const [answer, setAnswer] = useState<RecordRow | null>(null); const [message, setMessage] = useState("");
  return <section className="kw-form-surface"><h2>Ask KForge</h2><p>Answers are bounded to redacted project evidence; deterministic rules are used when no local model is available.</p><textarea aria-label="Ask KForge question" value={question} onChange={(e) => setQuestion(e.target.value)} /><button disabled={!question.trim()} onClick={() => void fetchJson<RecordRow>(`/api/workspace/projects/${encodeURIComponent(project.id)}/ask`, jsonRequest({ question })).then(setAnswer).catch((error) => setMessage(error instanceof Error ? error.message : "Ask KForge failed."))}>Analyze project evidence</button>{message && <p className="kw-message">{message}</p>}{answer && <article className="kw-answer"><pre>{JSON.stringify(answer, null, 2)}</pre></article>}</section>;
}

function SimpleFetchSurface({ url, title, onError }: { url: string; title: string; onError?: (text: string) => void }) {
  const [data, setData] = useState<RecordRow | null>(null); const [message, setMessage] = useState(`Loading ${title} evidence…`); const refresh = () => fetchJson<RecordRow>(url).then((next) => { setData(next); setMessage(""); }).catch((error) => { const text = error instanceof Error ? error.message : `${title} evidence unavailable.`; setMessage(text); onError?.(text); }); useEffect(() => { void refresh(); }, [url]);
  return <section className="kw-simple-surface"><div className="kw-inline-actions"><h2>{title}</h2><button onClick={() => void refresh()}>Refresh</button></div>{message && <p className="kw-message">{message}</p>}{data && <><EvidenceRows value={data} /><pre>{JSON.stringify(data, null, 2)}</pre></>}</section>;
}

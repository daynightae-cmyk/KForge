import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Archive,
  Bot,
  Boxes,
  BrainCircuit,
  Bug,
  ChevronRight,
  CircleGauge,
  Cloud,
  Code2,
  Cpu,
  Database,
  Download,
  FileCode2,
  FolderKanban,
  FolderOpen,
  GitBranch,
  Github,
  HardDrive,
  History,
  ListChecks,
  MonitorPlay,
  Network,
  Package,
  Pin,
  Play,
  RefreshCw,
  Rocket,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Terminal,
  TestTube2,
  Wrench,
  X,
} from "lucide-react";
import type {
  CommandResult,
  KForgeActivity,
  KForgeOnlineView,
  KForgePlatformSettings,
  ProjectSummary,
  WorkspaceAction,
  WorkspaceActionDescriptor,
  WorkspaceResponse,
} from "@shared/workspace";
import "./KForgeWorkbench.css";

type ViewDefinition = { id: string; label: string; group?: string; icon?: ReactNode };
type ActivityDefinition = { id: KForgeActivity; label: string; icon: ReactNode; views: ViewDefinition[] };

type MarketplaceEvidenceField = { state?: string; value?: string; source?: string };
type MarketplacePermission = { id: string; required: boolean; detail: string };
type MarketplaceItem = {
  id: string;
  category: string;
  taxonomy: string[];
  name: string;
  description?: string;
  overview?: string;
  features?: string[];
  source: string;
  version?: string;
  license?: string;
  capabilities?: string[];
  requirements?: string[];
  permissions?: MarketplacePermission[];
  trust?: string;
  installed?: boolean;
  enabled?: boolean;
  local?: boolean;
  installAction?: string;
  dataState?: string;
  authority?: { kind?: string; originalKind?: string };
  availability?: string;
  detectedAt?: string;
  checkedAt?: string;
  freshness?: { state?: string; at?: string | null };
  runtimeEvidence?: { state?: string; sources?: string[] };
  healthState?: string;
  actionEligibility?: { state?: string; unavailableReason?: string; actions?: Array<{ id: string; enabled: boolean; requiresConfirmation: boolean; reason?: string }> };
  unavailableReason?: string;
  installationState?: MarketplaceEvidenceField;
  updateState?: MarketplaceEvidenceField;
  dependencies?: { state?: string; items?: string[]; source?: string };
  provenance?: MarketplaceEvidenceField;
  integrity?: MarketplaceEvidenceField;
  projectCompatibility?: { state?: string; evidence?: string[]; source?: string };
  lifecycle?: Array<{ id: string; label: string; state: string; evidence: string }>;
};

type MarketplaceData = {
  items?: MarketplaceItem[];
  providers?: Array<Record<string, unknown>>;
  adapters?: Array<Record<string, unknown>>;
  categories?: Array<Record<string, unknown>>;
  capabilityGaps?: Array<Record<string, unknown>>;
  recommendations?: Array<Record<string, unknown>>;
};

type TaskRow = {
  id: string;
  projectId: string;
  kind: string;
  status: string;
  progress: number;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  output?: string;
  error?: string;
  logs?: Array<{ at: string; message: string; stream?: string }>;
};

type SearchRow = { entity: string; entityId: string; title: string; detail: string; projectId: string; target: string; source: string };

type ExecutionSnapshot = {
  label: string;
  command?: string;
  state: string;
  source?: string;
  startedAt?: string;
  completedAt?: string;
  output?: string;
  message?: string;
  exitCode?: number;
};

const ACTIVITIES: ActivityDefinition[] = [
  { id: "projects", label: "Projects", icon: <FolderKanban size={20} />, views: [
    { id: "workspace", label: "Workspace", group: "Projects" }, { id: "health", label: "Project Health", group: "Projects" }, { id: "recent", label: "Recent", group: "Collections" }, { id: "favorites", label: "Favorites", group: "Collections" }, { id: "pinned", label: "Pinned", group: "Collections" }, { id: "archive", label: "Archive", group: "Collections" }, { id: "open-project", label: "Open Project", group: "Actions" }, { id: "import-project", label: "Import Project", group: "Actions" },
  ] },
  { id: "ai", label: "AI", icon: <Bot size={20} />, views: [
    { id: "providers", label: "Providers", group: "AI" }, { id: "models", label: "Models", group: "AI" }, { id: "agents", label: "Agents", group: "AI" }, { id: "tasks", label: "Tasks", group: "AI" },
  ] },
  { id: "online", label: "Online", icon: <Cloud size={20} />, views: [
    { id: "discover", label: "Discover", group: "Discover" }, { id: "marketplace", label: "Marketplace", group: "Discover" },
    { id: "extensions", label: "Extensions", group: "Catalog" }, { id: "models", label: "Models", group: "Catalog" }, { id: "agents", label: "Agents", group: "Catalog" }, { id: "tools", label: "Tools", group: "Catalog" }, { id: "integrations", label: "Integrations", group: "Catalog" },
    { id: "installed", label: "Installed", group: "Manage" }, { id: "updates", label: "Updates", group: "Manage" }, { id: "downloads", label: "Downloads", group: "Manage" },
    { id: "providers", label: "Providers", group: "Sources" }, { id: "remote-sources", label: "Remote Sources", group: "Sources" },
    { id: "security", label: "Security", group: "Trust" }, { id: "activity", label: "Activity", group: "Observe" },
  ] },
  { id: "intelligence", label: "Intelligence", icon: <BrainCircuit size={20} />, views: [
    { id: "project-graph", label: "Project Graph" }, { id: "dependencies", label: "Dependencies" }, { id: "impact-analysis", label: "Impact Analysis" }, { id: "code-understanding", label: "Code Understanding" }, { id: "ask-kforge", label: "Ask KForge" }, { id: "architecture", label: "Architecture" },
  ] },
  { id: "quality", label: "Quality", icon: <ShieldCheck size={20} />, views: [
    { id: "sonar", label: "KForge Sonar" }, { id: "problems", label: "Problems" }, { id: "solutions", label: "Solutions" }, { id: "security", label: "Security" }, { id: "performance", label: "Performance" }, { id: "technical-debt", label: "Technical Debt" }, { id: "documentation", label: "Documentation" }, { id: "snapshots", label: "Snapshots" },
  ] },
  { id: "developer-tools", label: "Developer Tools", icon: <Terminal size={20} />, views: [
    { id: "terminal", label: "Terminal" }, { id: "tests", label: "Tests" }, { id: "build", label: "Build" }, { id: "runtime", label: "Runtime" }, { id: "lint", label: "Lint" }, { id: "logs", label: "Logs" }, { id: "diagnostics", label: "Diagnostics" }, { id: "preview", label: "Preview" },
  ] },
  { id: "remote", label: "Remote / Git", icon: <GitBranch size={20} />, views: [
    { id: "git", label: "Git" }, { id: "branches", label: "Branches" }, { id: "commits", label: "Commits" }, { id: "github", label: "GitHub" }, { id: "pull-requests", label: "Pull Requests" }, { id: "issues", label: "Issues" }, { id: "actions", label: "Actions" }, { id: "releases", label: "Releases" },
  ] },
  { id: "release", label: "Release", icon: <Rocket size={20} />, views: [
    { id: "release-gate", label: "Release Gate" }, { id: "release-preparation", label: "Release Preparation" }, { id: "artifacts", label: "Artifacts" }, { id: "versioning", label: "Versioning" },
  ] },
  { id: "system", label: "System", icon: <Settings2 size={20} />, views: [
    { id: "settings", label: "Settings" }, { id: "trust", label: "Trust" }, { id: "permissions", label: "Permissions" }, { id: "storage", label: "Storage" }, { id: "online-offline", label: "Online / Offline" }, { id: "self-audit", label: "Self Audit" }, { id: "system-diagnostics", label: "System Diagnostics" },
  ] },
];

export const KFORGE_ACTIVITY_IDS = ACTIVITIES.map((entry) => entry.id);
export const ONLINE_EXPLORER_VIEWS = ACTIVITIES.find((entry) => entry.id === "online")!.views.map((entry) => entry.id);

const defaultView = (activity: KForgeActivity) => ACTIVITIES.find((entry) => entry.id === activity)?.views[0]?.id || "workspace";
const activityLabel = (activity: KForgeActivity) => ACTIVITIES.find((entry) => entry.id === activity)?.label || activity;
const viewLabel = (activity: KForgeActivity, view: string) => ACTIVITIES.find((entry) => entry.id === activity)?.views.find((entry) => entry.id === view)?.label || view;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((payload as { error?: string }).error || `${response.status} ${response.statusText}`);
  return payload as T;
}

function applyTheme(theme: KForgePlatformSettings["appearance"]["theme"]) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  if (theme === "system") root.classList.add(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  else root.classList.add(theme);
}

function StatusBadge({ value }: { value?: string }) {
  const normalized = (value || "UNKNOWN").toUpperCase().replace(/\s+/g, "_");
  return <span className={`kw-badge kw-badge--${normalized.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{normalized}</span>;
}

function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="kw-empty"><CircleGauge size={28} /><h3>{title}</h3><p>{detail}</p>{action}</div>;
}

function EvidenceRows({ value }: { value: Record<string, unknown> | null | undefined }) {
  if (!value) return <p className="kw-muted">No evidence loaded.</p>;
  const entries = Object.entries(value).filter(([, entry]) => typeof entry !== "object" || entry === null);
  return <dl className="kw-evidence-list">{entries.map(([key, entry]) => <div key={key}><dt>{key.replace(/([A-Z])/g, " $1")}</dt><dd>{entry === null || entry === undefined || entry === "" ? "UNKNOWN" : String(entry)}</dd></div>)}</dl>;
}

function EvidenceCards({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (!rows.length) return <p className="kw-muted">No evidence rows are available.</p>;
  return <div className="kw-card-grid">{rows.map((row, index) => <article className="kw-evidence-card" key={String(row.id || row.name || row.label || index)}><strong>{String(row.name || row.label || row.id || `Evidence ${index + 1}`)}</strong><EvidenceRows value={row} /><details><summary>Advanced · Raw Evidence</summary><pre>{JSON.stringify(row, null, 2)}</pre></details></article>)}</div>;
}

export default function KForgeWorkbench() {
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [settings, setSettings] = useState<KForgePlatformSettings | null>(null);
  const [activeActivity, setActiveActivity] = useState<KForgeActivity>("projects");
  const [activeView, setActiveView] = useState("workspace");
  const [activeProjectId, setActiveProjectId] = useState("");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchRow[]>([]);
  const [execution, setExecution] = useState<ExecutionSnapshot | null>(null);
  const paletteInputRef = useRef<HTMLInputElement | null>(null);

  const activeProject = workspace?.projects.find((project) => project.id === activeProjectId);
  const currentActivity = ACTIVITIES.find((entry) => entry.id === activeActivity)!;

  const refreshWorkspace = async () => {
    try {
      const data = await fetchJson<WorkspaceResponse>("/api/workspace/projects");
      setWorkspace(data);
      if (activeProjectId && !data.projects.some((entry) => entry.id === activeProjectId)) setActiveProjectId("");
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Workspace discovery failed."); }
  };

  useEffect(() => {
    void (async () => {
      try {
        const [workspaceData, settingsData] = await Promise.all([
          fetchJson<WorkspaceResponse>("/api/workspace/projects"),
          fetchJson<{ settings: KForgePlatformSettings }>("/api/workspace/settings"),
        ]);
        setWorkspace(workspaceData);
        setSettings(settingsData.settings);
        const startup = settingsData.settings.general.startupActivity;
        setActiveActivity(startup);
        setActiveView(startup === "online" ? settingsData.settings.general.startupOnlineView : defaultView(startup));
        applyTheme(settingsData.settings.appearance.theme);
      } catch (error) { setMessage(error instanceof Error ? error.message : "KForge could not initialize the workbench."); }
      finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen(true); }
      if (event.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { if (paletteOpen) window.requestAnimationFrame(() => paletteInputRef.current?.focus()); }, [paletteOpen]);
  useEffect(() => {
    if (!paletteOpen || paletteQuery.trim().length < 2) { setSearchResults([]); return; }
    const timer = window.setTimeout(() => {
      void fetchJson<{ results: SearchRow[] }>(`/api/workspace/search?q=${encodeURIComponent(paletteQuery.trim())}${activeProjectId ? `&projectId=${encodeURIComponent(activeProjectId)}` : ""}`)
        .then((result) => setSearchResults(result.results || []))
        .catch(() => setSearchResults([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [paletteOpen, paletteQuery, activeProjectId]);

  const navigate = (activity: KForgeActivity, view: string) => { setActiveActivity(activity); setActiveView(view); setExecution(null); };
  const deepNavigate = (target: string) => {
    const mapping: Record<string, [KForgeActivity, string]> = {
      Workspace: ["projects", "workspace"], "Project health": ["projects", "health"], Agents: ["ai", "agents"], Models: ["ai", "models"], Tasks: ["ai", "tasks"], Marketplace: ["online", "marketplace"], Discover: ["online", "discover"], Extensions: ["online", "extensions"], "Project graph": ["intelligence", "project-graph"], Dependencies: ["intelligence", "dependencies"], Architecture: ["intelligence", "architecture"], Problems: ["quality", "problems"], Documentation: ["quality", "documentation"], "KForge Sonar": ["quality", "sonar"], Tests: ["developer-tools", "tests"], Build: ["developer-tools", "build"], Runtime: ["developer-tools", "runtime"], Preview: ["developer-tools", "preview"], Git: ["remote", "git"], GitHub: ["remote", "github"], "Release Gate": ["release", "release-gate"], Settings: ["system", "settings"],
    };
    const destination = mapping[target] || ["projects", "workspace"];
    navigate(destination[0], destination[1]);
  };

  const changeActivity = (activity: KForgeActivity) => navigate(activity, activity === "online" && settings ? settings.general.startupOnlineView : defaultView(activity));
  const changeMode = async (mode: string) => {
    try {
      await fetchJson("/api/workspace/platform/mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      await refreshWorkspace();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Platform mode could not change."); }
  };

  const groupedViews = useMemo(() => {
    const groups = new Map<string, ViewDefinition[]>();
    currentActivity.views.forEach((view) => groups.set(view.group || currentActivity.label, [...(groups.get(view.group || currentActivity.label) || []), view]));
    return [...groups.entries()];
  }, [currentActivity]);

  if (loading) return <div className="kw-loading">Loading KNOuX Forge workbench…</div>;

  return <div className="kw-shell" data-activity={activeActivity}>
    <header className="kw-topbar">
      <div className="kw-brand"><span className="kw-brand-mark">K</span><div><strong>KNOuX Forge</strong><small>Engineering Workbench</small></div></div>
      <button className="kw-command-trigger" onClick={() => setPaletteOpen(true)}><Search size={15} /><span>Search KForge</span><kbd>Ctrl K</kbd></button>
      <div className="kw-topbar-meta">
        <select aria-label="Project context" value={activeProjectId} onChange={(event) => setActiveProjectId(event.target.value)}>
          <option value="">No project context</option>
          {(workspace?.projects || []).filter((project) => !project.archived).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <select aria-label="Platform mode" value={workspace?.localPlatform.mode || "offline"} onChange={(event) => void changeMode(event.target.value)}>
          <option value="offline">Offline</option><option value="local-first">Local First</option><option value="online-optional">Online Optional</option><option value="online">Online</option>
        </select>
        <StatusBadge value={activeProject?.trust || "NO_PROJECT"} />
        <button aria-label="Toggle inspector" onClick={() => setInspectorOpen((value) => !value)}><SlidersHorizontal size={16} /></button>
      </div>
    </header>

    <aside className="kw-activity-bar" aria-label="KForge activities">
      {ACTIVITIES.map((activity) => <button key={activity.id} aria-label={activity.label} title={activity.label} className={activeActivity === activity.id ? "is-active" : ""} onClick={() => changeActivity(activity.id)}>{activity.icon}</button>)}
    </aside>

    {explorerOpen && <aside className="kw-explorer" aria-label={`${currentActivity.label} Explorer`}>
      <div className="kw-explorer-heading"><div><small>EXPLORER</small><strong>{currentActivity.label}</strong></div><button aria-label="Collapse explorer" onClick={() => setExplorerOpen(false)}><ChevronRight size={15} /></button></div>
      <div className="kw-explorer-scroll">{groupedViews.map(([group, views]) => <section key={group}><h3>{group}</h3>{views.map((view) => <button key={view.id} className={activeView === view.id ? "is-active" : ""} onClick={() => navigate(activeActivity, view.id)}>{view.icon}<span>{view.label}</span></button>)}</section>)}</div>
    </aside>}

    {!explorerOpen && <button className="kw-explorer-restore" aria-label="Open explorer" onClick={() => setExplorerOpen(true)}><ChevronRight size={15} /></button>}

    <main className="kw-workbench">
      <div className="kw-breadcrumb"><span>{activityLabel(activeActivity)}</span><ChevronRight size={13} /><strong>{viewLabel(activeActivity, activeView)}</strong></div>
      <div className="kw-surface-heading"><div><p>KNOuX / {activityLabel(activeActivity)}</p><h1>{viewLabel(activeActivity, activeView)}</h1><small>{surfaceDescription(activeActivity, activeView, activeProject)}</small></div><button onClick={() => void refreshWorkspace()}><RefreshCw size={15} />Refresh</button></div>
      {message && <div className="kw-message">{message}</div>}
      <div className="kw-workbench-scroll">
        <WorkbenchSurface activity={activeActivity} view={activeView} workspace={workspace} project={activeProject} settings={settings} onProjectSelect={setActiveProjectId} onRefresh={refreshWorkspace} onSettings={setSettings} onNavigate={navigate} onExecution={setExecution} />
      </div>
      {activeActivity === "developer-tools" && <div className="kw-bottom-panel" aria-label="Developer execution panel"><div><strong>EXECUTION</strong><span>{execution?.state || "IDLE"}</span></div>{execution ? <><code>{execution.command || "KForge registered operation"}</code><small>{execution.message || execution.source}</small><pre>{execution.output || "No process output captured."}</pre></> : <p>No developer command has run from this workbench session.</p>}</div>}
    </main>

    {inspectorOpen && <aside className="kw-inspector" aria-label="Context inspector"><Inspector activity={activeActivity} view={activeView} project={activeProject} execution={execution} /></aside>}

    {paletteOpen && <div className="kw-palette-backdrop" role="dialog" aria-modal="true" aria-label="KForge command palette"><div className="kw-palette"><div className="kw-palette-input"><Search size={17} /><input ref={paletteInputRef} value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Projects, files, symbols, problems, tasks, models…" /><button aria-label="Close command palette" onClick={() => setPaletteOpen(false)}><X size={16} /></button></div><div className="kw-palette-results">{searchResults.map((result) => <button key={`${result.entity}:${result.entityId}`} onClick={() => { if (result.projectId) setActiveProjectId(result.projectId); deepNavigate(result.target); setPaletteOpen(false); setPaletteQuery(""); }}><strong>{result.title}</strong><span>{result.entity} · {result.detail}</span><small>{result.source}</small></button>)}{paletteQuery.length >= 2 && searchResults.length === 0 && <p>No bounded local result matched this query.</p>}</div></div></div>}
  </div>;
}

function surfaceDescription(activity: KForgeActivity, view: string, project?: ProjectSummary) {
  if (activity === "online") return project ? `Global Online evidence with optional compatibility context from ${project.name}. Opening the surface itself performs no remote refresh.` : "Global Online evidence. Compatibility is NOT_EVALUATED because no project is selected; discovery remains available.";
  if (!project && !["system", "ai"].includes(activity)) return "Select a project context to load project-specific evidence. Read-only global surfaces remain available.";
  const descriptions: Record<string, string> = {
    terminal: "Safe KForge command terminal backed by registered project action descriptors; unrestricted shell execution is not exposed.", preview: "One shared Preview runtime with command, port, PID, health and process evidence only when detected.", "release-gate": "Independent SOURCE, LOCAL, PREVIEW, DESKTOP, WINDOWS_PACKAGE, INSTALLER, GITHUB, CI and REMOTE evidence domains.", settings: "Canonical Settings v3 with legacy migration and enforced privacy / Git confirmation invariants.", workspace: "Dense engineering project table with trust, Git state, health, collections and activity evidence.",
  };
  return descriptions[view] || `Evidence-backed ${viewLabel(activity, view)} surface for the selected engineering context.`;
}

function WorkbenchSurface({ activity, view, workspace, project, settings, onProjectSelect, onRefresh, onSettings, onNavigate, onExecution }: { activity: KForgeActivity; view: string; workspace: WorkspaceResponse | null; project?: ProjectSummary; settings: KForgePlatformSettings | null; onProjectSelect: (id: string) => void; onRefresh: () => Promise<void>; onSettings: (settings: KForgePlatformSettings) => void; onNavigate: (activity: KForgeActivity, view: string) => void; onExecution: (execution: ExecutionSnapshot | null) => void }) {
  if (activity === "projects") return <ProjectsSurface view={view} workspace={workspace} selectedProjectId={project?.id || ""} onProjectSelect={onProjectSelect} onRefresh={onRefresh} />;
  if (activity === "online") return <OnlineSurface view={view as KForgeOnlineView} project={project} />;
  if (activity === "ai") return <AISurface view={view} project={project} />;
  if (activity === "developer-tools") return <DeveloperSurface view={view} project={project} onExecution={onExecution} />;
  if (activity === "remote") return <RemoteSurface view={view} project={project} onExecution={onExecution} />;
  if (activity === "release") return <ReleaseSurface view={view} project={project} onExecution={onExecution} />;
  if (activity === "system") return <SystemSurface view={view} project={project} workspace={workspace} settings={settings} onSettings={onSettings} onRefresh={onRefresh} />;
  return <ProjectEvidenceSurface activity={activity} view={view} project={project} onNavigate={onNavigate} />;
}

function ProjectsSurface({ view, workspace, selectedProjectId, onProjectSelect, onRefresh }: { view: string; workspace: WorkspaceResponse | null; selectedProjectId: string; onProjectSelect: (id: string) => void; onRefresh: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"activity" | "name" | "health">("activity");
  const [pathInput, setPathInput] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [targetName, setTargetName] = useState("");
  const [message, setMessage] = useState("");
  const projects = useMemo(() => {
    let rows = [...(workspace?.projects || [])];
    if (view === "recent") rows = rows.filter((entry) => entry.categories.recent);
    if (view === "favorites") rows = rows.filter((entry) => entry.favorite);
    if (view === "pinned") rows = rows.filter((entry) => entry.pinned);
    if (view === "archive") rows = rows.filter((entry) => entry.archived);
    if (!["archive"].includes(view)) rows = rows.filter((entry) => !entry.archived);
    rows = rows.filter((entry) => `${entry.name} ${entry.path} ${entry.projectType} ${entry.branch} ${entry.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
    rows.sort((left, right) => sort === "name" ? left.name.localeCompare(right.name) : sort === "health" ? (right.healthScore ?? -1) - (left.healthScore ?? -1) : right.lastActivity.localeCompare(left.lastActivity));
    return rows;
  }, [workspace, view, query, sort]);

  if (view === "open-project") return <section className="kw-form-surface"><FolderOpen size={26} /><h2>Open Project</h2><p>Register an existing local directory. This is a local filesystem action and does not contact a remote.</p><input aria-label="Local project path" value={pathInput} onChange={(event) => setPathInput(event.target.value)} placeholder="D:\\Projects\\repository" /><button onClick={() => void (async () => { try { const result = await fetchJson<{ project: ProjectSummary }>("/api/workspace/projects/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: pathInput.trim() }) }); onProjectSelect(result.project.id); setMessage(`Opened ${result.project.name}.`); await onRefresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Open project failed."); } })()}>Open project</button>{message && <p>{message}</p>}</section>;
  if (view === "import-project") return <section className="kw-form-surface"><Download size={26} /><h2>Import Repository</h2><p>Remote clone is policy-controlled and requires explicit confirmation. Offline mode blocks the transfer.</p><input aria-label="Repository HTTPS URL" value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://github.com/owner/repository.git" /><input aria-label="Destination folder" value={targetName} onChange={(event) => setTargetName(event.target.value)} placeholder="repository" /><button onClick={() => void (async () => { if (!window.confirm(`Clone ${remoteUrl} into ${targetName}? This contacts the configured remote.`)) return; try { const result = await fetchJson<{ project: ProjectSummary }>("/api/workspace/projects/clone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remoteUrl: remoteUrl.trim(), targetName: targetName.trim(), confirmed: true }) }); onProjectSelect(result.project.id); setMessage(`Imported ${result.project.name}.`); await onRefresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed."); } })()}>Clone with confirmation</button>{message && <p>{message}</p>}</section>;

  return <section className="kw-projects"><div className="kw-table-toolbar"><label><Search size={14} /><input aria-label="Search projects" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects, paths, types, branches…" /></label><select aria-label="Sort projects" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="activity">Last activity</option><option value="name">Name</option><option value="health">Health</option></select><span>{projects.length} project(s)</span></div>{projects.length ? <div className="kw-table-wrap"><table className="kw-table"><thead><tr><th>Project</th><th>Type</th><th>Branch</th><th>Trust</th><th>Git</th><th>Health</th><th>Last Activity</th></tr></thead><tbody>{projects.map((entry) => <tr key={entry.id} className={selectedProjectId === entry.id ? "is-selected" : ""} onClick={() => onProjectSelect(entry.id)}><td><strong>{entry.name}</strong><small>{entry.path}</small>{entry.tags.length > 0 && <small>{entry.tags.join(" · ")}</small>}</td><td>{entry.projectType}</td><td><code>{entry.branch}</code></td><td><StatusBadge value={entry.trust} /></td><td><span>{entry.modifiedFiles + entry.untrackedFiles} changed</span><small>{entry.ahead} ahead · {entry.behind} behind</small></td><td>{entry.healthScore ?? "NOT_SCANNED"}</td><td>{new Date(entry.lastActivity).toLocaleString()}</td></tr>)}</tbody></table></div> : <EmptyState title={view === "pinned" ? "No pinned projects" : view === "favorites" ? "No favorite projects" : view === "archive" ? "Archive is empty" : "No projects found"} detail={view === "pinned" ? "Pin projects from Workspace to keep them here." : "Open or import a project to populate the engineering workspace."} />}</section>;
}

function OnlineSurface({ view, project }: { view: KForgeOnlineView; project?: ProjectSummary }) {
  const [marketplace, setMarketplace] = useState<MarketplaceData>({});
  const [control, setControl] = useState<Record<string, unknown> | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("Loading Online evidence…");
  const [installPreview, setInstallPreview] = useState<Record<string, unknown> | null>(null);

  const refresh = async () => {
    setMessage("Loading Online evidence…");
    try {
      const marketplaceUrl = project ? `/api/workspace/projects/${encodeURIComponent(project.id)}/marketplace` : "/api/workspace/marketplace";
      const [market, online, taskData] = await Promise.all([
        fetchJson<MarketplaceData>(marketplaceUrl), fetchJson<Record<string, unknown>>("/api/workspace/online/control-center"), fetchJson<{ tasks: TaskRow[] }>("/api/workspace/tasks"),
      ]);
      setMarketplace(market); setControl(online); setTasks(taskData.tasks || []); setMessage("");
      if (!selectedId && market.items?.[0]) setSelectedId(market.items[0].id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Online evidence could not load."); }
  };
  useEffect(() => { void refresh(); }, [project?.id]);

  const items = useMemo(() => {
    const all = marketplace.items || [];
    const securityConcern = (item: MarketplaceItem) => item.trust !== "TRUSTED" || (item.permissions || []).some((permission) => permission.required) || ["BLOCKED", "UNKNOWN"].includes(item.availability || "") || ["REMOTE_REGISTRY", "CACHED_REMOTE"].includes(item.authority?.kind || "");
    let rows = all;
    if (view === "extensions") rows = all.filter((item) => item.taxonomy?.includes("extensions"));
    if (view === "models") rows = all.filter((item) => item.category === "models");
    if (view === "agents") rows = all.filter((item) => item.category === "agents");
    if (view === "tools") rows = all.filter((item) => item.category === "tools");
    if (view === "integrations") rows = all.filter((item) => item.taxonomy?.includes("integrations"));
    if (view === "installed") rows = all.filter((item) => item.installed === true);
    if (view === "updates") rows = all.filter((item) => item.updateState?.state === "VERIFIED" && /UPDATE_AVAILABLE/i.test(item.updateState.value || ""));
    if (view === "security") rows = all.filter(securityConcern);
    return rows.filter((item) => `${item.name} ${item.description || ""} ${item.source} ${item.category} ${(item.capabilities || []).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  }, [marketplace, view, query]);
  const selected = (marketplace.items || []).find((item) => item.id === selectedId) || items[0];
  const downloadTasks = tasks.filter((task) => task.projectId === "ai-center" || /download|pull|install|update/i.test(`${task.kind} ${task.output || ""} ${task.logs?.map((log) => log.message).join(" ") || ""}`));
  const onlineTasks = tasks.filter((task) => task.projectId === "ai-center" || /marketplace|online|download|install|update|provider/i.test(`${task.projectId} ${task.kind} ${task.output || ""} ${task.logs?.map((log) => log.message).join(" ") || ""}`));

  if (["providers", "remote-sources"].includes(view)) {
    const rows = view === "providers" ? [...(marketplace.providers || []), ...(marketplace.adapters || [])] : (marketplace.adapters || []).filter((entry) => entry.kind === "remote");
    return <section className="kw-online"><OnlineContext project={project} control={control} /><div className="kw-online-toolbar"><strong>{view === "providers" ? "Provider Center" : "Remote Sources"}</strong><button onClick={() => void refresh()}><RefreshCw size={14} />Refresh evidence</button></div><EvidenceCards rows={rows} />{rows.length === 0 && <EmptyState title={view === "providers" ? "No verified providers configured" : "No remote sources configured"} detail="KForge does not infer configuration from a known default endpoint." />}</section>;
  }
  if (view === "downloads" || view === "activity") {
    const rows = view === "downloads" ? downloadTasks : onlineTasks;
    return <section className="kw-online"><OnlineContext project={project} control={control} /><div className="kw-online-toolbar"><strong>{view === "downloads" ? "Transfers and downloads" : "Online lifecycle activity"}</strong><span>{rows.length} evidence record(s)</span></div>{rows.length ? <TaskTable tasks={rows} /> : <EmptyState title={view === "downloads" ? "No download or transfer evidence" : "No Online activity evidence"} detail={view === "downloads" ? "Downloads contains transfer, staging and installation-transfer tasks only; broader lifecycle events belong to Activity." : "Activity is broader than Downloads and remains empty until an Online lifecycle operation creates persisted task evidence."} />}</section>;
  }

  return <section className="kw-online"><OnlineContext project={project} control={control} /><div className="kw-online-toolbar"><label><Search size={14} /><input aria-label="Search Online catalog" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, publisher, capability, source, model family…" /></label><span>{items.length} result(s)</span><button onClick={() => void refresh()}><RefreshCw size={14} />Refresh local evidence</button></div>{message && <p className="kw-message">{message}</p>}{view === "updates" && items.length === 0 && <EmptyState title="No verified update evidence" detail="An update appears only after installedVersion + verifiedLatestVersion + version comparison. updatedAt alone is never treated as an update." action={<button onClick={() => void refresh()}>Refresh Sources</button>} />}{items.length > 0 && <div className="kw-online-layout"><div className="kw-online-results">{items.map((item) => <button key={item.id} className={selected?.id === item.id ? "is-selected" : ""} onClick={() => { setSelectedId(item.id); setInstallPreview(null); }}><div><strong>{item.name}</strong><span>{item.category} · {item.version || "version UNKNOWN"}</span></div><p>{item.description || item.overview || "No description supplied by the verified source."}</p><div className="kw-row-badges"><StatusBadge value={item.authority?.kind} /><StatusBadge value={item.availability} /><StatusBadge value={project ? item.projectCompatibility?.state || "UNKNOWN" : "NOT_EVALUATED"} /></div></button>)}</div>{selected && <OnlineInspector item={selected} project={project} installPreview={installPreview} onPreview={() => void fetchJson<Record<string, unknown>>(`/api/workspace/marketplace/items/${encodeURIComponent(selected.id)}/install-preview`).then(setInstallPreview).catch((error) => setInstallPreview({ state: "UNAVAILABLE", reason: error instanceof Error ? error.message : "Install preview unavailable." }))} />}</div>}{items.length === 0 && view !== "updates" && <EmptyState title={`No ${viewLabel("online", view).toLowerCase()} evidence`} detail={view === "integrations" ? "No verified integrations configured. Open Providers to inspect configuration evidence." : "No item in the current verified sources satisfies this view and filter."} />}</section>;
}

function OnlineContext({ project, control }: { project?: ProjectSummary; control: Record<string, unknown> | null }) {
  return <div className="kw-online-context"><div><Cloud size={17} /><strong>Online is global</strong><span>Opening this surface performs no remote catalog refresh.</span></div><div><span>Compatibility</span><StatusBadge value={project ? "PROJECT_CONTEXT" : "NOT_EVALUATED"} /><small>{project ? project.name : "No project selected"}</small></div><div><span>Control Center</span><StatusBadge value={String(control?.mode || "UNKNOWN")} /><small>{control ? "Policy evidence loaded" : "Loading policy evidence"}</small></div></div>;
}

function OnlineInspector({ item, project, installPreview, onPreview }: { item: MarketplaceItem; project?: ProjectSummary; installPreview: Record<string, unknown> | null; onPreview: () => void }) {
  const compatibility = project ? item.projectCompatibility?.state || "UNKNOWN" : "NOT_EVALUATED";
  return <aside className="kw-online-inspector"><div className="kw-inspector-title"><Package size={18} /><div><strong>{item.name}</strong><small>{item.id}</small></div></div><dl className="kw-evidence-list"><div><dt>Authority</dt><dd>{item.authority?.kind || "UNKNOWN"}</dd></div><div><dt>Source</dt><dd>{item.source}</dd></div><div><dt>Availability</dt><dd>{item.availability || "UNKNOWN"}</dd></div><div><dt>Runtime evidence</dt><dd>{item.runtimeEvidence?.state || "UNKNOWN"}</dd></div><div><dt>Health</dt><dd>{item.healthState || "NOT_EVALUATED"}</dd></div><div><dt>Compatibility</dt><dd>{compatibility}{!project ? " · No project selected" : ""}</dd></div><div><dt>Trust</dt><dd>{item.trust || "UNKNOWN"}</dd></div><div><dt>Freshness</dt><dd>{item.freshness?.state || "UNKNOWN"}{item.freshness?.at ? ` · ${new Date(item.freshness.at).toLocaleString()}` : ""}</dd></div></dl>{item.unavailableReason && <p className="kw-warning">{item.unavailableReason}</p>}<section><h4>Capabilities</h4><div className="kw-chip-list">{(item.capabilities || []).length ? item.capabilities!.map((entry) => <span key={entry}>{entry}</span>) : <span>UNKNOWN</span>}</div></section><section><h4>Permissions</h4>{(item.permissions || []).filter((permission) => permission.required).length ? <ul>{item.permissions!.filter((permission) => permission.required).map((permission) => <li key={permission.id}><strong>{permission.id}</strong><span>{permission.detail}</span></li>)}</ul> : <p className="kw-muted">No required permission was declared by verified metadata.</p>}</section><section><h4>Integrity & lifecycle</h4><p>{item.integrity?.state || "UNKNOWN"} · {item.integrity?.source || "No integrity source"}</p>{item.lifecycle?.slice(0, 8).map((stage) => <div className="kw-lifecycle" key={stage.id}><StatusBadge value={stage.state} /><span>{stage.label}</span></div>)}</section><button disabled={item.installAction === "NOT_AVAILABLE"} onClick={onPreview}>Inspect install eligibility</button>{installPreview && <details open><summary>Installation preview evidence</summary><EvidenceRows value={installPreview} /><pre>{JSON.stringify(installPreview, null, 2)}</pre></details>}</aside>;
}

function AISurface({ view, project }: { view: string; project?: ProjectSummary }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState("Loading AI evidence…");
  useEffect(() => {
    let url = view === "providers" ? "/api/workspace/ai/providers" : view === "models" ? "/api/workspace/ai/models" : view === "tasks" ? "/api/workspace/tasks" : project ? `/api/workspace/projects/${encodeURIComponent(project.id)}/agent/tools` : "/api/workspace/marketplace";
    void fetchJson<Record<string, unknown>>(url).then((result) => { setData(result); setMessage(""); }).catch((error) => setMessage(error instanceof Error ? error.message : "AI evidence unavailable."));
  }, [view, project?.id]);
  if (message) return <p className="kw-message">{message}</p>;
  if (!data) return null;
  if (view === "providers") return <EvidenceCards rows={(data.providers as Array<Record<string, unknown>> || [])} />;
  if (view === "tasks") return <TaskTable tasks={(data.tasks as TaskRow[] || []).filter((task) => task.kind === "agent" || task.projectId === "ai-center")} />;
  if (view === "agents") {
    const rows = project ? (data.tools as Array<Record<string, unknown>> || []) : ((data.items as MarketplaceItem[] || []).filter((item) => item.category === "agents") as unknown as Array<Record<string, unknown>>);
    return rows.length ? <EvidenceCards rows={rows} /> : <EmptyState title="No agent evidence" detail={project ? "No registered agent tools were returned for this project." : "Select a project for executable agent eligibility. Global catalog evidence remains separate from execution."} />;
  }
  const recommendations = (data.recommendations as Array<Record<string, unknown>> || []);
  const providers = (data.providers as Array<Record<string, unknown>> || []);
  return <div className="kw-stack"><div className="kw-summary-strip"><div><strong>Installed / runtime providers</strong><span>{providers.length}</span></div><div><strong>Catalog recommendations</strong><span>{recommendations.length}</span></div><div><strong>Active model</strong><span>{String((data.active as { model?: string } | undefined)?.model || "NONE")}</span></div></div><h3>Detected provider evidence</h3><EvidenceCards rows={providers} /><h3>Catalog / recommended models</h3><EvidenceCards rows={recommendations} /></div>;
}

function DeveloperSurface({ view, project, onExecution }: { view: string; project?: ProjectSummary; onExecution: (execution: ExecutionSnapshot | null) => void }) {
  if (!project) return <EmptyState title="No project selected" detail="Developer execution requires an explicit project context. Select a project from the top bar; read-only Online remains independent." />;
  if (view === "preview") return <PreviewSurface project={project} onExecution={onExecution} />;
  if (view === "terminal") return <CommandTerminal project={project} onExecution={onExecution} />;
  if (["tests", "build", "runtime"].includes(view)) return <ActionSurface project={project} action={view === "tests" ? "test" : view as WorkspaceAction} onExecution={onExecution} />;
  if (view === "lint") return <LintSurface project={project} onExecution={onExecution} />;
  return <SimpleFetchSurface url={view === "logs" ? `/api/workspace/tasks?projectId=${encodeURIComponent(project.id)}` : `/api/workspace/projects/${encodeURIComponent(project.id)}/problems`} title={view === "logs" ? "Persisted task and process logs" : "Diagnostics"} />;
}

function CommandTerminal({ project, onExecution }: { project: ProjectSummary; onExecution: (execution: ExecutionSnapshot | null) => void }) {
  const [actions, setActions] = useState<WorkspaceActionDescriptor[]>([]);
  const [message, setMessage] = useState("Loading registered commands…");
  const refresh = () => fetchJson<{ actions: WorkspaceActionDescriptor[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/actions`).then((result) => { setActions(result.actions); setMessage(""); }).catch((error) => setMessage(error instanceof Error ? error.message : "Action descriptors unavailable."));
  useEffect(() => { void refresh(); }, [project.id]);
  const run = async (descriptor: WorkspaceActionDescriptor) => {
    if (!descriptor.enabled) return;
    const confirmed = descriptor.requiresConfirmation ? window.confirm(`${descriptor.label} requires explicit confirmation. Continue?`) : false;
    if (descriptor.requiresConfirmation && !confirmed) return;
    onExecution({ label: descriptor.label, command: descriptor.command, state: "RUNNING", source: descriptor.source });
    try {
      const result = await fetchJson<CommandResult>(`/api/workspace/projects/${encodeURIComponent(project.id)}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: descriptor.id, confirmed }) });
      onExecution({ label: descriptor.label, command: descriptor.command, state: result.ok ? "PASS" : "FAILED", source: descriptor.source, startedAt: result.startedAt, completedAt: result.completedAt, output: result.output, message: result.message, exitCode: result.exitCode });
    } catch (error) { onExecution({ label: descriptor.label, command: descriptor.command, state: "FAILED", source: descriptor.source, message: error instanceof Error ? error.message : "Execution failed." }); }
  };
  return <section className="kw-terminal"><div className="kw-terminal-header"><Terminal size={18} /><div><strong>KForge Command Terminal</strong><small>Working directory · {project.path}</small></div></div><p>Only registered KForge actions are executable. There is no unrestricted shell input.</p>{message && <p className="kw-message">{message}</p>}<div className="kw-command-table"><div className="kw-command-head"><span>Command</span><span>State</span><span>Permission</span><span>Evidence source</span><span /></div>{actions.map((descriptor) => <div key={descriptor.id}><span><strong>{descriptor.label}</strong><code>{descriptor.command || "NO_EXECUTABLE_EVIDENCE"}</code></span><StatusBadge value={descriptor.state} /><span>{descriptor.requiredPermission}{descriptor.requiresTrust ? " · trust" : ""}{descriptor.requiresNetwork ? " · network" : ""}</span><span>{descriptor.source}<small>{descriptor.unavailableReason}</small></span><button disabled={!descriptor.enabled} onClick={() => void run(descriptor)}><Play size={13} />Run</button></div>)}</div></section>;
}

function ActionSurface({ project, action, onExecution }: { project: ProjectSummary; action: WorkspaceAction; onExecution: (execution: ExecutionSnapshot | null) => void }) {
  const [descriptor, setDescriptor] = useState<WorkspaceActionDescriptor | null>(null);
  const [message, setMessage] = useState("Loading action eligibility…");
  useEffect(() => { void fetchJson<{ actions: WorkspaceActionDescriptor[] }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/actions`).then((data) => { setDescriptor(data.actions.find((entry) => entry.id === action) || null); setMessage(""); }).catch((error) => setMessage(error instanceof Error ? error.message : "Action evidence unavailable.")); }, [project.id, action]);
  const run = async () => {
    if (!descriptor?.enabled) return;
    onExecution({ label: descriptor.label, command: descriptor.command, state: "RUNNING", source: descriptor.source });
    try { const result = await fetchJson<CommandResult>(`/api/workspace/projects/${encodeURIComponent(project.id)}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }); onExecution({ label: descriptor.label, command: descriptor.command, state: result.ok ? "PASS" : "FAILED", source: descriptor.source, startedAt: result.startedAt, completedAt: result.completedAt, output: result.output, message: result.message, exitCode: result.exitCode }); }
    catch (error) { onExecution({ label: descriptor.label, command: descriptor.command, state: "FAILED", source: descriptor.source, message: error instanceof Error ? error.message : "Action failed." }); }
  };
  if (message) return <p className="kw-message">{message}</p>;
  if (!descriptor) return <EmptyState title="Action unavailable" detail={`No registered ${action} descriptor exists for this project.`} />;
  return <section className="kw-action-surface"><div><TestTube2 size={26} /><h2>{descriptor.label}</h2><StatusBadge value={descriptor.state} /></div><dl className="kw-evidence-list"><div><dt>Command</dt><dd><code>{descriptor.command || "UNAVAILABLE"}</code></dd></div><div><dt>Evidence source</dt><dd>{descriptor.source}</dd></div><div><dt>Trust required</dt><dd>{String(descriptor.requiresTrust)}</dd></div><div><dt>Network required</dt><dd>{String(descriptor.requiresNetwork)}</dd></div><div><dt>Permission</dt><dd>{descriptor.requiredPermission}</dd></div></dl>{descriptor.unavailableReason && <p className="kw-warning">{descriptor.unavailableReason}</p>}<button disabled={!descriptor.enabled} onClick={() => void run()}><Play size={14} />Run verified {action}</button></section>;
}

function LintSurface({ project, onExecution }: { project: ProjectSummary; onExecution: (execution: ExecutionSnapshot | null) => void }) {
  const [tool, setTool] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState("Loading lint eligibility…");
  useEffect(() => { void fetchJson<{ tools: Array<Record<string, unknown>> }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/agent/tools`).then((data) => { setTool(data.tools.find((entry) => entry.name === "lint") || null); setMessage(""); }).catch((error) => setMessage(error instanceof Error ? error.message : "Lint evidence unavailable.")); }, [project.id]);
  const run = async () => {
    onExecution({ label: "Lint", command: "detected package lint script", state: "RUNNING", source: "Agent tool registry" });
    try { const result = await fetchJson<{ ok: boolean; message: string; output: unknown }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/agent/tools/lint`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); onExecution({ label: "Lint", command: "detected package lint script", state: result.ok ? "PASS" : "FAILED", source: "Agent tool registry", message: result.message, output: typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2) }); }
    catch (error) { onExecution({ label: "Lint", state: "FAILED", source: "Agent tool registry", message: error instanceof Error ? error.message : "Lint failed." }); }
  };
  if (message) return <p className="kw-message">{message}</p>;
  const enabled = tool?.status === "AVAILABLE" || tool?.status === "AVAILABLE_WITH_CONFIRMATION";
  return <section className="kw-action-surface"><div><Bug size={26} /><h2>Lint</h2><StatusBadge value={String(tool?.status || "UNAVAILABLE")} /></div><EvidenceRows value={tool} /><button disabled={!enabled} onClick={() => void run()}><Play size={14} />Run detected lint command</button></section>;
}

function PreviewSurface({ project, onExecution }: { project: ProjectSummary; onExecution: (execution: ExecutionSnapshot | null) => void }) {
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState("Loading shared Preview evidence…");
  const refresh = () => fetchJson<{ preview: Record<string, unknown> }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/preview`).then((data) => { setPreview(data.preview); setMessage(""); }).catch((error) => setMessage(error instanceof Error ? error.message : "Preview evidence unavailable."));
  useEffect(() => { void refresh(); }, [project.id]);
  const operate = async (operation: "start" | "health" | "stop" | "restart") => {
    onExecution({ label: `Preview ${operation}`, state: "RUNNING", source: "Shared Preview runtime" });
    try { const data = await fetchJson<{ preview: Record<string, unknown> }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/preview/${operation}`, { method: "POST" }); setPreview(data.preview); onExecution({ label: `Preview ${operation}`, command: String(data.preview.command || "Detected Preview profile"), state: String(data.preview.state || "COMPLETED").toUpperCase(), source: "Shared Preview runtime", output: String(data.preview.stdout || data.preview.output || ""), message: String(data.preview.reason || data.preview.health || "Preview evidence refreshed.") }); }
    catch (error) { onExecution({ label: `Preview ${operation}`, state: "FAILED", source: "Shared Preview runtime", message: error instanceof Error ? error.message : "Preview operation failed." }); }
  };
  return <section className="kw-preview"><div className="kw-preview-heading"><MonitorPlay size={26} /><div><h2>KNOuX Forge Preview Engine</h2><p>One shared runtime; no second Preview engine is created by the workbench.</p></div></div>{message && <p className="kw-message">{message}</p>}<EvidenceRows value={preview} /><div className="kw-inline-actions"><button onClick={() => void operate("start")}>Start</button><button onClick={() => void operate("health")}>Health</button><button onClick={() => void operate("restart")}>Restart</button><button onClick={() => void operate("stop")}>Stop</button></div>{preview && <details><summary>Advanced · Raw Preview Evidence</summary><pre>{JSON.stringify(preview, null, 2)}</pre></details>}</section>;
}

function RemoteSurface({ view, project, onExecution }: { view: string; project?: ProjectSummary; onExecution: (execution: ExecutionSnapshot | null) => void }) {
  if (!project) return <EmptyState title="No project selected" detail="Git and GitHub evidence requires a selected project. Online catalog remains global." />;
  if (["git", "branches", "commits"].includes(view)) return <SimpleFetchSurface url={`/api/workspace/projects/${encodeURIComponent(project.id)}/git`} title={viewLabel("remote", view)} />;
  return <SimpleFetchSurface url={`/api/workspace/projects/${encodeURIComponent(project.id)}/github`} title={viewLabel("remote", view)} onErrorExecution={(message) => onExecution({ label: viewLabel("remote", view), state: "UNAVAILABLE", source: "GitHub read-only adapter", message })} />;
}

function ReleaseSurface({ view, project, onExecution }: { view: string; project?: ProjectSummary; onExecution: (execution: ExecutionSnapshot | null) => void }) {
  if (!project) return <EmptyState title="No project selected" detail="Release evidence is project-scoped. Select a project to evaluate source, local, Preview, desktop, package, installer, GitHub, CI and remote domains independently." />;
  if (view === "release-gate") return <ReleaseGate project={project} onExecution={onExecution} />;
  return <ReleasePreparation project={project} view={view} />;
}

function ReleaseGate({ project, onExecution }: { project: ProjectSummary; onExecution: (execution: ExecutionSnapshot | null) => void }) {
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState("");
  const run = async () => {
    onExecution({ label: "Release Gate", state: "RUNNING", source: "KForge release evidence engine" });
    try { const response = await fetch(`/api/workspace/projects/${encodeURIComponent(project.id)}/release-gate`, { method: "POST" }); const data = await response.json() as Record<string, unknown>; if (!response.ok && !data.verdicts) throw new Error(String(data.error || "Release Gate failed.")); setResult(data); const readiness = String(data.readiness || "UNKNOWN"); onExecution({ label: "Release Gate", state: readiness, source: "KForge release evidence engine", message: `Release readiness: ${readiness}` }); setMessage(response.ok ? "" : "Release Gate is blocked; independent evidence remains visible."); }
    catch (error) { const text = error instanceof Error ? error.message : "Release Gate failed."; setMessage(text); onExecution({ label: "Release Gate", state: "FAILED", source: "KForge release evidence engine", message: text }); }
  };
  const verdicts = result?.verdicts as Record<string, Record<string, unknown>> | undefined;
  const order = ["SOURCE", "LOCAL", "PREVIEW", "DESKTOP", "WINDOWS_PACKAGE", "INSTALLER", "GITHUB", "CI", "REMOTE"];
  return <section className="kw-release-gate"><div className="kw-inline-actions"><button onClick={() => void run()}><Rocket size={14} />Run Release Gate</button>{result && <StatusBadge value={String(result.readiness || "UNKNOWN")} />}</div>{message && <p className="kw-message">{message}</p>}{verdicts ? <div className="kw-release-grid">{order.map((kind) => { const verdict = verdicts[kind] || {}; return <article key={kind}><strong>{kind}</strong><StatusBadge value={String(verdict.state || "UNKNOWN")} /><p>{String(verdict.source || "No source evidence")}</p><small>{String(verdict.freshness || "UNKNOWN")} · {String(verdict.timestamp || "NO_TIMESTAMP")}</small><small>{String(verdict.reason || verdict.blocker || "")}</small></article>; })}</div> : <EmptyState title="No release verification loaded" detail="Run Release Gate to collect independent evidence domains. Missing domains remain UNKNOWN/NOT_AVAILABLE; they are never converted to PASS." />}</section>;
}

function ReleasePreparation({ project, view }: { project: ProjectSummary; view: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState("Loading local release preparation evidence…");
  useEffect(() => { void fetchJson<{ preparation: Record<string, unknown> }>(`/api/workspace/projects/${encodeURIComponent(project.id)}/release/preparation`).then((result) => { setData(result.preparation); setMessage(""); }).catch((error) => setMessage(error instanceof Error ? error.message : "Release preparation unavailable.")); }, [project.id]);
  if (message) return <p className="kw-message">{message}</p>;
  if (!data) return null;
  if (view === "artifacts") {
    const artifactNames = (data.artifacts as string[] || []);
    const localEvidence = data.localEvidence as Record<string, unknown> | undefined;
    return <section><div className="kw-table-wrap"><table className="kw-table"><thead><tr><th>Artifact</th><th>Type</th><th>Source</th><th>Version</th><th>Git SHA</th><th>Created</th><th>Size</th><th>SHA-256</th><th>Signature</th><th>Verification</th></tr></thead><tbody>{artifactNames.map((artifact) => <tr key={artifact}><td>{artifact}</td><td>directory</td><td>Local release preparation</td><td>{String(data.version || "UNKNOWN")}</td><td>{String(localEvidence?.gitSha || "UNKNOWN")}</td><td>UNKNOWN</td><td>UNKNOWN</td><td>UNKNOWN</td><td>UNKNOWN</td><td><StatusBadge value="NOT_VERIFIED" /></td></tr>)}</tbody></table></div>{artifactNames.length === 0 && <EmptyState title="No release artifacts detected" detail="Raw JSON is not treated as an artifact. KForge lists only detected artifact locations and preserves unknown verification fields as UNKNOWN." />}</section>;
  }
  return <section className="kw-stack"><EvidenceRows value={data} /><h3>Commits</h3><EvidenceCards rows={(data.commits as Array<Record<string, unknown>> || [])} /><details><summary>Advanced · Raw release evidence</summary><pre>{JSON.stringify(data, null, 2)}</pre></details></section>;
}

function SystemSurface({ view, project, workspace, settings, onSettings, onRefresh }: { view: string; project?: ProjectSummary; workspace: WorkspaceResponse | null; settings: KForgePlatformSettings | null; onSettings: (settings: KForgePlatformSettings) => void; onRefresh: () => Promise<void> }) {
  if (view === "settings") return settings ? <SettingsSurface settings={settings} onSettings={onSettings} /> : <p className="kw-message">Settings unavailable.</p>;
  if (view === "online-offline") return <section className="kw-stack"><h3>Current operating policy</h3><EvidenceRows value={workspace?.localPlatform as unknown as Record<string, unknown>} /><p>Remote actions remain policy controlled. Opening Online does not silently contact providers.</p></section>;
  if (view === "trust") {
    if (!project) return <EmptyState title="No project selected" detail="Project trust is contextual. Read-only inspection works without trust; process, Git and filesystem mutation require explicit project trust." />;
    return <section className="kw-action-surface"><div><ShieldCheck size={26} /><h2>{project.name}</h2><StatusBadge value={project.trust} /></div><p>Trust enables local command execution and write-capable agent operations. It does not authorize remote writes automatically.</p>{project.trust !== "trusted" && <button onClick={() => void (async () => { if (!window.confirm(`Trust ${project.name} for local execution?`)) return; await fetchJson(`/api/workspace/projects/${encodeURIComponent(project.id)}/trust`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }) }); await onRefresh(); })()}>Trust project with confirmation</button>}</section>;
  }
  if (!project && ["permissions", "storage", "self-audit"].includes(view)) return <EmptyState title="No project selected" detail={`${viewLabel("system", view)} is project-scoped. Select a project to inspect its evidence.`} />;
  const url = view === "permissions" ? `/api/workspace/projects/${encodeURIComponent(project!.id)}/agent/tools` : view === "storage" ? `/api/workspace/projects/${encodeURIComponent(project!.id)}/cache` : view === "self-audit" ? `/api/workspace/projects/${encodeURIComponent(project!.id)}/self-audit` : "/api/workspace/platform";
  return <SimpleFetchSurface url={url} title={viewLabel("system", view)} />;
}

function SettingsSurface({ settings, onSettings }: { settings: KForgePlatformSettings; onSettings: (settings: KForgePlatformSettings) => void }) {
  const [draft, setDraft] = useState(settings);
  const [message, setMessage] = useState("");
  useEffect(() => setDraft(settings), [settings]);
  const save = async () => {
    try {
      const result = await fetchJson<{ settings: KForgePlatformSettings }>("/api/workspace/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: 3, general: { startupActivity: draft.general.startupActivity, startupOnlineView: draft.general.startupOnlineView }, appearance: draft.appearance, preview: draft.preview, privacy: { remoteContextPolicy: draft.privacy.remoteContextPolicy }, git: {} }) });
      onSettings(result.settings); setDraft(result.settings); applyTheme(result.settings.appearance.theme); setMessage(`Settings saved locally at ${new Date(result.settings.updatedAt).toLocaleString()}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Settings could not be saved."); }
  };
  return <section className="kw-settings"><div className="kw-settings-grid"><label>Startup activity<select aria-label="Startup activity" value={draft.general.startupActivity} onChange={(event) => setDraft({ ...draft, general: { ...draft.general, startupActivity: event.target.value as KForgeActivity } })}>{ACTIVITIES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label><label>Startup Online view<select aria-label="Startup Online view" value={draft.general.startupOnlineView} onChange={(event) => setDraft({ ...draft, general: { ...draft.general, startupOnlineView: event.target.value as KForgeOnlineView } })}>{ACTIVITIES.find((entry) => entry.id === "online")!.views.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label><label>Theme<select aria-label="Theme" value={draft.appearance.theme} onChange={(event) => setDraft({ ...draft, appearance: { ...draft.appearance, theme: event.target.value as "light" | "dark" | "system" } })}><option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option></select></label><label>Information density<select aria-label="Information density" value={draft.appearance.density} onChange={(event) => setDraft({ ...draft, appearance: { ...draft.appearance, density: event.target.value as "compact" | "comfortable" } })}><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></label><label className="kw-checkbox"><input aria-label="Reduce motion" type="checkbox" checked={draft.appearance.reducedMotion} onChange={(event) => setDraft({ ...draft, appearance: { ...draft.appearance, reducedMotion: event.target.checked } })} />Reduce motion</label><label>Remote context policy<select aria-label="Remote context policy" value={draft.privacy.remoteContextPolicy} onChange={(event) => setDraft({ ...draft, privacy: { ...draft.privacy, remoteContextPolicy: event.target.value as "blocked" | "ask" } })}><option value="ask">Ask</option><option value="blocked">Blocked</option></select></label></div><div className="kw-security-invariants"><ShieldCheck size={18} /><div><strong>Enforced invariants</strong><span>secretRedaction = true · confirmRemoteWrites = true</span></div></div><button onClick={() => void save()}>Save settings</button>{message && <p className="kw-message">{message}</p>}</section>;
}

function ProjectEvidenceSurface({ activity, view, project, onNavigate }: { activity: KForgeActivity; view: string; project?: ProjectSummary; onNavigate: (activity: KForgeActivity, view: string) => void }) {
  if (!project) return <EmptyState title="No project selected" detail={`${viewLabel(activity, view)} needs project context. Select a project above. Online discovery remains fully usable without one.`} />;
  if (activity === "intelligence" && view === "ask-kforge") return <AskKForge project={project} />;
  if (activity === "intelligence" && view === "impact-analysis") return <ImpactAnalysis project={project} />;
  const url = activity === "intelligence" ? (view === "dependencies" ? `/api/workspace/projects/${encodeURIComponent(project.id)}/profile` : view === "architecture" ? `/api/workspace/projects/${encodeURIComponent(project.id)}/architecture` : `/api/workspace/projects/${encodeURIComponent(project.id)}/graph`) : view === "security" ? `/api/workspace/projects/${encodeURIComponent(project.id)}/security/tools` : view === "performance" ? `/api/workspace/projects/${encodeURIComponent(project.id)}/profile` : view === "documentation" ? `/api/workspace/projects/${encodeURIComponent(project.id)}/documentation` : view === "snapshots" ? `/api/workspace/projects/${encodeURIComponent(project.id)}/snapshots` : `/api/workspace/projects/${encodeURIComponent(project.id)}/problems`;
  return <div className="kw-stack"><SimpleFetchSurface url={url} title={viewLabel(activity, view)} />{activity === "quality" && view === "solutions" && <button onClick={() => onNavigate("quality", "problems")}>Review current problems</button>}</div>;
}

function AskKForge({ project }: { project: ProjectSummary }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState("");
  const ask = async () => { try { setMessage("Analyzing bounded project evidence…"); setAnswer(await fetchJson<Record<string, unknown>>(`/api/workspace/projects/${encodeURIComponent(project.id)}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) })); setMessage(""); } catch (error) { setMessage(error instanceof Error ? error.message : "Ask KForge failed."); } };
  return <section className="kw-form-surface"><BrainCircuit size={26} /><h2>Ask KForge</h2><p>Answers use bounded redacted project context. If no active local model exists, the server returns deterministic scan evidence rather than inventing an AI answer.</p><textarea aria-label="Ask KForge question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Which release blockers are evidence-backed right now?" /><button disabled={!question.trim()} onClick={() => void ask()}>Analyze project evidence</button>{message && <p className="kw-message">{message}</p>}{answer && <article className="kw-answer"><EvidenceRows value={answer} /><details><summary>Advanced · Raw answer evidence</summary><pre>{JSON.stringify(answer, null, 2)}</pre></details></article>}</section>;
}

function ImpactAnalysis({ project }: { project: ProjectSummary }) {
  const [target, setTarget] = useState("");
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState("");
  return <section className="kw-form-surface"><Network size={26} /><h2>Impact Analysis</h2><p>Provide a project-relative file path or exact graph symbol id. KForge does not infer a target silently.</p><input aria-label="Impact target" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="src/core/service.ts" /><button disabled={!target.trim()} onClick={() => void fetchJson<Record<string, unknown>>(`/api/workspace/projects/${encodeURIComponent(project.id)}/graph/impact?target=${encodeURIComponent(target.trim())}`).then((result) => { setData(result); setMessage(""); }).catch((error) => setMessage(error instanceof Error ? error.message : "Impact analysis failed."))}>Analyze impact</button>{message && <p className="kw-message">{message}</p>}{data && <><EvidenceRows value={data} /><details><summary>Advanced · Raw impact evidence</summary><pre>{JSON.stringify(data, null, 2)}</pre></details></>}</section>;
}

function SimpleFetchSurface({ url, title, onErrorExecution }: { url: string; title: string; onErrorExecution?: (message: string) => void }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState(`Loading ${title} evidence…`);
  const refresh = () => fetchJson<Record<string, unknown>>(url).then((result) => { setData(result); setMessage(""); }).catch((error) => { const text = error instanceof Error ? error.message : `${title} evidence unavailable.`; setMessage(text); onErrorExecution?.(text); });
  useEffect(() => { void refresh(); }, [url]);
  const arrays = data ? Object.entries(data).filter(([, value]) => Array.isArray(value)) : [];
  return <section className="kw-simple-surface"><div className="kw-inline-actions"><strong>{title}</strong><button onClick={() => void refresh()}><RefreshCw size={13} />Refresh</button></div>{message && <p className="kw-message">{message}</p>}{data && <><EvidenceRows value={data} />{arrays.map(([key, value]) => <div key={key}><h3>{key}</h3><EvidenceCards rows={(value as unknown[]).filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)} /></div>)}<details><summary>Advanced · Raw Evidence</summary><pre>{JSON.stringify(data, null, 2)}</pre></details></>}</section>;
}

function TaskTable({ tasks }: { tasks: TaskRow[] }) {
  if (!tasks.length) return <EmptyState title="No persisted tasks" detail="KForge does not invent activity records. Tasks appear only after an operation creates persisted evidence." />;
  return <div className="kw-table-wrap"><table className="kw-table"><thead><tr><th>Task</th><th>Project</th><th>State</th><th>Progress</th><th>Started</th><th>Duration</th><th>Evidence</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.id}><td><strong>{task.kind}</strong><small>{task.id}</small></td><td>{task.projectId}</td><td><StatusBadge value={task.status} /></td><td>{task.progress}%</td><td>{new Date(task.startedAt).toLocaleString()}</td><td>{task.durationMs ? `${task.durationMs} ms` : task.finishedAt ? `${new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime()} ms` : "RUNNING / UNKNOWN"}</td><td>{task.error || task.logs?.at(-1)?.message || task.output?.slice(0, 180) || "No output yet"}</td></tr>)}</tbody></table></div>;
}

function Inspector({ activity, view, project, execution }: { activity: KForgeActivity; view: string; project?: ProjectSummary; execution: ExecutionSnapshot | null }) {
  return <div className="kw-inspector-scroll"><div className="kw-inspector-title"><SlidersHorizontal size={17} /><div><strong>Inspector</strong><small>{activityLabel(activity)} / {viewLabel(activity, view)}</small></div></div>{project ? <><h3>Project context</h3><dl className="kw-evidence-list"><div><dt>Name</dt><dd>{project.name}</dd></div><div><dt>Path</dt><dd>{project.path}</dd></div><div><dt>Trust</dt><dd>{project.trust}</dd></div><div><dt>Branch</dt><dd>{project.branch}</dd></div><div><dt>Git</dt><dd>{project.modifiedFiles + project.untrackedFiles} changed · {project.ahead} ahead · {project.behind} behind</dd></div><div><dt>Health</dt><dd>{project.healthScore ?? "NOT_SCANNED"}</dd></div></dl></> : <><h3>Project context</h3><p className="kw-muted">No project selected. Global Online compatibility is NOT_EVALUATED, not incompatible.</p></>}{execution && <><h3>Latest execution</h3><dl className="kw-evidence-list"><div><dt>Operation</dt><dd>{execution.label}</dd></div><div><dt>State</dt><dd>{execution.state}</dd></div><div><dt>Command</dt><dd>{execution.command || "Registered KForge operation"}</dd></div><div><dt>Exit code</dt><dd>{execution.exitCode ?? "UNKNOWN"}</dd></div><div><dt>Source</dt><dd>{execution.source || "UNKNOWN"}</dd></div></dl></>}<h3>Workbench contract</h3><ul className="kw-contract"><li>One active capability surface</li><li>Explorer is scoped to the selected Activity</li><li>Inspector is contextual</li><li>Remote contact remains explicit and policy controlled</li></ul></div>;
}

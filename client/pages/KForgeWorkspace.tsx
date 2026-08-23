import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  Archive,
  ArrowDownUp,
  Bot,
  Box,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Cpu,
  Code2,
  Command,
  FolderGit2,
  FolderOpen,
  Github,
  GitBranch,
  HeartPulse,
  History,
  LayoutDashboard,
  MoreHorizontal,
  MessageSquare,
  Network,
  Play,
  Pin,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Star,
  Settings2,
  ShieldAlert,
  Terminal,
  TestTube2,
  Wrench,
  X,
} from "lucide-react";
import type {
  CommandResult,
  ProjectScan,
  ProjectSummary,
  ScanIssue,
  LocalPlatformStatus,
  WorkspaceAction,
  WorkspaceResponse,
  WorkspaceStatus,
} from "@shared/workspace";

const NAVIGATION = [
  { group: "Projects", items: [["Workspace", LayoutDashboard], ["Project health", HeartPulse], ["Recent projects", History], ["Favorites", Star], ["Pinned", Pin], ["Archive", Archive], ["Open project", FolderOpen], ["Import project", FolderGit2]] },
  { group: "AI", items: [["AI providers", Bot], ["Models", Cpu], ["Agents", Bot], ["Tasks", Activity]] },
  { group: "Marketplace", items: [["Marketplace", Box]] },
  { group: "Intelligence", items: [["Project graph", Network], ["Dependencies", Box], ["Impact analysis", Network], ["Code understanding", Code2], ["Ask KForge", MessageSquare], ["Architecture", Box]] },
  { group: "Quality", items: [["KForge Sonar", ShieldAlert], ["Problems", ShieldAlert], ["Solutions", Wrench], ["Security", ShieldAlert], ["Performance", Activity], ["Technical debt", Wrench], ["Snapshots", History]] },
  { group: "Release", items: [["Release Gate", Rocket], ["Release preparation", Rocket], ["Artifacts", Box], ["Versioning", GitBranch]] },
  { group: "Developer tools", items: [["Terminal", Terminal], ["Tests", TestTube2], ["Build", Play], ["Runtime", Play], ["Logs", History], ["Diagnostics", ShieldAlert]] },
  { group: "Remote", items: [["Git", GitBranch], ["Branches", GitBranch], ["Commits", History], ["GitHub", Github], ["Pull requests", Github], ["Issues", ShieldAlert], ["Actions", Activity], ["Releases", Rocket]] },
  { group: "System", items: [["Settings", Settings2], ["Trust", ShieldAlert], ["Permissions", ShieldAlert], ["Storage", Box], ["Offline / Online", Network], ["System diagnostics", Activity]] },
] as const;

type Status = WorkspaceStatus;
type SortKey = "name" | "projectType" | "branch" | "lastActivity" | "sync";

interface MissionEvidenceItem {
  id: string;
  stepId: string;
  kind: string;
  recordedAt: string;
  summary: string;
}

interface MissionStepItem {
  id: string;
  missionId?: string;
  index?: number;
  name: string;
  kind?: string;
  tool: string;
  status: "queued" | "running" | "waiting-confirmation" | "succeeded" | "failed" | "blocked" | "skipped";
  dependencies: string[];
  startedAt?: string;
  finishedAt?: string;
  logs: string[];
  output?: string;
  error?: string;
  evidence?: MissionEvidenceItem[];
  requiresConfirmation?: boolean;
  attempts?: number;
  retryCount: number;
}

interface MissionItem {
  id: string;
  projectId?: string;
  type?: string;
  name: string;
  goal?: string;
  state: "queued" | "planning" | "running" | "waiting-confirmation" | "verifying" | "succeeded" | "failed" | "blocked" | "recovering" | "cancelled" | "interrupted";
  status?: string;
  progress?: number;
  currentStepId?: string;
  steps: MissionStepItem[];
  evidence?: MissionEvidenceItem[];
  changedFiles: string[];
  snapshotId?: string;
  warnings: string[];
  recovery: { resume: boolean; rollback: boolean; inspect: boolean; detail: string; recoveryRequired?: boolean };
  finalResult?: { summary: string; state: string; recordedAt: string };
}

interface TaskItem {
  id: string;
  projectId: string;
  action: WorkspaceAction | "agent";
  state: "queued" | "running" | "success" | "error" | "cancelled" | "blocked" | "retrying";
  progress: number;
  output: string;
  message: string;
  startedAt: string;
  finishedAt?: string;
  retryOf?: string;
  mission?: MissionItem;
}

interface ServerTask {
  id: string;
  projectId: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "blocked" | "retrying";
  progress: number;
  logs: Array<{ at: string; message: string; stream?: "system" | "stdout" | "stderr" }>;
  output?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  artifacts?: string[];
  retryOf?: string;
  mission?: MissionItem;
}

function taskFromServer(task: ServerTask): TaskItem | null {
  if (!["scan", "test", "build", "typecheck", "runtime", "pull", "push", "agent"].includes(task.kind)) return null;
  const action = task.kind as WorkspaceAction | "agent";
  return {
    id: task.id,
    projectId: task.projectId,
    action,
    state: task.status === "succeeded" ? "success" : task.status === "failed" ? "error" : task.status,
    progress: task.progress,
    output: task.output || "",
    message: task.error || task.logs.at(-1)?.message || "Queued…",
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    retryOf: task.retryOf,
    mission: task.mission,
  };
}

function formatDate(value?: string) {
  if (!value) return "Not scanned";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function statusLabel(status: Status) {
  return ({ pass: "Pass", warning: "Warning", fail: "Needs review", unknown: "Not run", running: "Running", unavailable: "Unavailable" } as const)[status];
}

function statusClass(status: Status) {
  return `kf-status kf-status--${status}`;
}

function ProviderMark({ provider }: { provider: ProjectSummary["provider"] }) {
  return provider === "GitHub" ? <Github size={15} aria-label="GitHub" /> : <FolderGit2 size={15} aria-label={provider} />;
}

export default function KForgeWorkspace() {
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeProjectId, setActiveProjectId] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "synced" | "changes" | "review">("all");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "lastActivity", direction: "desc" });
  const [columns, setColumns] = useState({ branch: true, type: true, status: true, activity: true, git: true });
  const [openGroups, setOpenGroups] = useState({ active: true, others: true });
  const [activeNav, setActiveNav] = useState("Workspace");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [globalResults, setGlobalResults] = useState<Array<{ kind: string; title: string; detail: string; projectId: string; score: number }>>([]);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [actionResults, setActionResults] = useState<Record<string, Partial<Record<WorkspaceAction, CommandResult>>>>({});
  const [scans, setScans] = useState<Record<string, ProjectScan>>({});
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [modal, setModal] = useState<"open" | "clone" | null>(null);
  const [localPath, setLocalPath] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [targetName, setTargetName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const localPlatform = workspace?.localPlatform;

  const refreshProjects = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/workspace/projects");
      if (!response.ok) throw new Error("KForge could not read the local workspace.");
      const payload: WorkspaceResponse = await response.json();
      setWorkspace(payload);
      setActiveProjectId((previous) => previous || payload.projects[0]?.id || "");
    } catch (cause: any) {
      setError(cause.message || "The local KForge engine is unavailable.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshProjects();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setModal(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!commandOpen || commandQuery.trim().length < 2) { setGlobalResults([]); setGlobalSearchLoading(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setGlobalSearchLoading(true);
      void fetch(`/api/workspace/search?q=${encodeURIComponent(commandQuery.trim())}`, { signal: controller.signal })
        .then(async (response) => response.ok ? response.json() as Promise<{ results?: Array<{ kind: string; title: string; detail: string; projectId: string; score: number }> }> : { results: [] })
        .then((payload) => setGlobalResults(payload.results || []))
        .catch(() => { if (!controller.signal.aborted) setGlobalResults([]); })
        .finally(() => { if (!controller.signal.aborted) setGlobalSearchLoading(false); });
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [commandOpen, commandQuery]);

  const projects = workspace?.projects || [];
  const activeProject = projects.find((project) => project.id === activeProjectId) || projects[0];
  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = projects.filter((project) => {
      const scan = scans[project.id];
      const matchesQuery = !normalizedQuery || [project.name, project.path, project.branch, project.projectType, project.provider, ...project.tags].join(" ").toLowerCase().includes(normalizedQuery);
      const hasChanges = project.modifiedFiles + project.untrackedFiles > 0;
      const matchesStatus = statusFilter === "all" ||
        (statusFilter === "synced" && !hasChanges && project.behind === 0) ||
        (statusFilter === "changes" && hasChanges) ||
        (statusFilter === "review" && (scan?.issues.some((issue) => issue.severity === "critical" || issue.severity === "high") || project.behind > 0));
      return matchesQuery && matchesStatus;
    });
    return filtered.sort((left, right) => {
      const leftValue = sort.key === "sync" ? left.behind + left.ahead : String(left[sort.key] || "");
      const rightValue = sort.key === "sync" ? right.behind + right.ahead : String(right[sort.key] || "");
      const result = String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true });
      return sort.direction === "asc" ? result : -result;
    });
  }, [projects, query, scans, sort, statusFilter]);

  const selectedProjects = projects.filter((project) => selected.has(project.id));
  const allFilteredSelected = filteredProjects.length > 0 && filteredProjects.every((project) => selected.has(project.id));

  const updateSort = (key: SortKey) => {
    setSort((previous) => ({ key, direction: previous.key === key && previous.direction === "asc" ? "desc" : "asc" }));
  };

  const toggleSelected = (projectId: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      next.has(projectId) ? next.delete(projectId) : next.add(projectId);
      return next;
    });
  };

  const refreshTasks = async () => {
    try {
      const response = await fetch(`/api/workspace/tasks${activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : ""}`);
      if (!response.ok) return;
      const payload = await response.json() as { tasks?: ServerTask[] };
      const mapped = (payload.tasks || []).map(taskFromServer).filter((task): task is TaskItem => task !== null);
      setTasks(mapped);
      mapped.filter((task) => task.state === "success" || task.state === "error").forEach((task) => {
        if (task.action === "agent") return;
        const result: CommandResult = { action: task.action, projectId: task.projectId, ok: task.state === "success", startedAt: task.startedAt, completedAt: task.finishedAt || task.startedAt, output: task.output, message: task.message };
        setActionResults((previous) => ({ ...previous, [task.projectId]: { ...previous[task.projectId], [task.action]: result } }));
        if (task.action === "scan" && task.state === "success" && task.output) {
          try { setScans((previous) => ({ ...previous, [task.projectId]: JSON.parse(task.output) as ProjectScan })); } catch { /* The task remains available with its original command output. */ }
        }
      });
    } catch { /* The workspace stays usable when a transient task poll fails. */ }
  };

  const runAction = async (project: ProjectSummary, action: WorkspaceAction) => {
    try {
      const response = await fetch(`/api/workspace/projects/${project.id}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "The task could not be started.");
      await refreshTasks();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "The task could not be started.");
    }
  };

  useEffect(() => {
    void refreshTasks();
    const timer = window.setInterval(() => void refreshTasks(), 1_500);
    return () => window.clearInterval(timer);
  }, [activeProjectId]);

const controlTask = async (task: TaskItem, control: "cancel" | "retry" | "resume" | "rollback") => {
    try {
      if (control === "rollback" && !window.confirm(`Restore snapshot ${task.mission?.snapshotId || ""}? This writes the selected project back to the saved snapshot.`)) return;
      const endpoint = control === "resume" ? "mission/resume" : control === "rollback" ? "mission/rollback" : control;
      const response = await fetch(`/api/workspace/tasks/${task.id}/${endpoint}`, { method: "POST", headers: control === "rollback" ? { "Content-Type": "application/json" } : undefined, body: control === "rollback" ? JSON.stringify({ confirmed: true }) : undefined });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || `Task ${control} failed.`);
      await refreshTasks();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Task control failed.");
    }
  };

  const runBulk = (action: WorkspaceAction) => {
    selectedProjects.forEach((project) => void runAction(project, action));
  };

  const approveProjectTrust = async (project: ProjectSummary) => {
    if (!window.confirm(`Trust ${project.name}? This enables local tests, builds, runtime checks, and safe agent patches for this project. KForge will not enable remote push, deployment, or cloud AI automatically.`)) return;
    try {
      const response = await fetch(`/api/workspace/projects/${project.id}/trust`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Trust approval failed.");
      await refreshProjects();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Trust approval failed.");
    }
  };

  const openProject = async () => {
    if (!localPath.trim()) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/workspace/projects/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: localPath.trim() }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The project could not be opened.");
      setModal(null);
      setLocalPath("");
      await refreshProjects();
      setActiveProjectId(payload.project.id);
    } catch (cause: any) {
      setError(cause.message || "The project could not be opened.");
    } finally {
      setSubmitting(false);
    }
  };

  const updateProjectCollection = async (project: ProjectSummary, patch: Partial<Pick<ProjectSummary, "favorite" | "pinned" | "archived" | "tags">>) => {
    try {
      const response = await fetch(`/api/workspace/projects/${project.id}/collection`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Project collection could not be updated.");
      await refreshProjects();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Project collection could not be updated.");
    }
  };

  const editProjectTags = (project: ProjectSummary) => {
    const value = window.prompt(`Set labels for ${project.name}. Separate labels with commas.`, project.tags.join(", "));
    if (value === null) return;
    void updateProjectCollection(project, { tags: value.split(",").map((tag) => tag.trim()).filter(Boolean) });
  };

  const setPlatformMode = async (mode: LocalPlatformStatus["mode"]) => {
    if (mode === "online-optional" && !window.confirm("You are enabling online access.\n\nPurpose: optional GitHub synchronization and provider download pages.\nData: repository URL and metadata only when you explicitly clone, pull, or push.\n\nProject source remains local. Cloud AI is not enabled, and no project source is sent to a cloud provider unless you separately choose and confirm that action.")) return;
    try {
      const response = await fetch("/api/workspace/platform/mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      const payload = await response.json() as LocalPlatformStatus & { error?: string };
      if (!response.ok) throw new Error(payload.error || "KForge could not change the platform mode.");
      setWorkspace((previous) => previous ? { ...previous, localPlatform: payload } : previous);
      setError("");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "KForge could not change the platform mode.");
    }
  };

  const cloneProject = async () => {
    if (!remoteUrl.trim() || !targetName.trim()) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/workspace/projects/clone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remoteUrl: remoteUrl.trim(), targetName: targetName.trim() }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The repository could not be cloned.");
      setModal(null);
      setRemoteUrl("");
      setTargetName("");
      await refreshProjects();
      setActiveProjectId(payload.project.id);
    } catch (cause: any) {
      setError(cause.message || "The repository could not be cloned.");
    } finally {
      setSubmitting(false);
    }
  };

  const executeCommand = (label: string, callback: () => void) => {
    callback();
    setCommandOpen(false);
    setCommandQuery("");
    setActiveNav(label);
  };

  const commandItems = [
    { label: "Open local project", meta: "Project", callback: () => setModal("open") },
    { label: "Clone repository", meta: "Project", callback: () => setModal("clone") },
    { label: "Refresh workspace", meta: "Workspace", callback: () => void refreshProjects() },
    { label: "Scan selected project", meta: "Audit", callback: () => activeProject && void runAction(activeProject, "scan") },
    { label: "Run tests", meta: "Developer tools", callback: () => activeProject && void runAction(activeProject, "test") },
    { label: "Run build", meta: "Developer tools", callback: () => activeProject && void runAction(activeProject, "build") },
    { label: "Open GitHub remote", meta: "Remote", callback: () => activeProject?.remoteUrl && window.open(activeProject.remoteUrl, "_blank", "noopener,noreferrer") },
  ].filter((command) => command.label.toLowerCase().includes(commandQuery.toLowerCase()));

  const activeScan = activeProject ? scans[activeProject.id] : undefined;
  const activeTaskList = tasks.filter((task) => task.projectId === activeProject?.id).slice(0, 4);

  return (
    <div className="kf-app">
      <aside className="kf-sidebar">
        <div className="kf-brand"><span className="kf-brand-mark"><Code2 size={19} /></span><span>KForge</span></div>
        <div className="kf-workspace-switcher"><span className="kf-workspace-dot" /> Local-first engineering</div>
        <nav className="kf-nav" aria-label="KForge navigation">
          {NAVIGATION.map((section) => (
            <section key={section.group}>
              <p className="kf-nav-label">{section.group}</p>
              {section.items.map(([label, Icon]) => <button key={label} className={`kf-nav-item ${activeNav === label ? "is-active" : ""}`} onClick={() => setActiveNav(label)}><Icon size={16} /><span>{label}</span></button>)}
            </section>
          ))}
        </nav>
        <div className="kf-sidebar-footer"><span><CircleDot size={12} className="kf-live-dot" /> {localPlatform?.mode === "online-optional" ? "Online optional" : "Offline core ready"}</span><button onClick={() => setActiveNav("Settings")} title="Local platform settings"><Settings2 size={17} /></button></div>
      </aside>

      <main className="kf-main">
        <header className="kf-topbar">
          <div className="kf-breadcrumb"><span>Projects</span><ChevronRight size={14} /><strong>Workspace</strong></div>
          <button className="kf-command-trigger" onClick={() => setCommandOpen(true)}><Search size={17} /><span>Ask KForge or run a command</span><kbd>Ctrl K</kbd></button>
          <div className="kf-topbar-state"><span><i className="kf-connection-dot" />{localPlatform?.mode === "online-optional" ? "Online optional" : "Offline mode"}</span><span><i className="kf-connection-dot" />Local AI</span></div>
        </header>

        <section className="kf-content">
          <div className="kf-page-heading">
            <div><p className="kf-eyebrow">KForge workspace</p><h1>Projects</h1><p className="kf-page-subtitle">Real local repositories, Git state, audits, and engineering actions in one workspace.</p></div>
            <div className="kf-heading-actions"><button className="kf-button kf-button--ghost" onClick={() => void refreshProjects()} disabled={loading}><RefreshCw size={16} className={loading ? "kf-spin" : ""} />Refresh</button><button className="kf-button kf-button--secondary" onClick={() => setModal("clone")} disabled={localPlatform?.mode !== "online-optional"} title={localPlatform?.mode !== "online-optional" ? "Enable Online Optional mode to clone a remote repository." : "Clone a remote repository"}><Github size={16} />Clone repository</button><button className="kf-button kf-button--primary" onClick={() => setModal("open")}><Plus size={16} />Open project</button></div>
          </div>

          {error && <div className="kf-alert"><ShieldAlert size={17} /><span>{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}
          {activeProject?.trust === "untrusted" && <div className="kf-alert"><ShieldAlert size={17} /><span><strong>UNTRUSTED PROJECT</strong> — read-only inspection is available. Tests, builds, runtime checks, and agent patches require your approval.</span><button className="kf-button kf-button--secondary" onClick={() => void approveProjectTrust(activeProject)}>Trust local execution</button></div>}

          <section className="kf-workspace-panel">
            <div className="kf-toolbar">
              <div className="kf-search"><Search size={16} /><input aria-label="Search local projects" placeholder="Search projects, paths, branches…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} aria-label="Project filter"><option value="all">All projects</option><option value="synced">Synced</option><option value="changes">Local changes</option><option value="review">Needs review</option></select>
              <details className="kf-column-menu"><summary><EyeIcon />Columns <ChevronDown size={14} /></summary><div>{Object.entries(columns).map(([key, visible]) => <label key={key}><input type="checkbox" checked={visible} onChange={() => setColumns((previous) => ({ ...previous, [key]: !previous[key as keyof typeof previous] }))} />{key}</label>)}</div></details>
            </div>

            {selected.size > 0 && <div className="kf-bulk-bar"><span>{selected.size} selected</span><button onClick={() => runBulk("scan")}>Scan</button><button onClick={() => runBulk("test")}>Test</button><button onClick={() => runBulk("build")}>Build</button><button onClick={() => setSelected(new Set())}>Clear</button></div>}

            <div className="kf-group-header"><button onClick={() => setOpenGroups((state) => ({ ...state, active: !state.active }))}>{openGroups.active ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<span>Local projects</span><small>{filteredProjects.length}</small></button><span>Local workspace: {workspace?.root || "Loading…"}</span></div>
            {openGroups.active && (
              loading ? <WorkspaceLoading /> : filteredProjects.length === 0 ? <WorkspaceEmpty onOpen={() => setModal("open")} /> : (
                <div className="kf-table-wrap" tabIndex={0} onKeyDown={(event) => {
                  const index = filteredProjects.findIndex((project) => project.id === activeProjectId);
                  if (event.key === "ArrowDown" && index < filteredProjects.length - 1) { event.preventDefault(); setActiveProjectId(filteredProjects[index + 1].id); }
                  if (event.key === "ArrowUp" && index > 0) { event.preventDefault(); setActiveProjectId(filteredProjects[index - 1].id); }
                  if (event.key === " " && activeProjectId) { event.preventDefault(); toggleSelected(activeProjectId); }
                }}>
                  <table className="kf-table"><thead><tr><th><input aria-label="Select all filtered projects" type="checkbox" checked={allFilteredSelected} onChange={() => setSelected(allFilteredSelected ? new Set() : new Set(filteredProjects.map((project) => project.id)))} /></th><SortableHeader label="Project" onClick={() => updateSort("name")} active={sort.key === "name"} />{columns.type && <SortableHeader label="Type" onClick={() => updateSort("projectType")} active={sort.key === "projectType"} />}{columns.branch && <SortableHeader label="Branch" onClick={() => updateSort("branch")} active={sort.key === "branch"} />}{columns.status && <th>Health & checks</th>}{columns.git && <SortableHeader label="Git sync" onClick={() => updateSort("sync")} active={sort.key === "sync"} />}{columns.activity && <SortableHeader label="Last activity" onClick={() => updateSort("lastActivity")} active={sort.key === "lastActivity"} />}<th aria-label="Actions" /></tr></thead>
                  <tbody>{filteredProjects.map((project) => <ProjectRow key={project.id} project={project} selected={selected.has(project.id)} active={project.id === activeProjectId} scan={scans[project.id]} results={actionResults[project.id]} columns={columns} onSelect={() => toggleSelected(project.id)} onActivate={() => setActiveProjectId(project.id)} onRun={(action) => void runAction(project, action)} onCollectionUpdate={(patch) => void updateProjectCollection(project, patch)} onEditTags={() => editProjectTags(project)} />)}</tbody></table>
                </div>
              )
            )}
            <div className="kf-group-header kf-group-header--collapsed"><button onClick={() => setOpenGroups((state) => ({ ...state, others: !state.others }))}>{openGroups.others ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<span>Connected & recent</span><small>{projects.filter((project) => project.provider === "GitHub").length}</small></button><span>{openGroups.others ? "GitHub-connected repositories appear in the local projects list." : ""}</span></div>
          </section>

          {activeProject && activeNav !== "Workspace" && <CapabilitySurface activeNav={activeNav} project={activeProject} projects={projects} scan={activeScan} tasks={activeTaskList} results={actionResults[activeProject.id]} platform={localPlatform} onPlatformModeChange={(mode) => void setPlatformMode(mode)} onOpenProject={() => setModal("open")} onRun={(action) => void runAction(activeProject, action)} onTaskControl={(task, control) => void controlTask(task, control)} onTrust={() => void approveProjectTrust(activeProject)} />}
          {activeProject && <ProjectInspectorV2 project={activeProject} scan={activeScan} results={actionResults[activeProject.id]} tasks={activeTaskList} onRun={(action) => void runAction(activeProject, action)} onTaskControl={(task, control) => void controlTask(task, control)} />}
        </section>
      </main>

      {commandOpen && <div className="kf-overlay" role="dialog" aria-modal="true" aria-label="KForge command palette"><div className="kf-command-palette"><div className="kf-command-input"><Command size={18} /><input autoFocus aria-label="Search commands and local workspace" placeholder="Search commands, files, problems, tasks…" value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} /><button aria-label="Close command palette" onClick={() => setCommandOpen(false)}><X size={16} /></button></div><div className="kf-command-list">{commandItems.map((command) => <button key={command.label} onClick={() => executeCommand(command.label, command.callback)}><span>{command.label}</span><small>{command.meta}</small></button>)}{globalSearchLoading && <p role="status">Searching local workspace…</p>}{globalResults.map((result) => <button key={`${result.projectId}:${result.kind}:${result.title}:${result.detail}`} onClick={() => { setActiveProjectId(result.projectId); setCommandOpen(false); setCommandQuery(""); }}><span>{result.title}</span><small>{result.kind} · {result.detail}</small></button>)}{commandItems.length === 0 && !globalSearchLoading && globalResults.length === 0 && <p>No local result found.</p>}</div><p className="kf-command-help"><kbd>Ctrl/Cmd K</kbd> search · <kbd>Esc</kbd> close</p></div></div>}
      {modal && <ProjectModal mode={modal} localPath={localPath} setLocalPath={setLocalPath} remoteUrl={remoteUrl} setRemoteUrl={setRemoteUrl} targetName={targetName} setTargetName={setTargetName} submitting={submitting} onClose={() => setModal(null)} onSubmit={modal === "open" ? () => void openProject() : () => void cloneProject()} />}
    </div>
  );
}

function EyeIcon() { return <span className="kf-eye-icon">◉</span>; }

function SortableHeader({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) { return <th><button className={`kf-sort-button ${active ? "is-active" : ""}`} onClick={onClick}>{label}<ArrowDownUp size={13} /></button></th>; }

function ProjectRow({ project, selected, active, scan, results, columns, onSelect, onActivate, onRun, onCollectionUpdate, onEditTags }: { project: ProjectSummary; selected: boolean; active: boolean; scan?: ProjectScan; results?: Partial<Record<WorkspaceAction, CommandResult>>; columns: Record<string, boolean>; onSelect: () => void; onActivate: () => void; onRun: (action: WorkspaceAction) => void; onCollectionUpdate: (patch: Partial<Pick<ProjectSummary, "favorite" | "pinned" | "archived" | "tags">>) => void; onEditTags: () => void }) {
  const security = scan?.summaries.security || "unknown";
  const tests = results?.test?.ok ? "pass" : results?.test ? "fail" : "unknown";
  const build = results?.build?.ok ? "pass" : results?.build ? "fail" : "unknown";
  return <tr className={`${active ? "is-active" : ""} ${selected ? "is-selected" : ""}`} onClick={onActivate}><td onClick={(event) => event.stopPropagation()}><input aria-label={`Select ${project.name}`} type="checkbox" checked={selected} onChange={onSelect} /></td><td><button className="kf-project-cell" onClick={onActivate}><span className="kf-project-icon"><ProviderMark provider={project.provider} /></span><span><strong>{project.name}</strong><small title={project.path}>{project.trust === "untrusted" ? "Untrusted · read only" : "Trusted local execution"} · {project.path}{project.tags.length ? ` · labels: ${project.tags.join(", ")}` : ""}</small></span></button></td>{columns.type && <td><span className="kf-type-pill">{project.projectType}</span></td>}{columns.branch && <td><span className="kf-branch"><GitBranch size={13} />{project.branch}</span></td>}{columns.status && <td><div className="kf-checks"><span className={statusClass(security)} title="Security"><ShieldAlert size={12} />{statusLabel(security)}</span><span className={statusClass(tests)} title="Tests"><TestTube2 size={12} />{statusLabel(tests)}</span><span className={statusClass(build)} title="Build"><Play size={12} />{statusLabel(build)}</span></div></td>}{columns.git && <td><GitState project={project} /></td>}{columns.activity && <td><span className="kf-date"><Clock3 size={13} />{formatDate(project.lastActivity)}</span></td>}<td onClick={(event) => event.stopPropagation()}><details className="kf-row-menu"><summary aria-label={`Actions for ${project.name}`}><MoreHorizontal size={18} /></summary><div><button onClick={() => onRun("scan")}>Scan project</button><button onClick={() => onRun("test")}>Run tests</button><button onClick={() => onRun("build")}>Run build</button><button onClick={onEditTags}>Edit labels</button><button onClick={() => onCollectionUpdate({ favorite: !project.favorite })}>{project.favorite ? "Remove favorite" : "Add favorite"}</button><button onClick={() => onCollectionUpdate({ pinned: !project.pinned })}>{project.pinned ? "Unpin project" : "Pin project"}</button><button onClick={() => onCollectionUpdate({ archived: !project.archived })}>{project.archived ? "Restore from archive" : "Archive project"}</button>{project.remoteUrl && <a href={project.remoteUrl} target="_blank" rel="noreferrer">Open remote</a>}</div></details></td></tr>;
}

function GitState({ project }: { project: ProjectSummary }) { const changed = project.modifiedFiles + project.untrackedFiles; return <div className="kf-git-state"><span className={changed ? "is-warning" : "is-good"}>{changed ? `${changed} changed` : "Clean"}</span>{project.behind > 0 && <small>{project.behind} behind</small>}{project.ahead > 0 && <small>{project.ahead} ahead</small>}</div>; }

function ProjectInspector({ project, scan, results, tasks, onRun, onTaskControl }: { project: ProjectSummary; scan?: ProjectScan; results?: Partial<Record<WorkspaceAction, CommandResult>>; tasks: TaskItem[]; onRun: (action: WorkspaceAction) => void; onTaskControl: (task: TaskItem, control: "cancel" | "retry" | "resume" | "rollback") => void }) {
  const issues = scan?.issues || [];
  const critical = issues.filter((issue) => issue.severity === "critical" || issue.severity === "high");
  const health = scan?.health.score;
  return <section className="kf-inspector"><div className="kf-inspector-header"><div><p className="kf-eyebrow">Project intelligence</p><h2>{project.name}</h2><p>{project.path}</p></div><div className="kf-inspector-actions"><button className="kf-button kf-button--primary" onClick={() => onRun("scan")}><ShieldAlert size={16} />Scan</button><button className="kf-button kf-button--ghost" onClick={() => onRun("test")}><TestTube2 size={16} />Test</button><button className="kf-button kf-button--ghost" onClick={() => onRun("build")}><Play size={16} />Build</button></div></div>
  <div className="kf-metrics"><Metric icon={<HeartPulse size={18} />} label="Project health" value={health === undefined ? "Not scanned" : `${health}%`} tone={health === undefined ? "neutral" : health >= 85 ? "good" : health >= 60 ? "warning" : "bad"} /><Metric icon={<ShieldAlert size={18} />} label="Security" value={scan ? `${critical.length} priority` : "Not scanned"} tone={critical.length ? "bad" : scan ? "good" : "neutral"} /><Metric icon={<TestTube2 size={18} />} label="Tests" value={results?.test ? (results.test.ok ? "Pass" : "Failed") : "Not run"} tone={!results?.test ? "neutral" : results.test.ok ? "good" : "bad"} /><Metric icon={<Play size={18} />} label="Build" value={results?.build ? (results.build.ok ? "Pass" : "Failed") : "Not run"} tone={!results?.build ? "neutral" : results.build.ok ? "good" : "bad"} /><Metric icon={<GitBranch size={18} />} label="Git" value={project.modifiedFiles + project.untrackedFiles ? `${project.modifiedFiles + project.untrackedFiles} changes` : "Clean"} tone={project.modifiedFiles + project.untrackedFiles ? "warning" : "good"} /></div>
  <div className="kf-inspector-grid"><article className="kf-inspector-card"><div className="kf-card-heading"><div><ShieldAlert size={17} /><h3>KForge Sonar</h3></div>{scan && <span>Last scan {formatDate(scan.scannedAt)}</span>}</div>{!scan ? <div className="kf-card-empty"><p>No audit result is loaded for this project.</p><button onClick={() => onRun("scan")}>Run full scan</button></div> : issues.length === 0 ? <div className="kf-card-empty kf-card-empty--good"><p>No security, dependency, or local Git findings were detected by this scan.</p></div> : <div className="kf-issues">{issues.slice(0, 5).map((issue) => <details key={issue.id} className="kf-issue"><summary><span className={`kf-severity kf-severity--${issue.severity}`}>{issue.severity}</span><span><strong>{issue.title}</strong><small>{issue.file || issue.category}</small></span><ChevronRight size={15} /></summary><div><p>{issue.message}</p>{issue.suggestion && <p className="kf-suggestion"><Wrench size={14} />{issue.suggestion}</p>}</div></details>)}</div>}</article>
  <article className="kf-inspector-card"><div className="kf-card-heading"><div><Bot size={17} /><h3>Agent workspace</h3></div><span>Task center</span></div>{tasks.length === 0 ? <div className="kf-card-empty"><p>Actions initiated in KForge are tracked here with their real command output.</p><button onClick={() => onRun("scan")}>Start audit task</button></div> : <div className="kf-task-list">{tasks.map((task) => <details key={task.id} className={`kf-task kf-task--${task.state}`}><summary><span className="kf-task-indicator">{task.state === "running" ? <RefreshCw size={14} className="kf-spin" /> : <Activity size={14} />}</span><span><strong>{task.action} · {task.state === "success" ? "completed" : task.state}</strong><small>{task.message} · {task.progress}%{task.finishedAt ? ` · ${Math.max(0, Math.round((new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime()) / 1000))}s` : ""}</small></span><ChevronRight size={15} /></summary><pre>{task.output || "Waiting for command output…"}</pre><div className="kf-task-controls">{task.state === "queued" && <button onClick={() => onTaskControl(task, "cancel")}>Cancel</button>}{(task.state === "success" || task.state === "error" || task.state === "cancelled" || task.state === "blocked") && <button onClick={() => onTaskControl(task, "retry")}>Retry</button>}{task.mission?.recovery.resume && (task.state === "blocked" || task.state === "error") && <button onClick={() => onTaskControl(task, "resume")}>Resume</button>}{task.mission?.recovery.rollback && <button onClick={() => onTaskControl(task, "rollback")}>Rollback</button>}</div></details>)}</div>}</article></div></section>;
}

function CapabilitySurface({ activeNav, project, projects, scan, tasks, results, platform, onPlatformModeChange, onOpenProject, onRun, onTaskControl, onTrust }: { activeNav: string; project: ProjectSummary; projects: ProjectSummary[]; scan?: ProjectScan; tasks: TaskItem[]; results?: Partial<Record<WorkspaceAction, CommandResult>>; platform?: LocalPlatformStatus; onPlatformModeChange: (mode: LocalPlatformStatus["mode"]) => void; onOpenProject: () => void; onRun: (action: WorkspaceAction) => void; onTaskControl: (task: TaskItem, control: "cancel" | "retry" | "resume" | "rollback") => void; onTrust: () => void }) {
  if (activeNav === "Project health") return <ProjectHealthPanel project={project} />;
  if (activeNav === "Recent projects") return <RecentProjectsPanel projects={projects} />;
  if (activeNav === "Favorites") return <CollectionProjectsPanel title="Favorite Projects" projects={projects.filter((entry) => entry.categories.favorite)} empty="No projects have been marked as favorite in the local workspace." icon={<Star size={17} />} />;
  if (activeNav === "Pinned") return <CollectionProjectsPanel title="Pinned Projects" projects={projects.filter((entry) => entry.categories.pinned && !entry.archived)} empty="No projects have been pinned in the local workspace." icon={<Pin size={17} />} />;
  if (activeNav === "Archive") return <CollectionProjectsPanel title="Archived Projects" projects={projects.filter((entry) => entry.categories.archive)} empty="No projects have been archived in the local workspace." icon={<Archive size={17} />} />;
  if (activeNav === "Open project" || activeNav === "Import project") return <OpenProjectPanel onOpen={onOpenProject} />;
  if (activeNav === "Trust") return <TrustPanel project={project} onTrust={onTrust} />;
  if (activeNav === "Permissions") return <PermissionsPanel project={project} />;
  if (activeNav === "Storage") return <StoragePanel project={project} />;
  if (activeNav === "Offline / Online") return <LocalPlatformPanel platform={platform} onModeChange={onPlatformModeChange} />;
  if (activeNav === "System diagnostics") return <SystemDiagnosticsPanel platform={platform} />;
  if (activeNav === "Terminal") return <TerminalOperationsPanel project={project} results={results} tasks={tasks} onRun={onRun} />;
  if (activeNav === "Tests") return <DeveloperActionPanel title="Test Lab" description="Runs the detected local test command for the selected project and records actual stdout, stderr, exit state, and duration." action="test" result={results?.test} tasks={tasks} onRun={onRun} />;
  if (activeNav === "Build") return <DeveloperActionPanel title="Build Center" description="Runs the project’s detected build command. No package manager or build result is assumed when discovery has not found one." action="build" result={results?.build} tasks={tasks} onRun={onRun} />;
  if (activeNav === "Runtime") return <DeveloperActionPanel title="Runtime Verification" description="Runs the detected bounded runtime verification and captures its actual output, exit state, and duration." action="runtime" result={results?.runtime} tasks={tasks} onRun={onRun} />;
  if (activeNav === "Logs") return <TaskCenterPanel tasks={tasks} onTaskControl={onTaskControl} />;
  if (activeNav === "Diagnostics") return <QualityPanel title="Diagnostics" scan={scan} onScan={() => onRun("scan")} />;
  if (activeNav === "Git" || activeNav === "Branches" || activeNav === "Commits") return <GitCenterPanel project={project} />;
  if (["GitHub", "Pull requests", "Issues", "Actions", "Releases"].includes(activeNav)) return <GitHubCenterPanel project={project} onlineOptional={platform?.mode === "online-optional"} />;
  if (activeNav === "Solutions") return <SolutionsPanel scan={scan} onScan={() => onRun("scan")} />;
  if (activeNav === "Snapshots") return <SnapshotsPanel project={project} />;
  return <CapabilityPanel activeNav={activeNav} project={project} scan={scan} tasks={tasks} platform={platform} onPlatformModeChange={onPlatformModeChange} onRun={onRun} onTaskControl={onTaskControl} />;
}

function ProjectHealthPanel({ project }: { project: ProjectSummary }) {
  const [data, setData] = useState<{ health: { score: number | null; evidenceCoverage: number; calculatedAt: string; metrics: Array<{ key: string; label: string; status: WorkspaceStatus; score: number | null; weight: number; evidence: string[]; findings: string[]; lastScan: string; evidenceSource: string; evidenceAgeMs: number; freshness: "current-scan" | "live-task" | "persisted-task" | "unknown" }>; release: { state: string; blockers: Array<{ title: string; source: string; file?: string }>; warnings: Array<{ title: string; source: string; file?: string }>; evidence: string[] } }; scannedAt: string; issueCount: number; tools: Array<{ name: string; available: boolean; version?: string; reason?: string }> } | null>(null);
  const [message, setMessage] = useState("Loading Project Health from local evidence…");
  const refresh = async () => { try { setMessage("Recalculating local health evidence…"); const response = await fetch(`/api/workspace/projects/${project.id}/health`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Project Health is unavailable."); setData(payload); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Project Health request failed."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  const health = data?.health;
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><HeartPulse size={17} /><h3>Project Health</h3></div><button onClick={() => void refresh()}>Refresh evidence</button></div>{message && <p className="kf-capability-message">{message}</p>}{health ? <><div className="kf-hardware-grid"><span><strong>Health score</strong>{health.score === null ? "Evidence pending" : `${health.score}%`}</span><span><strong>Evidence coverage</strong>{health.evidenceCoverage}%</span><span><strong>Findings</strong>{data.issueCount}</span><span><strong>Release</strong>{health.release.state}</span></div><p className="kf-capability-copy">Calculated {formatDate(health.calculatedAt)} from local scan, command evidence, Git state, configuration, dependency, documentation, and architecture evidence. Every metric lists its source evidence below.</p><div className="kf-issues">{health.metrics.map((metric) => <details className="kf-issue" key={metric.key}><summary><span className={statusClass(metric.status)}>{statusLabel(metric.status)}</span><span><strong>{metric.label}</strong><small>{metric.score === null ? "No score" : `${metric.score}%`} · weight {metric.weight} · {metric.freshness} · {Math.round(metric.evidenceAgeMs / 1000)}s old</small></span><ChevronRight size={15} /></summary><div><p><strong>Evidence</strong></p><p className="kf-capability-copy">Source: {metric.evidenceSource} · freshness: {metric.freshness} · captured {formatDate(metric.lastScan)}</p><pre>{metric.evidence.length ? metric.evidence.join("\n") : "No measured evidence is available for this metric."}</pre>{metric.findings.length ? <><p><strong>Findings</strong></p><pre>{metric.findings.join("\n")}</pre></> : <p className="kf-capability-copy">No findings were recorded for this metric.</p>}</div></details>)}</div><article className="kf-command-evidence"><strong>Release decision · {health.release.state}</strong><pre>{JSON.stringify({ blockers: health.release.blockers, warnings: health.release.warnings, evidence: health.release.evidence }, null, 2)}</pre></article><article className="kf-command-evidence"><strong>Local tool availability</strong><pre>{JSON.stringify(data.tools, null, 2)}</pre></article></> : <p className="kf-capability-copy">{message || "No Project Health evidence is loaded."}</p>}</section>;
}

function RecentProjectsPanel({ projects }: { projects: ProjectSummary[] }) {
  const recent = [...projects].filter((entry) => entry.categories.recent && !entry.archived).sort((left, right) => new Date(right.lastOpenedAt || 0).getTime() - new Date(left.lastOpenedAt || 0).getTime()).slice(0, 12);
  return <CollectionProjectsPanel title="Recent Projects" projects={recent} empty="No projects have been opened in this local KForge workspace yet." icon={<History size={17} />} />;
}

function CollectionProjectsPanel({ title, projects, empty, icon }: { title: string; projects: ProjectSummary[]; empty: string; icon: React.ReactNode }) {
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div>{icon}<h3>{title}</h3></div><span>{projects.length} local record(s)</span></div>{projects.length ? <div className="kf-provider-grid">{projects.map((entry) => <article className="kf-provider-card" key={entry.id}><div><strong>{entry.name}</strong><span>{entry.projectType}</span></div><p>{entry.path}</p><small>{entry.branch} · {formatDate(entry.lastOpenedAt || entry.lastActivity)} · {entry.trust === "trusted" ? "trusted" : "read-only"}</small></article>)}</div> : <p className="kf-capability-copy">{empty}</p>}</section>;
}

function OpenProjectPanel({ onOpen }: { onOpen: () => void }) { return <section className="kf-capability-panel"><div className="kf-card-heading"><div><FolderOpen size={17} /><h3>Open Local Project</h3></div><span>Discovery on open</span></div><p className="kf-capability-copy">Choose a local folder. KForge detects technologies, source roots, package manager, scripts, Git state, remotes, Docker, environment files, and local test/build evidence before it is listed.</p><button className="kf-button kf-button--primary" onClick={onOpen}><FolderOpen size={16} />Choose local folder</button></section>; }

function TrustPanel({ project, onTrust }: { project: ProjectSummary; onTrust: () => void }) {
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><ShieldAlert size={17} /><h3>Project Trust</h3></div><span>{project.trust}</span></div><p className="kf-capability-copy">Untrusted projects remain read-only: KForge can inspect files, build evidence, and list diagnostics, but it blocks command execution and write-capable repair flows until explicit local approval.</p><div className="kf-hardware-grid"><span><strong>Current trust</strong>{project.trust}</span><span><strong>Path</strong>{project.path}</span><span><strong>Write operations</strong>{project.trust === "trusted" ? "Permission-gated" : "Blocked"}</span></div>{project.trust === "untrusted" ? <button className="kf-button kf-button--primary" onClick={onTrust}>Trust local execution</button> : <p className="kf-capability-copy">This project is trusted. Remote actions and destructive operations still require their own confirmation gates.</p>}</section>;
}

function PermissionsPanel({ project }: { project: ProjectSummary }) {
  const [registry, setRegistry] = useState<{ tools?: Array<{ id: string; label: string; permission: string; available: boolean; reason?: string }>; permissions?: Record<string, string> } | null>(null);
  const [message, setMessage] = useState("Loading registered agent tool permissions…");
  const refresh = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/agent/tools`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Permissions registry is unavailable."); setRegistry(payload); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Permissions registry failed."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><ShieldAlert size={17} /><h3>Permissions</h3></div><button onClick={() => void refresh()}>Refresh registry</button></div>{message && <p className="kf-capability-message">{message}</p>}{registry && <><div className="kf-provider-grid">{(registry.tools || []).map((tool) => <article className="kf-provider-card" key={tool.id}><div><strong>{tool.label}</strong><span>{tool.permission}</span></div><p>{tool.available ? "Available" : "Unavailable"}</p><small>{tool.reason || "Registered local capability"}</small></article>)}</div><article className="kf-command-evidence"><strong>Policy evidence</strong><pre>{JSON.stringify(registry.permissions, null, 2)}</pre></article></>}</section>;
}

function StoragePanel({ project }: { project: ProjectSummary }) {
  const [entries, setEntries] = useState<Array<{ path: string; bytes?: number; modifiedAt?: string }> | null>(null);
  const [message, setMessage] = useState("Reading KForge cache status…");
  const refresh = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/cache`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Cache status is unavailable."); setEntries(payload.entries || []); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Cache status failed."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  const clear = async () => { if (project.trust !== "trusted") { setMessage("UNTRUSTED PROJECT: cache clearing is blocked until explicit trust approval."); return; } if (!window.confirm("Clear only KForge project cache entries? Project source files are not affected.")) return; try { const response = await fetch(`/api/workspace/projects/${project.id}/cache/clear`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Cache clear failed."); setMessage("KForge project cache cleared."); await refresh(); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Cache clear failed."); } };
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Box size={17} /><h3>Local Storage & Cache</h3></div><button onClick={() => void refresh()}>Refresh</button></div><p className="kf-capability-copy">This panel reports KForge-managed cache entries only. It never claims ownership of package-manager, build, or user files outside the configured cache engine.</p>{message && <p className="kf-capability-message">{message}</p>}<div className="kf-provider-grid">{entries?.map((entry) => <article className="kf-provider-card" key={entry.path}><div><strong>{entry.path}</strong><span>{entry.bytes === undefined ? "size unavailable" : `${Math.round(entry.bytes / 1024)} KB`}</span></div><small>{entry.modifiedAt ? formatDate(entry.modifiedAt) : "timestamp unavailable"}</small></article>)}</div>{entries?.length === 0 && <p className="kf-capability-copy">No KForge cache entry is currently reported for this project.</p>}<button className="kf-button kf-button--ghost" onClick={() => void clear()}>Clear KForge cache</button></section>;
}

function SystemDiagnosticsPanel({ platform }: { platform?: LocalPlatformStatus }) {
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Activity size={17} /><h3>System Diagnostics</h3></div><span>{platform?.mode || "Loading"}</span></div>{platform ? <><p className="kf-capability-copy">Diagnostics describe local capabilities and their measured availability. Missing tools remain unavailable rather than being represented as successful.</p><div className="kf-provider-grid">{platform.capabilities.map((capability) => <article className="kf-provider-card" key={capability.id}><div><strong>{capability.label}</strong><span>{capability.state}</span></div><small>{capability.detail}</small></article>)}</div></> : <p className="kf-capability-copy">Loading local platform diagnostics…</p>}</section>;
}

function TerminalOperationsPanel({ project, results, tasks, onRun }: { project: ProjectSummary; results?: Partial<Record<WorkspaceAction, CommandResult>>; tasks: TaskItem[]; onRun: (action: WorkspaceAction) => void }) { return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Terminal size={17} /><h3>Local Command Center</h3></div><span>Scoped to {project.name}</span></div><p className="kf-capability-copy">KForge executes only detected project actions from the selected local repository. Output below comes from real local processes; arbitrary shell input is intentionally not exposed in this browser workspace.</p><div className="kf-inline-controls"><button onClick={() => onRun("typecheck")}>Typecheck</button><button onClick={() => onRun("test")}>Run tests</button><button onClick={() => onRun("build")}>Run build</button><button onClick={() => onRun("runtime")}>Runtime check</button></div><ExecutionEvidence results={results} tasks={tasks} /></section>; }

function DeveloperActionPanel({ title, description, action, result, tasks, onRun }: { title: string; description: string; action: WorkspaceAction; result?: CommandResult; tasks: TaskItem[]; onRun: (action: WorkspaceAction) => void }) { const matching = tasks.filter((task) => task.action === action); return <section className="kf-capability-panel"><div className="kf-card-heading"><div>{action === "test" ? <TestTube2 size={17} /> : <Play size={17} />}<h3>{title}</h3></div><span>Detected local action</span></div><p className="kf-capability-copy">{description}</p><button className="kf-button kf-button--primary" onClick={() => onRun(action)}>Run {action}</button>{result && <article className="kf-command-evidence"><strong>{result.ok ? "PASS" : "FAILED"} · {result.action}</strong><small>{result.message}</small><pre>{result.output || "The local process completed without captured output."}</pre></article>}{matching.map((task) => <article className="kf-command-evidence" key={task.id}><strong>{task.action} · {task.state}</strong><small>{task.message} · {task.progress}%</small><pre>{task.output || "Waiting for local process output…"}</pre></article>)}</section>; }

function ExecutionEvidence({ results, tasks }: { results?: Partial<Record<WorkspaceAction, CommandResult>>; tasks: TaskItem[] }) { const actualResults = Object.values(results || {}).filter((entry): entry is CommandResult => Boolean(entry)); return <div className="kf-task-list">{actualResults.map((result) => <article className="kf-command-evidence" key={`${result.action}:${result.completedAt}`}><strong>{result.action} · {result.ok ? "PASS" : "FAILED"}</strong><small>{result.message}</small><pre>{result.output || "No process output was captured."}</pre></article>)}{tasks.map((task) => <article className="kf-command-evidence" key={task.id}><strong>{task.action} · {task.state}</strong><small>{task.message} · {task.progress}%</small><pre>{task.output || "Waiting for local process output…"}</pre></article>)}{actualResults.length === 0 && tasks.length === 0 && <p className="kf-capability-copy">No local command has run from this session yet.</p>}</div>; }

function GitCenterPanel({ project }: { project: ProjectSummary }) {
  const [data, setData] = useState<{ branch?: string; remoteUrl?: string; status?: string; diffStat?: string; branches?: string[]; commits?: Array<{ sha: string; shortSha: string; subject: string; committedAt: string }>; stashes?: string[]; tags?: string[] } | null>(null);
  const [proposal, setProposal] = useState<{ title: string; description: string; changedFiles: Array<{ status: string; file: string }>; diffStat: string; validations: Array<{ action: string; ok: boolean; completedAt: string; message: string }> } | null>(null);
  const [prePush, setPrePush] = useState<unknown>(null);
  const [branchName, setBranchName] = useState("");
  const [message, setMessage] = useState("Loading local Git evidence…");
  const refresh = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/git`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Git evidence is unavailable."); setData(payload); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Git request failed."); } };
  useEffect(() => { void refresh(); setProposal(null); setPrePush(null); }, [project.id]);
  const createBranch = async () => { const name = branchName.trim(); if (!name || !window.confirm(`Create local branch ${name}?`)) return; try { const response = await fetch(`/api/workspace/projects/${project.id}/git/branches`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, confirmed: true }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Branch creation failed."); setBranchName(""); setMessage(payload.message || `Branch ${name} created.`); await refresh(); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Branch creation failed."); } };
  const loadProposal = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/commit-preview`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Smart Commit evidence is unavailable."); setProposal(payload.proposal); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Smart Commit request failed."); } };
  const runPrePush = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/pre-push-gate`, { method: "POST" }); const payload = await response.json(); setPrePush(payload); if (!response.ok) setMessage(payload.error || "Pre-push gate is blocked; inspect its evidence below."); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Pre-push gate failed."); } };
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><GitBranch size={17} /><h3>Git Center</h3></div><button onClick={() => void refresh()}>Refresh</button></div>{message && <p className="kf-capability-message">{message}</p>}{data && <><div className="kf-hardware-grid"><span><strong>Branch</strong>{data.branch || "Unavailable"}</span><span><strong>Remote</strong>{data.remoteUrl || "No remote"}</span><span><strong>Stashes</strong>{data.stashes?.length || 0}</span><span><strong>Tags</strong>{data.tags?.length || 0}</span></div><article className="kf-command-evidence"><strong>Working tree</strong><pre>{data.status || "No Git status output."}</pre></article><article className="kf-command-evidence"><strong>Diff stat</strong><pre>{data.diffStat || "Clean working tree."}</pre></article><div className="kf-inline-controls"><input value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="feature/branch-name" aria-label="New local branch name" /><button onClick={() => void createBranch()}>Create branch</button><button onClick={() => void loadProposal()}>Smart Commit preview</button><button onClick={() => void runPrePush()}>Run Pre-push Gate</button></div>{proposal && <article className="kf-command-evidence"><strong>{proposal.title}</strong><small>{proposal.description}</small><pre>{JSON.stringify({ changedFiles: proposal.changedFiles, diffStat: proposal.diffStat, validations: proposal.validations }, null, 2)}</pre></article>}{prePush && <article className="kf-command-evidence"><strong>Pre-push verification</strong><pre>{JSON.stringify(prePush, null, 2)}</pre></article>}<div className="kf-provider-grid">{(data.commits || []).slice(0, 8).map((commit) => <article className="kf-provider-card" key={commit.sha}><div><strong>{commit.subject}</strong><span>{commit.shortSha}</span></div><small>{formatDate(commit.committedAt)}</small></article>)}{(data.tags || []).slice(0, 8).map((tag) => <article className="kf-provider-card" key={`tag-${tag}`}><div><strong>{tag}</strong><span>Tag</span></div></article>)}</div></>}</section>;
}

function GitHubCenterPanel({ project, onlineOptional }: { project: ProjectSummary; onlineOptional: boolean }) {
  const [data, setData] = useState<{ slug?: string; repository?: { full_name?: string; default_branch?: string; open_issues_count?: number; error?: string }; issues?: Array<{ number: number; title: string }> | { error?: string }; pullRequests?: Array<{ number: number; title: string }> | { error?: string }; actions?: { workflow_runs?: Array<{ id: number; name: string; status: string; conclusion?: string }> } | { error?: string }; releases?: Array<{ id: number; name?: string; tag_name?: string; draft?: boolean; prerelease?: boolean }> | { error?: string } } | null>(null);
  const [message, setMessage] = useState(onlineOptional ? "Ready to load GitHub metadata after an explicit refresh." : "GitHub metadata stays disabled in Offline Mode.");
  const refresh = async () => { if (!onlineOptional) { setMessage("Enable Online Optional before loading GitHub metadata. Local Git remains available offline."); return; } try { const response = await fetch(`/api/workspace/projects/${project.id}/github`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "GitHub metadata is unavailable."); setData(payload); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "GitHub request failed."); } };
  useEffect(() => { setData(null); setMessage(onlineOptional ? "Ready to load GitHub metadata after an explicit refresh." : "GitHub metadata stays disabled in Offline Mode."); }, [project.id, onlineOptional]);
  const issues = Array.isArray(data?.issues) ? data.issues : []; const pulls = Array.isArray(data?.pullRequests) ? data.pullRequests : []; const runs = data?.actions && "workflow_runs" in data.actions ? data.actions.workflow_runs || [] : []; const releases = Array.isArray(data?.releases) ? data.releases : [];
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Github size={17} /><h3>GitHub Center</h3></div><button disabled={!onlineOptional} onClick={() => void refresh()}>Load metadata</button></div><p className="kf-capability-copy">Remote data is never requested in Offline Mode. Push, pull-request creation, releases, and other destructive remote actions remain behind explicit confirmation gates.</p>{message && <p className="kf-capability-message">{message}</p>}{data && <><div className="kf-hardware-grid"><span><strong>Repository</strong>{data.repository?.full_name || data.slug || "Unavailable"}</span><span><strong>Default branch</strong>{data.repository?.default_branch || "Unavailable"}</span><span><strong>Open issues</strong>{data.repository?.open_issues_count ?? "Unavailable"}</span></div><div className="kf-provider-grid">{issues.slice(0, 6).map((issue) => <article className="kf-provider-card" key={`issue-${issue.number}`}><div><strong>#{issue.number} {issue.title}</strong><span>Issue</span></div></article>)}{pulls.slice(0, 6).map((pull) => <article className="kf-provider-card" key={`pr-${pull.number}`}><div><strong>#{pull.number} {pull.title}</strong><span>Pull request</span></div></article>)}{runs.slice(0, 6).map((run) => <article className="kf-provider-card" key={run.id}><div><strong>{run.name}</strong><span>{run.conclusion || run.status}</span></div></article>)}{releases.slice(0, 6).map((release) => <article className="kf-provider-card" key={`release-${release.id}`}><div><strong>{release.name || release.tag_name || "Untitled release"}</strong><span>{release.draft ? "draft" : release.prerelease ? "pre-release" : "release"}</span></div><small>{release.tag_name || "No tag reported"}</small></article>)}</div></>}</section>;
}

function SolutionsPanel({ scan, onScan }: { scan?: ProjectScan; onScan: () => void }) { const automatic = (scan?.issues || []).filter((entry) => entry.fixability === "automatic"); return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Wrench size={17} /><h3>Solutions Engine</h3></div><button onClick={onScan}>Refresh evidence</button></div><p className="kf-capability-copy">KForge exposes only fixes with a verified preview path. A safe patch creates a snapshot first, verifies detected commands, and restores the snapshot on verification failure.</p>{!scan ? <p className="kf-capability-copy">No scan evidence is loaded. Run a local scan before a solution can be classified.</p> : automatic.length ? <div className="kf-issues">{automatic.map((entry) => <details className="kf-issue" key={entry.id}><summary><span className={`kf-severity kf-severity--${entry.severity}`}>{entry.severity}</span><span><strong>{entry.title}</strong><small>Automatic preview available · {entry.file || entry.category}</small></span><ChevronRight size={15} /></summary><p>{entry.suggestion || entry.message}</p><p className="kf-suggestion"><Wrench size={14} />Open this issue in the Problems Center to preview, apply, and verify its safe patch.</p></details>)}</div> : <p className="kf-capability-copy">The current evidence contains no automatic patch. KForge will not invent a fix; use Problems for explanation and guided review.</p>}</section>; }

function SnapshotsPanel({ project }: { project: ProjectSummary }) {
  const [snapshots, setSnapshots] = useState<Array<{ id: string; createdAt: string; reason: string; files: string[] }> | null>(null);
  const [files, setFiles] = useState("");
  const [reason, setReason] = useState("Manual KForge recovery point");
  const [message, setMessage] = useState("Loading local recovery snapshots…");
  const refresh = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/snapshots`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Snapshots are unavailable."); setSnapshots(payload.snapshots || []); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Snapshot request failed."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  const create = async () => { const selected = files.split(/[,\n]/).map((entry) => entry.trim()).filter(Boolean); if (!selected.length) { setMessage("Add one or more project-relative files to create a snapshot."); return; } if (!window.confirm(`Create a local snapshot of ${selected.length} file(s) before making changes?`)) return; try { const response = await fetch(`/api/workspace/projects/${project.id}/snapshots`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: selected, reason }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Snapshot could not be created."); setFiles(""); setMessage(`Snapshot ${payload.snapshot?.id || "created"} is ready for recovery.`); await refresh(); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Snapshot creation failed."); } };
  const restore = async (snapshot: { id: string; files: string[] }) => { if (!window.confirm(`Restore ${snapshot.files.length} file(s) from snapshot ${snapshot.id}? Current file contents will be overwritten.`)) return; try { const response = await fetch(`/api/workspace/projects/${project.id}/snapshots/${snapshot.id}/restore`, { method: "POST" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Snapshot restore failed."); setMessage(`Snapshot ${snapshot.id} restored.`); await refresh(); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Snapshot restore failed."); } };
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><History size={17} /><h3>Snapshot & Recovery</h3></div><button onClick={() => void refresh()}>Refresh</button></div><p className="kf-capability-copy">Snapshots are local recovery points. Safe solution and agent flows create them before a verified patch; manual snapshots require an explicit file list and confirmation.</p>{message && <p className="kf-capability-message">{message}</p>}<div className="kf-agent-panel"><input value={files} onChange={(event) => setFiles(event.target.value)} placeholder="client/App.tsx, client/global.css" aria-label="Files to snapshot" /><input value={reason} onChange={(event) => setReason(event.target.value)} aria-label="Snapshot reason" /><button className="kf-button kf-button--primary" onClick={() => void create()}>Create snapshot</button></div>{snapshots?.length ? <div className="kf-provider-grid">{snapshots.map((snapshot) => <article className="kf-provider-card" key={snapshot.id}><div><strong>{snapshot.reason}</strong><span>{snapshot.files.length} file(s)</span></div><small>{snapshot.id} · {formatDate(snapshot.createdAt)}</small><button onClick={() => void restore(snapshot)}>Restore snapshot</button></article>)}</div> : <p className="kf-capability-copy">No local snapshot exists for this project yet.</p>}</section>;
}

function CapabilityPanel({ activeNav, project, scan, tasks, platform, onPlatformModeChange, onRun, onTaskControl }: { activeNav: string; project: ProjectSummary; scan?: ProjectScan; tasks: TaskItem[]; platform?: LocalPlatformStatus; onPlatformModeChange: (mode: LocalPlatformStatus["mode"]) => void; onRun: (action: WorkspaceAction) => void; onTaskControl: (task: TaskItem, control: "cancel" | "retry" | "resume" | "rollback") => void }) {
  if (activeNav === "Settings") return <LocalPlatformPanel platform={platform} onModeChange={onPlatformModeChange} />;
  if (activeNav === "AI providers") return <AICenter view="providers" onlineOptional={platform?.mode === "online-optional"} />;
  if (activeNav === "Models") return <LocalAIOnboarding onlineOptional={platform?.mode === "online-optional"} />;
  if (activeNav === "Marketplace") return <MarketplacePanel />;
  if (activeNav === "Agents") return <AgentMissionCenter project={project} />;
  if (activeNav === "Tasks") return <TaskCenterPanel tasks={tasks} onTaskControl={onTaskControl} />;
  if (activeNav === "Project graph") return <GraphPanel project={project} />;
  if (activeNav === "Dependencies") return <DependenciesPanel project={project} />;
  if (activeNav === "Impact analysis") return <ImpactAnalysisPanel project={project} />;
  if (activeNav === "Code understanding") return <CodeUnderstandingPanel project={project} />;
  if (activeNav === "Architecture") return <ArchitecturePanel project={project} />;
  if (activeNav === "Ask KForge") return <AskKForgePanel project={project} />;
  if (activeNav === "Release Gate") return <ReleaseGatePanel project={project} />;
  if (activeNav === "Release preparation" || activeNav === "Artifacts" || activeNav === "Versioning") return <ReleasePreparationPanel project={project} view={activeNav} />;
  if (activeNav === "KForge Sonar") return <SecurityToolsPanel project={project} scan={scan} onScan={() => onRun("scan")} />;
  if (activeNav === "Security") return <SecurityToolsPanel project={project} scan={scan} onScan={() => onRun("scan")} />;
  if (activeNav === "Performance") return <QualityCategoryPanel title="Performance Evidence" description="Performance diagnostics are shown only when the local scanner produces performance evidence; no synthetic score is assigned." categories={["performance"]} scan={scan} onScan={() => onRun("scan")} />;
  if (activeNav === "Technical debt") return <QualityCategoryPanel title="Technical Debt Evidence" description="Technical debt is derived from the scanner's explicit completeness, quality, complexity, and architecture findings." categories={["completeness", "quality", "architecture"]} scan={scan} onScan={() => onRun("scan")} />;
  if (activeNav === "Problems" || activeNav === "Solutions" || activeNav === "Security scan") return <QualityPanel title={activeNav} scan={scan} onScan={() => onRun("scan")} />;
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Activity size={17} /><h3>{activeNav}</h3></div><span>Workspace</span></div><p className="kf-capability-copy">This Workspace section stays connected to the selected project and local engineering engine.</p></section>;
}

function LocalPlatformPanel({ platform, onModeChange }: { platform?: LocalPlatformStatus; onModeChange: (mode: LocalPlatformStatus["mode"]) => void }) {
  if (!platform) return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Settings2 size={17} /><h3>Local platform</h3></div></div><p className="kf-capability-copy">Reading local platform status…</p></section>;
  const offline = platform.mode === "offline";
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Settings2 size={17} /><h3>Local-First Platform</h3></div><span>{offline ? "Offline Mode" : "Online Optional"}</span></div><p className="kf-capability-copy">Core KForge engineering stays local, free of mandatory cloud APIs, subscriptions, and internet access. Online actions remain opt-in additions.</p><div className="kf-hardware-grid"><span><strong>Core readiness</strong>{platform.coreReady ? "Ready locally" : "Review local tooling"}</span><span><strong>Network for core</strong>{platform.networkRequiredForCore ? "Required" : "Not required"}</span><span><strong>Local storage</strong>{platform.storagePath}</span></div><div className="kf-provider-grid">{platform.capabilities.map((item) => <article className="kf-provider-card" key={item.id}><div><strong>{item.label}</strong><span>{item.state}</span></div><small>{item.detail}</small></article>)}</div><div className="kf-card-heading"><div><Network size={17} /><h3>Optional online integrations</h3></div><span>Never required for core</span></div><div className="kf-provider-grid">{platform.optionalOnlineFeatures.map((item) => <article className="kf-provider-card" key={item.id}><div><strong>{item.label}</strong><span>{item.enabled ? "Enabled" : "Disabled"}</span></div><small>{item.detail}</small></article>)}</div><div className="kf-inline-controls"><button className={`kf-button ${offline ? "kf-button--primary" : "kf-button--ghost"}`} onClick={() => onModeChange("offline")}>Use Offline Mode</button><button className={`kf-button ${offline ? "kf-button--ghost" : "kf-button--primary"}`} onClick={() => onModeChange("online-optional")}>Enable Online Optional</button></div></section>;
}

function LocalAIOnboarding({ onlineOptional }: { onlineOptional: boolean }) {
  const [data, setData] = useState<{ onboarding?: string; downloadUrl?: string; ollama?: { installed: boolean; serviceReachable: boolean; version?: string; reason?: string; models: Array<{ id: string; name: string; contextLength?: number }> }; hardware?: { cpu: { model: string }; memory: { totalBytes: number }; disk: { availableBytes?: number }; gpu: Array<{ name: string }> }; active?: { provider: string; model: string }; fallback?: { provider: string; model: string }; modelHealth?: Record<string, { status: string; testedAt: string; latencyMs?: number; reason?: string }>; recommendations?: Array<{ id: string; label: string; family: string; variant: string; parameterCount: string; quantization: string; compatible: boolean; reason: string; categories: string[]; recommendedUse: string[]; update: { state: string; latestKnownVersion: string; changelog: string } }> } | null>(null);
  const [message, setMessage] = useState("");
  const refresh = async () => { try { const response = await fetch("/api/workspace/ai/models"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Local AI status is unavailable."); setData(payload); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Local AI status failed."); } };
  useEffect(() => { void refresh(); }, []);
  const openInstaller = () => { if (!onlineOptional) { setMessage("Downloads are disabled in Offline Mode. Enable Online Optional only if you choose to open a provider download page."); return; } if (!window.confirm("Open the Ollama download page? KForge will not download or install anything automatically.")) return; if (data?.downloadUrl) window.open(data.downloadUrl, "_blank", "noopener,noreferrer"); setMessage("Download page opened after confirmation. Install Ollama, then choose Detect Existing Runtime."); };
  const setModel = async (model: string, fallback = false) => { try { const response = await fetch("/api/workspace/ai/models/active", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "ollama", model, fallback }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Model selection failed."); setMessage(fallback ? `Fallback model set to ${model}.` : `Active model set to ${model}.`); await refresh(); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Model selection failed."); } };
  const test = async (model: string) => { try { const response = await fetch("/api/workspace/ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "ollama", model }) }); const payload = await response.json(); setMessage(response.ok ? `Health test PASS: ${model} responded in ${payload.latencyMs} ms.` : payload.error || "Health test failed."); await refresh(); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Health test failed."); } };
  const checkUpdate = async (model: string) => { try { const response = await fetch(`/api/workspace/ai/models/${encodeURIComponent(model)}/update`); const payload = await response.json() as { state?: string; currentVersion?: string; latestKnownVersion?: string; detail?: string; error?: string }; if (!response.ok) throw new Error(payload.error || "Model update check failed."); setMessage(`Update check for ${model}: ${payload.state || "UNKNOWN"} · current ${payload.currentVersion || "UNKNOWN"} · latest ${payload.latestKnownVersion || "UNKNOWN"}. ${payload.detail || ""}`); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Model update check failed."); } };
  const remove = async (model: string) => { if (!window.confirm(`Remove local model ${model}? This deletes its downloaded model data.`)) return; try { const response = await fetch(`/api/workspace/ai/models/${encodeURIComponent(model)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "ollama", confirmed: true }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Model removal failed."); setMessage(payload.message || `Removed ${model}.`); await refresh(); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Model removal failed."); } };
  const ollama = data?.ollama;
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Bot size={17} /><h3>Enable Local AI</h3></div><button onClick={() => void refresh()}>Detect Existing Runtime</button></div>{message && <p className="kf-capability-message">{message}</p>}<div className="kf-wizard-steps"><span className="is-current">1 Hardware</span><span className={ollama?.installed ? "is-current" : ""}>2 Runtime</span><span>3 Models</span><span>4 Confirm</span><span>5 Install</span><span>6 Health test</span><span>7 Activate</span></div><div className="kf-provider-grid"><article className="kf-provider-card"><div><strong>Hardware Detection</strong><span>Step 1</span></div><p>{data?.hardware?.cpu.model || "Detecting CPU…"}</p><small>{data?.hardware ? `${Math.round(data.hardware.memory.totalBytes / 1e9)} GB RAM · ${(data.hardware.gpu || []).map((gpu) => gpu.name).join(", ") || "No dedicated GPU"} · ${data.hardware.disk.availableBytes ? `${Math.round(data.hardware.disk.availableBytes / 1e9)} GB free` : "disk unavailable"}` : "Waiting for local hardware data."}</small></article><article className="kf-provider-card"><div><strong>Ollama</strong><span>{ollama?.installed ? "Installed" : "Not installed"}</span></div><p>{ollama?.serviceReachable ? "Status: Connected" : "Local AI is not configured."}</p><small>{ollama?.version || ollama?.reason || "Detect an existing runtime or install Ollama after confirmation."}</small>{!ollama?.installed && <button onClick={openInstaller}>Install Ollama</button>}{ollama?.installed && !ollama?.serviceReachable && <button onClick={() => void refresh()}>Verify service</button>}<button onClick={() => setMessage("KForge can use Ollama, LM Studio, or llama.cpp when their local runtime is detected. No cloud provider is selected automatically.")}>Use Existing Provider</button></article></div>{(data?.recommendations || []).length > 0 && <><div className="kf-card-heading"><div><Cpu size={17} /><h3>Local Model Families</h3></div><span>Catalog evidence</span></div><p className="kf-capability-copy">Recommendations use detected memory and disk capacity. No verified remote catalog adapter is configured, so update and changelog fields remain UNKNOWN or DATA_UNAVAILABLE rather than being inferred.</p><div className="kf-provider-grid">{(data?.recommendations || []).map((model) => <article className={`kf-provider-card ${model.compatible ? "is-compatible" : "is-incompatible"}`} key={model.id}><div><strong>{model.label}</strong><span>{model.parameterCount}</span></div><p>{model.compatible ? "Compatible with detected budget" : "Not recommended for detected budget"}</p><small>{model.family} · variant {model.variant} · quantization {model.quantization}</small><small>{model.categories.join(" · ")} · {model.recommendedUse.join("; ")}</small><small>{model.reason}</small><small>Update: {model.update.state} · latest {model.update.latestKnownVersion} · changelog {model.update.changelog}</small></article>)}</div></>}{ollama?.models?.length ? <div className="kf-provider-grid">{ollama.models.map((model) => { const health = data?.modelHealth?.[`ollama:${model.id}`]; return <article className="kf-provider-card" key={model.id}><div><strong>{model.name}</strong><span>{model.contextLength ? `${model.contextLength} ctx` : "local"}</span></div><p>{data?.active?.model === model.id ? "Active model" : data?.fallback?.model === model.id ? "Fallback model" : "Installed model"}</p><small>{health ? `Last test: ${health.status.toUpperCase()} ${health.latencyMs ? `· ${health.latencyMs} ms` : ""} ${health.reason || ""}` : "No health test recorded."}</small><div className="kf-provider-model"><button onClick={() => void setModel(model.id)}>Activate</button><button onClick={() => void setModel(model.id, true)}>Fallback</button><button onClick={() => void test(model.id)}>Test</button><button onClick={() => void checkUpdate(model.id)}>Check update</button><button onClick={() => void remove(model.id)}>Remove</button></div></article>; })}</div> : <p className="kf-capability-copy">Continue Without AI keeps evidence-based planning active. After a runtime and model are available, KForge uses the selected local model for Ask KForge, planning, and Sonar explanations.</p>}</section>;
}

function AICenter({ view, onlineOptional }: { view: "providers" | "models"; onlineOptional: boolean }) {
  const [data, setData] = useState<{ providers?: Array<{ id: string; name: string; kind: string; configured: boolean; reachable: boolean; available: boolean; endpoint?: string; models: Array<{ id: string; name: string }>; reason?: string; privacy?: string }>; hardware?: { os: string; cpu: { model: string; cores: number }; memory: { totalBytes: number }; gpu: Array<{ name: string; vramBytes?: number }>; disk: { availableBytes?: number } }; recommendations?: Array<{ id: string; label: string; pullName: string; parameterCount: string; estimatedDownloadBytes: number; estimatedRamBytes: number; license: string; compatible: boolean; reason: string; family: string; variant: string; quantization: string; categories: string[]; recommendedUse: string[]; update: { state: string; currentVersion: string; latestKnownVersion: string; source: string; changelog: string } }>; active?: { provider: string; model: string } } | null>(null);
  const [message, setMessage] = useState("");
  const refresh = async () => { try { const response = await fetch(view === "models" ? "/api/workspace/ai/models" : "/api/workspace/ai/providers"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "AI Center is unavailable."); setData(view === "models" ? payload : { providers: payload.providers }); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "AI Center request failed."); } };
  useEffect(() => { void refresh(); }, [view]);
  const install = async (pullName: string) => { if (!onlineOptional) { setMessage("Model downloads are disabled in Offline Mode. Existing local models and deterministic assistance remain available."); return; } if (!window.confirm(`Download ${pullName}? KForge will use disk, RAM, and network only after this confirmation.`)) return; try { const response = await fetch("/api/workspace/ai/models/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "ollama", model: pullName, confirmed: true }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Installation could not start."); setMessage(`Installation task ${payload.task?.id || "started"} is running in the local engine.`); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Installation failed."); } };
  const test = async (provider: string, model: string) => { try { const response = await fetch("/api/workspace/ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, model }) }); const payload = await response.json(); setMessage(response.ok ? `Test passed in ${payload.latencyMs} ms using ${payload.model}.` : payload.error || "Test failed."); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "AI test failed."); } };
  const providers = data?.providers || [];
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Cpu size={17} /><h3>{view === "models" ? "KForge Model Center" : "KForge AI Center"}</h3></div><button onClick={() => void refresh()}>Refresh</button></div>{message && <p className="kf-capability-message">{message}</p>}{view === "providers" ? <div className="kf-provider-grid">{providers.map((provider) => <article key={provider.id} className="kf-provider-card"><div><strong>{provider.name}</strong><span>{provider.kind}</span></div><p>{provider.available ? "Ready" : provider.reachable ? "Reachable — no model" : provider.configured ? "Configured — not contacted" : "Not configured"}</p><small>{provider.endpoint || provider.reason || provider.privacy}</small>{provider.models.map((model) => <div className="kf-provider-model" key={model.id}><span>{model.name}</span><button onClick={() => void test(provider.id, model.id)}>Test</button></div>)}</article>)}</div> : <div className="kf-model-center"><div className="kf-hardware-grid"><span><strong>OS</strong>{data?.hardware?.os || "Loading"}</span><span><strong>CPU</strong>{data?.hardware?.cpu.model || "Loading"}</span><span><strong>RAM</strong>{data?.hardware ? `${Math.round(data.hardware.memory.totalBytes / 1e9)} GB` : "Loading"}</span><span><strong>GPU</strong>{data?.hardware?.gpu.map((gpu) => gpu.name).join(", ") || "Not reported"}</span><span><strong>Free disk</strong>{data?.hardware?.disk.availableBytes ? `${Math.round(data.hardware.disk.availableBytes / 1e9)} GB` : "Unavailable"}</span></div><div className="kf-provider-grid">{(data?.recommendations || []).map((model) => <article key={model.id} className={`kf-provider-card ${model.compatible ? "is-compatible" : "is-incompatible"}`}><div><strong>{model.label}</strong><span>{model.parameterCount}</span></div><p>{model.compatible ? "Compatible with detected budget" : "Not recommended"}</p><small>{model.reason}</small><small>{model.family} · variant {model.variant} · quantization {model.quantization}</small><small>{model.categories.join(" · ")} · {model.recommendedUse.join("; ")}</small><small>{model.license} · ~{Math.round(model.estimatedDownloadBytes / 1e9)} GB download</small><small>Update: {model.update.state} · latest {model.update.latestKnownVersion} · changelog {model.update.changelog}</small><button disabled={!model.compatible || !onlineOptional} title={!onlineOptional ? "Enable Online Optional mode before downloading a model." : undefined} onClick={() => void install(model.pullName)}>Install with confirmation</button></article>)}</div></div>}</section>;
}

function AgentMissionCenter({ project }: { project: ProjectSummary }) {
  const [mission, setMission] = useState("audit");
  const [status, setStatus] = useState("Choose a mission. KForge records task logs, applies only verified safe patches, and restores snapshots on failed verification.");
  const [registry, setRegistry] = useState<{ tools?: Array<{ name: string; description: string; permission: string; status?: "AVAILABLE" | "AVAILABLE_WITH_CONFIRMATION" | "UNAVAILABLE" | "BLOCKED" | "ERROR"; requiresConfirmation?: boolean; unavailableReason?: string; runtimeError?: string }>; permissions?: Record<string, string> } | null>(null);
  const refreshRegistry = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/agent/tools`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Agent tool registry is unavailable."); setRegistry(payload); } catch (cause: unknown) { setStatus(cause instanceof Error ? cause.message : "Agent tool registry failed."); } };
  useEffect(() => { void refreshRegistry(); }, [project.id]);
  const start = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/agent/missions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mission }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Mission could not start."); setStatus(`Mission task ${payload.task.id} started. Open Tasks to follow its event log.`); } catch (cause: unknown) { setStatus(cause instanceof Error ? cause.message : "Mission start failed."); } };
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Bot size={17} /><h3>KForge Engineer missions</h3></div><button onClick={() => void refreshRegistry()}>Refresh tools</button></div><p className="kf-capability-copy">Read · Plan · Patch · Verify. The agent only invokes registered typed tools; commits, pushes, deployment, force push, and secret exposure remain permission-gated or blocked.</p><div className="kf-inline-controls"><select value={mission} onChange={(event) => setMission(event.target.value)}><option value="audit">Audit project</option><option value="fix-critical">Fix critical issue</option><option value="improve-security">Improve security</option><option value="improve-tests">Improve tests</option><option value="refactor">Prepare refactor plan</option><option value="prepare-release">Prepare production release</option><option value="prepare-github">Prepare GitHub</option><option value="documentation">Audit documentation</option><option value="performance">Inspect performance strategy</option></select><button className="kf-button kf-button--primary" onClick={() => void start()}>Start mission</button></div><p className="kf-capability-copy">{status}</p>{registry && <><div className="kf-provider-grid">{(registry.tools || []).map((tool) => { const status = tool.status || "ERROR"; return <article className="kf-provider-card" key={tool.name}><div><strong>{tool.name}</strong><span>{status}</span></div><p>{tool.description}</p><small>Permission: {tool.permission}</small><small>Requires confirmation: {tool.requiresConfirmation ? "Yes" : "No"}</small>{tool.unavailableReason && <small>Unavailable reason: {tool.unavailableReason}</small>}{tool.runtimeError && <small>Runtime error: {tool.runtimeError}</small>}</article>; })}</div><article className="kf-command-evidence"><strong>Agent permissions</strong><pre>{JSON.stringify(registry.permissions, null, 2)}</pre></article></>}</section>;
}

function MissionProgress({ mission }: { mission: MissionItem }) { return <article className="kf-command-evidence"><strong>{mission.name} mission · {mission.state}</strong><small>{mission.type || "agent"} strategy · progress: {mission.progress ?? 0}% · {mission.currentStepId ? `Current step: ${mission.currentStepId}` : "No active step"} · changed files: {mission.changedFiles.length} · evidence: {mission.evidence?.length || 0}</small><p>{mission.goal || "No mission goal was recorded."}</p><div className="kf-task-list">{mission.steps.map((step) => <details className="kf-task" key={step.id}><summary><span><strong>{step.status === "succeeded" ? "✓" : step.status === "running" ? "▶" : step.status === "failed" ? "!" : step.status === "blocked" ? "■" : step.status === "skipped" ? "–" : "○"} {step.name} · {step.status}</strong><small>{step.kind || step.tool} · tool {step.tool} · attempts {step.attempts ?? step.retryCount}{step.requiresConfirmation ? " · confirmation required" : ""}{step.dependencies.length ? ` · after ${step.dependencies.join(", ")}` : ""}</small></span><ChevronRight size={15} /></summary><pre>{JSON.stringify({ startedAt: step.startedAt, finishedAt: step.finishedAt, logs: step.logs, output: step.output, error: step.error, evidence: step.evidence }, null, 2)}</pre></details>)}</div>{mission.warnings.length > 0 && <pre>{mission.warnings.join("\n")}</pre>}<small>Recovery: {mission.recovery.detail}</small></article>; }

function TaskCenterPanel({ tasks, onTaskControl }: { tasks: TaskItem[]; onTaskControl: (task: TaskItem, control: "cancel" | "retry" | "resume" | "rollback") => void }) { return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Activity size={17} /><h3>Task Center v2</h3></div><span>{tasks.length} selected-project task(s)</span></div>{tasks.length ? <div className="kf-task-list">{tasks.map((task) => <details key={task.id} className={`kf-task kf-task--${task.state}`}><summary><span><strong>{task.action} · {task.state}</strong><small>{task.message} · {task.progress}%{task.finishedAt ? ` · ${Math.max(0, Math.round((new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime()) / 1000))}s` : ""}</small></span><ChevronRight size={15} /></summary><pre>{task.output || "Waiting for process output…"}</pre>{task.mission && <MissionProgress mission={task.mission} />}{task.state === "queued" && <button onClick={() => onTaskControl(task, "cancel")}>Cancel queued task</button>}{["success", "error", "cancelled", "blocked"].includes(task.state) && <button onClick={() => onTaskControl(task, "retry")}>Retry task</button>}{task.mission?.recovery.resume && ["blocked", "error"].includes(task.state) && <button onClick={() => onTaskControl(task, "resume")}>Resume mission</button>}{task.mission?.recovery.rollback && <button onClick={() => onTaskControl(task, "rollback")}>Rollback snapshot</button>}</details>)}</div> : <p className="kf-capability-copy">Agent and project tasks appear here after they start. Logs and output come from the actual local process.</p>}</section>; }

function DocumentationPanel({ project }: { project: ProjectSummary }) {
  const [audit, setAudit] = useState<{ findings: Array<{ id: string; sourceDocument: string; claim: string; evidence: string; actualState: string; severity: string; suggestedFix: string }> } | null>(null);
  const [message, setMessage] = useState("Loading local documentation evidence…");
  const refresh = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/documentation`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Documentation audit failed."); setAudit(payload.audit); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Documentation audit failed."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  const previewAndApply = async (findingId: string) => { try { const previewResponse = await fetch(`/api/workspace/projects/${project.id}/documentation/${findingId}/preview`, { method: "POST" }); const preview = await previewResponse.json(); if (!previewResponse.ok || !preview.patch) throw new Error(preview.reason || "This evidence requires manual review."); if (!window.confirm(`Apply documentation fix?\n\n${preview.patch.before}\n→ ${preview.patch.after}`)) return; const applyResponse = await fetch(`/api/workspace/projects/${project.id}/documentation/${findingId}/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }) }); const applied = await applyResponse.json(); if (!applyResponse.ok || !applied.verified) throw new Error(applied.reason || "Documentation verification failed."); setMessage("Documentation fix applied and re-audited."); await refresh(); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Documentation fix failed."); } };
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Box size={17} /><h3>Documentation Audit V2</h3></div><button onClick={() => void refresh()}>Refresh</button></div>{message && <p className="kf-capability-message" role="status">{message}</p>}{!audit ? <p className="kf-capability-copy">Loading documentation evidence…</p> : audit.findings.length === 0 ? <p className="kf-capability-copy">No semantic contradictions, missing local links, or stale package commands were detected.</p> : <div className="kf-issues">{audit.findings.map((finding) => <details className="kf-issue" key={finding.id}><summary><span className={`kf-severity kf-severity--${finding.severity === "high" ? "high" : finding.severity === "medium" ? "medium" : "low"}`}>{finding.severity}</span><span><strong>{finding.sourceDocument}</strong><small>{finding.claim}</small></span><ChevronRight size={15} /></summary><div><p><strong>Evidence:</strong> {finding.evidence}</p><p><strong>Actual state:</strong> {finding.actualState}</p><p className="kf-suggestion"><Wrench size={14} />{finding.suggestedFix}</p>{project.trust === "trusted" && <button className="kf-solution-button" onClick={() => void previewAndApply(finding.id)}>Preview + Apply + Verify</button>}{project.trust !== "trusted" && <p className="kf-capability-copy">Blocked until this project is trusted for a write operation.</p>}</div></details>)}</div>}</section>;
}

function GraphPanel({ project }: { project: ProjectSummary }) {
  const [data, setData] = useState<{ graph?: { generatedAt: string; summary: { files: number; imports: number; routes: number; apis: number; tests: number }; nodes: Array<{ id: string; type: string; label: string; path?: string }>; edges: Array<{ from: string; to: string; type: string }> } } | null>(null);
  const [file, setFile] = useState("");
  const [impact, setImpact] = useState<{ file: string; directDependents: string[]; ownedApis: string[]; relatedTests: string[]; risk: string; message: string } | null>(null);
  const [message, setMessage] = useState("");
  const refresh = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/graph`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Graph unavailable."); setData(payload); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Graph request failed."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  const inspectImpact = async () => { if (!file.trim()) { setMessage("Enter a project-relative file path from the graph."); return; } try { const response = await fetch(`/api/workspace/projects/${project.id}/graph/impact?file=${encodeURIComponent(file.trim())}`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Impact analysis failed."); setImpact(payload.impact); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Impact analysis failed."); } };
  const graph = data?.graph;
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Network size={17} /><h3>Project Graph</h3></div><button onClick={() => void refresh()}>Refresh evidence</button></div>{message && <p className="kf-capability-message">{message}</p>}{graph ? <><div className="kf-hardware-grid"><span><strong>Files</strong>{graph.summary.files}</span><span><strong>Imports</strong>{graph.summary.imports}</span><span><strong>Routes</strong>{graph.summary.routes}</span><span><strong>APIs</strong>{graph.summary.apis}</span><span><strong>Tests</strong>{graph.summary.tests}</span></div><p className="kf-capability-copy">Generated {formatDate(graph.generatedAt)} from actual source files, imports, routes, API definitions/calls, and test filenames. Select any listed file for direct-impact evidence.</p><div className="kf-inline-controls"><input value={file} onChange={(event) => setFile(event.target.value)} placeholder="client/pages/KForgeWorkspace.tsx" aria-label="Project-relative file path for impact analysis" /><button onClick={() => void inspectImpact()}>Analyze impact</button></div><div className="kf-provider-grid">{graph.nodes.filter((node) => node.type === "file" || node.type === "test").slice(0, 20).map((node) => <button className="kf-provider-card" type="button" key={node.id} onClick={() => setFile(node.path || "")}><div><strong>{node.label}</strong><span>{node.type}</span></div><small>{node.path}</small></button>)}</div>{impact && <article className="kf-command-evidence"><strong>{impact.risk.toUpperCase()} impact · {impact.file}</strong><small>{impact.message}</small><pre>{JSON.stringify({ usedBy: impact.directDependents, ownedApis: impact.ownedApis, relatedTests: impact.relatedTests }, null, 2)}</pre></article>}</> : <p className="kf-capability-copy">{message || "Building graph from local source evidence…"}</p>}</section>;
}

function DependenciesPanel({ project }: { project: ProjectSummary }) {
  const [profile, setProfile] = useState<{ dependencies: Array<{ name: string; version: string; kind: string }>; manifests: string[]; lockfiles: string[]; packageManager: string | null; detectedAt: string } | null>(null);
  const [message, setMessage] = useState("Reading declared local dependency evidence…");
  const refresh = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/profile`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Dependency profile is unavailable."); setProfile(payload.profile); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Dependency profile failed."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Box size={17} /><h3>Dependency Evidence</h3></div><button onClick={() => void refresh()}>Refresh evidence</button></div>{message && <p className="kf-capability-message">{message}</p>}{profile && <><div className="kf-hardware-grid"><span><strong>Dependencies</strong>{profile.dependencies.length}</span><span><strong>Package manager</strong>{profile.packageManager || "Not detected"}</span><span><strong>Manifests</strong>{profile.manifests.length}</span><span><strong>Lockfiles</strong>{profile.lockfiles.length}</span></div><p className="kf-capability-copy">This list is derived directly from local manifests and lockfiles; it does not infer transitive dependencies or remote vulnerability data without an available scanner.</p><div className="kf-provider-grid">{profile.dependencies.slice(0, 120).map((dependency) => <article className="kf-provider-card" key={`${dependency.name}:${dependency.kind}`}><div><strong>{dependency.name}</strong><span>{dependency.kind}</span></div><small>{dependency.version}</small></article>)}</div>{profile.dependencies.length === 0 && <p className="kf-capability-copy">No manifest-declared dependencies were detected.</p>}</>}</section>;
}

function ImpactAnalysisPanel({ project }: { project: ProjectSummary }) {
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Network size={17} /><h3>Impact Analysis</h3></div><span>Static evidence</span></div><p className="kf-capability-copy">Choose a source file in the graph below to inspect direct dependents, owned APIs, related tests, and the measured risk classification. KForge does not claim transitive or runtime impact without evidence.</p><GraphPanel project={project} /></section>;
}

function CodeUnderstandingPanel({ project }: { project: ProjectSummary }) {
  const [data, setData] = useState<{ profile?: { framework: string[]; languages: string[]; sourceRoots: string[]; testRoots: string[]; workspaceKind: string; runtimeEntrypoint?: string; sourceFileCount: number; totalFileCount: number }; graph?: { summary: { files: number; imports: number; routes: number; apis: number; tests: number } } } | null>(null);
  const [message, setMessage] = useState("Building local code understanding evidence…");
  const refresh = async () => { try { const [profileResponse, graphResponse] = await Promise.all([fetch(`/api/workspace/projects/${project.id}/profile`), fetch(`/api/workspace/projects/${project.id}/graph`)]); const profilePayload = await profileResponse.json(); const graphPayload = await graphResponse.json(); if (!profileResponse.ok || !graphResponse.ok) throw new Error(profilePayload.error || graphPayload.error || "Code understanding is unavailable."); setData({ profile: profilePayload.profile, graph: graphPayload.graph }); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Code understanding failed."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Code2 size={17} /><h3>Code Understanding</h3></div><button onClick={() => void refresh()}>Refresh evidence</button></div>{message && <p className="kf-capability-message">{message}</p>}{data?.profile && <><div className="kf-hardware-grid"><span><strong>Workspace</strong>{data.profile.workspaceKind}</span><span><strong>Source files</strong>{data.profile.sourceFileCount}</span><span><strong>Graph imports</strong>{data.graph?.summary.imports ?? "Unavailable"}</span><span><strong>Routes</strong>{data.graph?.summary.routes ?? "Unavailable"}</span><span><strong>APIs</strong>{data.graph?.summary.apis ?? "Unavailable"}</span></div><article className="kf-command-evidence"><strong>Measured project structure</strong><pre>{JSON.stringify({ frameworks: data.profile.framework, languages: data.profile.languages, sourceRoots: data.profile.sourceRoots, testRoots: data.profile.testRoots, runtimeEntrypoint: data.profile.runtimeEntrypoint || "UNAVAILABLE" }, null, 2)}</pre></article></>}</section>;
}

function ArchitecturePanel({ project }: { project: ProjectSummary }) {
  const [data, setData] = useState<{ generatedAt: string; modules: Array<{ name: string; files: number }>; apiBoundaries: Array<{ path: string; owner?: string }>; routeBoundaries: Array<{ path: string; owner?: string }>; directCycles: string[][]; highCoupling: Array<{ file: string; dependents: number }>; limitations: string[] } | null>(null);
  const [message, setMessage] = useState("Loading static architecture evidence…");
  const refresh = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/architecture`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Architecture evidence is unavailable."); setData(payload); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Architecture request failed."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Box size={17} /><h3>Architecture Evidence</h3></div><button onClick={() => void refresh()}>Refresh evidence</button></div><p className="kf-capability-copy">KForge derives these findings from local files and static import/API/route evidence. It marks the remaining limits rather than inventing layers or responsibilities.</p>{message && <p className="kf-capability-message">{message}</p>}{data && <><div className="kf-hardware-grid"><span><strong>Modules</strong>{data.modules.length}</span><span><strong>API boundaries</strong>{data.apiBoundaries.length}</span><span><strong>Route boundaries</strong>{data.routeBoundaries.length}</span><span><strong>Direct cycles</strong>{data.directCycles.length}</span><span><strong>High coupling</strong>{data.highCoupling.length}</span></div><div className="kf-provider-grid">{data.modules.slice(0, 12).map((module) => <article className="kf-provider-card" key={module.name}><div><strong>{module.name}</strong><span>Module</span></div><small>{module.files} scanned file(s)</small></article>)}</div><article className="kf-command-evidence"><strong>Boundaries, direct cycles, and coupling</strong><pre>{JSON.stringify({ apiBoundaries: data.apiBoundaries, routeBoundaries: data.routeBoundaries, directCycles: data.directCycles, highCoupling: data.highCoupling }, null, 2)}</pre></article><article className="kf-command-evidence"><strong>Measured limitations</strong><pre>{data.limitations.join("\n")}</pre></article></>}<GraphPanel project={project} /><DocumentationPanel project={project} /></section>;
}

function AskKForgePanel({ project }: { project: ProjectSummary }) { const [question, setQuestion] = useState("What are the 5 biggest risks in this project?"); const [answer, setAnswer] = useState(""); const ask = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Ask KForge failed."); setAnswer(typeof payload.answer === "string" ? payload.answer : JSON.stringify(payload.answer, null, 2)); } catch (cause: unknown) { setAnswer(cause instanceof Error ? cause.message : "Ask KForge failed."); } }; return <section className="kf-capability-panel"><div className="kf-card-heading"><div><MessageSquare size={17} /><h3>Ask KForge</h3></div><span>Project-grounded</span></div><div className="kf-agent-panel"><textarea value={question} onChange={(event) => setQuestion(event.target.value)} /><button className="kf-button kf-button--primary" onClick={() => void ask()}>Ask</button>{answer && <pre>{answer}</pre>}</div></section>; }

function ReleaseGatePanel({ project }: { project: ProjectSummary }) {
  const [result, setResult] = useState("");
  const [preparation, setPreparation] = useState<unknown>(null);
  const run = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/release-gate`, { method: "POST" }); const payload = await response.json(); setResult(JSON.stringify({ readiness: payload.readiness, checks: payload.checks, missingChecks: payload.missingChecks, blockers: payload.blockers?.map((entry: ScanIssue) => entry.title), warnings: payload.warnings?.map((entry: ScanIssue) => entry.title) }, null, 2)); } catch (cause: unknown) { setResult(cause instanceof Error ? cause.message : "Release Gate failed."); } };
  const prepare = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/release/preparation`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Release preparation is unavailable."); setPreparation(payload.preparation); } catch (cause: unknown) { setResult(cause instanceof Error ? cause.message : "Release preparation failed."); } };
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Rocket size={17} /><h3>KForge Release Gate</h3></div><span>Typecheck · Tests · Build · Runtime · Security</span></div><p className="kf-capability-copy">The gate reports blockers and warnings from actual local verification. Release preparation creates a local preview only; it does not create tags, commits, GitHub releases, or any remote request.</p><div className="kf-inline-controls"><button className="kf-button kf-button--primary" onClick={() => void run()}>Run Release Gate</button><button onClick={() => void prepare()}>Prepare release notes</button></div>{result && <pre className="kf-release-output">{result}</pre>}{preparation && <article className="kf-command-evidence"><strong>Release preparation</strong><pre>{JSON.stringify(preparation, null, 2)}</pre></article>}</section>;
}

function ReleasePreparationPanel({ project, view }: { project: ProjectSummary; view: "Release preparation" | "Artifacts" | "Versioning" }) {
  const [preparation, setPreparation] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState("Loading local release preparation evidence…");
  const refresh = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/release/preparation`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Release preparation is unavailable."); setPreparation(payload.preparation); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Release preparation failed."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  const value = view === "Artifacts" ? preparation?.artifacts : view === "Versioning" ? { baselineTag: preparation?.baselineTag, version: preparation?.version } : preparation;
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Rocket size={17} /><h3>{view}</h3></div><button onClick={() => void refresh()}>Refresh evidence</button></div><p className="kf-capability-copy">This is a local, read-only release preparation preview. It does not create tags, artifacts, releases, or remote requests.</p>{message && <p className="kf-capability-message">{message}</p>}{preparation && <article className="kf-command-evidence"><strong>Local release evidence</strong><pre>{JSON.stringify(value, null, 2)}</pre></article>}</section>;
}

type MarketplaceItemView = { id: string; category: string; name: string; description: string; source: string; sourceUrl?: string; version?: string; license?: string; capabilities: string[]; requirements: string[]; compatibility: string; permissions: Array<{ id: string; required: boolean; detail: string }>; trust: string; installed: boolean; enabled: boolean; local: boolean; installAction: string; dataState: string };

function MarketplacePanel() {
  const [items, setItems] = useState<MarketplaceItemView[]>([]);
  const [providers, setProviders] = useState<Array<{ id: string; label: string; state: string; detail: string; sourceUrl?: string; adapterKind?: "local" | "remote"; configured?: boolean; capabilities?: string[] }>>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [message, setMessage] = useState("Loading configured Marketplace providers…");
  const load = async () => { try { const response = await fetch("/api/workspace/marketplace"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Marketplace is unavailable."); setItems(payload.items || []); setProviders(payload.providers || []); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Marketplace could not be loaded."); } };
  useEffect(() => { void load(); }, []);
  const inspect = async (item: MarketplaceItemView) => { try { const response = await fetch(`/api/workspace/marketplace/items/${encodeURIComponent(item.id)}/install-preview`); const payload = await response.json(); const permissions = item.permissions.map((permission) => `${permission.id}${permission.required ? " (required)" : ""}`).join(", "); setMessage(`${payload.reason || "Install preview unavailable."} Permissions: ${permissions || "none"}.`); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Marketplace inspection failed."); } };
  const visible = items.filter((item) => (filter === "all" || item.category === filter) && `${item.name} ${item.description} ${item.capabilities.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Box size={17} /><h3>Knoux Forge Marketplace</h3></div><button onClick={() => void load()}>Refresh registry</button></div><p className="kf-capability-copy">Marketplace data is sourced from local runtime metadata or a declared official provider. It never invents ratings, prices, downloads, or install state. Remote installs remain disabled in Offline Mode and always require review.</p><div className="kf-provider-grid">{providers.map((provider) => <article className="kf-provider-card" key={provider.id}><div><strong>{provider.label}</strong><span>{provider.state}</span></div><p>{provider.detail}</p><small>{provider.adapterKind || "registry"} adapter · {provider.configured ? "configured" : "not configured"}</small><small>Capabilities: {(provider.capabilities || []).join(", ") || "not declared"}</small>{provider.sourceUrl && <a href={provider.sourceUrl} target="_blank" rel="noreferrer">Source</a>}</article>)}</div><div className="kf-inline-controls"><input aria-label="Search Marketplace" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models and capabilities" /><select aria-label="Marketplace category" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All categories</option><option value="models">Models</option><option value="agents">Agents</option><option value="tools">Tools</option><option value="plugins">Plugins</option></select></div>{message && <p className="kf-capability-message">{message}</p>}<div className="kf-provider-grid">{visible.map((item) => <article className="kf-provider-card" key={item.id}><div><strong>{item.name}</strong><span>{item.installed ? "INSTALLED" : item.dataState}</span></div><p>{item.description}</p><small>{item.source} · {item.version || "version not supplied"} · {item.license || "license not supplied"}</small><small>Trust: {item.trust} · {item.compatibility}</small><div className="kf-inline-controls"><button onClick={() => void inspect(item)}>{item.installed ? "Inspect local item" : "Review install"}</button>{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Source</a>}</div><details><summary>Capabilities, requirements & permissions</summary><pre>{JSON.stringify({ capabilities: item.capabilities, requirements: item.requirements, permissions: item.permissions }, null, 2)}</pre></details></article>)}</div>{!visible.length && <p className="kf-capability-copy">No configured Marketplace item matches the current search and filters.</p>}</section>;
}

type SecurityToolView = { id: string; label: string; state: string; executable?: string; version?: string; detail: string; lastRun?: string; exitCode?: number; stdout?: string; stderr?: string; findings?: unknown[] };

function SecurityToolsPanel({ project, scan, onScan }: { project: ProjectSummary; scan?: ProjectScan; onScan: () => void }) {
  const [tools, setTools] = useState<SecurityToolView[]>([]);
  const [trust, setTrust] = useState<string>(project.trust);
  const [message, setMessage] = useState("Detecting local security tools…");
  const refresh = async () => {
    try {
      const response = await fetch(`/api/workspace/projects/${project.id}/security/tools`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Security Tool Manager is unavailable.");
      setTools(payload.tools || []); setTrust(payload.trust || project.trust); setMessage("");
    } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Security tool detection failed."); }
  };
  useEffect(() => { void refresh(); }, [project.id]);
  const runTool = async (id: string) => {
    try {
      setMessage(`Running ${id} with captured local evidence…`);
      const response = await fetch(`/api/workspace/projects/${project.id}/security/tools/${id}/run`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || payload.tool?.detail || `${id} did not complete.`);
      setTools((current) => current.map((tool) => tool.id === id ? payload.tool : tool)); setMessage("");
    } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Security tool run failed."); }
  };
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><ShieldAlert size={17} /><h3>Knoux Sonar · Security Tool Manager</h3></div><button onClick={() => void refresh()}>Detect local tools</button></div><p className="kf-capability-copy">No tool is downloaded or run silently. UNAVAILABLE means no executable was found; BLOCKED preserves the trust or offline policy; PASSED appears only after an explicit local scan succeeds.</p>{message && <p className="kf-capability-message">{message}</p>}<div className="kf-hardware-grid"><span><strong>Project trust</strong>{trust}</span><span><strong>Detected tools</strong>{tools.length}</span><span><strong>Available</strong>{tools.filter((tool) => tool.state === "AVAILABLE").length}</span><span><strong>Passed</strong>{tools.filter((tool) => tool.state === "PASSED").length}</span></div><div className="kf-provider-grid">{tools.map((tool) => <article className="kf-provider-card" key={tool.id}><div><strong>{tool.label}</strong><span>{tool.state}</span></div><p>{tool.version || tool.executable || "No local executable path available"}</p><small>{tool.detail}</small><button disabled={!(["AVAILABLE", "CONFIGURED"] as string[]).includes(tool.state)} onClick={() => void runTool(tool.id)}>Run explicit scan</button>{tool.lastRun && <details><summary>Captured evidence · exit {tool.exitCode}</summary><pre>{JSON.stringify({ findings: tool.findings, stdout: tool.stdout, stderr: tool.stderr }, null, 2)}</pre></details>}</article>)}</div><QualityPanel title="Current normalized security findings" scan={scan} onScan={onScan} /></section>;
}

function QualityPanel({ title, scan, onScan }: { title: string; scan?: ProjectScan; onScan: () => void }) { const issues = scan?.issues || []; return <section className="kf-capability-panel"><div className="kf-card-heading"><div><ShieldAlert size={17} /><h3>{title}</h3></div><button onClick={onScan}>Run current scan</button></div>{scan ? <div className="kf-issues">{issues.slice(0, 8).map((entry) => <details key={entry.id} className="kf-issue"><summary><span className={`kf-severity kf-severity--${entry.severity}`}>{entry.severity}</span><span><strong>{entry.title}</strong><small>{entry.source} · {entry.rule || entry.category}</small></span><ChevronRight size={15} /></summary><p>{entry.suggestion || entry.description}</p></details>)}</div> : <p className="kf-capability-copy">No scan is loaded. Start a real local scan to populate this panel.</p>}</section>; }

function QualityCategoryPanel({ title, description, categories, scan, onScan }: { title: string; description: string; categories: string[]; scan?: ProjectScan; onScan: () => void }) {
  const findings = (scan?.issues || []).filter((entry) => categories.includes(entry.category));
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><ShieldAlert size={17} /><h3>{title}</h3></div><button onClick={onScan}>Run current scan</button></div><p className="kf-capability-copy">{description}</p>{scan ? findings.length ? <div className="kf-issues">{findings.map((entry) => <details key={entry.id} className="kf-issue"><summary><span className={`kf-severity kf-severity--${entry.severity}`}>{entry.severity}</span><span><strong>{entry.title}</strong><small>{entry.source} · {entry.file || entry.category}</small></span><ChevronRight size={15} /></summary><p>{entry.description}</p></details>)}</div> : <p className="kf-capability-copy">No matching local scanner evidence was produced by the current scan.</p> : <p className="kf-capability-copy">Run a real local scan to populate this panel.</p>}</section>;
}

function ProjectInspectorV2({ project, scan, results, tasks, onRun, onTaskControl }: { project: ProjectSummary; scan?: ProjectScan; results?: Partial<Record<WorkspaceAction, CommandResult>>; tasks: TaskItem[]; onRun: (action: WorkspaceAction) => void; onTaskControl: (task: TaskItem, control: "cancel" | "retry" | "resume" | "rollback") => void }) {
  const health = scan?.health.score;
  const critical = (scan?.issues || []).filter((entry) => entry.severity === "critical" || entry.severity === "high");
  return <section className="kf-inspector"><div className="kf-inspector-header"><div><p className="kf-eyebrow">Project intelligence</p><h2>{project.name}</h2><p>{project.path}</p></div><div className="kf-inspector-actions"><button className="kf-button kf-button--primary" onClick={() => onRun("scan")}><ShieldAlert size={16} />Scan</button><button className="kf-button kf-button--ghost" onClick={() => onRun("typecheck")}>Typecheck</button><button className="kf-button kf-button--ghost" onClick={() => onRun("test")}><TestTube2 size={16} />Test</button><button className="kf-button kf-button--ghost" onClick={() => onRun("build")}><Play size={16} />Build</button></div></div><div className="kf-metrics"><Metric icon={<HeartPulse size={18} />} label="Project health" value={health === undefined || health === null ? "Evidence pending" : `${health}%`} tone={health === undefined || health === null ? "neutral" : health >= 85 ? "good" : health >= 60 ? "warning" : "bad"} /><Metric icon={<ShieldAlert size={18} />} label="Problems" value={scan ? `${critical.length} priority` : "Not scanned"} tone={critical.length ? "bad" : scan ? "good" : "neutral"} /><Metric icon={<TestTube2 size={18} />} label="Tests" value={results?.test ? (results.test.ok ? "Pass" : "Failed") : "Not run"} tone={!results?.test ? "neutral" : results.test.ok ? "good" : "bad"} /><Metric icon={<Play size={18} />} label="Build" value={results?.build ? (results.build.ok ? "Pass" : "Failed") : "Not run"} tone={!results?.build ? "neutral" : results.build.ok ? "good" : "bad"} /><Metric icon={<GitBranch size={18} />} label="Git" value={project.modifiedFiles + project.untrackedFiles ? `${project.modifiedFiles + project.untrackedFiles} changes` : "Clean"} tone={project.modifiedFiles + project.untrackedFiles ? "warning" : "good"} /></div><div className="kf-inspector-grid"><article className="kf-inspector-card"><ProblemsCenter projectId={project.id} issues={scan?.issues || []} scannedAt={scan?.scannedAt} /></article><article className="kf-inspector-card"><AgentPanel projectId={project.id} /><div className="kf-card-heading"><div><Activity size={17} /><h3>Task center</h3></div><span>{tasks.length} task(s)</span></div>{tasks.length === 0 ? <div className="kf-card-empty"><p>Long-running KForge operations appear here with their actual process output.</p><button onClick={() => onRun("scan")}>Start audit task</button></div> : <div className="kf-task-list">{tasks.map((task) => <details key={task.id} className={`kf-task kf-task--${task.state}`}><summary><span className="kf-task-indicator">{task.state === "running" ? <RefreshCw size={14} className="kf-spin" /> : <Activity size={14} />}</span><span><strong>{task.action} · {task.state === "success" ? "completed" : task.state}</strong><small>{task.message} · {task.progress}%{task.finishedAt ? ` · ${Math.max(0, Math.round((new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime()) / 1000))}s` : ""}</small></span><ChevronRight size={15} /></summary><pre>{task.output || "Waiting for command output…"}</pre><div className="kf-task-controls">{task.state === "queued" && <button onClick={() => onTaskControl(task, "cancel")}>Cancel</button>}{(task.state === "success" || task.state === "error" || task.state === "cancelled" || task.state === "blocked") && <button onClick={() => onTaskControl(task, "retry")}>Retry</button>}{task.mission?.recovery.resume && (task.state === "blocked" || task.state === "error") && <button onClick={() => onTaskControl(task, "resume")}>Resume</button>}{task.mission?.recovery.rollback && <button onClick={() => onTaskControl(task, "rollback")}>Rollback</button>}</div></details>)}</div>}</article></div></section>;
}

function ProblemsCenter({ projectId, issues, scannedAt }: { projectId: string; issues: ScanIssue[]; scannedAt?: string }) {
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("all");
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("all");
  const filtered = issues.filter((entry) => (severity === "all" || entry.severity === severity) && (source === "all" || entry.source === source) && (category === "all" || entry.category === category) && `${entry.title} ${entry.message} ${entry.file || ""}`.toLowerCase().includes(query.toLowerCase()));
  const sources = [...new Set(issues.map((entry) => entry.source))];
  const categories = [...new Set(issues.map((entry) => entry.category))];
  const [solutionStatus, setSolutionStatus] = useState("");
  const applyEnvironmentTemplate = async (entry: ScanIssue) => {
    try {
      const previewResponse = await fetch(`/api/workspace/projects/${projectId}/problems/${entry.id}/preview`, { method: "POST" });
      const previewPayload = await previewResponse.json() as { error?: string; preview?: { file?: string } };
      if (!previewResponse.ok) throw new Error(previewPayload.error || "Preview is unavailable.");
      const confirmed = window.confirm(`Create ${previewPayload.preview?.file || ".env.example"} from environment variable names only? A snapshot will be created first.`);
      if (!confirmed) return;
      const applyResponse = await fetch(`/api/workspace/projects/${projectId}/problems/${entry.id}/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verify: true }) });
      const applyPayload = await applyResponse.json() as { ok?: boolean; rolledBack?: boolean; error?: string; snapshot?: { id?: string } };
      if (!applyResponse.ok) throw new Error(applyPayload.error || "The solution was not applied.");
      setSolutionStatus(`Applied with snapshot ${applyPayload.snapshot?.id || "created"}.`);
    } catch (cause: unknown) { setSolutionStatus(cause instanceof Error ? cause.message : "Solution action failed."); }
  };
  return <><div className="kf-card-heading"><div><ShieldAlert size={17} /><h3>Problems center</h3></div><span>{scannedAt ? `Scan ${formatDate(scannedAt)}` : "Run scan to load"}</span></div>{!scannedAt ? <div className="kf-card-empty"><p>No normalized diagnostics are loaded for this project.</p></div> : <><div className="kf-problem-filters"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search diagnostics" aria-label="Search problems" /><select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="all">All severity</option>{["critical", "high", "medium", "low", "info"].map((value) => <option key={value}>{value}</option>)}</select><select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All sources</option>{sources.map((value) => <option key={value}>{value}</option>)}</select><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select></div><div className="kf-issues">{filtered.length ? <>{filtered.map((entry) => <details key={entry.id} className="kf-issue"><summary><span className={`kf-severity kf-severity--${entry.severity}`}>{entry.severity}</span><span><strong>{entry.title}</strong><small>{entry.source} · {entry.file || entry.category}</small></span><ChevronRight size={15} /></summary><div><p>{entry.description}</p><p className="kf-suggestion"><Wrench size={14} />{entry.fixability === "automatic" ? "Automatic patch may be available after review." : entry.suggestion || "Manual review is required."}</p>{entry.id.endsWith(":missing-env-example") && <button className="kf-solution-button" onClick={() => void applyEnvironmentTemplate(entry)}>Preview + Apply safe template</button>}</div></details>)}{solutionStatus && <p className="kf-solution-status">{solutionStatus}</p>}</> : <div className="kf-card-empty"><p>No problems match the selected filters.</p></div>}</div></>}</>;
}

function PlanOutput({ value }: { value: unknown }) {
  if (typeof value === "string") return <article className="kf-command-evidence"><strong>Plan</strong><pre>{value}</pre></article>;
  if (value === null || value === undefined) return <p className="kf-capability-copy">No plan content was returned.</p>;
  if (Array.isArray(value)) return <article className="kf-command-evidence"><strong>Plan steps</strong><pre>{JSON.stringify(value, null, 2)}</pre></article>;
  if (typeof value !== "object") return <article className="kf-command-evidence"><strong>Plan</strong><pre>{String(value)}</pre></article>;
  const record = value as Record<string, unknown>;
  const summary = typeof record.summary === "string" ? record.summary : typeof record.goal === "string" ? record.goal : typeof record.mission === "string" ? record.mission : "Evidence-backed plan";
  const steps = Array.isArray(record.steps) ? record.steps : Array.isArray(record.tasks) ? record.tasks : [];
  const risks = Array.isArray(record.risks) ? record.risks : Array.isArray(record.warnings) ? record.warnings : [];
  const verification = Array.isArray(record.verification) ? record.verification : record.verification ? [record.verification] : [];
  return <article className="kf-command-evidence"><strong>Plan summary</strong><p>{summary}</p>{steps.length > 0 && <><strong>Steps</strong><pre>{JSON.stringify(steps, null, 2)}</pre></>}{risks.length > 0 && <><strong>Risks</strong><pre>{JSON.stringify(risks, null, 2)}</pre></>}{verification.length > 0 && <><strong>Verification</strong><pre>{JSON.stringify(verification, null, 2)}</pre></>}{steps.length === 0 && risks.length === 0 && verification.length === 0 && <pre>{JSON.stringify(record, null, 2)}</pre>}</article>;
}

function AgentPanel({ projectId }: { projectId: string }) {
  const [mission, setMission] = useState("Review diagnostics and produce a safe implementation plan.");
  const [result, setResult] = useState<unknown>(null);
  const [status, setStatus] = useState("KForge Engineer reads project context and uses a local model only when one is available.");
  const [working, setWorking] = useState(false);
  const plan = async () => {
    setWorking(true);
    try {
      const response = await fetch(`/api/workspace/projects/${projectId}/agent/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mission }) });
      const payload = await response.json() as { plan?: unknown; error?: string; mode?: "local-ai" | "rules"; provider?: string | { provider?: string; reason?: string } };
      const providerReason = typeof payload.provider === "object" && payload.provider ? payload.provider.reason : undefined;
      if (!response.ok) { setResult(null); setStatus(payload.error || providerReason || "Local AI is unavailable."); return; }
      setResult(payload.plan ?? null);
      const providerName = typeof payload.provider === "string" ? payload.provider : payload.provider?.provider;
      setStatus(payload.mode === "local-ai" ? `Plan generated by local ${providerName || "AI"}.` : "Evidence-based deterministic plan generated from the current scan.");
    } catch (cause: unknown) { setStatus(cause instanceof Error ? cause.message : "Local AI request failed."); }
    finally { setWorking(false); }
  };
  return <><div className="kf-card-heading"><div><Bot size={17} /><h3>KForge Engineer</h3></div><span>Read + plan</span></div><div className="kf-agent-panel"><textarea value={mission} onChange={(event) => setMission(event.target.value)} aria-label="KForge Engineer mission" /><button className="kf-button kf-button--ghost" onClick={() => void plan()} disabled={working}>{working ? "Planning…" : "Generate plan"}</button><p>{status}</p>{result !== null && <PlanOutput value={result} />}</div></>;
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: "good" | "warning" | "bad" | "neutral" }) { return <div className={`kf-metric kf-metric--${tone}`}><span>{icon}</span><small>{label}</small><strong>{value}</strong></div>; }

function WorkspaceLoading() { return <div className="kf-loading"><div /><div /><div /><div /></div>; }
function WorkspaceEmpty({ onOpen }: { onOpen: () => void }) { return <div className="kf-empty"><FolderOpen size={28} /><h2>No projects found</h2><p>Choose a local repository or clone one into the configured KForge workspace to begin.</p><button className="kf-button kf-button--primary" onClick={onOpen}><Plus size={16} />Open local project</button></div>; }

function ProjectModal({ mode, localPath, setLocalPath, remoteUrl, setRemoteUrl, targetName, setTargetName, submitting, onClose, onSubmit }: { mode: "open" | "clone"; localPath: string; setLocalPath: (value: string) => void; remoteUrl: string; setRemoteUrl: (value: string) => void; targetName: string; setTargetName: (value: string) => void; submitting: boolean; onClose: () => void; onSubmit: () => void }) { const clone = mode === "clone"; return <div className="kf-overlay" role="dialog" aria-modal="true" aria-labelledby="project-modal-title"><form className="kf-modal" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}><div><p className="kf-eyebrow">{clone ? "Remote repository" : "Local project"}</p><h2 id="project-modal-title">{clone ? "Clone repository" : "Open project"}</h2><p>{clone ? "Clone a GitHub or GitLab HTTPS repository directly into the configured KForge workspace." : "Enter an existing local project folder. KForge will detect its stack and real Git state."}</p></div>{clone ? <><label>Repository HTTPS URL<input required value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://github.com/owner/repository.git" /></label><label>Destination folder name<input required pattern="[A-Za-z0-9._-]+" value={targetName} onChange={(event) => setTargetName(event.target.value)} placeholder="my-repository" /></label></> : <label>Local project path<input required value={localPath} onChange={(event) => setLocalPath(event.target.value)} placeholder="D:\\Projects\\my-repository" /></label>}<div className="kf-modal-actions"><button type="button" className="kf-button kf-button--ghost" onClick={onClose}>Cancel</button><button type="submit" className="kf-button kf-button--primary" disabled={submitting}>{submitting ? "Working…" : clone ? "Clone repository" : "Open project"}</button></div></form></div>; }

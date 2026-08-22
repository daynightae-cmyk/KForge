import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
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
  Plus,
  RefreshCw,
  Rocket,
  Search,
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
  { group: "Projects", items: [["Workspace", LayoutDashboard], ["Recent projects", History], ["Open project", FolderOpen]] },
  { group: "AI", items: [["AI providers", Bot], ["Models", Cpu], ["Agents", Bot], ["Tasks", Activity]] },
  { group: "Intelligence", items: [["Project graph", Network], ["Ask KForge", MessageSquare], ["Architecture", Box]] },
  { group: "Quality", items: [["KForge Sonar", ShieldAlert], ["Problems", ShieldAlert], ["Solutions", Wrench]] },
  { group: "Release", items: [["Release Gate", Rocket]] },
  { group: "Developer tools", items: [["Terminal", Terminal], ["Tests", TestTube2], ["Build", Play]] },
  { group: "Remote", items: [["Git", GitBranch], ["GitHub", Github]] },
] as const;

type Status = WorkspaceStatus;
type SortKey = "name" | "projectType" | "branch" | "lastActivity" | "sync";

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
      const matchesQuery = !normalizedQuery || [project.name, project.path, project.branch, project.projectType, project.provider].join(" ").toLowerCase().includes(normalizedQuery);
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

  const controlTask = async (task: TaskItem, control: "cancel" | "retry") => {
    try {
      const response = await fetch(`/api/workspace/tasks/${task.id}/${control}`, { method: "POST" });
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
                  <tbody>{filteredProjects.map((project) => <ProjectRow key={project.id} project={project} selected={selected.has(project.id)} active={project.id === activeProjectId} scan={scans[project.id]} results={actionResults[project.id]} columns={columns} onSelect={() => toggleSelected(project.id)} onActivate={() => setActiveProjectId(project.id)} onRun={(action) => void runAction(project, action)} />)}</tbody></table>
                </div>
              )
            )}
            <div className="kf-group-header kf-group-header--collapsed"><button onClick={() => setOpenGroups((state) => ({ ...state, others: !state.others }))}>{openGroups.others ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<span>Connected & recent</span><small>{projects.filter((project) => project.provider === "GitHub").length}</small></button><span>{openGroups.others ? "GitHub-connected repositories appear in the local projects list." : ""}</span></div>
          </section>

          {activeProject && activeNav !== "Workspace" && <CapabilityPanel activeNav={activeNav} project={activeProject} scan={activeScan} tasks={activeTaskList} platform={localPlatform} onPlatformModeChange={(mode) => void setPlatformMode(mode)} onRun={(action) => void runAction(activeProject, action)} onTaskControl={(task, control) => void controlTask(task, control)} />}
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

function ProjectRow({ project, selected, active, scan, results, columns, onSelect, onActivate, onRun }: { project: ProjectSummary; selected: boolean; active: boolean; scan?: ProjectScan; results?: Partial<Record<WorkspaceAction, CommandResult>>; columns: Record<string, boolean>; onSelect: () => void; onActivate: () => void; onRun: (action: WorkspaceAction) => void }) {
  const security = scan?.summaries.security || "unknown";
  const tests = results?.test?.ok ? "pass" : results?.test ? "fail" : "unknown";
  const build = results?.build?.ok ? "pass" : results?.build ? "fail" : "unknown";
  return <tr className={`${active ? "is-active" : ""} ${selected ? "is-selected" : ""}`} onClick={onActivate}><td onClick={(event) => event.stopPropagation()}><input aria-label={`Select ${project.name}`} type="checkbox" checked={selected} onChange={onSelect} /></td><td><button className="kf-project-cell" onClick={onActivate}><span className="kf-project-icon"><ProviderMark provider={project.provider} /></span><span><strong>{project.name}</strong><small title={project.path}>{project.trust === "untrusted" ? "Untrusted · read only" : "Trusted local execution"} · {project.path}</small></span></button></td>{columns.type && <td><span className="kf-type-pill">{project.projectType}</span></td>}{columns.branch && <td><span className="kf-branch"><GitBranch size={13} />{project.branch}</span></td>}{columns.status && <td><div className="kf-checks"><span className={statusClass(security)} title="Security"><ShieldAlert size={12} />{statusLabel(security)}</span><span className={statusClass(tests)} title="Tests"><TestTube2 size={12} />{statusLabel(tests)}</span><span className={statusClass(build)} title="Build"><Play size={12} />{statusLabel(build)}</span></div></td>}{columns.git && <td><GitState project={project} /></td>}{columns.activity && <td><span className="kf-date"><Clock3 size={13} />{formatDate(project.lastActivity)}</span></td>}<td onClick={(event) => event.stopPropagation()}><details className="kf-row-menu"><summary aria-label={`Actions for ${project.name}`}><MoreHorizontal size={18} /></summary><div><button onClick={() => onRun("scan")}>Scan project</button><button onClick={() => onRun("test")}>Run tests</button><button onClick={() => onRun("build")}>Run build</button>{project.remoteUrl && <a href={project.remoteUrl} target="_blank" rel="noreferrer">Open remote</a>}</div></details></td></tr>;
}

function GitState({ project }: { project: ProjectSummary }) { const changed = project.modifiedFiles + project.untrackedFiles; return <div className="kf-git-state"><span className={changed ? "is-warning" : "is-good"}>{changed ? `${changed} changed` : "Clean"}</span>{project.behind > 0 && <small>{project.behind} behind</small>}{project.ahead > 0 && <small>{project.ahead} ahead</small>}</div>; }

function ProjectInspector({ project, scan, results, tasks, onRun, onTaskControl }: { project: ProjectSummary; scan?: ProjectScan; results?: Partial<Record<WorkspaceAction, CommandResult>>; tasks: TaskItem[]; onRun: (action: WorkspaceAction) => void; onTaskControl: (task: TaskItem, control: "cancel" | "retry") => void }) {
  const issues = scan?.issues || [];
  const critical = issues.filter((issue) => issue.severity === "critical" || issue.severity === "high");
  const health = scan?.health.score;
  return <section className="kf-inspector"><div className="kf-inspector-header"><div><p className="kf-eyebrow">Project intelligence</p><h2>{project.name}</h2><p>{project.path}</p></div><div className="kf-inspector-actions"><button className="kf-button kf-button--primary" onClick={() => onRun("scan")}><ShieldAlert size={16} />Scan</button><button className="kf-button kf-button--ghost" onClick={() => onRun("test")}><TestTube2 size={16} />Test</button><button className="kf-button kf-button--ghost" onClick={() => onRun("build")}><Play size={16} />Build</button></div></div>
  <div className="kf-metrics"><Metric icon={<HeartPulse size={18} />} label="Project health" value={health === undefined ? "Not scanned" : `${health}%`} tone={health === undefined ? "neutral" : health >= 85 ? "good" : health >= 60 ? "warning" : "bad"} /><Metric icon={<ShieldAlert size={18} />} label="Security" value={scan ? `${critical.length} priority` : "Not scanned"} tone={critical.length ? "bad" : scan ? "good" : "neutral"} /><Metric icon={<TestTube2 size={18} />} label="Tests" value={results?.test ? (results.test.ok ? "Pass" : "Failed") : "Not run"} tone={!results?.test ? "neutral" : results.test.ok ? "good" : "bad"} /><Metric icon={<Play size={18} />} label="Build" value={results?.build ? (results.build.ok ? "Pass" : "Failed") : "Not run"} tone={!results?.build ? "neutral" : results.build.ok ? "good" : "bad"} /><Metric icon={<GitBranch size={18} />} label="Git" value={project.modifiedFiles + project.untrackedFiles ? `${project.modifiedFiles + project.untrackedFiles} changes` : "Clean"} tone={project.modifiedFiles + project.untrackedFiles ? "warning" : "good"} /></div>
  <div className="kf-inspector-grid"><article className="kf-inspector-card"><div className="kf-card-heading"><div><ShieldAlert size={17} /><h3>KForge Sonar</h3></div>{scan && <span>Last scan {formatDate(scan.scannedAt)}</span>}</div>{!scan ? <div className="kf-card-empty"><p>No audit result is loaded for this project.</p><button onClick={() => onRun("scan")}>Run full scan</button></div> : issues.length === 0 ? <div className="kf-card-empty kf-card-empty--good"><p>No security, dependency, or local Git findings were detected by this scan.</p></div> : <div className="kf-issues">{issues.slice(0, 5).map((issue) => <details key={issue.id} className="kf-issue"><summary><span className={`kf-severity kf-severity--${issue.severity}`}>{issue.severity}</span><span><strong>{issue.title}</strong><small>{issue.file || issue.category}</small></span><ChevronRight size={15} /></summary><div><p>{issue.message}</p>{issue.suggestion && <p className="kf-suggestion"><Wrench size={14} />{issue.suggestion}</p>}</div></details>)}</div>}</article>
  <article className="kf-inspector-card"><div className="kf-card-heading"><div><Bot size={17} /><h3>Agent workspace</h3></div><span>Task center</span></div>{tasks.length === 0 ? <div className="kf-card-empty"><p>Actions initiated in KForge are tracked here with their real command output.</p><button onClick={() => onRun("scan")}>Start audit task</button></div> : <div className="kf-task-list">{tasks.map((task) => <details key={task.id} className={`kf-task kf-task--${task.state}`}><summary><span className="kf-task-indicator">{task.state === "running" ? <RefreshCw size={14} className="kf-spin" /> : <Activity size={14} />}</span><span><strong>{task.action} · {task.state === "success" ? "completed" : task.state}</strong><small>{task.message} · {task.progress}%{task.finishedAt ? ` · ${Math.max(0, Math.round((new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime()) / 1000))}s` : ""}</small></span><ChevronRight size={15} /></summary><pre>{task.output || "Waiting for command output…"}</pre><div className="kf-task-controls">{task.state === "queued" && <button onClick={() => onTaskControl(task, "cancel")}>Cancel</button>}{(task.state === "success" || task.state === "error" || task.state === "cancelled" || task.state === "blocked") && <button onClick={() => onTaskControl(task, "retry")}>Retry</button>}</div></details>)}</div>}</article></div></section>;
}

function CapabilityPanel({ activeNav, project, scan, tasks, platform, onPlatformModeChange, onRun, onTaskControl }: { activeNav: string; project: ProjectSummary; scan?: ProjectScan; tasks: TaskItem[]; platform?: LocalPlatformStatus; onPlatformModeChange: (mode: LocalPlatformStatus["mode"]) => void; onRun: (action: WorkspaceAction) => void; onTaskControl: (task: TaskItem, control: "cancel" | "retry") => void }) {
  if (activeNav === "Settings") return <LocalPlatformPanel platform={platform} onModeChange={onPlatformModeChange} />;
  if (activeNav === "AI providers") return <LocalAIOnboarding onlineOptional={platform?.mode === "online-optional"} />;
  if (activeNav === "Models") return <AICenter view="models" onlineOptional={platform?.mode === "online-optional"} />;
  if (activeNav === "Agents") return <AgentMissionCenter project={project} />;
  if (activeNav === "Tasks") return <TaskCenterPanel tasks={tasks} onTaskControl={onTaskControl} />;
  if (activeNav === "Project graph") return <GraphPanel project={project} />;
  if (activeNav === "Architecture") return <DocumentationPanel project={project} />;
  if (activeNav === "Ask KForge") return <AskKForgePanel project={project} />;
  if (activeNav === "Release Gate") return <ReleaseGatePanel project={project} />;
  if (activeNav === "KForge Sonar" || activeNav === "Problems" || activeNav === "Solutions" || activeNav === "Security scan" || activeNav === "Dependencies") return <QualityPanel title={activeNav} scan={scan} onScan={() => onRun("scan")} />;
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Activity size={17} /><h3>{activeNav}</h3></div><span>Workspace</span></div><p className="kf-capability-copy">This Workspace section stays connected to the selected project and local engineering engine.</p></section>;
}

function LocalPlatformPanel({ platform, onModeChange }: { platform?: LocalPlatformStatus; onModeChange: (mode: LocalPlatformStatus["mode"]) => void }) {
  if (!platform) return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Settings2 size={17} /><h3>Local platform</h3></div></div><p className="kf-capability-copy">Reading local platform status…</p></section>;
  const offline = platform.mode === "offline";
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Settings2 size={17} /><h3>Local-First Platform</h3></div><span>{offline ? "Offline Mode" : "Online Optional"}</span></div><p className="kf-capability-copy">Core KForge engineering stays local, free of mandatory cloud APIs, subscriptions, and internet access. Online actions remain opt-in additions.</p><div className="kf-hardware-grid"><span><strong>Core readiness</strong>{platform.coreReady ? "Ready locally" : "Review local tooling"}</span><span><strong>Network for core</strong>{platform.networkRequiredForCore ? "Required" : "Not required"}</span><span><strong>Local storage</strong>{platform.storagePath}</span></div><div className="kf-provider-grid">{platform.capabilities.map((item) => <article className="kf-provider-card" key={item.id}><div><strong>{item.label}</strong><span>{item.state}</span></div><small>{item.detail}</small></article>)}</div><div className="kf-card-heading"><div><Network size={17} /><h3>Optional online integrations</h3></div><span>Never required for core</span></div><div className="kf-provider-grid">{platform.optionalOnlineFeatures.map((item) => <article className="kf-provider-card" key={item.id}><div><strong>{item.label}</strong><span>{item.enabled ? "Enabled" : "Disabled"}</span></div><small>{item.detail}</small></article>)}</div><div className="kf-inline-controls"><button className={`kf-button ${offline ? "kf-button--primary" : "kf-button--ghost"}`} onClick={() => onModeChange("offline")}>Use Offline Mode</button><button className={`kf-button ${offline ? "kf-button--ghost" : "kf-button--primary"}`} onClick={() => onModeChange("online-optional")}>Enable Online Optional</button></div></section>;
}

function LocalAIOnboarding({ onlineOptional }: { onlineOptional: boolean }) {
  const [data, setData] = useState<{ onboarding?: string; downloadUrl?: string; ollama?: { installed: boolean; serviceReachable: boolean; version?: string; reason?: string; models: Array<{ id: string; name: string; contextLength?: number }> }; hardware?: { cpu: { model: string }; memory: { totalBytes: number }; disk: { availableBytes?: number }; gpu: Array<{ name: string }> }; active?: { provider: string; model: string }; fallback?: { provider: string; model: string }; modelHealth?: Record<string, { status: string; testedAt: string; latencyMs?: number; reason?: string }> } | null>(null);
  const [message, setMessage] = useState("");
  const refresh = async () => { try { const response = await fetch("/api/workspace/ai/models"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Local AI status is unavailable."); setData(payload); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Local AI status failed."); } };
  useEffect(() => { void refresh(); }, []);
  const openInstaller = () => { if (!onlineOptional) { setMessage("Downloads are disabled in Offline Mode. Enable Online Optional only if you choose to open a provider download page."); return; } if (!window.confirm("Open the Ollama download page? KForge will not download or install anything automatically.")) return; if (data?.downloadUrl) window.open(data.downloadUrl, "_blank", "noopener,noreferrer"); setMessage("Download page opened after confirmation. Install Ollama, then choose Detect Existing Runtime."); };
  const setModel = async (model: string, fallback = false) => { try { const response = await fetch("/api/workspace/ai/models/active", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "ollama", model, fallback }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Model selection failed."); setMessage(fallback ? `Fallback model set to ${model}.` : `Active model set to ${model}.`); await refresh(); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Model selection failed."); } };
  const test = async (model: string) => { try { const response = await fetch("/api/workspace/ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "ollama", model }) }); const payload = await response.json(); setMessage(response.ok ? `Health test PASS: ${model} responded in ${payload.latencyMs} ms.` : payload.error || "Health test failed."); await refresh(); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Health test failed."); } };
  const remove = async (model: string) => { if (!window.confirm(`Remove local model ${model}? This deletes its downloaded model data.`)) return; try { const response = await fetch(`/api/workspace/ai/models/${encodeURIComponent(model)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "ollama", confirmed: true }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Model removal failed."); setMessage(payload.message || `Removed ${model}.`); await refresh(); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Model removal failed."); } };
  const ollama = data?.ollama;
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Bot size={17} /><h3>Enable Local AI</h3></div><button onClick={() => void refresh()}>Detect Existing Runtime</button></div>{message && <p className="kf-capability-message">{message}</p>}<div className="kf-wizard-steps"><span className="is-current">1 Hardware</span><span className={ollama?.installed ? "is-current" : ""}>2 Runtime</span><span>3 Models</span><span>4 Confirm</span><span>5 Install</span><span>6 Health test</span><span>7 Activate</span></div><div className="kf-provider-grid"><article className="kf-provider-card"><div><strong>Hardware Detection</strong><span>Step 1</span></div><p>{data?.hardware?.cpu.model || "Detecting CPU…"}</p><small>{data?.hardware ? `${Math.round(data.hardware.memory.totalBytes / 1e9)} GB RAM · ${(data.hardware.gpu || []).map((gpu) => gpu.name).join(", ") || "No dedicated GPU"} · ${data.hardware.disk.availableBytes ? `${Math.round(data.hardware.disk.availableBytes / 1e9)} GB free` : "disk unavailable"}` : "Waiting for local hardware data."}</small></article><article className="kf-provider-card"><div><strong>Ollama</strong><span>{ollama?.installed ? "Installed" : "Not installed"}</span></div><p>{ollama?.serviceReachable ? "Status: Connected" : "Local AI is not configured."}</p><small>{ollama?.version || ollama?.reason || "Detect an existing runtime or install Ollama after confirmation."}</small>{!ollama?.installed && <button onClick={openInstaller}>Install Ollama</button>}{ollama?.installed && !ollama?.serviceReachable && <button onClick={() => void refresh()}>Verify service</button>}<button onClick={() => setMessage("KForge can use Ollama, LM Studio, or llama.cpp when their local runtime is detected. No cloud provider is selected automatically.")}>Use Existing Provider</button></article></div>{ollama?.models?.length ? <div className="kf-provider-grid">{ollama.models.map((model) => { const health = data?.modelHealth?.[`ollama:${model.id}`]; return <article className="kf-provider-card" key={model.id}><div><strong>{model.name}</strong><span>{model.contextLength ? `${model.contextLength} ctx` : "local"}</span></div><p>{data?.active?.model === model.id ? "Active model" : data?.fallback?.model === model.id ? "Fallback model" : "Installed model"}</p><small>{health ? `Last test: ${health.status.toUpperCase()} ${health.latencyMs ? `· ${health.latencyMs} ms` : ""} ${health.reason || ""}` : "No health test recorded."}</small><div className="kf-provider-model"><button onClick={() => void setModel(model.id)}>Activate</button><button onClick={() => void setModel(model.id, true)}>Fallback</button><button onClick={() => void test(model.id)}>Test</button><button onClick={() => void remove(model.id)}>Remove</button></div></article>; })}</div> : <p className="kf-capability-copy">Continue Without AI keeps evidence-based planning active. After a runtime and model are available, KForge uses the selected local model for Ask KForge, planning, and Sonar explanations.</p>}</section>;
}

function AICenter({ view, onlineOptional }: { view: "providers" | "models"; onlineOptional: boolean }) {
  const [data, setData] = useState<{ providers?: Array<{ id: string; name: string; kind: string; configured: boolean; reachable: boolean; available: boolean; endpoint?: string; models: Array<{ id: string; name: string }>; reason?: string; privacy?: string }>; hardware?: { os: string; cpu: { model: string; cores: number }; memory: { totalBytes: number }; gpu: Array<{ name: string; vramBytes?: number }>; disk: { availableBytes?: number } }; recommendations?: Array<{ id: string; label: string; pullName: string; parameterCount: string; estimatedDownloadBytes: number; estimatedRamBytes: number; license: string; compatible: boolean; reason: string }>; active?: { provider: string; model: string } } | null>(null);
  const [message, setMessage] = useState("");
  const refresh = async () => { try { const response = await fetch(view === "models" ? "/api/workspace/ai/models" : "/api/workspace/ai/providers"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "AI Center is unavailable."); setData(view === "models" ? payload : { providers: payload.providers }); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "AI Center request failed."); } };
  useEffect(() => { void refresh(); }, [view]);
  const install = async (pullName: string) => { if (!onlineOptional) { setMessage("Model downloads are disabled in Offline Mode. Existing local models and deterministic assistance remain available."); return; } if (!window.confirm(`Download ${pullName}? KForge will use disk, RAM, and network only after this confirmation.`)) return; try { const response = await fetch("/api/workspace/ai/models/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "ollama", model: pullName, confirmed: true }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Installation could not start."); setMessage(`Installation task ${payload.task?.id || "started"} is running in the local engine.`); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Installation failed."); } };
  const test = async (provider: string, model: string) => { try { const response = await fetch("/api/workspace/ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, model }) }); const payload = await response.json(); setMessage(response.ok ? `Test passed in ${payload.latencyMs} ms using ${payload.model}.` : payload.error || "Test failed."); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "AI test failed."); } };
  const providers = data?.providers || [];
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Cpu size={17} /><h3>{view === "models" ? "KForge Model Center" : "KForge AI Center"}</h3></div><button onClick={() => void refresh()}>Refresh</button></div>{message && <p className="kf-capability-message">{message}</p>}{view === "providers" ? <div className="kf-provider-grid">{providers.map((provider) => <article key={provider.id} className="kf-provider-card"><div><strong>{provider.name}</strong><span>{provider.kind}</span></div><p>{provider.available ? "Ready" : provider.reachable ? "Reachable — no model" : provider.configured ? "Configured — not contacted" : "Not configured"}</p><small>{provider.endpoint || provider.reason || provider.privacy}</small>{provider.models.map((model) => <div className="kf-provider-model" key={model.id}><span>{model.name}</span><button onClick={() => void test(provider.id, model.id)}>Test</button></div>)}</article>)}</div> : <div className="kf-model-center"><div className="kf-hardware-grid"><span><strong>OS</strong>{data?.hardware?.os || "Loading"}</span><span><strong>CPU</strong>{data?.hardware?.cpu.model || "Loading"}</span><span><strong>RAM</strong>{data?.hardware ? `${Math.round(data.hardware.memory.totalBytes / 1e9)} GB` : "Loading"}</span><span><strong>GPU</strong>{data?.hardware?.gpu.map((gpu) => gpu.name).join(", ") || "Not reported"}</span><span><strong>Free disk</strong>{data?.hardware?.disk.availableBytes ? `${Math.round(data.hardware.disk.availableBytes / 1e9)} GB` : "Unavailable"}</span></div><div className="kf-provider-grid">{(data?.recommendations || []).map((model) => <article key={model.id} className={`kf-provider-card ${model.compatible ? "is-compatible" : "is-incompatible"}`}><div><strong>{model.label}</strong><span>{model.parameterCount}</span></div><p>{model.compatible ? "Compatible with detected budget" : "Not recommended"}</p><small>{model.reason}</small><small>{model.license} · ~{Math.round(model.estimatedDownloadBytes / 1e9)} GB download</small><button disabled={!model.compatible || !onlineOptional} title={!onlineOptional ? "Enable Online Optional mode before downloading a model." : undefined} onClick={() => void install(model.pullName)}>Install with confirmation</button></article>)}</div></div>}</section>;
}

function AgentMissionCenter({ project }: { project: ProjectSummary }) {
  const [mission, setMission] = useState("audit");
  const [status, setStatus] = useState("Choose a mission. KForge records task logs, applies only verified safe patches, and restores snapshots on failed verification.");
  const start = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/agent/missions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mission }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Mission could not start."); setStatus(`Mission task ${payload.task.id} started. Open Tasks to follow its event log.`); } catch (cause: unknown) { setStatus(cause instanceof Error ? cause.message : "Mission start failed."); } };
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Bot size={17} /><h3>KForge Engineer missions</h3></div><span>Read · Plan · Patch · Verify</span></div><div className="kf-inline-controls"><select value={mission} onChange={(event) => setMission(event.target.value)}><option value="audit">Audit project</option><option value="fix-critical">Fix critical issue</option><option value="prepare-release">Prepare production release</option></select><button className="kf-button kf-button--primary" onClick={() => void start()}>Start mission</button></div><p className="kf-capability-copy">{status}</p></section>;
}

function TaskCenterPanel({ tasks, onTaskControl }: { tasks: TaskItem[]; onTaskControl: (task: TaskItem, control: "cancel" | "retry") => void }) { return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Activity size={17} /><h3>Task Center v2</h3></div><span>{tasks.length} selected-project task(s)</span></div>{tasks.length ? <div className="kf-task-list">{tasks.map((task) => <details key={task.id} className={`kf-task kf-task--${task.state}`}><summary><span><strong>{task.action} · {task.state}</strong><small>{task.message} · {task.progress}%{task.finishedAt ? ` · ${Math.max(0, Math.round((new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime()) / 1000))}s` : ""}</small></span><ChevronRight size={15} /></summary><pre>{task.output || "Waiting for process output…"}</pre>{task.state === "queued" && <button onClick={() => onTaskControl(task, "cancel")}>Cancel queued task</button>}{["success", "error", "cancelled", "blocked"].includes(task.state) && <button onClick={() => onTaskControl(task, "retry")}>Retry task</button>}</details>)}</div> : <p className="kf-capability-copy">Agent and project tasks appear here after they start. Logs and output come from the actual local process.</p>}</section>; }

function DocumentationPanel({ project }: { project: ProjectSummary }) {
  const [audit, setAudit] = useState<{ findings: Array<{ id: string; sourceDocument: string; claim: string; evidence: string; actualState: string; severity: string; suggestedFix: string }> } | null>(null);
  const [message, setMessage] = useState("Loading local documentation evidence…");
  const refresh = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/documentation`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Documentation audit failed."); setAudit(payload.audit); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Documentation audit failed."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  const previewAndApply = async (findingId: string) => { try { const previewResponse = await fetch(`/api/workspace/projects/${project.id}/documentation/${findingId}/preview`, { method: "POST" }); const preview = await previewResponse.json(); if (!previewResponse.ok || !preview.patch) throw new Error(preview.reason || "This evidence requires manual review."); if (!window.confirm(`Apply documentation fix?\n\n${preview.patch.before}\n→ ${preview.patch.after}`)) return; const applyResponse = await fetch(`/api/workspace/projects/${project.id}/documentation/${findingId}/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }) }); const applied = await applyResponse.json(); if (!applyResponse.ok || !applied.verified) throw new Error(applied.reason || "Documentation verification failed."); setMessage("Documentation fix applied and re-audited."); await refresh(); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Documentation fix failed."); } };
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Box size={17} /><h3>Documentation Audit V2</h3></div><button onClick={() => void refresh()}>Refresh</button></div>{message && <p className="kf-capability-message" role="status">{message}</p>}{!audit ? <p className="kf-capability-copy">Loading documentation evidence…</p> : audit.findings.length === 0 ? <p className="kf-capability-copy">No semantic contradictions, missing local links, or stale package commands were detected.</p> : <div className="kf-issues">{audit.findings.map((finding) => <details className="kf-issue" key={finding.id}><summary><span className={`kf-severity kf-severity--${finding.severity === "high" ? "high" : finding.severity === "medium" ? "medium" : "low"}`}>{finding.severity}</span><span><strong>{finding.sourceDocument}</strong><small>{finding.claim}</small></span><ChevronRight size={15} /></summary><div><p><strong>Evidence:</strong> {finding.evidence}</p><p><strong>Actual state:</strong> {finding.actualState}</p><p className="kf-suggestion"><Wrench size={14} />{finding.suggestedFix}</p>{project.trust === "trusted" && <button className="kf-solution-button" onClick={() => void previewAndApply(finding.id)}>Preview + Apply + Verify</button>}{project.trust !== "trusted" && <p className="kf-capability-copy">Blocked until this project is trusted for a write operation.</p>}</div></details>)}</div>}</section>;
}

function GraphPanel({ project }: { project: ProjectSummary }) { const [data, setData] = useState<{ graph?: { summary: { files: number; imports: number; routes: number; apis: number; tests: number } } } | null>(null); const [message, setMessage] = useState(""); useEffect(() => { void (async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/graph`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Graph unavailable."); setData(payload); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Graph request failed."); } })(); }, [project.id]); const summary = data?.graph?.summary; return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Network size={17} /><h3>Project Graph</h3></div><span>Actual static evidence</span></div>{summary ? <div className="kf-hardware-grid"><span><strong>Files</strong>{summary.files}</span><span><strong>Imports</strong>{summary.imports}</span><span><strong>Routes</strong>{summary.routes}</span><span><strong>APIs</strong>{summary.apis}</span><span><strong>Tests</strong>{summary.tests}</span></div> : <p className="kf-capability-copy">{message || "Building graph…"}</p>}</section>; }

function AskKForgePanel({ project }: { project: ProjectSummary }) { const [question, setQuestion] = useState("What are the 5 biggest risks in this project?"); const [answer, setAnswer] = useState(""); const ask = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Ask KForge failed."); setAnswer(typeof payload.answer === "string" ? payload.answer : JSON.stringify(payload.answer, null, 2)); } catch (cause: unknown) { setAnswer(cause instanceof Error ? cause.message : "Ask KForge failed."); } }; return <section className="kf-capability-panel"><div className="kf-card-heading"><div><MessageSquare size={17} /><h3>Ask KForge</h3></div><span>Project-grounded</span></div><div className="kf-agent-panel"><textarea value={question} onChange={(event) => setQuestion(event.target.value)} /><button className="kf-button kf-button--primary" onClick={() => void ask()}>Ask</button>{answer && <pre>{answer}</pre>}</div></section>; }

function ReleaseGatePanel({ project }: { project: ProjectSummary }) { const [result, setResult] = useState(""); const run = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/release-gate`, { method: "POST" }); const payload = await response.json(); setResult(JSON.stringify({ readiness: payload.readiness, checks: payload.checks, missingChecks: payload.missingChecks, blockers: payload.blockers?.map((entry: ScanIssue) => entry.title) }, null, 2)); } catch (cause: unknown) { setResult(cause instanceof Error ? cause.message : "Release Gate failed."); } }; return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Rocket size={17} /><h3>KForge Release Gate</h3></div><span>Typecheck · Tests · Build · Runtime · Security</span></div><button className="kf-button kf-button--primary" onClick={() => void run()}>Run Release Gate</button>{result && <pre className="kf-release-output">{result}</pre>}</section>; }

function QualityPanel({ title, scan, onScan }: { title: string; scan?: ProjectScan; onScan: () => void }) { const issues = scan?.issues || []; return <section className="kf-capability-panel"><div className="kf-card-heading"><div><ShieldAlert size={17} /><h3>{title}</h3></div><button onClick={onScan}>Run current scan</button></div>{scan ? <div className="kf-issues">{issues.slice(0, 8).map((entry) => <details key={entry.id} className="kf-issue"><summary><span className={`kf-severity kf-severity--${entry.severity}`}>{entry.severity}</span><span><strong>{entry.title}</strong><small>{entry.source} · {entry.rule || entry.category}</small></span><ChevronRight size={15} /></summary><p>{entry.suggestion || entry.description}</p></details>)}</div> : <p className="kf-capability-copy">No scan is loaded. Start a real local scan to populate this panel.</p>}</section>; }

function ProjectInspectorV2({ project, scan, results, tasks, onRun, onTaskControl }: { project: ProjectSummary; scan?: ProjectScan; results?: Partial<Record<WorkspaceAction, CommandResult>>; tasks: TaskItem[]; onRun: (action: WorkspaceAction) => void; onTaskControl: (task: TaskItem, control: "cancel" | "retry") => void }) {
  const health = scan?.health.score;
  const critical = (scan?.issues || []).filter((entry) => entry.severity === "critical" || entry.severity === "high");
  return <section className="kf-inspector"><div className="kf-inspector-header"><div><p className="kf-eyebrow">Project intelligence</p><h2>{project.name}</h2><p>{project.path}</p></div><div className="kf-inspector-actions"><button className="kf-button kf-button--primary" onClick={() => onRun("scan")}><ShieldAlert size={16} />Scan</button><button className="kf-button kf-button--ghost" onClick={() => onRun("typecheck")}>Typecheck</button><button className="kf-button kf-button--ghost" onClick={() => onRun("test")}><TestTube2 size={16} />Test</button><button className="kf-button kf-button--ghost" onClick={() => onRun("build")}><Play size={16} />Build</button></div></div><div className="kf-metrics"><Metric icon={<HeartPulse size={18} />} label="Project health" value={health === undefined || health === null ? "Evidence pending" : `${health}%`} tone={health === undefined || health === null ? "neutral" : health >= 85 ? "good" : health >= 60 ? "warning" : "bad"} /><Metric icon={<ShieldAlert size={18} />} label="Problems" value={scan ? `${critical.length} priority` : "Not scanned"} tone={critical.length ? "bad" : scan ? "good" : "neutral"} /><Metric icon={<TestTube2 size={18} />} label="Tests" value={results?.test ? (results.test.ok ? "Pass" : "Failed") : "Not run"} tone={!results?.test ? "neutral" : results.test.ok ? "good" : "bad"} /><Metric icon={<Play size={18} />} label="Build" value={results?.build ? (results.build.ok ? "Pass" : "Failed") : "Not run"} tone={!results?.build ? "neutral" : results.build.ok ? "good" : "bad"} /><Metric icon={<GitBranch size={18} />} label="Git" value={project.modifiedFiles + project.untrackedFiles ? `${project.modifiedFiles + project.untrackedFiles} changes` : "Clean"} tone={project.modifiedFiles + project.untrackedFiles ? "warning" : "good"} /></div><div className="kf-inspector-grid"><article className="kf-inspector-card"><ProblemsCenter projectId={project.id} issues={scan?.issues || []} scannedAt={scan?.scannedAt} /></article><article className="kf-inspector-card"><AgentPanel projectId={project.id} /><div className="kf-card-heading"><div><Activity size={17} /><h3>Task center</h3></div><span>{tasks.length} task(s)</span></div>{tasks.length === 0 ? <div className="kf-card-empty"><p>Long-running KForge operations appear here with their actual process output.</p><button onClick={() => onRun("scan")}>Start audit task</button></div> : <div className="kf-task-list">{tasks.map((task) => <details key={task.id} className={`kf-task kf-task--${task.state}`}><summary><span className="kf-task-indicator">{task.state === "running" ? <RefreshCw size={14} className="kf-spin" /> : <Activity size={14} />}</span><span><strong>{task.action} · {task.state === "success" ? "completed" : task.state}</strong><small>{task.message} · {task.progress}%{task.finishedAt ? ` · ${Math.max(0, Math.round((new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime()) / 1000))}s` : ""}</small></span><ChevronRight size={15} /></summary><pre>{task.output || "Waiting for command output…"}</pre><div className="kf-task-controls">{task.state === "queued" && <button onClick={() => onTaskControl(task, "cancel")}>Cancel</button>}{(task.state === "success" || task.state === "error" || task.state === "cancelled" || task.state === "blocked") && <button onClick={() => onTaskControl(task, "retry")}>Retry</button>}</div></details>)}</div>}</article></div></section>;
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

function AgentPanel({ projectId }: { projectId: string }) {
  const [mission, setMission] = useState("Review diagnostics and produce a safe implementation plan.");
  const [result, setResult] = useState("");
  const [status, setStatus] = useState("KForge Engineer reads project context and uses a local model only when one is available.");
  const [working, setWorking] = useState(false);
  const plan = async () => {
    setWorking(true);
    try {
      const response = await fetch(`/api/workspace/projects/${projectId}/agent/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mission }) });
      const payload = await response.json() as { plan?: string; error?: string; provider?: { provider?: string; reason?: string } };
      if (!response.ok) { setResult(""); setStatus(payload.error || payload.provider?.reason || "Local AI is unavailable."); return; }
      setResult(payload.plan || "");
      setStatus(`Plan generated by local ${payload.provider?.provider || "AI"}.`);
    } catch (cause: unknown) { setStatus(cause instanceof Error ? cause.message : "Local AI request failed."); }
    finally { setWorking(false); }
  };
  return <><div className="kf-card-heading"><div><Bot size={17} /><h3>KForge Engineer</h3></div><span>Read + plan</span></div><div className="kf-agent-panel"><textarea value={mission} onChange={(event) => setMission(event.target.value)} aria-label="KForge Engineer mission" /><button className="kf-button kf-button--ghost" onClick={() => void plan()} disabled={working}>{working ? "Planning…" : "Generate plan"}</button><p>{status}</p>{result && <pre>{result}</pre>}</div></>;
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: "good" | "warning" | "bad" | "neutral" }) { return <div className={`kf-metric kf-metric--${tone}`}><span>{icon}</span><small>{label}</small><strong>{value}</strong></div>; }

function WorkspaceLoading() { return <div className="kf-loading"><div /><div /><div /><div /></div>; }
function WorkspaceEmpty({ onOpen }: { onOpen: () => void }) { return <div className="kf-empty"><FolderOpen size={28} /><h2>No projects found</h2><p>Choose a local repository or clone one into the configured KForge workspace to begin.</p><button className="kf-button kf-button--primary" onClick={onOpen}><Plus size={16} />Open local project</button></div>; }

function ProjectModal({ mode, localPath, setLocalPath, remoteUrl, setRemoteUrl, targetName, setTargetName, submitting, onClose, onSubmit }: { mode: "open" | "clone"; localPath: string; setLocalPath: (value: string) => void; remoteUrl: string; setRemoteUrl: (value: string) => void; targetName: string; setTargetName: (value: string) => void; submitting: boolean; onClose: () => void; onSubmit: () => void }) { const clone = mode === "clone"; return <div className="kf-overlay" role="dialog" aria-modal="true" aria-labelledby="project-modal-title"><form className="kf-modal" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}><div><p className="kf-eyebrow">{clone ? "Remote repository" : "Local project"}</p><h2 id="project-modal-title">{clone ? "Clone repository" : "Open project"}</h2><p>{clone ? "Clone a GitHub or GitLab HTTPS repository directly into the configured KForge workspace." : "Enter an existing local project folder. KForge will detect its stack and real Git state."}</p></div>{clone ? <><label>Repository HTTPS URL<input required value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://github.com/owner/repository.git" /></label><label>Destination folder name<input required pattern="[A-Za-z0-9._-]+" value={targetName} onChange={(event) => setTargetName(event.target.value)} placeholder="my-repository" /></label></> : <label>Local project path<input required value={localPath} onChange={(event) => setLocalPath(event.target.value)} placeholder="D:\\Projects\\my-repository" /></label>}<div className="kf-modal-actions"><button type="button" className="kf-button kf-button--ghost" onClick={onClose}>Cancel</button><button type="submit" className="kf-button kf-button--primary" disabled={submitting}>{submitting ? "Working…" : clone ? "Clone repository" : "Open project"}</button></div></form></div>; }

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
  Network,
  Play,
  Plus,
  RefreshCw,
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
  WorkspaceAction,
  WorkspaceResponse,
} from "@shared/workspace";

const NAVIGATION = [
  { group: "Projects", items: [["Workspace", LayoutDashboard], ["Recent projects", History], ["Open project", FolderOpen]] },
  { group: "Project intelligence", items: [["Overview", HeartPulse], ["Project graph", Network], ["Architecture", Box]] },
  { group: "Audit", items: [["KForge Sonar", ShieldAlert], ["Security scan", ShieldAlert], ["Dependencies", Box]] },
  { group: "Developer tools", items: [["Terminal", Terminal], ["Tests", TestTube2], ["Build", Play]] },
  { group: "Remote", items: [["Git", GitBranch], ["GitHub", Github], ["Agent tasks", Bot]] },
] as const;

type Status = "pass" | "warning" | "fail" | "unknown" | "running";
type SortKey = "name" | "projectType" | "branch" | "lastActivity" | "sync";

interface TaskItem {
  id: string;
  projectId: string;
  action: WorkspaceAction;
  state: "running" | "success" | "error";
  output: string;
  message: string;
  startedAt: string;
}

function formatDate(value?: string) {
  if (!value) return "Not scanned";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function statusLabel(status: Status) {
  return ({ pass: "Pass", warning: "Warning", fail: "Needs review", unknown: "Not run", running: "Running" } as const)[status];
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
  const [actionResults, setActionResults] = useState<Record<string, Partial<Record<WorkspaceAction, CommandResult>>>>({});
  const [scans, setScans] = useState<Record<string, ProjectScan>>({});
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [modal, setModal] = useState<"open" | "clone" | null>(null);
  const [localPath, setLocalPath] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [targetName, setTargetName] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  const runAction = async (project: ProjectSummary, action: WorkspaceAction) => {
    const taskId = `${project.id}-${action}-${Date.now()}`;
    setTasks((previous) => [{ id: taskId, projectId: project.id, action, state: "running", output: "", message: "Starting…", startedAt: new Date().toISOString() }, ...previous]);
    try {
      const response = await fetch(`/api/workspace/projects/${project.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload: CommandResult | { error?: string; message?: string; output?: string } = await response.json();
      const result = payload as CommandResult;
      setActionResults((previous) => ({ ...previous, [project.id]: { ...previous[project.id], [action]: result } }));
      if (action === "scan" && result.output) {
        try {
          const scan: ProjectScan = JSON.parse(result.output);
          setScans((previous) => ({ ...previous, [project.id]: scan }));
        } catch {
          // Output stays available in the activity record when the scan result cannot be decoded.
        }
      }
      setTasks((previous) => previous.map((task) => task.id === taskId ? {
        ...task,
        state: response.ok && result.ok ? "success" : "error",
        output: result.output || "",
        message: result.message || (payload as any).error || "Action completed.",
      } : task));
      await refreshProjects();
    } catch (cause: any) {
      setTasks((previous) => previous.map((task) => task.id === taskId ? { ...task, state: "error", message: cause.message || "The action could not start." } : task));
    }
  };

  const runBulk = (action: WorkspaceAction) => {
    selectedProjects.forEach((project) => void runAction(project, action));
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
        <div className="kf-sidebar-footer"><span><CircleDot size={12} className="kf-live-dot" /> Local engine online</span><button onClick={() => setActiveNav("Settings")} title="Settings"><Settings2 size={17} /></button></div>
      </aside>

      <main className="kf-main">
        <header className="kf-topbar">
          <div className="kf-breadcrumb"><span>Projects</span><ChevronRight size={14} /><strong>Workspace</strong></div>
          <button className="kf-command-trigger" onClick={() => setCommandOpen(true)}><Search size={17} /><span>Ask KForge or run a command</span><kbd>Ctrl K</kbd></button>
          <div className="kf-topbar-state"><span><i className="kf-connection-dot" />Local AI</span><span><i className="kf-connection-dot" />GitHub</span></div>
        </header>

        <section className="kf-content">
          <div className="kf-page-heading">
            <div><p className="kf-eyebrow">KForge workspace</p><h1>Projects</h1><p className="kf-page-subtitle">Real local repositories, Git state, audits, and engineering actions in one workspace.</p></div>
            <div className="kf-heading-actions"><button className="kf-button kf-button--ghost" onClick={() => void refreshProjects()} disabled={loading}><RefreshCw size={16} className={loading ? "kf-spin" : ""} />Refresh</button><button className="kf-button kf-button--secondary" onClick={() => setModal("clone")}><Github size={16} />Clone repository</button><button className="kf-button kf-button--primary" onClick={() => setModal("open")}><Plus size={16} />Open project</button></div>
          </div>

          {error && <div className="kf-alert"><ShieldAlert size={17} /><span>{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}

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

          {activeProject && <ProjectInspector project={activeProject} scan={activeScan} results={actionResults[activeProject.id]} tasks={activeTaskList} onRun={(action) => void runAction(activeProject, action)} />}
        </section>
      </main>

      {commandOpen && <div className="kf-overlay" role="dialog" aria-modal="true" aria-label="KForge command palette"><div className="kf-command-palette"><div className="kf-command-input"><Command size={18} /><input autoFocus placeholder="Type a command…" value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} /><button onClick={() => setCommandOpen(false)}><X size={16} /></button></div><div className="kf-command-list">{commandItems.map((command) => <button key={command.label} onClick={() => executeCommand(command.label, command.callback)}><span>{command.label}</span><small>{command.meta}</small></button>)}{commandItems.length === 0 && <p>No command found.</p>}</div><p className="kf-command-help"><kbd>↑↓</kbd> navigate <kbd>Enter</kbd> run <kbd>Esc</kbd> close</p></div></div>}
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
  return <tr className={`${active ? "is-active" : ""} ${selected ? "is-selected" : ""}`} onClick={onActivate}><td onClick={(event) => event.stopPropagation()}><input aria-label={`Select ${project.name}`} type="checkbox" checked={selected} onChange={onSelect} /></td><td><button className="kf-project-cell" onClick={onActivate}><span className="kf-project-icon"><ProviderMark provider={project.provider} /></span><span><strong>{project.name}</strong><small title={project.path}>{project.path}</small></span></button></td>{columns.type && <td><span className="kf-type-pill">{project.projectType}</span></td>}{columns.branch && <td><span className="kf-branch"><GitBranch size={13} />{project.branch}</span></td>}{columns.status && <td><div className="kf-checks"><span className={statusClass(security)} title="Security"><ShieldAlert size={12} />{statusLabel(security)}</span><span className={statusClass(tests)} title="Tests"><TestTube2 size={12} />{statusLabel(tests)}</span><span className={statusClass(build)} title="Build"><Play size={12} />{statusLabel(build)}</span></div></td>}{columns.git && <td><GitState project={project} /></td>}{columns.activity && <td><span className="kf-date"><Clock3 size={13} />{formatDate(project.lastActivity)}</span></td>}<td onClick={(event) => event.stopPropagation()}><details className="kf-row-menu"><summary aria-label={`Actions for ${project.name}`}><MoreHorizontal size={18} /></summary><div><button onClick={() => onRun("scan")}>Scan project</button><button onClick={() => onRun("test")}>Run tests</button><button onClick={() => onRun("build")}>Run build</button>{project.remoteUrl && <a href={project.remoteUrl} target="_blank" rel="noreferrer">Open remote</a>}</div></details></td></tr>;
}

function GitState({ project }: { project: ProjectSummary }) { const changed = project.modifiedFiles + project.untrackedFiles; return <div className="kf-git-state"><span className={changed ? "is-warning" : "is-good"}>{changed ? `${changed} changed` : "Clean"}</span>{project.behind > 0 && <small>{project.behind} behind</small>}{project.ahead > 0 && <small>{project.ahead} ahead</small>}</div>; }

function ProjectInspector({ project, scan, results, tasks, onRun }: { project: ProjectSummary; scan?: ProjectScan; results?: Partial<Record<WorkspaceAction, CommandResult>>; tasks: TaskItem[]; onRun: (action: WorkspaceAction) => void }) {
  const issues = scan?.issues || [];
  const critical = issues.filter((issue) => issue.severity === "critical" || issue.severity === "high");
  const health = scan?.healthScore;
  return <section className="kf-inspector"><div className="kf-inspector-header"><div><p className="kf-eyebrow">Project intelligence</p><h2>{project.name}</h2><p>{project.path}</p></div><div className="kf-inspector-actions"><button className="kf-button kf-button--primary" onClick={() => onRun("scan")}><ShieldAlert size={16} />Scan</button><button className="kf-button kf-button--ghost" onClick={() => onRun("test")}><TestTube2 size={16} />Test</button><button className="kf-button kf-button--ghost" onClick={() => onRun("build")}><Play size={16} />Build</button></div></div>
  <div className="kf-metrics"><Metric icon={<HeartPulse size={18} />} label="Project health" value={health === undefined ? "Not scanned" : `${health}%`} tone={health === undefined ? "neutral" : health >= 85 ? "good" : health >= 60 ? "warning" : "bad"} /><Metric icon={<ShieldAlert size={18} />} label="Security" value={scan ? `${critical.length} priority` : "Not scanned"} tone={critical.length ? "bad" : scan ? "good" : "neutral"} /><Metric icon={<TestTube2 size={18} />} label="Tests" value={results?.test ? (results.test.ok ? "Pass" : "Failed") : "Not run"} tone={!results?.test ? "neutral" : results.test.ok ? "good" : "bad"} /><Metric icon={<Play size={18} />} label="Build" value={results?.build ? (results.build.ok ? "Pass" : "Failed") : "Not run"} tone={!results?.build ? "neutral" : results.build.ok ? "good" : "bad"} /><Metric icon={<GitBranch size={18} />} label="Git" value={project.modifiedFiles + project.untrackedFiles ? `${project.modifiedFiles + project.untrackedFiles} changes` : "Clean"} tone={project.modifiedFiles + project.untrackedFiles ? "warning" : "good"} /></div>
  <div className="kf-inspector-grid"><article className="kf-inspector-card"><div className="kf-card-heading"><div><ShieldAlert size={17} /><h3>KForge Sonar</h3></div>{scan && <span>Last scan {formatDate(scan.scannedAt)}</span>}</div>{!scan ? <div className="kf-card-empty"><p>No audit result is loaded for this project.</p><button onClick={() => onRun("scan")}>Run full scan</button></div> : issues.length === 0 ? <div className="kf-card-empty kf-card-empty--good"><p>No security, dependency, or local Git findings were detected by this scan.</p></div> : <div className="kf-issues">{issues.slice(0, 5).map((issue) => <details key={issue.id} className="kf-issue"><summary><span className={`kf-severity kf-severity--${issue.severity}`}>{issue.severity}</span><span><strong>{issue.title}</strong><small>{issue.file || issue.category}</small></span><ChevronRight size={15} /></summary><div><p>{issue.message}</p>{issue.suggestion && <p className="kf-suggestion"><Wrench size={14} />{issue.suggestion}</p>}</div></details>)}</div>}</article>
  <article className="kf-inspector-card"><div className="kf-card-heading"><div><Bot size={17} /><h3>Agent workspace</h3></div><span>Task center</span></div>{tasks.length === 0 ? <div className="kf-card-empty"><p>Actions initiated in KForge are tracked here with their real command output.</p><button onClick={() => onRun("scan")}>Start audit task</button></div> : <div className="kf-task-list">{tasks.map((task) => <details key={task.id} className={`kf-task kf-task--${task.state}`}><summary><span className="kf-task-indicator">{task.state === "running" ? <RefreshCw size={14} className="kf-spin" /> : <Activity size={14} />}</span><span><strong>{task.action} · {task.state === "success" ? "completed" : task.state}</strong><small>{task.message}</small></span><ChevronRight size={15} /></summary><pre>{task.output || "Waiting for command output…"}</pre></details>)}</div>}</article></div></section>;
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: "good" | "warning" | "bad" | "neutral" }) { return <div className={`kf-metric kf-metric--${tone}`}><span>{icon}</span><small>{label}</small><strong>{value}</strong></div>; }

function WorkspaceLoading() { return <div className="kf-loading"><div /><div /><div /><div /></div>; }
function WorkspaceEmpty({ onOpen }: { onOpen: () => void }) { return <div className="kf-empty"><FolderOpen size={28} /><h2>No projects found</h2><p>Choose a local repository or clone one into the configured KForge workspace to begin.</p><button className="kf-button kf-button--primary" onClick={onOpen}><Plus size={16} />Open local project</button></div>; }

function ProjectModal({ mode, localPath, setLocalPath, remoteUrl, setRemoteUrl, targetName, setTargetName, submitting, onClose, onSubmit }: { mode: "open" | "clone"; localPath: string; setLocalPath: (value: string) => void; remoteUrl: string; setRemoteUrl: (value: string) => void; targetName: string; setTargetName: (value: string) => void; submitting: boolean; onClose: () => void; onSubmit: () => void }) { const clone = mode === "clone"; return <div className="kf-overlay" role="dialog" aria-modal="true" aria-labelledby="project-modal-title"><form className="kf-modal" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}><div><p className="kf-eyebrow">{clone ? "Remote repository" : "Local project"}</p><h2 id="project-modal-title">{clone ? "Clone repository" : "Open project"}</h2><p>{clone ? "Clone a GitHub or GitLab HTTPS repository directly into the configured KForge workspace." : "Enter an existing local project folder. KForge will detect its stack and real Git state."}</p></div>{clone ? <><label>Repository HTTPS URL<input required value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://github.com/owner/repository.git" /></label><label>Destination folder name<input required pattern="[A-Za-z0-9._-]+" value={targetName} onChange={(event) => setTargetName(event.target.value)} placeholder="my-repository" /></label></> : <label>Local project path<input required value={localPath} onChange={(event) => setLocalPath(event.target.value)} placeholder="D:\\Projects\\my-repository" /></label>}<div className="kf-modal-actions"><button type="button" className="kf-button kf-button--ghost" onClick={onClose}>Cancel</button><button type="submit" className="kf-button kf-button--primary" disabled={submitting}>{submitting ? "Working…" : clone ? "Clone repository" : "Open project"}</button></div></form></div>; }

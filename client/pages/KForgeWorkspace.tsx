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
  ProjectProfile,
  ProjectScan,
  ProjectSummary,
  ProjectHealthEvidenceSource,
  ProjectHealthEvidenceSourceKind,
  ReleaseGateResult,
  ReleaseGateSourceKind,
  SelfAuditRecord,
  ScanIssue,
  KForgePlatformSettings,
  GlobalSearchCoverage,
  GlobalSearchEntity,
  GlobalSearchResult,
  LocalPlatformStatus,
  OnlineControlCenter,
  OperationTransparency,
  WorkspaceAction,
  WorkspaceResponse,
  WorkspaceStatus,
} from "@shared/workspace";
import { KFORGE_SETTINGS_DOMAIN_HANDLING, KFORGE_STARTUP_CAPABILITIES } from "@shared/workspace";

const NAVIGATION = [
  { group: "Projects", items: [["Workspace", LayoutDashboard], ["Project health", HeartPulse], ["Recent projects", History], ["Favorites", Star], ["Pinned", Pin], ["Archive", Archive], ["Open project", FolderOpen], ["Import project", FolderGit2]] },
  { group: "AI", items: [["AI providers", Bot], ["Models", Cpu], ["Agents", Bot], ["Tasks", Activity]] },
  { group: "Online", items: [["Discover", Search], ["Marketplace", Box], ["Extensions", Box], ["Model Hub", Cpu], ["Agent Marketplace", Bot], ["Tool Marketplace", Wrench], ["Integrations", Network], ["Providers", CircleDot], ["Installed", FolderOpen], ["Updates", RefreshCw], ["Security Center", ShieldAlert], ["Remote Sources", Network], ["Downloads", ArrowDownUp], ["Activity", Activity]] },
  { group: "Intelligence", items: [["Project graph", Network], ["Dependencies", Box], ["Impact analysis", Network], ["Code understanding", Code2], ["Ask KForge", MessageSquare], ["Architecture", Box]] },
  { group: "Quality", items: [["KForge Sonar", ShieldAlert], ["Problems", ShieldAlert], ["Solutions", Wrench], ["Security", ShieldAlert], ["Performance", Activity], ["Technical debt", Wrench], ["Documentation", Box], ["Snapshots", History]] },
  { group: "Release", items: [["Release Gate", Rocket], ["Release preparation", Rocket], ["Artifacts", Box], ["Versioning", GitBranch]] },
  { group: "Developer tools", items: [["Terminal", Terminal], ["Tests", TestTube2], ["Build", Play], ["Runtime", Play], ["Logs", History], ["Diagnostics", ShieldAlert], ["Preview", Play]] },
  { group: "Remote", items: [["Git", GitBranch], ["Branches", GitBranch], ["Commits", History], ["GitHub", Github], ["Pull requests", Github], ["Issues", ShieldAlert], ["Actions", Activity], ["Releases", Rocket]] },
  { group: "System", items: [["Settings", Settings2], ["Trust", ShieldAlert], ["Permissions", ShieldAlert], ["Storage", Box], ["Offline / Online", Network], ["Self Audit", Activity], ["System diagnostics", Activity]] },
] as const;

const NAV_SERVICE_INFO: Record<string, { description: string; capability: string }> = {
  "Project health": { description: "Evidence age, source, and release-impacting local health metrics.", capability: "Evidence freshness" },
  "Agents": { description: "Persistent strategy missions with explicit trust, tool, and confirmation boundaries.", capability: "Mission orchestration" },
  "Tasks": { description: "Persisted task logs, evidence, recovery, and safe controls.", capability: "Task evidence" },
  "Marketplace": { description: "Local runtime metadata and configured provider adapters only; no invented registry data.", capability: "Registry inspection" },
  "Discover": { description: "Searches every configured local and official catalog source from one dense discovery surface.", capability: "Global online discovery" },
  "Extensions": { description: "Shows verified extension metadata, compatibility, source, permissions, and local installation state.", capability: "Extension catalog" },
  "Model Hub": { description: "Compares installed and compatible local models using detected runtime and hardware evidence.", capability: "Model discovery" },
  "Agent Marketplace": { description: "Lists registered engineering agents with their capabilities, trust, and project permissions.", capability: "Agent catalog" },
  "Tool Marketplace": { description: "Lists registered engineering tools and the exact local permissions each tool requires.", capability: "Tool catalog" },
  "Integrations": { description: "Reports configured integrations and truthful offline or unavailable states without fabricated connections.", capability: "Integration registry" },
  "Providers": { description: "Inspects local and remote registry adapters, configuration state, and supported catalog operations.", capability: "Provider center" },
  "Installed": { description: "Shows only items verified as installed by a local runtime or the KForge registry.", capability: "Installed center" },
  "Updates": { description: "Shows update evidence only when a configured provider supplies a trustworthy version comparison.", capability: "Update center" },
  "Security Center": { description: "Reviews marketplace trust, permissions, compatibility, and network requirements before any action.", capability: "Marketplace security" },
  "Remote Sources": { description: "Inspects declared remote registry adapters, configuration, network policy, and current availability.", capability: "Remote source registry" },
  "Downloads": { description: "Shows only persisted model/package download tasks started through a verified adapter.", capability: "Download task evidence" },
  "Activity": { description: "Shows persisted Online Hub lifecycle activity without synthetic analytics.", capability: "Online activity evidence" },
  "Project graph": { description: "Local source imports and dependencies derived from the selected project.", capability: "Dependency graph" },
  "KForge Sonar": { description: "Local scanner evidence and installed-tool availability, including explicit unavailable states.", capability: "Quality analysis" },
  "Release Gate": { description: "Runs selected local verification and reports actual blockers, warnings, and Preview evidence.", capability: "Release evidence" },
  "Preview": { description: "Starts a detected local project command only after trust, then reports HTTP health and process logs.", capability: "Trusted local runtime" },
  "GitHub": { description: "Shows configured GitHub metadata only when optional online access is enabled.", capability: "Optional remote metadata" },
  "Models": { description: "Reports local model runtime state and configured source metadata without claiming remote availability.", capability: "Local model state" },
  "Self Audit": { description: "Runs the exact observational KForge-on-KForge evidence sequence and proves persistence only after a real server restart.", capability: "Persistent product self-verification" },
};

export function navHoverInfo(label: string, group: string) {
  return NAV_SERVICE_INFO[label] || { description: `${label} is a ${group.toLowerCase()} surface. Its view loads current local or configured-service evidence when opened.`, capability: `${group} capability` };
}

function navCardId(label: string) { return `nav-card-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`; }

export const ONLINE_NAVIGATION_LABELS = ["Discover", "Marketplace", "Extensions", "Model Hub", "Agent Marketplace", "Tool Marketplace", "Integrations", "Providers", "Installed", "Updates", "Security Center", "Remote Sources", "Downloads", "Activity"] as const;

function navigationContext(label: string) {
  const section = NAVIGATION.find((entry) => entry.items.some((item) => item[0] === label));
  return { group: section?.group || "Workspace", ...navHoverInfo(label, section?.group || "Workspace") };
}

function isOnlineNavigation(label: string): label is typeof ONLINE_NAVIGATION_LABELS[number] {
  return (ONLINE_NAVIGATION_LABELS as readonly string[]).includes(label);
}

function platformModeLabel(mode?: LocalPlatformStatus["mode"]) {
  return ({ offline: "Offline", "local-first": "Local First", "online-optional": "Online Optional", online: "Online" } as const)[mode || "offline"];
}

function metadataReadsEnabled(platform?: LocalPlatformStatus) {
  return platform?.policy.externalMetadataReads === true;
}

function remoteTransfersEnabled(platform?: LocalPlatformStatus) {
  return platform?.policy.remoteTransfers === true;
}

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

function StatusMessage({ children }: { children: ReactNode }) {
  return <p className="kf-capability-message" role="status" aria-live="polite">{children}</p>;
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
  const [globalResults, setGlobalResults] = useState<GlobalSearchResult[]>([]);
  const [globalSearchCoverage, setGlobalSearchCoverage] = useState<Partial<Record<GlobalSearchEntity, GlobalSearchCoverage>>>({});
  const [selectedSearchResult, setSelectedSearchResult] = useState<GlobalSearchResult | null>(null);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [actionResults, setActionResults] = useState<Record<string, Partial<Record<WorkspaceAction, CommandResult>>>>({});
  const [scans, setScans] = useState<Record<string, ProjectScan>>({});
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [modal, setModal] = useState<"open" | "clone" | null>(null);
  const [localPath, setLocalPath] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [targetName, setTargetName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [settings, setSettings] = useState<KForgePlatformSettings | null>(null);
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
    void fetch("/api/workspace/settings")
      .then(async (response) => {
        const payload = await response.json() as { settings?: KForgePlatformSettings; error?: string };
        if (!response.ok || !payload.settings) throw new Error(payload.error || "Platform settings are unavailable.");
        setSettings(payload.settings);
        setActiveNav((current) => current === "Workspace" ? payload.settings!.general.startupCapability : current);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Platform settings are unavailable."));
  }, []);

  useEffect(() => {
    if (!settings) return;
    document.documentElement.dataset.kfDensity = settings.appearance.density;
    document.documentElement.dataset.kfReducedMotion = String(settings.appearance.reducedMotion);
  }, [settings]);

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
    if (!commandOpen || commandQuery.trim().length < 2) { setGlobalResults([]); setGlobalSearchCoverage({}); setGlobalSearchLoading(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setGlobalSearchLoading(true);
      const projectParameter = activeProjectId ? `&projectId=${encodeURIComponent(activeProjectId)}` : "";
      void fetch(`/api/workspace/search?q=${encodeURIComponent(commandQuery.trim())}${projectParameter}`, { signal: controller.signal })
        .then(async (response) => response.ok ? response.json() as Promise<{ results?: GlobalSearchResult[]; coverage?: Partial<Record<GlobalSearchEntity, GlobalSearchCoverage>> }> : { results: [], coverage: {} })
        .then((payload) => { setGlobalResults(payload.results || []); setGlobalSearchCoverage(payload.coverage || {}); })
        .catch(() => { if (!controller.signal.aborted) { setGlobalResults([]); setGlobalSearchCoverage({}); } })
        .finally(() => { if (!controller.signal.aborted) setGlobalSearchLoading(false); });
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [activeProjectId, commandOpen, commandQuery]);

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
        const completedAt = task.finishedAt || task.startedAt;
        const remote = task.action === "pull" || task.action === "push";
        const result: CommandResult = { action: task.action, projectId: task.projectId, ok: task.state === "success", startedAt: task.startedAt, completedAt, output: task.output, message: task.message, transparency: { execution: remote ? "HYBRID" : "LOCAL", network: remote ? "REQUIRED" : "NOT_REQUIRED", dataClasses: task.action === "push" ? ["METADATA", "SOURCE_CODE"] : remote ? ["METADATA", "ARTIFACT"] : ["PROJECT_CONTEXT"], projectSourceSent: task.action === "push", secretRedaction: true, provider: remote ? "Git" : "Local project toolchain", destination: remote ? "Configured Git upstream (redacted task evidence)" : "Selected project process", purpose: `Execute the explicit ${task.action} project action.`, confirmation: task.action === "push" ? "CONFIRMED" : "NOT_REQUIRED", startedAt: task.startedAt, completedAt, durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(task.startedAt).getTime()), result: task.state === "success" ? "SUCCEEDED" : task.state === "blocked" ? "BLOCKED" : "FAILED", reason: task.state === "success" ? undefined : task.message } };
        setActionResults((previous) => ({ ...previous, [task.projectId]: { ...previous[task.projectId], [task.action]: result } }));
        if (task.action === "scan" && task.state === "success" && task.output) {
          try { setScans((previous) => ({ ...previous, [task.projectId]: JSON.parse(task.output) as ProjectScan })); } catch { /* The task remains available with its original command output. */ }
        }
      });
    } catch { /* The workspace stays usable when a transient task poll fails. */ }
  };

  const runAction = async (project: ProjectSummary, action: WorkspaceAction) => {
    try {
      const confirmed = action !== "push" || window.confirm(`Push ${project.name} to ${project.remoteUrl || "its configured upstream"}?\n\nExecution: HYBRID\nNetwork: REQUIRED\nData: commit metadata and SOURCE_CODE\nSecret redaction: enforced\nPurpose: update the configured Git remote`);
      if (!confirmed) return;
      const response = await fetch(`/api/workspace/projects/${project.id}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, confirmed: action === "push" }) });
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
    if (mode !== "offline" && !window.confirm(`Switch to ${platformModeLabel(mode)} mode?\n\nMetadata reads: ${mode === "local-first" ? "explicit remote reads only" : "enabled for explicit actions"}.\nRemote transfers: ${mode === "local-first" ? "blocked" : "enabled only after the action's own confirmation gates"}.\nProvider refresh: ${mode === "online" ? "enabled only by an explicit refresh action" : "blocked"}.\n\nOpening a remote surface still performs no network request. Cloud AI is not auto-selected, and remote writes always require confirmation.`)) return;
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
    if (!window.confirm(`Clone ${remoteUrl.trim()} into ${targetName.trim()}?\n\nExecution: HYBRID\nNetwork: REQUIRED\nData: repository metadata and artifact content received locally\nProject source sent: NO\nSecret redaction: enforced`)) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/workspace/projects/clone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remoteUrl: remoteUrl.trim(), targetName: targetName.trim(), confirmed: true }) });
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
    setSelectedSearchResult(null);
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
  const activeTaskList = tasks.filter((task) => task.projectId === activeProject?.id).sort((left, right) => Number(right.id === selectedSearchResult?.entityId) - Number(left.id === selectedSearchResult?.entityId)).slice(0, 4);
  const activeContext = navigationContext(activeNav);
  const activeTitle = activeNav === "Workspace" ? "Projects" : activeNav;

  return (
    <div className="kf-app">
      <aside className="kf-sidebar">
        <div className="kf-brand"><span className="kf-brand-mark"><Code2 size={19} /></span><span>KForge</span></div>
        <div className="kf-workspace-switcher"><span className="kf-workspace-dot" /> Local-first engineering</div>
        <nav className="kf-nav" aria-label="KForge navigation">
          {NAVIGATION.map((section) => (
            <section key={section.group}>
              <p className="kf-nav-label">{section.group}</p>
              {section.items.map(([label, Icon]) => { const info = navHoverInfo(label, section.group); const cardId = navCardId(label); return <button key={label} aria-label={label} aria-describedby={cardId} className={`kf-nav-item ${activeNav === label ? "is-active" : ""}`} onClick={() => setActiveNav(label)}><Icon size={16} /><span>{label}</span><span id={cardId} role="tooltip" className="kf-nav-hover-card"><strong>{label}</strong><small>{info.description}</small><em>Capability: {info.capability}</em><em>Privacy: {platformModeLabel(localPlatform?.mode)} · explicit network policy</em><em>State: {activeNav === label ? "Open" : "Open to load current evidence"}</em></span></button>; })}
            </section>
          ))}
        </nav>
        <div className="kf-sidebar-footer"><span><CircleDot size={12} className="kf-live-dot" /> {platformModeLabel(localPlatform?.mode)}</span><button onClick={() => setActiveNav("Settings")} title="Local platform settings"><Settings2 size={17} /></button></div>
      </aside>

      <main className="kf-main">
        <header className="kf-topbar">
          <div className="kf-breadcrumb"><span>{activeContext.group}</span><ChevronRight size={14} /><strong>{activeTitle}</strong></div>
          <button className="kf-command-trigger" onClick={() => setCommandOpen(true)}><Search size={17} /><span>Ask KForge or run a command</span><kbd>Ctrl K</kbd></button>
          <div className="kf-topbar-state"><span><i className="kf-connection-dot" />{platformModeLabel(localPlatform?.mode)}</span><span><i className="kf-connection-dot" />Local AI</span></div>
        </header>

        <section className="kf-content">
          <div className="kf-page-heading">
            <div><p className="kf-eyebrow">{activeContext.group}</p><h1>{activeTitle}</h1><p className="kf-page-subtitle">{activeNav === "Workspace" ? "Real local repositories, Git state, audits, and engineering actions in one workspace." : activeContext.description}</p></div>
            {activeNav === "Workspace" ? <div className="kf-heading-actions"><button className="kf-button kf-button--ghost" onClick={() => void refreshProjects()} disabled={loading}><RefreshCw size={16} className={loading ? "kf-spin" : ""} />Refresh</button><button className="kf-button kf-button--secondary" onClick={() => setModal("clone")} disabled={!remoteTransfersEnabled(localPlatform)} title={!remoteTransfersEnabled(localPlatform) ? "Enable Online Optional or Online mode to clone a remote repository." : "Clone a remote repository"}><Github size={16} />Clone repository</button><button className="kf-button kf-button--primary" onClick={() => setModal("open")}><Plus size={16} />Open project</button></div> : <div className="kf-heading-actions"><span className="kf-active-project-chip"><FolderGit2 size={14} />{activeProject?.name || "No project selected"}</span><button className="kf-button kf-button--ghost" onClick={() => setActiveNav("Workspace")}><LayoutDashboard size={16} />Projects</button></div>}
          </div>

          {error && <div className="kf-alert"><ShieldAlert size={17} /><span>{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}
          {activeProject?.trust === "untrusted" && <div className="kf-alert"><ShieldAlert size={17} /><span><strong>UNTRUSTED PROJECT</strong> — read-only inspection is available. Tests, builds, runtime checks, and agent patches require your approval.</span><button className="kf-button kf-button--secondary" onClick={() => void approveProjectTrust(activeProject)}>Trust local execution</button></div>}

          {activeNav === "Workspace" && <><section className="kf-workspace-panel">
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
          {activeProject && <><ProjectInspectorV2 project={activeProject} scan={activeScan} results={actionResults[activeProject.id]} tasks={activeTaskList} onRun={(action) => void runAction(activeProject, action)} onTaskControl={(task, control) => void controlTask(task, control)} /><PreviewContextCard project={activeProject} source="Project" onNavigate={() => setActiveNav("Preview")} /></>}</>}

          {activeProject && activeNav !== "Workspace" && <section className={`kf-active-surface ${isOnlineNavigation(activeNav) ? "kf-active-surface--online" : ""}`} aria-label={`${activeTitle} capability`}>{selectedSearchResult?.projectId === activeProject.id && selectedSearchResult.target === activeNav && <SearchSelectionCard result={selectedSearchResult} onClear={() => setSelectedSearchResult(null)} />}<CapabilitySurface activeNav={activeNav} project={activeProject} projects={projects} scan={activeScan} tasks={activeTaskList} results={actionResults[activeProject.id]} platform={localPlatform} settings={settings} searchSelection={selectedSearchResult?.projectId === activeProject.id && selectedSearchResult.target === activeNav ? selectedSearchResult : undefined} onSettingsChange={setSettings} onPlatformModeChange={(mode) => void setPlatformMode(mode)} onOpenProject={() => setModal("open")} onRun={(action) => void runAction(activeProject, action)} onTaskControl={(task, control) => void controlTask(task, control)} onTrust={() => void approveProjectTrust(activeProject)} onNavigate={(label) => setActiveNav(label)} /></section>}
          {!activeProject && activeNav !== "Workspace" && <WorkspaceEmpty onOpen={() => setModal("open")} />}
        </section>
      </main>

      {commandOpen && <div className="kf-overlay" role="dialog" aria-modal="true" aria-label="KForge command palette"><div className="kf-command-palette"><div className="kf-command-input"><Command size={18} /><input autoFocus aria-label="Search commands and local workspace" placeholder="Search projects, files, symbols, problems, tasks, agents, models…" value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} /><button aria-label="Close command palette" onClick={() => setCommandOpen(false)}><X size={16} /></button></div><div className="kf-command-list">{commandItems.map((command) => <button key={command.label} onClick={() => executeCommand(command.label, command.callback)}><span>{command.label}</span><small>{command.meta}</small></button>)}{globalSearchLoading && <p role="status">Searching bounded local evidence…</p>}{globalResults.map((result) => <button key={`${result.projectId}:${result.entity}:${result.entityId}`} onClick={() => { setActiveProjectId(result.projectId); setActiveNav(result.target); setSelectedSearchResult(result); setCommandOpen(false); setCommandQuery(""); }}><span>{result.title}</span><small>{result.entity} · {result.kind} · {result.detail} · open {result.target}</small></button>)}{Object.keys(globalSearchCoverage).length > 0 && <details className="kf-command-search-coverage"><summary>Search evidence coverage</summary>{Object.entries(globalSearchCoverage).map(([entity, coverage]) => <p key={entity}><strong>{entity} · {coverage.state}</strong><small>{coverage.searchedCount} searched · total {coverage.totalOrUnknown ?? "UNKNOWN"} · {coverage.reason}</small></p>)}</details>}{commandItems.length === 0 && !globalSearchLoading && globalResults.length === 0 && <p>No local result found. Review coverage for unavailable or bounded sources.</p>}</div><p className="kf-command-help"><kbd>Ctrl/Cmd K</kbd> search · <kbd>Esc</kbd> close</p></div></div>}
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

export const CAPABILITY_RENDERER_IDS: Record<string, string> = {
  "Workspace": "WorkspaceProjectList", "Project health": "ProjectHealthPanel", "Recent projects": "RecentProjectsPanel", "Favorites": "CollectionProjectsPanel", "Pinned": "CollectionProjectsPanel", "Archive": "CollectionProjectsPanel", "Open project": "OpenProjectPanel", "Import project": "OpenProjectPanel",
  "AI providers": "AICenter", "Models": "LocalAIOnboarding", "Agents": "AgentMissionCenter", "Tasks": "TaskCenterPanel",
  "Discover": "OnlineHubPanel", "Marketplace": "OnlineHubPanel", "Extensions": "OnlineHubPanel", "Model Hub": "OnlineHubPanel", "Agent Marketplace": "OnlineHubPanel", "Tool Marketplace": "OnlineHubPanel", "Integrations": "OnlineHubPanel", "Providers": "OnlineHubPanel", "Installed": "OnlineHubPanel", "Updates": "OnlineHubPanel", "Security Center": "OnlineHubPanel", "Remote Sources": "OnlineHubPanel", "Downloads": "OnlineHubPanel", "Activity": "OnlineHubPanel",
  "Project graph": "GraphPanel", "Dependencies": "DependenciesPanel", "Impact analysis": "ImpactAnalysisPanel", "Code understanding": "CodeUnderstandingPanel", "Ask KForge": "AskKForgePanel", "Architecture": "ArchitecturePanel",
  "KForge Sonar": "SecurityToolsPanel", "Problems": "QualityPanel", "Solutions": "SolutionsPanel", "Security": "SecurityToolsPanel", "Performance": "QualityCategoryPanel", "Technical debt": "QualityCategoryPanel", "Documentation": "DocumentationPanel", "Snapshots": "SnapshotsPanel",
  "Release Gate": "ReleaseGatePanel", "Release preparation": "ReleasePreparationPanel", "Artifacts": "ReleasePreparationPanel", "Versioning": "ReleasePreparationPanel",
  "Terminal": "TerminalOperationsPanel", "Tests": "DeveloperActionPanel", "Build": "DeveloperActionPanel", "Runtime": "DeveloperActionPanel", "Logs": "TaskCenterPanel", "Diagnostics": "QualityPanel", "Preview": "PreviewPanel",
  "Git": "GitCenterPanel", "Branches": "GitCenterPanel", "Commits": "GitCenterPanel", "GitHub": "GitHubCenterPanel", "Pull requests": "GitHubCenterPanel", "Issues": "GitHubCenterPanel", "Actions": "GitHubCenterPanel", "Releases": "GitHubCenterPanel",
  "Settings": "SettingsCenter", "Trust": "TrustPanel", "Permissions": "PermissionsPanel", "Storage": "StoragePanel", "Offline / Online": "LocalPlatformPanel", "Self Audit": "SelfAuditPanel", "System diagnostics": "SystemDiagnosticsPanel",
};

export const visibleNavigationLabels = (): string[] => NAVIGATION.flatMap((section) => section.items.map((item) => item[0] as string));
export const missingCapabilityRenderers = () => visibleNavigationLabels().filter((label) => !CAPABILITY_RENDERER_IDS[label]);

export const PREVIEW_CONTEXT_NAVIGATION_LABELS = ["Project health", "Agents", "Tasks", "KForge Sonar", "Problems", "Solutions", "Project graph", "Architecture", "Tests", "Build", "Runtime", "Git", "GitHub", "Pull requests", "Issues", "Actions", "Releases", "Marketplace", "Models"] as const;
const previewContextNavigation = new Set<string>(PREVIEW_CONTEXT_NAVIGATION_LABELS);

function UnavailableCapabilityPanel({ label }: { label: string }) { return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Activity size={17} /><h3>{label}</h3></div><span>Unavailable</span></div><p className="kf-capability-copy">UNAVAILABLE: this internal navigation state has no registered capability renderer. It is not a production sidebar destination.</p></section>; }

function SearchSelectionCard({ result, onClear }: { result: GlobalSearchResult; onClear: () => void }) {
  return <article className="kf-command-evidence" aria-label="Selected global search entity"><strong>Selected {result.entity} evidence · {result.title}</strong><small>{result.kind} · {result.detail}</small><small>Source: {result.source} · entity: {result.entityId}</small><button type="button" onClick={onClear}>Clear selection</button></article>;
}

function CapabilitySurface({ activeNav, project, projects, scan, tasks, results, platform, settings, searchSelection, onSettingsChange, onPlatformModeChange, onOpenProject, onRun, onTaskControl, onTrust, onNavigate }: { activeNav: string; project: ProjectSummary; projects: ProjectSummary[]; scan?: ProjectScan; tasks: TaskItem[]; results?: Partial<Record<WorkspaceAction, CommandResult>>; platform?: LocalPlatformStatus; settings: KForgePlatformSettings | null; searchSelection?: GlobalSearchResult; onSettingsChange: (settings: KForgePlatformSettings) => void; onPlatformModeChange: (mode: LocalPlatformStatus["mode"]) => void; onOpenProject: () => void; onRun: (action: WorkspaceAction) => void; onTaskControl: (task: TaskItem, control: "cancel" | "retry" | "resume" | "rollback") => void; onTrust: () => void; onNavigate: (label: string) => void }) {
  const renderers: Record<string, ReactNode> = {
    "Workspace": <CollectionProjectsPanel title="Workspace Projects" projects={projects.filter((entry) => !entry.archived)} empty="No local project is currently available in this workspace." icon={<LayoutDashboard size={17} />} />, "Project health": <ProjectHealthPanel project={project} />, "Recent projects": <RecentProjectsPanel projects={projects} />, "Favorites": <CollectionProjectsPanel title="Favorite Projects" projects={projects.filter((entry) => entry.categories.favorite)} empty="No projects have been marked as favorite in the local workspace." icon={<Star size={17} />} />, "Pinned": <CollectionProjectsPanel title="Pinned Projects" projects={projects.filter((entry) => entry.categories.pinned && !entry.archived)} empty="No projects have been pinned in the local workspace." icon={<Pin size={17} />} />, "Archive": <CollectionProjectsPanel title="Archived Projects" projects={projects.filter((entry) => entry.categories.archive)} empty="No projects have been archived in the local workspace." icon={<Archive size={17} />} />, "Open project": <OpenProjectPanel onOpen={onOpenProject} />, "Import project": <OpenProjectPanel onOpen={onOpenProject} />,
    "AI providers": <AICenter view="providers" onlineOptional={remoteTransfersEnabled(platform)} />, "Models": <LocalAIOnboarding onlineOptional={remoteTransfersEnabled(platform)} selectedModelId={searchSelection?.entityId} />, "Agents": <AgentMissionCenter project={project} initialMission={searchSelection?.entityId} />, "Tasks": <TaskCenterPanel tasks={tasks} onTaskControl={onTaskControl} selectedTaskId={searchSelection?.entityId} />,
    "Discover": <OnlineHubPanel initialView="discover" project={project} platform={platform} />, "Marketplace": <OnlineHubPanel initialView="marketplace" project={project} platform={platform} initialSelectionId={searchSelection?.entityId} />, "Extensions": <OnlineHubPanel initialView="extensions" project={project} platform={platform} />, "Model Hub": <OnlineHubPanel initialView="models" project={project} platform={platform} />, "Agent Marketplace": <OnlineHubPanel initialView="agents" project={project} platform={platform} />, "Tool Marketplace": <OnlineHubPanel initialView="tools" project={project} platform={platform} />, "Integrations": <OnlineHubPanel initialView="integrations" project={project} platform={platform} />, "Providers": <OnlineHubPanel initialView="providers" project={project} platform={platform} />, "Installed": <OnlineHubPanel initialView="installed" project={project} platform={platform} />, "Updates": <OnlineHubPanel initialView="updates" project={project} platform={platform} />, "Security Center": <OnlineHubPanel initialView="security" project={project} platform={platform} />, "Remote Sources": <OnlineHubPanel initialView="remote-sources" project={project} platform={platform} />, "Downloads": <OnlineHubPanel initialView="downloads" project={project} platform={platform} />, "Activity": <OnlineHubPanel initialView="activity" project={project} platform={platform} />,
    "Project graph": <GraphPanel project={project} initialTarget={searchSelection?.entityId} />, "Dependencies": <DependenciesPanel project={project} />, "Impact analysis": <ImpactAnalysisPanel project={project} />, "Code understanding": <CodeUnderstandingPanel project={project} />, "Ask KForge": <AskKForgePanel project={project} />, "Architecture": <ArchitecturePanel project={project} />,
    "KForge Sonar": <SecurityToolsPanel project={project} scan={scan} onScan={() => onRun("scan")} />, "Problems": <QualityPanel title="Problems" scan={scan} onScan={() => onRun("scan")} selectedIssueId={searchSelection?.entityId} />, "Solutions": <SolutionsPanel scan={scan} onScan={() => onRun("scan")} onNavigate={onNavigate} />, "Security": <SecurityToolsPanel project={project} scan={scan} onScan={() => onRun("scan")} />, "Performance": <QualityCategoryPanel title="Performance Evidence" description="Performance diagnostics are shown only when the local scanner produces performance evidence; no synthetic score is assigned." categories={["performance"]} scan={scan} onScan={() => onRun("scan")} />, "Technical debt": <QualityCategoryPanel title="Technical Debt Evidence" description="Technical debt is derived from the scanner's explicit completeness, quality, complexity, and architecture findings." categories={["completeness", "quality", "architecture"]} scan={scan} onScan={() => onRun("scan")} />, "Documentation": <DocumentationPanel project={project} selectedFindingId={searchSelection?.entityId} />, "Snapshots": <SnapshotsPanel project={project} />,
    "Release Gate": <ReleaseGatePanel project={project} />, "Release preparation": <ReleasePreparationPanel project={project} view="Release preparation" />, "Artifacts": <ReleasePreparationPanel project={project} view="Artifacts" />, "Versioning": <ReleasePreparationPanel project={project} view="Versioning" />,
    "Terminal": <TerminalOperationsPanel project={project} results={results} tasks={tasks} onRun={onRun} />, "Tests": <DeveloperActionPanel title="Test Lab" description="Runs the detected local test command for the selected project and records actual stdout, stderr, exit state, and duration." action="test" result={results?.test} tasks={tasks} onRun={onRun} />, "Build": <DeveloperActionPanel title="Build Center" description="Runs the project’s detected build command. No package manager or build result is assumed when discovery has not found one." action="build" result={results?.build} tasks={tasks} onRun={onRun} />, "Runtime": <DeveloperActionPanel title="Runtime Verification" description="Runs the detected bounded runtime verification and captures its actual output, exit state, and duration." action="runtime" result={results?.runtime} tasks={tasks} onRun={onRun} />, "Logs": <TaskCenterPanel tasks={tasks} onTaskControl={onTaskControl} />, "Diagnostics": <QualityPanel title="Diagnostics" scan={scan} onScan={() => onRun("scan")} />, "Preview": <PreviewPanel project={project} settings={settings?.preview} />,
    "Git": <GitCenterPanel project={project} />, "Branches": <GitCenterPanel project={project} />, "Commits": <GitCenterPanel project={project} />, "GitHub": <GitHubCenterPanel project={project} view="GitHub" onlineOptional={metadataReadsEnabled(platform)} />, "Pull requests": <GitHubCenterPanel project={project} view="Pull requests" onlineOptional={metadataReadsEnabled(platform)} />, "Issues": <GitHubCenterPanel project={project} view="Issues" onlineOptional={metadataReadsEnabled(platform)} />, "Actions": <GitHubCenterPanel project={project} view="Actions" onlineOptional={metadataReadsEnabled(platform)} />, "Releases": <GitHubCenterPanel project={project} view="Releases" onlineOptional={metadataReadsEnabled(platform)} />,
    "Settings": <SettingsCenter settings={settings} platform={platform} onSettingsChange={onSettingsChange} onModeChange={onPlatformModeChange} />, "Trust": <TrustPanel project={project} onTrust={onTrust} />, "Permissions": <PermissionsPanel project={project} />, "Storage": <StoragePanel project={project} />, "Offline / Online": <LocalPlatformPanel platform={platform} onModeChange={onPlatformModeChange} />, "Self Audit": <SelfAuditPanel project={project} />, "System diagnostics": <SystemDiagnosticsPanel platform={platform} />,
  };
  const surface = renderers[activeNav] || <UnavailableCapabilityPanel label={activeNav} />;
  return <>{surface}{previewContextNavigation.has(activeNav) && <PreviewContextCard project={project} source={activeNav} onNavigate={() => onNavigate("Preview")} />}</>;
}

function ProjectHealthPanel({ project }: { project: ProjectSummary }) {
  const [data, setData] = useState<{ health: { score: number | null; evidenceCoverage: number; calculatedAt: string; metrics: Array<{ key: string; label: string; status: WorkspaceStatus; score: number | null; weight: number; evidence: string[]; findings: string[]; lastScan: string; evidenceSource: string; evidenceAgeMs: number; freshness: "current-scan" | "live-task" | "persisted-task" | "stale-task" | "unknown" }>; sources: Record<ProjectHealthEvidenceSourceKind, ProjectHealthEvidenceSource>; release: { state: string; blockers: Array<{ title: string; source: string; file?: string }>; warnings: Array<{ title: string; source: string; file?: string }>; evidence: string[] } }; scannedAt: string; issueCount: number; coverage: ProjectScan["coverage"]; tools: Array<{ name: string; available: boolean; version?: string; reason?: string }> } | null>(null);
  const [message, setMessage] = useState("Loading Project Health from local evidence…");
  const refresh = async () => { try { setMessage("Recalculating local health evidence…"); const response = await fetch(`/api/workspace/projects/${project.id}/health`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Project Health is unavailable."); setData(payload); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Project Health request failed."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  const health = data?.health;
  const sourceOrder: ProjectHealthEvidenceSourceKind[] = ["LOCAL", "GITHUB", "CI", "REMOTE_REGISTRY", "PREVIEW"];
  return <section className="kf-capability-panel">
    <div className="kf-card-heading"><div><HeartPulse size={17} /><h3>Project Health</h3></div><button onClick={() => void refresh()}>Refresh evidence</button></div>
    {message && <StatusMessage>{message}</StatusMessage>}
    {health ? <>
      <div className="kf-hardware-grid"><span><strong>Health score</strong>{health.score === null ? "Evidence pending" : `${health.score}%`}</span><span><strong>Evidence coverage</strong>{health.evidenceCoverage}%</span><span><strong>Findings</strong>{data.issueCount}</span><span><strong>Overall recommendation</strong>{health.release.state}</span></div>
      <p className="kf-capability-copy">Each source below is independent. Project Health does not contact GitHub, CI, or registries implicitly; missing remote evidence remains UNKNOWN, OFFLINE, or NOT_CONFIGURED before the overall recommendation.</p>
      <div className="kf-provider-grid">{sourceOrder.map((kind) => { const source = health.sources[kind]; return <article className="kf-provider-card" key={kind}><div><strong>{kind.replace("_", " ")}</strong><span>{source.state}</span></div><p>{source.provider}</p><small>{source.source} · {source.freshness} · {formatDate(source.timestamp || undefined)}</small><small>Network: {source.network}</small><small>{source.evidence.join(" ")}</small>{(source.blocker || source.error) && <small>{source.blocker || source.error}</small>}</article>; })}</div>
      <p className="kf-capability-copy">Local metrics were calculated {formatDate(health.calculatedAt)} from scan, command, Git, configuration, dependency, documentation, and architecture evidence.</p>
      <div className="kf-issues">{health.metrics.map((metric) => <details className="kf-issue" key={metric.key}><summary><span className={statusClass(metric.status)}>{statusLabel(metric.status)}</span><span><strong>{metric.label}</strong><small>{metric.score === null ? "No score" : `${metric.score}%`} · weight {metric.weight} · {metric.freshness} · {Math.round(metric.evidenceAgeMs / 1000)}s old</small></span><ChevronRight size={15} /></summary><div><p><strong>Evidence</strong></p><p className="kf-capability-copy">Source: {metric.evidenceSource} · freshness: {metric.freshness} · captured {formatDate(metric.lastScan)}</p><pre>{metric.evidence.length ? metric.evidence.join("\n") : "No measured evidence is available for this metric."}</pre>{metric.findings.length ? <><p><strong>Findings</strong></p><pre>{metric.findings.join("\n")}</pre></> : <p className="kf-capability-copy">No findings were recorded for this metric.</p>}</div></details>)}</div>
      <article className="kf-command-evidence"><strong>Overall recommendation · {health.release.state}</strong><pre>{JSON.stringify({ blockers: health.release.blockers, warnings: health.release.warnings, evidence: health.release.evidence }, null, 2)}</pre></article>
      <article className="kf-command-evidence"><strong>Bounded local scan coverage</strong><pre>{JSON.stringify(data.coverage, null, 2)}</pre></article>
      <article className="kf-command-evidence"><strong>Local tool availability</strong><pre>{JSON.stringify(data.tools, null, 2)}</pre></article>
    </> : <p className="kf-capability-copy">{message || "No Project Health evidence is loaded."}</p>}
  </section>;
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
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><ShieldAlert size={17} /><h3>Permissions</h3></div><button onClick={() => void refresh()}>Refresh registry</button></div>{message && <StatusMessage>{message}</StatusMessage>}{registry && <><div className="kf-provider-grid">{(registry.tools || []).map((tool) => <article className="kf-provider-card" key={tool.id}><div><strong>{tool.label}</strong><span>{tool.permission}</span></div><p>{tool.available ? "Available" : "Unavailable"}</p><small>{tool.reason || "Registered local capability"}</small></article>)}</div><article className="kf-command-evidence"><strong>Policy evidence</strong><pre>{JSON.stringify(registry.permissions, null, 2)}</pre></article></>}</section>;
}

function StoragePanel({ project }: { project: ProjectSummary }) {
  const [entries, setEntries] = useState<Array<{ path: string; bytes?: number; modifiedAt?: string }> | null>(null);
  const [message, setMessage] = useState("Reading KForge cache status…");
  const refresh = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/cache`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Cache status is unavailable."); setEntries(payload.entries || []); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Cache status failed."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  const clear = async () => { if (project.trust !== "trusted") { setMessage("UNTRUSTED PROJECT: cache clearing is blocked until explicit trust approval."); return; } if (!window.confirm("Clear only KForge project cache entries? Project source files are not affected.")) return; try { const response = await fetch(`/api/workspace/projects/${project.id}/cache/clear`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Cache clear failed."); setMessage("KForge project cache cleared."); await refresh(); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Cache clear failed."); } };
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Box size={17} /><h3>Local Storage & Cache</h3></div><button onClick={() => void refresh()}>Refresh</button></div><p className="kf-capability-copy">This panel reports KForge-managed cache entries only. It never claims ownership of package-manager, build, or user files outside the configured cache engine.</p>{message && <StatusMessage>{message}</StatusMessage>}<div className="kf-provider-grid">{entries?.map((entry) => <article className="kf-provider-card" key={entry.path}><div><strong>{entry.path}</strong><span>{entry.bytes === undefined ? "size unavailable" : `${Math.round(entry.bytes / 1024)} KB`}</span></div><small>{entry.modifiedAt ? formatDate(entry.modifiedAt) : "timestamp unavailable"}</small></article>)}</div>{entries?.length === 0 && <p className="kf-capability-copy">No KForge cache entry is currently reported for this project.</p>}<button className="kf-button kf-button--ghost" onClick={() => void clear()}>Clear KForge cache</button></section>;
}

function SelfAuditPanel({ project }: { project: ProjectSummary }) {
  const [record, setRecord] = useState<SelfAuditRecord | null>(null);
  const [message, setMessage] = useState("Loading persisted Self Audit evidence…");
  const [running, setRunning] = useState(false);
  const load = async () => {
    try {
      const response = await fetch(`/api/workspace/projects/${project.id}/self-audit`);
      const payload = await response.json() as { selfAudit?: SelfAuditRecord; error?: string };
      if (response.status === 404) { setRecord(null); setMessage(payload.error || "No Self Audit evidence exists yet."); return; }
      if (!response.ok || !payload.selfAudit) throw new Error(payload.error || "Self Audit evidence is unavailable.");
      setRecord(payload.selfAudit);
      setMessage(payload.selfAudit.status === "WAITING_RESTART" ? "Evidence is persisted. Restart the KForge server process, then reload this panel to prove Restart and Reload Evidence." : "");
    } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Self Audit evidence is unavailable."); }
  };
  useEffect(() => { void load(); }, [project.id]);
  const runAudit = async () => {
    setRunning(true);
    setMessage("Running the exact local observational sequence. Tests, build, and runtime may take several minutes…");
    try {
      const response = await fetch(`/api/workspace/projects/${project.id}/self-audit`, { method: "POST" });
      const payload = await response.json() as { selfAudit?: SelfAuditRecord; error?: string };
      if (!response.ok || !payload.selfAudit) throw new Error(payload.error || "Self Audit failed.");
      setRecord(payload.selfAudit);
      setMessage("Evidence was atomically persisted. A real KForge server restart is now required; a renderer refresh does not count.");
    } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Self Audit failed."); }
    finally { setRunning(false); }
  };
  return <section className="kf-capability-panel">
    <div className="kf-card-heading"><div><Activity size={17} /><h3>KForge Self Audit</h3></div><span>{record?.status || "NOT RUN"}</span></div>
    <p className="kf-capability-copy">This KForge-on-KForge workflow composes the existing Health, Graph, Architecture, Sonar, Problems, Agent, command, Preview, and Release Gate engines. It never applies a fix, starts Preview, or contacts a remote provider implicitly. Tests, build, and bounded runtime verification execute only after this explicit action.</p>
    <div className="kf-inline-controls"><button className="kf-button kf-button--primary" disabled={running} aria-busy={running} onClick={() => void runAudit()}>{running ? "Running Self Audit…" : "Run KForge Self Audit"}</button><button disabled={running} onClick={() => void load()}>Reload persisted evidence</button></div>
    {message && <StatusMessage>{message}</StatusMessage>}
    {record && <>
      <div className="kf-hardware-grid"><span><strong>Status</strong>{record.status}</span><span><strong>Outcome</strong>{record.outcome}</span><span><strong>Observational</strong>{record.observational ? "YES" : "NO"}</span><span><strong>Source mutation</strong>{record.sourceMutationDetected ? "DETECTED" : "NONE"}</span><span><strong>Started</strong>{formatDate(record.startedAt)}</span><span><strong>Completed</strong>{record.completedAt ? formatDate(record.completedAt) : "WAITING FOR RESTART"}</span></div>
      <div className="kf-provider-grid">{record.stages.map((stage, index) => <article className="kf-provider-card" key={stage.id}><div><strong>{index + 1}. {stage.label}</strong><span>{stage.state}</span></div><small>{stage.completedAt ? formatDate(stage.completedAt) : stage.startedAt ? `Started ${formatDate(stage.startedAt)}` : "Not started"}</small><details><summary>Stage evidence</summary><pre>{JSON.stringify(stage.evidence, null, 2)}</pre></details></article>)}</div>
      <article className="kf-command-evidence"><strong>Persistence and restart boundary</strong><small>{record.evidenceFile}</small><pre>{JSON.stringify({ originInstanceId: record.originInstanceId, reloadedByInstanceId: record.reloadedByInstanceId, status: record.status, outcome: record.outcome }, null, 2)}</pre></article>
    </>}
  </section>;
}

function SystemDiagnosticsPanel({ platform }: { platform?: LocalPlatformStatus }) {
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Activity size={17} /><h3>System Diagnostics</h3></div><span>{platform?.mode || "Loading"}</span></div>{platform ? <><p className="kf-capability-copy">Diagnostics describe local capabilities and their measured availability. Missing tools remain unavailable rather than being represented as successful.</p><div className="kf-provider-grid">{platform.capabilities.map((capability) => <article className="kf-provider-card" key={capability.id}><div><strong>{capability.label}</strong><span>{capability.state}</span></div><small>{capability.detail}</small></article>)}</div></> : <p className="kf-capability-copy">Loading local platform diagnostics…</p>}</section>;
}

function TerminalOperationsPanel({ project, results, tasks, onRun }: { project: ProjectSummary; results?: Partial<Record<WorkspaceAction, CommandResult>>; tasks: TaskItem[]; onRun: (action: WorkspaceAction) => void }) { return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Terminal size={17} /><h3>Local Command Center</h3></div><span>Scoped to {project.name}</span></div><p className="kf-capability-copy">KForge executes only detected project actions from the selected local repository. Output below comes from real local processes; arbitrary shell input is intentionally not exposed in this browser workspace.</p><div className="kf-inline-controls"><button onClick={() => onRun("typecheck")}>Typecheck</button><button onClick={() => onRun("test")}>Run tests</button><button onClick={() => onRun("build")}>Run build</button><button onClick={() => onRun("runtime")}>Runtime check</button></div><ExecutionEvidence results={results} tasks={tasks} /></section>; }

function DeveloperActionPanel({ title, description, action, result, tasks, onRun }: { title: string; description: string; action: WorkspaceAction; result?: CommandResult; tasks: TaskItem[]; onRun: (action: WorkspaceAction) => void }) { const matching = tasks.filter((task) => task.action === action); return <section className="kf-capability-panel"><div className="kf-card-heading"><div>{action === "test" ? <TestTube2 size={17} /> : <Play size={17} />}<h3>{title}</h3></div><span>Detected local action</span></div><p className="kf-capability-copy">{description}</p><button className="kf-button kf-button--primary" onClick={() => onRun(action)}>Run {action}</button>{result && <article className="kf-command-evidence"><strong>{result.ok ? "PASS" : "FAILED"} · {result.action}</strong><small>{result.message}</small><pre>{result.output || "The local process completed without captured output."}</pre><details><summary>Execution and data disclosure</summary><pre>{JSON.stringify(result.transparency, null, 2)}</pre></details></article>}{matching.map((task) => <article className="kf-command-evidence" key={task.id}><strong>{task.action} · {task.state}</strong><small>{task.message} · {task.progress}%</small><pre>{task.output || "Waiting for local process output…"}</pre></article>)}</section>; }

interface PreviewViewState {
  state: string;
  sessionId?: string;
  command?: string;
  port?: number;
  url?: string;
  pid?: number;
  startedAt?: string;
  stoppedAt?: string;
  checkedAt?: string;
  health?: { ok: boolean; status?: number; detail: string };
  healthHistory: Array<{ checkedAt: string; ok: boolean; status?: number; detail: string }>;
  routes: Array<{ path: string; source: "root" | "html-link"; checkedAt: string }>;
  history: Array<{ at: string; event: string; detail: string }>;
  runtime: { execution: "LOCAL"; network: "NOT_REQUIRED"; source: string; projectSourceSent: false };
  telemetry: { console: string; network: string; browserConsoleCaptured: false };
  logs: string[];
  error?: string;
}

function PreviewContextCard({ project, source, onNavigate }: { project: ProjectSummary; source: string; onNavigate: () => void }) {
  const [preview, setPreview] = useState<PreviewViewState | null>(null);
  const [message, setMessage] = useState("Loading shared Preview evidence…");
  const refresh = async () => {
    try {
      const response = await fetch(`/api/workspace/projects/${project.id}/preview`);
      const payload = await response.json() as { preview?: PreviewViewState; error?: string };
      if (!response.ok || !payload.preview) throw new Error(payload.error || "Preview evidence is unavailable.");
      setPreview(payload.preview);
      setMessage("");
    } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Preview evidence is unavailable."); }
  };
  useEffect(() => { void refresh(); }, [project.id, source]);
  return <section className="kf-capability-panel" aria-label={`Preview context for ${source}`}>
    <div className="kf-card-heading"><div><Play size={17} /><h3>Current Preview context</h3></div><span>{source}</span></div>
    <p className="kf-capability-copy">This surface references the same project Preview session and evidence. Starting, stopping, repairing, and verifying remain owned by the single Preview engine.</p>
    {message && <StatusMessage>{message}</StatusMessage>}
    {preview && <div className="kf-hardware-grid"><span><strong>State</strong>{preview.state}</span><span><strong>Health</strong>{preview.health?.ok ? `HTTP ${preview.health.status || "OK"}` : preview.health?.detail || "Not checked"}</span><span><strong>Session</strong>{preview.sessionId || "NOT_STARTED"}</span><span><strong>Checked</strong>{preview.checkedAt ? formatDate(preview.checkedAt) : "UNAVAILABLE"}</span></div>}
    <div className="kf-inline-controls"><button className="kf-button kf-button--primary" onClick={onNavigate}>Open shared Preview</button><button onClick={() => void refresh()}>Refresh Preview evidence</button></div>
  </section>;
}

function PreviewPanel({ project, settings }: { project: ProjectSummary; settings?: KForgePlatformSettings["preview"] }) {
  const [preview, setPreview] = useState<PreviewViewState | null>(null);
  const [message, setMessage] = useState("Reading local Preview state…");
  const [loopIssues, setLoopIssues] = useState<ScanIssue[]>([]);
  const [loopResult, setLoopResult] = useState<Record<string, unknown> | null>(null);
  const [tab, setTab] = useState<"preview" | "console" | "routes" | "network" | "history" | "metadata">("preview");
  const [reloadKey, setReloadKey] = useState(0);
  const request = async (path: string, method = "GET") => {
    try {
      const response = await fetch(`/api/workspace/projects/${project.id}/preview${path}`, { method });
      const payload = await response.json() as { preview?: PreviewViewState; error?: string };
      if (!response.ok || !payload.preview) throw new Error(payload.error || payload.preview?.error || "Preview operation failed.");
      setPreview(payload.preview);
      setMessage("");
      return payload.preview;
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : "Preview operation failed.");
      return null;
    }
  };
  const refresh = async () => { await request(""); };
  const loadLoopIssues = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/problems`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Problems are unavailable."); setLoopIssues((payload.problems || []).filter((entry: ScanIssue) => entry.fixability === "automatic")); } catch { setLoopIssues([]); } };
  const fixAndVerify = async (issue: ScanIssue) => {
    if (!window.confirm(`Apply the reviewed safe fix for “${issue.title}” after a snapshot, run detected verification, restart Preview, and roll back automatically on failure?`)) return;
    try {
      setMessage("Running Preview → Problem → Agent → Snapshot → Fix → Verify…");
      const response = await fetch(`/api/workspace/projects/${project.id}/preview/fix-verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issueId: issue.id, confirmed: true }) });
      const payload = await response.json();
      setLoopResult(payload);
      if (!response.ok) setMessage(payload.error || "Preview Fix & Verify did not pass; its evidence is preserved below."); else setMessage("Preview Fix & Verify passed with a healthy restarted Preview.");
      if (payload.previewAfter) setPreview(payload.previewAfter);
      await loadLoopIssues();
    } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Preview Fix & Verify failed."); }
  };
  useEffect(() => { void refresh(); void loadLoopIssues(); setLoopResult(null); setTab("preview"); }, [project.id]);
  const running = preview?.state === "running" || preview?.state === "starting";
  const failingPreview = Boolean(preview && !["idle", "unavailable", "stopped"].includes(preview.state) && (preview.health?.ok === false || preview.error || preview.state === "failed"));
  useEffect(() => {
    if (!running || settings?.autoHealthCheck === false) return;
    const timer = window.setInterval(() => { void request("/health", "POST"); }, settings?.healthIntervalMs || 5_000);
    return () => window.clearInterval(timer);
  }, [project.id, running, settings?.autoHealthCheck, settings?.healthIntervalMs]);
  const tabs = [["preview", "Preview"], ["console", "Console"], ["routes", "Routes"], ["network", "Network"], ["history", "History"], ["metadata", "Metadata"]] as const;
  return <section className="kf-preview-engine">
    <div className="kf-card-heading"><div><Play size={17} /><h3>KNOuX Forge Preview Engine</h3></div><button onClick={() => void refresh()}>Refresh evidence</button></div>
    <p className="kf-capability-copy">One trusted local Preview engine owns the process lifecycle, session identity, discovered routes, process console, health-probe network evidence, and bounded history. It never claims browser-console capture or remote deployment.</p>
    {message && <StatusMessage>{message}</StatusMessage>}
    <div className="kf-hardware-grid"><span><strong>State</strong>{preview?.state || "loading"}</span><span><strong>Health</strong>{preview?.health?.ok ? `HTTP ${preview.health.status}` : preview?.health?.detail || "not checked"}</span><span><strong>Session</strong>{preview?.sessionId || "not started"}</span><span><strong>Port</strong>{preview?.port || "not allocated"}</span><span><strong>PID</strong>{preview?.pid || "not allocated"}</span><span><strong>Trust</strong>{project.trust}</span></div>
    <div className="kf-preview-actions"><button className="kf-button kf-button--primary" disabled={project.trust !== "trusted" || running} onClick={() => void request("/start", "POST")}>Start</button><button disabled={project.trust !== "trusted" || !running} onClick={() => void request("/restart", "POST")}>Restart</button><button disabled={!running} onClick={() => void request("/health", "POST")}>Health check</button><button disabled={!preview?.health?.ok} onClick={() => setReloadKey((value) => value + 1)}>Reload frame</button><button disabled={project.trust !== "trusted" || !running} onClick={() => void request("/stop", "POST")}>Stop</button>{preview?.url && <a href={preview.url} target="_blank" rel="noreferrer">Open external</a>}</div>
    {project.trust !== "trusted" && <p className="kf-capability-copy">BLOCKED: trust this local project before starting or controlling its process.</p>}
    <div className="kf-preview-tabs" role="tablist" aria-label="Preview evidence views">{tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>{label}</button>)}</div>
    <div className="kf-preview-workspace">
      {tab === "preview" && (preview?.url && preview.health?.ok ? <iframe key={reloadKey} className="kf-preview-frame" title={`Local Preview: ${project.name}`} src={preview.url} /> : <div className="kf-online-empty"><Play size={24} /><strong>No healthy local frame</strong><p>Start the detected project command and complete an HTTP health check before KForge embeds the local route.</p></div>)}
      {tab === "console" && <article className="kf-command-evidence"><strong>Process stdout / stderr</strong><small>Browser console capture: NOT AVAILABLE in the current server adapter.</small><pre>{preview?.logs?.length ? preview.logs.join("\n") : "No Preview process output has been captured in this server session."}</pre></article>}
      {tab === "routes" && <div className="kf-preview-evidence-list">{preview?.routes?.length ? preview.routes.map((route) => <article key={`${route.path}:${route.checkedAt}`}><strong>{route.path}</strong><span>{route.source}</span><small>{formatDate(route.checkedAt)}</small></article>) : <p>No same-origin route evidence has been discovered from a healthy root document.</p>}</div>}
      {tab === "network" && <><div className="kf-settings-lock"><Network size={16} /><span><strong>Captured scope: local health probe only</strong><small>Project source is not sent. Browser requests beyond the KForge HTTP probe are not captured by this adapter.</small></span></div><div className="kf-preview-evidence-list">{preview?.healthHistory?.length ? [...preview.healthHistory].reverse().map((entry) => <article key={`${entry.checkedAt}:${entry.detail}`}><strong>{entry.ok ? "PASS" : "FAILED"} {entry.status ? `· HTTP ${entry.status}` : ""}</strong><span>LOCAL</span><small>{formatDate(entry.checkedAt)} · {entry.detail}</small></article>) : <p>No local network probe has run.</p>}</div></>}
      {tab === "history" && <div className="kf-preview-evidence-list">{preview?.history?.length ? [...preview.history].reverse().map((entry) => <article key={`${entry.at}:${entry.event}`}><strong>{entry.event}</strong><span>session event</span><small>{formatDate(entry.at)} · {entry.detail}</small></article>) : <p>No Preview lifecycle event exists in this server session.</p>}</div>}
      {tab === "metadata" && <article className="kf-command-evidence"><strong>Runtime metadata</strong><pre>{JSON.stringify({ project: project.name, sessionId: preview?.sessionId || "NOT_STARTED", command: preview?.command || "UNAVAILABLE", url: preview?.url || "UNAVAILABLE", pid: preview?.pid || "UNAVAILABLE", startedAt: preview?.startedAt || "UNAVAILABLE", stoppedAt: preview?.stoppedAt || "UNAVAILABLE", checkedAt: preview?.checkedAt || "UNAVAILABLE", runtime: preview?.runtime, telemetry: preview?.telemetry, settings: settings || "DEFAULT" }, null, 2)}</pre></article>}
    </div>
    {preview?.error && <article className="kf-command-evidence"><strong>Preview error</strong><pre>{preview.error}</pre></article>}
    <article className="kf-command-evidence"><strong>Preview → Fix → Verify</strong><small>This path requires current failing Preview evidence, a scanner problem with a verified deterministic patch, project trust, and explicit confirmation. It creates a snapshot, runs detected typecheck/test/build commands, restarts this same Preview engine, verifies HTTP health, and restores the snapshot on any failure.</small>{failingPreview ? loopIssues.length ? <div className="kf-issues">{loopIssues.map((issue) => <div className="kf-issue" key={issue.id}><p><strong>{issue.title}</strong></p><small>{issue.file || issue.category} · {issue.suggestion || issue.message}</small><button disabled={project.trust !== "trusted"} onClick={() => void fixAndVerify(issue)}>Fix, restart, and verify</button></div>)}</div> : <p>No current scanner problem has a verified automatic patch. KForge will not invent a fix for this Preview failure.</p> : <p>Start Preview and capture a failing health or process result before linking a problem to the repair loop.</p>}<button onClick={() => void loadLoopIssues()}>Refresh eligible problems</button></article>
    {loopResult && <article className="kf-command-evidence"><strong>Fix & Verify evidence</strong><pre>{JSON.stringify(loopResult, null, 2)}</pre></article>}
  </section>;
}

function ExecutionEvidence({ results, tasks }: { results?: Partial<Record<WorkspaceAction, CommandResult>>; tasks: TaskItem[] }) { const actualResults = Object.values(results || {}).filter((entry): entry is CommandResult => Boolean(entry)); return <div className="kf-task-list">{actualResults.map((result) => <article className="kf-command-evidence" key={`${result.action}:${result.completedAt}`}><strong>{result.action} · {result.ok ? "PASS" : "FAILED"}</strong><small>{result.message}</small><pre>{result.output || "No process output was captured."}</pre><details><summary>Execution and data disclosure</summary><pre>{JSON.stringify(result.transparency, null, 2)}</pre></details></article>)}{tasks.map((task) => <article className="kf-command-evidence" key={task.id}><strong>{task.action} · {task.state}</strong><small>{task.message} · {task.progress}%</small><pre>{task.output || "Waiting for local process output…"}</pre></article>)}{actualResults.length === 0 && tasks.length === 0 && <p className="kf-capability-copy">No local command has run from this session yet.</p>}</div>; }

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
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><GitBranch size={17} /><h3>Git Center</h3></div><button onClick={() => void refresh()}>Refresh</button></div>{message && <StatusMessage>{message}</StatusMessage>}{data && <><div className="kf-hardware-grid"><span><strong>Branch</strong>{data.branch || "Unavailable"}</span><span><strong>Remote</strong>{data.remoteUrl || "No remote"}</span><span><strong>Stashes</strong>{data.stashes?.length || 0}</span><span><strong>Tags</strong>{data.tags?.length || 0}</span></div><article className="kf-command-evidence"><strong>Working tree</strong><pre>{data.status || "No Git status output."}</pre></article><article className="kf-command-evidence"><strong>Diff stat</strong><pre>{data.diffStat || "Clean working tree."}</pre></article><div className="kf-inline-controls"><input value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="feature/branch-name" aria-label="New local branch name" /><button onClick={() => void createBranch()}>Create branch</button><button onClick={() => void loadProposal()}>Smart Commit preview</button><button onClick={() => void runPrePush()}>Run Pre-push Gate</button></div>{proposal && <article className="kf-command-evidence"><strong>{proposal.title}</strong><small>{proposal.description}</small><pre>{JSON.stringify({ changedFiles: proposal.changedFiles, diffStat: proposal.diffStat, validations: proposal.validations }, null, 2)}</pre></article>}{prePush && <article className="kf-command-evidence"><strong>Pre-push verification</strong><pre>{JSON.stringify(prePush, null, 2)}</pre></article>}<div className="kf-provider-grid">{(data.commits || []).slice(0, 8).map((commit) => <article className="kf-provider-card" key={commit.sha}><div><strong>{commit.subject}</strong><span>{commit.shortSha}</span></div><small>{formatDate(commit.committedAt)}</small></article>)}{(data.tags || []).slice(0, 8).map((tag) => <article className="kf-provider-card" key={`tag-${tag}`}><div><strong>{tag}</strong><span>Tag</span></div></article>)}</div></>}</section>;
}

function GitHubCenterPanel({ project, view, onlineOptional }: { project: ProjectSummary; view: "GitHub" | "Pull requests" | "Issues" | "Actions" | "Releases"; onlineOptional: boolean }) {
  type SourceState = { label: string; endpoint: string | null; state: string; reason: string; fetchedAt: string };
  type GitHubData = { slug?: string; connection?: { state: string; authenticated?: boolean; reason: string }; repository?: { full_name?: string; default_branch?: string; open_issues_count?: number; error?: string }; branches?: Array<{ name: string; commit?: { sha?: string } }> | { error?: string }; commits?: Array<{ sha: string; commit?: { message?: string; author?: { date?: string } } }> | { error?: string }; issues?: Array<{ number: number; title: string }> | { error?: string }; pullRequests?: Array<{ number: number; title: string }> | { error?: string }; actions?: { workflow_runs?: Array<{ id: number; name: string; status: string; conclusion?: string }> } | { error?: string }; checks?: { state: string; commitSha?: string | null; reason: string; checkRuns?: { check_runs?: Array<{ id: number; name: string; status: string; conclusion?: string }> ; error?: string }; status?: { state?: string; statuses?: Array<{ id: number; context: string; state: string; description?: string }>; error?: string } }; releases?: Array<{ id: number; name?: string; tag_name?: string; draft?: boolean; prerelease?: boolean }> | { error?: string }; sources?: Record<string, SourceState>; transparency?: OperationTransparency; error?: string };
  const [data, setData] = useState<GitHubData | null>(null);
  const [message, setMessage] = useState(onlineOptional ? "Ready to load GitHub metadata after an explicit refresh." : "GitHub metadata stays disabled by the current mode.");
  const refresh = async () => { if (!onlineOptional) { setMessage("Switch to Local First, Online Optional, or Online before loading GitHub metadata. Local Git remains available."); return; } try { const response = await fetch(`/api/workspace/projects/${project.id}/github`); const payload = await response.json() as GitHubData; if (payload.connection || payload.checks) setData(payload); if (!response.ok) throw new Error(payload.error || payload.connection?.reason || "GitHub metadata is unavailable."); setData(payload); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "GitHub request failed."); } };
  useEffect(() => { setData(null); setMessage(onlineOptional ? `Ready to load ${view} metadata after an explicit refresh.` : `${view} metadata stays disabled by the current mode.`); }, [project.id, onlineOptional, view]);
  const issues = Array.isArray(data?.issues) ? data.issues : []; const pulls = Array.isArray(data?.pullRequests) ? data.pullRequests : []; const branches = Array.isArray(data?.branches) ? data.branches : []; const commits = Array.isArray(data?.commits) ? data.commits : []; const runs = data?.actions && "workflow_runs" in data.actions ? data.actions.workflow_runs || [] : []; const checkRuns = data?.checks?.checkRuns?.check_runs || []; const statuses = data?.checks?.status?.statuses || []; const releases = Array.isArray(data?.releases) ? data.releases : [];
  const actionCards = [...runs.map((run) => ({ key: `run-${run.id}`, name: run.name, kind: "Workflow run", state: run.conclusion || run.status })), ...checkRuns.map((check) => ({ key: `check-${check.id}`, name: check.name, kind: "Check run", state: check.conclusion || check.status })), ...statuses.map((status) => ({ key: `status-${status.id}`, name: status.context, kind: "Commit status", state: status.state }))];
  const cards = view === "Pull requests" ? pulls.slice(0, 20).map((pull) => <article className="kf-provider-card" key={`pr-${pull.number}`}><div><strong>#{pull.number} {pull.title}</strong><span>Pull request</span></div></article>) : view === "Issues" ? issues.slice(0, 20).map((issue) => <article className="kf-provider-card" key={`issue-${issue.number}`}><div><strong>#{issue.number} {issue.title}</strong><span>Issue</span></div></article>) : view === "Actions" ? actionCards.slice(0, 40).map((entry) => <article className="kf-provider-card" key={entry.key}><div><strong>{entry.name}</strong><span>{entry.state}</span></div><small>{entry.kind}</small></article>) : view === "Releases" ? releases.slice(0, 20).map((release) => <article className="kf-provider-card" key={`release-${release.id}`}><div><strong>{release.name || release.tag_name || "Untitled release"}</strong><span>{release.draft ? "draft" : release.prerelease ? "pre-release" : "release"}</span></div><small>{release.tag_name || "No tag reported"}</small></article>) : [];
  return <section className="kf-capability-panel">
    <div className="kf-card-heading"><div><Github size={17} /><h3>{view}</h3></div><button disabled={!onlineOptional} onClick={() => void refresh()}>Refresh {view}</button></div>
    <p className="kf-capability-copy">Execution: REMOTE read · Network: REQUIRED · Data: repository, branch, commit, issue, pull request, action, check-run, status, release metadata, and credential reference · Project source sent: NO · Secret redaction: enforced. Remote writes remain separate and unavailable from this read-only surface.</p>
    {message && <StatusMessage>{message}</StatusMessage>}
    {data && <>
      <div className="kf-hardware-grid"><span><strong>Connection</strong>{data.connection?.state || "UNKNOWN"}</span><span><strong>Repository</strong>{data.repository?.full_name || data.slug || "UNAVAILABLE"}</span><span><strong>Default branch</strong>{data.repository?.default_branch || "UNAVAILABLE"}</span><span><strong>Branches</strong>{branches.length}</span><span><strong>Commits</strong>{commits.length}</span><span><strong>Checks</strong>{data.checks?.state || "UNKNOWN"}</span></div>
      {data.checks && <article className="kf-command-evidence"><strong>Real GitHub Checks · {data.checks.state}</strong><small>Commit {data.checks.commitSha || "UNAVAILABLE"} · {data.checks.reason}</small><pre>{JSON.stringify({ checkRuns, combinedStatus: data.checks.status, evidence: { checkRuns: data.sources?.checkRuns, commitStatus: data.sources?.commitStatus } }, null, 2)}</pre></article>}
      {data.transparency && <article className="kf-command-evidence"><strong>Network transparency evidence</strong><pre>{JSON.stringify(data.transparency, null, 2)}</pre></article>}
      {view === "GitHub" ? <><div className="kf-provider-grid"><article className="kf-provider-card"><div><strong>Branches</strong><span>{branches.length}</span></div><small>Real remote branch metadata</small></article><article className="kf-provider-card"><div><strong>Commits</strong><span>{commits.length}</span></div><small>Remote commits for {project.branch}</small></article><article className="kf-provider-card"><div><strong>Pull requests</strong><span>{pulls.length}</span></div><small>Open remote pull-request metadata</small></article><article className="kf-provider-card"><div><strong>Issues</strong><span>{issues.length}</span></div><small>Open remote issue metadata</small></article><article className="kf-provider-card"><div><strong>Actions</strong><span>{runs.length}</span></div><small>Latest workflow-run metadata</small></article><article className="kf-provider-card"><div><strong>Releases</strong><span>{releases.length}</span></div><small>Published and draft release metadata</small></article></div><article className="kf-command-evidence"><strong>Branches and recent commits</strong><pre>{JSON.stringify({ branches: branches.map((entry) => ({ name: entry.name, sha: entry.commit?.sha })), commits: commits.map((entry) => ({ sha: entry.sha, message: entry.commit?.message, committedAt: entry.commit?.author?.date })) }, null, 2)}</pre></article></> : cards.length ? <div className="kf-provider-grid">{cards}</div> : <p className="kf-capability-copy">No {view.toLowerCase()} were returned by the configured GitHub source.</p>}
      {data.sources && <article className="kf-command-evidence"><strong>GitHub source availability</strong><pre>{JSON.stringify(data.sources, null, 2)}</pre></article>}
    </>}
  </section>;
}

function SolutionsPanel({ scan, onScan, onNavigate }: { scan?: ProjectScan; onScan: () => void; onNavigate: (label: string) => void }) { const automatic = (scan?.issues || []).filter((entry) => entry.fixability === "automatic"); return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Wrench size={17} /><h3>Solutions Engine</h3></div><button onClick={onScan}>Refresh evidence</button></div><p className="kf-capability-copy">KForge exposes only fixes with a verified preview path. A safe patch creates a snapshot first, verifies detected commands, and restores the snapshot on verification failure.</p>{!scan ? <p className="kf-capability-copy">No scan evidence is loaded. Run a local scan before a solution can be classified.</p> : automatic.length ? <div className="kf-issues">{automatic.map((entry) => <details className="kf-issue" key={entry.id}><summary><span className={`kf-severity kf-severity--${entry.severity}`}>{entry.severity}</span><span><strong>{entry.title}</strong><small>Automatic preview available · {entry.file || entry.category}</small></span><ChevronRight size={15} /></summary><p>{entry.suggestion || entry.message}</p><p className="kf-suggestion"><Wrench size={14} />This issue has a deterministic preview path. Open Problems to inspect, preview, apply, and verify its safe patch.</p><button onClick={() => onNavigate("Problems")}>Open in Problems</button></details>)}</div> : <p className="kf-capability-copy">The current evidence contains no automatic patch. KForge will not invent a fix; use Problems for explanation and guided review.</p>}</section>; }

function SnapshotsPanel({ project }: { project: ProjectSummary }) {
  const [snapshots, setSnapshots] = useState<Array<{ id: string; createdAt: string; reason: string; files: string[] }> | null>(null);
  const [files, setFiles] = useState("");
  const [reason, setReason] = useState("Manual KForge recovery point");
  const [message, setMessage] = useState("Loading local recovery snapshots…");
  const refresh = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/snapshots`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Snapshots are unavailable."); setSnapshots(payload.snapshots || []); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Snapshot request failed."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  const create = async () => { const selected = files.split(/[,\n]/).map((entry) => entry.trim()).filter(Boolean); if (!selected.length) { setMessage("Add one or more project-relative files to create a snapshot."); return; } if (!window.confirm(`Create a local snapshot of ${selected.length} file(s) before making changes?`)) return; try { const response = await fetch(`/api/workspace/projects/${project.id}/snapshots`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: selected, reason, confirmed: true }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Snapshot could not be created."); setFiles(""); setMessage(`Snapshot ${payload.snapshot?.id || "created"} is ready for recovery.`); await refresh(); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Snapshot creation failed."); } };
  const restore = async (snapshot: { id: string; files: string[] }) => { if (!window.confirm(`Restore ${snapshot.files.length} file(s) from snapshot ${snapshot.id}? Current file contents will be overwritten.`)) return; try { const response = await fetch(`/api/workspace/projects/${project.id}/snapshots/${snapshot.id}/restore`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Snapshot restore failed."); setMessage(`Snapshot ${snapshot.id} restored.`); await refresh(); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Snapshot restore failed."); } };
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><History size={17} /><h3>Snapshot & Recovery</h3></div><button onClick={() => void refresh()}>Refresh</button></div><p className="kf-capability-copy">Snapshots are local recovery points. Safe solution and agent flows create them before a verified patch; manual snapshots require an explicit file list and confirmation.</p>{message && <StatusMessage>{message}</StatusMessage>}<div className="kf-agent-panel"><input value={files} onChange={(event) => setFiles(event.target.value)} placeholder="client/App.tsx, client/global.css" aria-label="Files to snapshot" /><input value={reason} onChange={(event) => setReason(event.target.value)} aria-label="Snapshot reason" /><button className="kf-button kf-button--primary" onClick={() => void create()}>Create snapshot</button></div>{snapshots?.length ? <div className="kf-provider-grid">{snapshots.map((snapshot) => <article className="kf-provider-card" key={snapshot.id}><div><strong>{snapshot.reason}</strong><span>{snapshot.files.length} file(s)</span></div><small>{snapshot.id} · {formatDate(snapshot.createdAt)}</small><button onClick={() => void restore(snapshot)}>Restore snapshot</button></article>)}</div> : <p className="kf-capability-copy">No local snapshot exists for this project yet.</p>}</section>;
}



function DesktopRuntimeCard() {
  const [runtime, setRuntime] = useState<KForgeDesktopRuntimeInfo | null>(null);
  const [message, setMessage] = useState(window.kforgeDesktop ? "Reading desktop runtime metadata…" : "UNAVAILABLE: this KForge session is not running inside the packaged desktop shell.");
  useEffect(() => {
    let active = true;
    if (!window.kforgeDesktop) return () => { active = false; };
    void window.kforgeDesktop.getRuntimeInfo()
      .then((value) => { if (active) { setRuntime(value); setMessage(""); } })
      .catch(() => { if (active) setMessage("UNAVAILABLE: desktop runtime metadata could not be read."); });
    return () => { active = false; };
  }, []);
  return <article className="kf-command-evidence" aria-label="KForge desktop runtime information"><strong>About KNOuX Forge</strong>{runtime ? <div className="kf-hardware-grid"><span><strong>Version</strong>{runtime.version}</span><span><strong>Runtime</strong>{runtime.runtime}</span><span><strong>Platform</strong>{runtime.platform} · {runtime.architecture}</span><span><strong>Build type</strong>{runtime.packaged ? "Installed desktop" : "Development desktop"}</span><span><strong>Signing</strong>{runtime.signature}</span></div> : <p className="kf-capability-copy">{message}</p>}{runtime?.signature === "UNSIGNED" && <p className="kf-capability-copy">UNSIGNED DEVELOPMENT/RELEASE ARTIFACT. A valid signing certificate has not been configured or verified for this build.</p>}</article>;
}

function SettingsCenter({ settings, platform, onSettingsChange, onModeChange }: { settings: KForgePlatformSettings | null; platform?: LocalPlatformStatus; onSettingsChange: (settings: KForgePlatformSettings) => void; onModeChange: (mode: LocalPlatformStatus["mode"]) => void }) {
  const [draft, setDraft] = useState<KForgePlatformSettings | null>(settings);
  const [message, setMessage] = useState(settings ? "" : "Loading persisted platform settings…");
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  const persist = async (next: KForgePlatformSettings) => {
    setSaving(true);
    try {
      const response = await fetch("/api/workspace/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const payload = await response.json() as { settings?: KForgePlatformSettings; error?: string };
      if (!response.ok || !payload.settings) throw new Error(payload.error || "Settings could not be saved.");
      setDraft(payload.settings);
      onSettingsChange(payload.settings);
      setMessage(`Settings saved locally at ${formatDate(payload.settings.updatedAt)}.`);
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : "Settings could not be saved.");
    } finally { setSaving(false); }
  };
  const reset = async () => {
    if (!window.confirm("Reset KForge platform settings to their safe local defaults? Project collections, tasks, trust, and snapshots are not deleted.")) return;
    setSaving(true);
    try {
      const response = await fetch("/api/workspace/settings/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }) });
      const payload = await response.json() as { settings?: KForgePlatformSettings; error?: string };
      if (!response.ok || !payload.settings) throw new Error(payload.error || "Settings could not be reset.");
      setDraft(payload.settings);
      onSettingsChange(payload.settings);
      setMessage("Safe local defaults restored. Project evidence and collections were preserved.");
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : "Settings could not be reset.");
    } finally { setSaving(false); }
  };
  if (!draft) return <section className="kf-capability-panel"><p className="kf-capability-copy">{message}</p></section>;
  return <section className="kf-settings-center">
    <header className="kf-settings-header"><div><p className="kf-eyebrow">Persistent platform policy</p><h2>Settings Center</h2><p>Editable controls are connected to real runtime behavior. Every other requested domain is classified by its actual owner or availability.</p></div><div className="kf-heading-actions"><button className="kf-button kf-button--ghost" disabled={saving} onClick={() => void reset()}>Reset</button><button className="kf-button kf-button--primary" disabled={saving} onClick={() => void persist(draft)}>{saving ? "Saving…" : "Save settings"}</button></div></header>
        {message && <StatusMessage>{message}</StatusMessage>}
    <DesktopRuntimeCard />
    <div className="kf-settings-layout"><div className="kf-settings-form">
      <fieldset><legend>General · EDITABLE_REAL</legend>
        <label>Startup capability<select value={draft.general.startupCapability} onChange={(event) => setDraft({ ...draft, general: { ...draft.general, startupCapability: event.target.value as KForgePlatformSettings["general"]["startupCapability"] } })}>{KFORGE_STARTUP_CAPABILITIES.map((capability) => <option key={capability}>{capability}</option>)}</select><small>Applied the next time the Workspace loads.</small></label>
      </fieldset>
      <fieldset><legend>Appearance · EDITABLE_REAL</legend>
        <label>Information density<select value={draft.appearance.density} onChange={(event) => setDraft({ ...draft, appearance: { ...draft.appearance, density: event.target.value as KForgePlatformSettings["appearance"]["density"] } })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
        <label className="kf-settings-check"><input type="checkbox" checked={draft.appearance.reducedMotion} onChange={(event) => setDraft({ ...draft, appearance: { ...draft.appearance, reducedMotion: event.target.checked } })} /><span><strong>Reduce motion</strong><small>Disables nonessential workspace transitions immediately after saving.</small></span></label>
      </fieldset>
      <fieldset><legend>Privacy · EDITABLE_REAL</legend>
        <div className="kf-settings-lock"><ShieldAlert size={16} /><span><strong>Secret redaction: ENFORCED</strong><small>Cannot be disabled. .env, tokens, keys, credentials, cookies, auth headers are always redacted.</small></span></div>
        <label>Remote context policy<select value={draft.privacy.remoteContextPolicy} onChange={(event) => setDraft({ ...draft, privacy: { ...draft.privacy, remoteContextPolicy: event.target.value as KForgePlatformSettings["privacy"]["remoteContextPolicy"] } })}><option value="ask">Ask before sending</option><option value="blocked">Block remote context</option></select></label>
        <div className="kf-settings-lock"><GitBranch size={16} /><span><strong>Confirm remote writes: ENFORCED</strong><small>Push and other remote writes cannot be made silent.</small></span></div>
      </fieldset>
      <fieldset><legend>Online / Offline · MANAGED_ELSEWHERE</legend>
        <div className="kf-inline-controls">{(["offline", "local-first", "online-optional", "online"] as const).map((mode) => <button key={mode} className={`kf-button ${platform?.mode === mode ? "kf-button--primary" : "kf-button--ghost"}`} onClick={() => onModeChange(mode)}>{platformModeLabel(mode)}</button>)}</div>
        <small>The canonical local-platform store atomically persists this mode. Metadata reads, remote transfers, and provider refresh have separate enforced eligibility.</small>
      </fieldset>
      <fieldset><legend>Preview · EDITABLE_REAL</legend>
        <label className="kf-settings-check"><input type="checkbox" checked={draft.preview.autoHealthCheck} onChange={(event) => setDraft({ ...draft, preview: { ...draft.preview, autoHealthCheck: event.target.checked } })} /><span><strong>Automatic health checks</strong><small>Polls only the allocated local Preview URL while its process is running.</small></span></label>
        <label>Health interval<select disabled={!draft.preview.autoHealthCheck} value={draft.preview.healthIntervalMs} onChange={(event) => setDraft({ ...draft, preview: { ...draft.preview, healthIntervalMs: Number(event.target.value) as KForgePlatformSettings["preview"]["healthIntervalMs"] } })}><option value={3000}>3 seconds</option><option value={5000}>5 seconds</option><option value={10000}>10 seconds</option><option value={30000}>30 seconds</option></select></label>
      </fieldset>
    </div><aside className="kf-settings-domains" aria-label="Settings domain handling"><h3>Requested settings domains</h3>{KFORGE_SETTINGS_DOMAIN_HANDLING.map(([domain, state, detail]) => <article key={domain}><div><strong>{domain}</strong><span data-state={state}>{state}</span></div><p>{detail}</p></article>)}</aside></div>
  </section>;
}

function LocalPlatformPanel({ platform, onModeChange }: { platform?: LocalPlatformStatus; onModeChange: (mode: LocalPlatformStatus["mode"]) => void }) {
  if (!platform) return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Settings2 size={17} /><h3>Local platform</h3></div></div><p className="kf-capability-copy">Reading local platform status…</p></section>;
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Settings2 size={17} /><h3>Local-First Platform</h3></div><span>{platformModeLabel(platform.mode)}</span></div><p className="kf-capability-copy">Core KForge engineering stays local, free of mandatory cloud APIs, subscriptions, and internet access. Opening a remote surface never contacts its provider; the current mode independently controls metadata reads, transfers, and provider refresh.</p><div className="kf-hardware-grid"><span><strong>Core readiness</strong>{platform.coreReady ? "Ready locally" : "Review local tooling"}</span><span><strong>Network for core</strong>{platform.networkRequiredForCore ? "Required" : "Not required"}</span><span><strong>Metadata reads</strong>{platform.policy.externalMetadataReads ? "Explicit actions enabled" : "Blocked"}</span><span><strong>Remote transfers</strong>{platform.policy.remoteTransfers ? "Confirmed actions enabled" : "Blocked"}</span><span><strong>Provider refresh</strong>{platform.policy.providerRefresh ? "Explicit refresh enabled" : "Blocked"}</span><span><strong>Local storage</strong>{platform.storagePath}</span></div><div className="kf-provider-grid">{platform.capabilities.map((item) => <article className="kf-provider-card" key={item.id}><div><strong>{item.label}</strong><span>{item.state}</span></div><small>{item.detail}</small></article>)}</div><div className="kf-card-heading"><div><Network size={17} /><h3>Optional online integrations</h3></div><span>Never required for core</span></div><div className="kf-provider-grid">{platform.optionalOnlineFeatures.map((item) => <article className="kf-provider-card" key={item.id}><div><strong>{item.label}</strong><span>{item.enabled ? "Enabled" : "Disabled"}</span></div><small>{item.detail}</small></article>)}</div><div className="kf-inline-controls">{(["offline", "local-first", "online-optional", "online"] as const).map((mode) => <button key={mode} className={`kf-button ${platform.mode === mode ? "kf-button--primary" : "kf-button--ghost"}`} onClick={() => onModeChange(mode)}>{platformModeLabel(mode)}</button>)}</div></section>;
}

function LocalAIOnboarding({ onlineOptional, selectedModelId }: { onlineOptional: boolean; selectedModelId?: string }) {
  const [data, setData] = useState<{ onboarding?: string; downloadUrl?: string; ollama?: { installed: boolean; serviceReachable: boolean; version?: string; reason?: string; models: Array<{ id: string; name: string; contextLength?: number }> }; hardware?: { cpu: { model: string }; memory: { totalBytes: number }; disk: { availableBytes?: number }; gpu: Array<{ name: string }> }; active?: { provider: string; model: string }; fallback?: { provider: string; model: string }; modelHealth?: Record<string, { status: string; testedAt: string; latencyMs?: number; reason?: string }>; recommendations?: Array<{ id: string; label: string; family: string; variant: string; parameterCount: string; quantization: string; compatible: boolean; reason: string; categories: string[]; recommendedUse: string[]; update: { state: string; latestKnownVersion: string; changelog: string } }> } | null>(null);
  const [message, setMessage] = useState("");
  const refresh = async () => { try { const response = await fetch("/api/workspace/ai/models"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Local AI status is unavailable."); setData(payload); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Local AI status failed."); } };
  useEffect(() => { void refresh(); }, []);
  const openInstaller = () => { if (!onlineOptional) { setMessage("Downloads are disabled by the current mode. Choose Online Optional or Online only if you want to open a provider download page."); return; } if (!window.confirm("Open the Ollama download page? KForge will not download or install anything automatically.")) return; if (data?.downloadUrl) window.open(data.downloadUrl, "_blank", "noopener,noreferrer"); setMessage("Download page opened after confirmation. Install Ollama, then choose Detect Existing Runtime."); };
  const setModel = async (model: string, fallback = false) => { try { const response = await fetch("/api/workspace/ai/models/active", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "ollama", model, fallback }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Model selection failed."); setMessage(fallback ? `Fallback model set to ${model}.` : `Active model set to ${model}.`); await refresh(); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Model selection failed."); } };
  const test = async (model: string) => { try { const response = await fetch("/api/workspace/ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "ollama", model }) }); const payload = await response.json(); setMessage(response.ok ? `Health test PASS: ${model} responded in ${payload.latencyMs} ms.` : payload.error || "Health test failed."); await refresh(); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Health test failed."); } };
  const checkUpdate = async (model: string) => { try { const response = await fetch(`/api/workspace/ai/models/${encodeURIComponent(model)}/update`); const payload = await response.json() as { state?: string; currentVersion?: string; latestKnownVersion?: string; detail?: string; error?: string }; if (!response.ok) throw new Error(payload.error || "Model update check failed."); setMessage(`Update check for ${model}: ${payload.state || "UNKNOWN"} · current ${payload.currentVersion || "UNKNOWN"} · latest ${payload.latestKnownVersion || "UNKNOWN"}. ${payload.detail || ""}`); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Model update check failed."); } };
  const remove = async (model: string) => { if (!window.confirm(`Remove local model ${model}? This deletes its downloaded model data.`)) return; try { const response = await fetch(`/api/workspace/ai/models/${encodeURIComponent(model)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "ollama", confirmed: true }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Model removal failed."); setMessage(payload.message || `Removed ${model}.`); await refresh(); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Model removal failed."); } };
  const ollama = data?.ollama;
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Bot size={17} /><h3>Enable Local AI</h3></div><button onClick={() => void refresh()}>Detect Existing Runtime</button></div>{message && <StatusMessage>{message}</StatusMessage>}<div className="kf-wizard-steps"><span className="is-current">1 Hardware</span><span className={ollama?.installed ? "is-current" : ""}>2 Runtime</span><span>3 Models</span><span>4 Confirm</span><span>5 Install</span><span>6 Health test</span><span>7 Activate</span></div><div className="kf-provider-grid"><article className="kf-provider-card"><div><strong>Hardware Detection</strong><span>Step 1</span></div><p>{data?.hardware?.cpu.model || "Detecting CPU…"}</p><small>{data?.hardware ? `${Math.round(data.hardware.memory.totalBytes / 1e9)} GB RAM · ${(data.hardware.gpu || []).map((gpu) => gpu.name).join(", ") || "No dedicated GPU"} · ${data.hardware.disk.availableBytes ? `${Math.round(data.hardware.disk.availableBytes / 1e9)} GB free` : "disk unavailable"}` : "Waiting for local hardware data."}</small></article><article className="kf-provider-card"><div><strong>Ollama</strong><span>{ollama?.installed ? "Installed" : "Not installed"}</span></div><p>{ollama?.serviceReachable ? "Status: Connected" : "Local AI is not configured."}</p><small>{ollama?.version || ollama?.reason || "Detect an existing runtime or install Ollama after confirmation."}</small>{!ollama?.installed && <button onClick={openInstaller}>Install Ollama</button>}{ollama?.installed && !ollama?.serviceReachable && <button onClick={() => void refresh()}>Verify service</button>}<button onClick={() => setMessage("KForge can use Ollama, LM Studio, or llama.cpp when their local runtime is detected. No cloud provider is selected automatically.")}>Use Existing Provider</button></article></div>{(data?.recommendations || []).length > 0 && <><div className="kf-card-heading"><div><Cpu size={17} /><h3>Local Model Families</h3></div><span>Bundled compatibility profiles</span></div><p className="kf-capability-copy">These profiles use detected memory and disk capacity plus documented source links; they are not a live remote catalog. No verified remote adapter is configured, so update and changelog fields remain UNKNOWN or DATA_UNAVAILABLE rather than being inferred.</p><div className="kf-provider-grid">{(data?.recommendations || []).map((model) => <article className={`kf-provider-card ${model.compatible ? "is-compatible" : "is-incompatible"} ${selectedModelId === `ollama:${model.id}` ? "is-selected" : ""}`} aria-current={selectedModelId === `ollama:${model.id}` || undefined} key={model.id}><div><strong>{model.label}</strong><span>{model.parameterCount}</span></div><p>{model.compatible ? "Compatible with detected budget" : "Not recommended for detected budget"}</p><small>{model.family} · variant {model.variant} · quantization {model.quantization}</small><small>{model.categories.join(" · ")} · {model.recommendedUse.join("; ")}</small><small>{model.reason}</small><small>Update: {model.update.state} · latest {model.update.latestKnownVersion} · changelog {model.update.changelog}</small></article>)}</div></>}{ollama?.models?.length ? <div className="kf-provider-grid">{ollama.models.map((model) => { const health = data?.modelHealth?.[`ollama:${model.id}`]; return <article className={`kf-provider-card ${selectedModelId === `ollama:${model.id}` ? "is-selected" : ""}`} aria-current={selectedModelId === `ollama:${model.id}` || undefined} key={model.id}><div><strong>{model.name}</strong><span>{model.contextLength ? `${model.contextLength} ctx` : "local"}</span></div><p>{data?.active?.model === model.id ? "Active model" : data?.fallback?.model === model.id ? "Fallback model" : "Installed model"}</p><small>{health ? `Last test: ${health.status.toUpperCase()} ${health.latencyMs ? `· ${health.latencyMs} ms` : ""} ${health.reason || ""}` : "No health test recorded."}</small><div className="kf-provider-model"><button onClick={() => void setModel(model.id)}>Activate</button><button onClick={() => void setModel(model.id, true)}>Fallback</button><button onClick={() => void test(model.id)}>Test</button><button onClick={() => void checkUpdate(model.id)}>Check update</button><button onClick={() => void remove(model.id)}>Remove</button></div></article>; })}</div> : <p className="kf-capability-copy">Continue Without AI keeps evidence-based planning active. After a runtime and model are available, KForge uses the selected local model for Ask KForge, planning, and Sonar explanations.</p>}</section>;
}

function AICenter({ view, onlineOptional }: { view: "providers" | "models"; onlineOptional: boolean }) {
  const [data, setData] = useState<{ providers?: Array<{ id: string; name: string; kind: string; configured: boolean; reachable: boolean; available: boolean; endpoint?: string; models: Array<{ id: string; name: string }>; reason?: string; privacy?: string }>; hardware?: { os: string; cpu: { model: string; cores: number }; memory: { totalBytes: number }; gpu: Array<{ name: string; vramBytes?: number }>; disk: { availableBytes?: number } }; recommendations?: Array<{ id: string; label: string; pullName: string; parameterCount: string; estimatedDownloadBytes: number; estimatedRamBytes: number; license: string; compatible: boolean; reason: string; family: string; variant: string; quantization: string; categories: string[]; recommendedUse: string[]; sourceUrl: string; update: { state: string; currentVersion: string; latestKnownVersion: string; source: string; changelog: string } }>; active?: { provider: string; model: string } } | null>(null);
  const [message, setMessage] = useState("");
  const refresh = async () => { try { const response = await fetch(view === "models" ? "/api/workspace/ai/models" : "/api/workspace/ai/providers"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "AI Center is unavailable."); setData(view === "models" ? payload : { providers: payload.providers }); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "AI Center request failed."); } };
  useEffect(() => { void refresh(); }, [view]);
  const install = async (pullName: string) => { if (!onlineOptional) { setMessage("Model downloads are disabled by the current mode. Existing local models and deterministic assistance remain available."); return; } if (!window.confirm(`Download ${pullName}? KForge will use disk, RAM, and network only after this confirmation.`)) return; try { const response = await fetch("/api/workspace/ai/models/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "ollama", model: pullName, confirmed: true }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Installation could not start."); setMessage(`Installation task ${payload.task?.id || "started"} is running in the local engine.`); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Installation failed."); } };
  const test = async (provider: string, model: string) => { try { const response = await fetch("/api/workspace/ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, model }) }); const payload = await response.json(); setMessage(response.ok ? `Test passed in ${payload.latencyMs} ms using ${payload.model}.` : payload.error || "Test failed."); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "AI test failed."); } };
  const providers = data?.providers || [];
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Cpu size={17} /><h3>{view === "models" ? "KForge Model Center" : "KForge AI Center"}</h3></div><button onClick={() => void refresh()}>Refresh</button></div>{message && <StatusMessage>{message}</StatusMessage>}{view === "providers" ? <div className="kf-provider-grid">{providers.map((provider) => <article key={provider.id} className="kf-provider-card"><div><strong>{provider.name}</strong><span>{provider.kind}</span></div><p>{provider.available ? "Ready" : provider.reachable ? "Reachable — no model" : provider.configured ? "Configured — not contacted" : "Not configured"}</p><small>{provider.endpoint || provider.reason || provider.privacy}</small>{provider.models.map((model) => <div className="kf-provider-model" key={model.id}><span>{model.name}</span><button onClick={() => void test(provider.id, model.id)}>Test</button></div>)}</article>)}</div> : <div className="kf-model-center"><div className="kf-hardware-grid"><span><strong>OS</strong>{data?.hardware?.os || "Loading"}</span><span><strong>CPU</strong>{data?.hardware?.cpu.model || "Loading"}</span><span><strong>RAM</strong>{data?.hardware ? `${Math.round(data.hardware.memory.totalBytes / 1e9)} GB` : "Loading"}</span><span><strong>GPU</strong>{data?.hardware?.gpu.map((gpu) => gpu.name).join(", ") || "Not reported"}</span><span><strong>Free disk</strong>{data?.hardware?.disk.availableBytes ? `${Math.round(data.hardware.disk.availableBytes / 1e9)} GB` : "Unavailable"}</span></div><p className="kf-capability-copy">The entries below are bundled local compatibility estimates against detected hardware, with official source links. Remote model-registry metadata is not configured, so KForge does not claim live versions, changelogs, availability, or download counts.</p><div className="kf-provider-grid">{(data?.recommendations || []).map((model) => <article key={model.id} className={`kf-provider-card ${model.compatible ? "is-compatible" : "is-incompatible"}`}><div><strong>{model.label}</strong><span>{model.parameterCount}</span></div><p>{model.compatible ? "Compatible with detected budget" : "Not recommended"}</p><small>{model.reason}</small><small>{model.family} · variant {model.variant} · quantization {model.quantization}</small><small>{model.categories.join(" · ")} · {model.recommendedUse.join("; ")}</small><small>{model.license} · ~{Math.round(model.estimatedDownloadBytes / 1e9)} GB download</small><small>Remote update data: {model.update.source} · state {model.update.state} · latest {model.update.latestKnownVersion} · changelog {model.update.changelog}</small><a href={model.sourceUrl} target="_blank" rel="noreferrer">Official source</a><button disabled={!model.compatible || !onlineOptional} title={!onlineOptional ? "Enable Online Optional or Online mode before downloading a model." : undefined} onClick={() => void install(model.pullName)}>Install with confirmation</button></article>)}</div></div>}</section>;
}

function AgentMissionCenter({ project, initialMission }: { project: ProjectSummary; initialMission?: string }) {
  const [mission, setMission] = useState(initialMission || "audit");
  const [status, setStatus] = useState("Choose a mission. KForge records task logs, applies only verified safe patches, and restores snapshots on failed verification.");
  const [registry, setRegistry] = useState<{ tools?: Array<{ name: string; description: string; permission: string; status?: "AVAILABLE" | "AVAILABLE_WITH_CONFIRMATION" | "UNAVAILABLE" | "BLOCKED" | "ERROR"; requiresConfirmation?: boolean; unavailableReason?: string; runtimeError?: string }>; permissions?: Record<string, string> } | null>(null);
  const refreshRegistry = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/agent/tools`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Agent tool registry is unavailable."); setRegistry(payload); } catch (cause: unknown) { setStatus(cause instanceof Error ? cause.message : "Agent tool registry failed."); } };
  useEffect(() => { void refreshRegistry(); }, [project.id]);
  useEffect(() => { if (initialMission) setMission(initialMission); }, [initialMission]);
  const start = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/agent/missions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mission }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Mission could not start."); setStatus(`Mission task ${payload.task.id} started. Open Tasks to follow its event log.`); } catch (cause: unknown) { setStatus(cause instanceof Error ? cause.message : "Mission start failed."); } };
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Bot size={17} /><h3>KForge Engineer missions</h3></div><button onClick={() => void refreshRegistry()}>Refresh tools</button></div><p className="kf-capability-copy">Read · Plan · Patch · Verify. The agent only invokes registered typed tools; commits, pushes, deployment, force push, and secret exposure remain permission-gated or blocked.</p><div className="kf-inline-controls"><select value={mission} onChange={(event) => setMission(event.target.value)}><option value="audit">Audit project</option><option value="fix-critical">Fix critical issue</option><option value="improve-security">Improve security</option><option value="improve-tests">Improve tests</option><option value="refactor">Prepare refactor plan</option><option value="prepare-release">Prepare production release</option><option value="prepare-github">Prepare GitHub</option><option value="documentation">Audit documentation</option><option value="performance">Inspect performance strategy</option></select><button className="kf-button kf-button--primary" onClick={() => void start()}>Start mission</button></div><p className="kf-capability-copy">{status}</p>{registry && <><div className="kf-provider-grid">{(registry.tools || []).map((tool) => { const status = tool.status || "ERROR"; return <article className="kf-provider-card" key={tool.name}><div><strong>{tool.name}</strong><span>{status}</span></div><p>{tool.description}</p><small>Permission: {tool.permission}</small><small>Requires confirmation: {tool.requiresConfirmation ? "Yes" : "No"}</small>{tool.unavailableReason && <small>Unavailable reason: {tool.unavailableReason}</small>}{tool.runtimeError && <small>Runtime error: {tool.runtimeError}</small>}</article>; })}</div><article className="kf-command-evidence"><strong>Agent permissions</strong><pre>{JSON.stringify(registry.permissions, null, 2)}</pre></article></>}</section>;
}

function MissionProgress({ mission }: { mission: MissionItem }) { return <article className="kf-command-evidence"><strong>{mission.name} mission · {mission.state}</strong><small>{mission.type || "agent"} strategy · progress: {mission.progress ?? 0}% · {mission.currentStepId ? `Current step: ${mission.currentStepId}` : "No active step"} · changed files: {mission.changedFiles.length} · evidence: {mission.evidence?.length || 0}</small><p>{mission.goal || "No mission goal was recorded."}</p><div className="kf-task-list">{mission.steps.map((step) => <details className="kf-task" key={step.id}><summary><span><strong>{step.status === "succeeded" ? "✓" : step.status === "running" ? "▶" : step.status === "failed" ? "!" : step.status === "blocked" ? "■" : step.status === "skipped" ? "–" : "○"} {step.name} · {step.status}</strong><small>{step.kind || step.tool} · tool {step.tool} · attempts {step.attempts ?? step.retryCount}{step.requiresConfirmation ? " · confirmation required" : ""}{step.dependencies.length ? ` · after ${step.dependencies.join(", ")}` : ""}</small></span><ChevronRight size={15} /></summary><pre>{JSON.stringify({ startedAt: step.startedAt, finishedAt: step.finishedAt, logs: step.logs, output: step.output, error: step.error, evidence: step.evidence }, null, 2)}</pre></details>)}</div>{mission.warnings.length > 0 && <pre>{mission.warnings.join("\n")}</pre>}<small>Recovery: {mission.recovery.detail}</small></article>; }

function TaskCenterPanel({ tasks, onTaskControl, selectedTaskId }: { tasks: TaskItem[]; onTaskControl: (task: TaskItem, control: "cancel" | "retry" | "resume" | "rollback") => void; selectedTaskId?: string }) { return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Activity size={17} /><h3>Task Center v2</h3></div><span>{tasks.length} selected-project task(s)</span></div>{tasks.length ? <div className="kf-task-list">{tasks.map((task) => <details key={task.id} className={`kf-task kf-task--${task.state}`} open={task.id === selectedTaskId || undefined}><summary><span><strong>{task.action} · {task.state}</strong><small>{task.message} · {task.progress}%{task.finishedAt ? ` · ${Math.max(0, Math.round((new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime()) / 1000))}s` : ""}</small></span><ChevronRight size={15} /></summary><pre>{task.output || "Waiting for process output…"}</pre>{task.mission && <MissionProgress mission={task.mission} />}{task.state === "queued" && <button onClick={() => onTaskControl(task, "cancel")}>Cancel queued task</button>}{["success", "error", "cancelled", "blocked"].includes(task.state) && <button onClick={() => onTaskControl(task, "retry")}>Retry task</button>}{task.mission?.recovery.resume && ["blocked", "error"].includes(task.state) && <button onClick={() => onTaskControl(task, "resume")}>Resume mission</button>}{task.mission?.recovery.rollback && <button onClick={() => onTaskControl(task, "rollback")}>Rollback snapshot</button>}</details>)}</div> : <p className="kf-capability-copy">Agent and project tasks appear here after they start. Logs and output come from the actual local process.</p>}</section>; }

function DocumentationPanel({ project, selectedFindingId }: { project: ProjectSummary; selectedFindingId?: string }) {
  const [audit, setAudit] = useState<{ findings: Array<{ id: string; sourceDocument: string; claim: string; evidence: string; actualState: string; severity: string; suggestedFix: string }> } | null>(null);
  const [message, setMessage] = useState("Loading local documentation evidence…");
  const refresh = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/documentation`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Documentation audit failed."); setAudit(payload.audit); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Documentation audit failed."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  const previewAndApply = async (findingId: string) => { try { const previewResponse = await fetch(`/api/workspace/projects/${project.id}/documentation/${findingId}/preview`, { method: "POST" }); const preview = await previewResponse.json(); if (!previewResponse.ok || !preview.patch) throw new Error(preview.reason || "This evidence requires manual review."); if (!window.confirm(`Apply documentation fix?\n\n${preview.patch.before}\n→ ${preview.patch.after}`)) return; const applyResponse = await fetch(`/api/workspace/projects/${project.id}/documentation/${findingId}/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }) }); const applied = await applyResponse.json(); if (!applyResponse.ok || !applied.verified) throw new Error(applied.reason || "Documentation verification failed."); setMessage("Documentation fix applied and re-audited."); await refresh(); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Documentation fix failed."); } };
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Box size={17} /><h3>Documentation Audit V2</h3></div><button onClick={() => void refresh()}>Refresh</button></div>{message && <p className="kf-capability-message" role="status">{message}</p>}{!audit ? <p className="kf-capability-copy">Loading documentation evidence…</p> : audit.findings.length === 0 ? <p className="kf-capability-copy">No semantic contradictions, missing local links, or stale package commands were detected.</p> : <div className="kf-issues">{audit.findings.map((finding) => <details className="kf-issue" key={finding.id} open={finding.id === selectedFindingId || undefined}><summary><span className={`kf-severity kf-severity--${finding.severity === "high" ? "high" : finding.severity === "medium" ? "medium" : "low"}`}>{finding.severity}</span><span><strong>{finding.sourceDocument}</strong><small>{finding.claim}</small></span><ChevronRight size={15} /></summary><div><p><strong>Evidence:</strong> {finding.evidence}</p><p><strong>Actual state:</strong> {finding.actualState}</p><p className="kf-suggestion"><Wrench size={14} />{finding.suggestedFix}</p>{project.trust === "trusted" && <button className="kf-solution-button" onClick={() => void previewAndApply(finding.id)}>Preview + Apply + Verify</button>}{project.trust !== "trusted" && <p className="kf-capability-copy">Blocked until this project is trusted for a write operation.</p>}</div></details>)}</div>}</section>;
}

function GraphPanel({ project, initialTarget }: { project: ProjectSummary; initialTarget?: string }) {
  const [data, setData] = useState<{ graph?: { generatedAt: string; coverage: { state: "COMPLETE" | "LIMIT_REACHED"; scannedCount: number; totalOrUnknown: number | null; limit: number; reason: string; source: string }; cache: { state: "LIVE" | "CACHED" | "IN_FLIGHT_REUSED"; fingerprint: string; generatedAt: string; servedAt: string }; summary: { files: number; imports: number; exports: number; symbols: number; dependencies: number; routes: number; apis: number; tests: number; cycles: number; duplicatedResponsibilities: number }; nodes: Array<{ id: string; type: string; label: string; path?: string; language?: string; symbolKind?: string; exported?: boolean; line?: number }>; edges: Array<{ from: string; to: string; type: string }>; analysis: { cycles: string[][]; duplicatedResponsibilities: Array<{ symbol: string; kind: string; files: string[]; evidence: string }>; languageAdapters: Array<{ language: string; files: number; state: string; adapter: string; reason: string }>; limitations: string[] } } } | null>(null);
  const [file, setFile] = useState("");
  const [impact, setImpact] = useState<{ target: string; targetType: string; file: string; directDependents: string[]; transitiveDependents: string[]; affectedSymbols: string[]; ownedSymbols: string[]; ownedApis: string[]; relatedTests: string[]; dependencies: string[]; risk: string; message: string; evidence: string } | null>(null);
  const [message, setMessage] = useState("");
  const refresh = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/graph`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Graph unavailable."); setData(payload); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Graph request failed."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  useEffect(() => { if (initialTarget) setFile(initialTarget); }, [initialTarget, project.id]);
  const inspectImpact = async () => { if (!file.trim()) { setMessage("Enter a project-relative file path or select an exported symbol."); return; } try { const response = await fetch(`/api/workspace/projects/${project.id}/graph/impact?target=${encodeURIComponent(file.trim())}`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Impact analysis failed."); setImpact(payload.impact); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Impact analysis failed."); } };
  const graph = data?.graph;
  return <section className="kf-capability-panel">
    <div className="kf-card-heading"><div><Network size={17} /><h3>Project Graph</h3></div><button onClick={() => void refresh()}>Refresh evidence</button></div>
    {message && <StatusMessage>{message}</StatusMessage>}
    {graph ? <>
      <div className="kf-hardware-grid">
        <span><strong>Files</strong>{graph.summary.files}</span><span><strong>Imports</strong>{graph.summary.imports}</span><span><strong>Exports</strong>{graph.summary.exports}</span><span><strong>Symbols</strong>{graph.summary.symbols}</span><span><strong>Dependencies</strong>{graph.summary.dependencies}</span><span><strong>Cycles</strong>{graph.summary.cycles}</span><span><strong>APIs</strong>{graph.summary.apis}</span><span><strong>Tests</strong>{graph.summary.tests}</span>
      </div>
      <p className="kf-capability-copy">Generated {formatDate(graph.generatedAt)} from syntax-tree exports and references plus measured file, import, dependency, route, API, and test evidence. Choose a file or exported symbol node for direct and transitive static impact.</p>
      <article className="kf-command-evidence"><strong>{graph.coverage.state} · {graph.coverage.scannedCount.toLocaleString()} source file(s) scanned</strong><small>{graph.coverage.reason}</small><small>Source: {graph.coverage.source} · total: {graph.coverage.totalOrUnknown ?? "UNKNOWN"} · cache: {graph.cache.state} · served {formatDate(graph.cache.servedAt)}</small></article>
      <div className="kf-inline-controls"><input value={file} onChange={(event) => setFile(event.target.value)} placeholder="file path or symbol node id" aria-label="File path or symbol node id for impact analysis" /><button onClick={() => void inspectImpact()}>Analyze impact</button></div>
      <h4>Files</h4>
      <div className="kf-provider-grid">{graph.nodes.filter((node) => node.type === "file" || node.type === "test").slice(0, 16).map((node) => <button className="kf-provider-card" type="button" key={node.id} onClick={() => setFile(node.path || "")}><div><strong>{node.label}</strong><span>{node.type}</span></div><small>{node.path}</small></button>)}</div>
      <h4>Exported symbols</h4>
      <div className="kf-provider-grid">{graph.nodes.filter((node) => node.type === "symbol").slice(0, 24).map((node) => <button className="kf-provider-card" type="button" key={node.id} onClick={() => setFile(node.id)}><div><strong>{node.label}</strong><span>{node.symbolKind || "symbol"}</span></div><small>{node.path}:{node.line}</small></button>)}</div>
      <article className="kf-command-evidence"><strong>Language parser boundaries</strong><pre>{JSON.stringify(graph.analysis.languageAdapters, null, 2)}</pre></article>
      <article className="kf-command-evidence"><strong>Cycle and duplicated responsibility evidence</strong><pre>{JSON.stringify({ cycles: graph.analysis.cycles, duplicatedResponsibilities: graph.analysis.duplicatedResponsibilities, limitations: graph.analysis.limitations }, null, 2)}</pre></article>
      {impact && <article className="kf-command-evidence"><strong>{impact.risk.toUpperCase()} impact · {impact.target}</strong><small>{impact.message}</small><small>Direct dependents and Transitive dependents are separated below.</small><pre>{JSON.stringify({ targetType: impact.targetType, evidence: impact.evidence, directDependents: impact.directDependents, transitiveDependents: impact.transitiveDependents, affectedSymbols: impact.affectedSymbols, ownedSymbols: impact.ownedSymbols, ownedApis: impact.ownedApis, relatedTests: impact.relatedTests, dependencies: impact.dependencies }, null, 2)}</pre></article>}
    </> : <p className="kf-capability-copy">{message || "Building graph from local source evidence…"}</p>}
  </section>;
}

function DependenciesPanel({ project }: { project: ProjectSummary }) {
  const [profile, setProfile] = useState<{ dependencies: Array<{ name: string; version: string; kind: string }>; manifests: string[]; lockfiles: string[]; packageManager: string | null; detectedAt: string } | null>(null);
  const [message, setMessage] = useState("Reading declared local dependency evidence…");
  const refresh = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/profile`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Dependency profile is unavailable."); setProfile(payload.profile); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Dependency profile failed."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Box size={17} /><h3>Dependency Evidence</h3></div><button onClick={() => void refresh()}>Refresh evidence</button></div>{message && <StatusMessage>{message}</StatusMessage>}{profile && <><div className="kf-hardware-grid"><span><strong>Dependencies</strong>{profile.dependencies.length}</span><span><strong>Package manager</strong>{profile.packageManager || "Not detected"}</span><span><strong>Manifests</strong>{profile.manifests.length}</span><span><strong>Lockfiles</strong>{profile.lockfiles.length}</span></div><p className="kf-capability-copy">This list is derived directly from local manifests and lockfiles; it does not infer transitive dependencies or remote vulnerability data without an available scanner.</p><div className="kf-provider-grid">{profile.dependencies.slice(0, 120).map((dependency) => <article className="kf-provider-card" key={`${dependency.name}:${dependency.kind}`}><div><strong>{dependency.name}</strong><span>{dependency.kind}</span></div><small>{dependency.version}</small></article>)}</div>{profile.dependencies.length === 0 && <p className="kf-capability-copy">No manifest-declared dependencies were detected.</p>}</>}</section>;
}

function ImpactAnalysisPanel({ project }: { project: ProjectSummary }) {
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Network size={17} /><h3>Impact Analysis</h3></div><span>Static evidence</span></div><p className="kf-capability-copy">Choose a source file or exported symbol below to inspect direct and transitive syntax-tree dependents, affected symbols, dependencies, owned APIs, related tests, and measured risk. Runtime and unsupported-language impact remain explicitly unavailable.</p><GraphPanel project={project} /></section>;
}

function CodeUnderstandingPanel({ project }: { project: ProjectSummary }) {
  const [data, setData] = useState<{ profile?: { framework: string[]; languages: string[]; sourceRoots: string[]; testRoots: string[]; workspaceKind: string; runtimeEntrypoint?: string; sourceFileCount: number; totalFileCount: number; fileDiscovery: ProjectProfile["fileDiscovery"] }; graph?: { coverage: { state: string; scannedCount: number; totalOrUnknown: number | null; reason: string }; summary: { files: number; imports: number; exports: number; symbols: number; dependencies: number; routes: number; apis: number; tests: number } } } | null>(null);
  const [message, setMessage] = useState("Building local code understanding evidence…");
  const refresh = async () => { try { const [profileResponse, graphResponse] = await Promise.all([fetch(`/api/workspace/projects/${project.id}/profile`), fetch(`/api/workspace/projects/${project.id}/graph`)]); const profilePayload = await profileResponse.json(); const graphPayload = await graphResponse.json(); if (!profileResponse.ok || !graphResponse.ok) throw new Error(profilePayload.error || graphPayload.error || "Code understanding is unavailable."); setData({ profile: profilePayload.profile, graph: graphPayload.graph }); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Code understanding failed."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Code2 size={17} /><h3>Code Understanding</h3></div><button onClick={() => void refresh()}>Refresh evidence</button></div>{message && <StatusMessage>{message}</StatusMessage>}{data?.profile && <><div className="kf-hardware-grid"><span><strong>Workspace</strong>{data.profile.workspaceKind}</span><span><strong>Source files</strong>{data.profile.sourceFileCount}</span><span><strong>Graph imports</strong>{data.graph?.summary.imports ?? "Unavailable"}</span><span><strong>Exported symbols</strong>{data.graph?.summary.symbols ?? "Unavailable"}</span><span><strong>Dependencies</strong>{data.graph?.summary.dependencies ?? "Unavailable"}</span><span><strong>Routes</strong>{data.graph?.summary.routes ?? "Unavailable"}</span><span><strong>APIs</strong>{data.graph?.summary.apis ?? "Unavailable"}</span></div><article className="kf-command-evidence"><strong>Measured project structure</strong><pre>{JSON.stringify({ frameworks: data.profile.framework, languages: data.profile.languages, sourceRoots: data.profile.sourceRoots, testRoots: data.profile.testRoots, runtimeEntrypoint: data.profile.runtimeEntrypoint || "UNAVAILABLE", fileDiscovery: data.profile.fileDiscovery, graphCoverage: data.graph?.coverage }, null, 2)}</pre></article></>}</section>;
}

function ArchitecturePanel({ project }: { project: ProjectSummary }) {
  const [data, setData] = useState<{ generatedAt: string; coverage: { state: string; scannedCount: number; totalOrUnknown: number | null; reason: string }; cache: { state: string; servedAt: string }; modules: Array<{ name: string; files: number }>; apiBoundaries: Array<{ path: string; owner?: string }>; routeBoundaries: Array<{ path: string; owner?: string }>; directCycles: string[][]; dependencyCycles: string[][]; duplicatedResponsibilities: Array<{ symbol: string; kind: string; files: string[]; evidence: string }>; languageAdapters: Array<{ language: string; files: number; state: string; adapter: string; reason: string }>; highCoupling: Array<{ file: string; dependents: number }>; limitations: string[] } | null>(null);
  const [message, setMessage] = useState("Loading static architecture evidence…");
  const refresh = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/architecture`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Architecture evidence is unavailable."); setData(payload); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Architecture request failed."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Box size={17} /><h3>Architecture Evidence</h3></div><button onClick={() => void refresh()}>Refresh evidence</button></div><p className="kf-capability-copy">KForge derives these findings from local files and language-aware static import, symbol, API, route, cycle, and responsibility evidence. It marks parser and runtime limits instead of inventing architectural claims.</p>{message && <StatusMessage>{message}</StatusMessage>}{data && <><div className="kf-hardware-grid"><span><strong>Modules</strong>{data.modules.length}</span><span><strong>API boundaries</strong>{data.apiBoundaries.length}</span><span><strong>Route boundaries</strong>{data.routeBoundaries.length}</span><span><strong>Dependency cycles</strong>{data.dependencyCycles.length}</span><span><strong>Duplicated responsibilities</strong>{data.duplicatedResponsibilities.length}</span><span><strong>High coupling</strong>{data.highCoupling.length}</span></div><article className="kf-command-evidence"><strong>{data.coverage.state} · architecture evidence coverage</strong><small>{data.coverage.reason}</small><small>{data.coverage.scannedCount.toLocaleString()} scanned · total {data.coverage.totalOrUnknown ?? "UNKNOWN"} · cache {data.cache.state} · served {formatDate(data.cache.servedAt)}</small></article><div className="kf-provider-grid">{data.modules.slice(0, 12).map((module) => <article className="kf-provider-card" key={module.name}><div><strong>{module.name}</strong><span>Module</span></div><small>{module.files} scanned file(s)</small></article>)}</div><article className="kf-command-evidence"><strong>Boundaries, dependency cycles, and coupling</strong><pre>{JSON.stringify({ apiBoundaries: data.apiBoundaries, routeBoundaries: data.routeBoundaries, directCycles: data.directCycles, dependencyCycles: data.dependencyCycles, highCoupling: data.highCoupling }, null, 2)}</pre></article><article className="kf-command-evidence"><strong>Duplicated responsibility evidence</strong><pre>{JSON.stringify(data.duplicatedResponsibilities, null, 2)}</pre></article><article className="kf-command-evidence"><strong>Language parser boundaries</strong><pre>{JSON.stringify(data.languageAdapters, null, 2)}</pre></article><article className="kf-command-evidence"><strong>Measured limitations</strong><pre>{data.limitations.join("\n")}</pre></article></>}<GraphPanel project={project} /><DocumentationPanel project={project} /></section>;
}

function AskKForgePanel({ project }: { project: ProjectSummary }) { const [question, setQuestion] = useState("What are the 5 biggest risks in this project?"); const [answer, setAnswer] = useState(""); const [source, setSource] = useState<{ mode?: string; provider?: string; model?: string; contextFiles?: string[]; notice?: string; transparency?: OperationTransparency } | null>(null); const ask = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Ask KForge failed."); setAnswer(typeof payload.answer === "string" ? payload.answer : JSON.stringify(payload.answer, null, 2)); setSource({ mode: payload.mode, provider: payload.provider, model: payload.model, contextFiles: Array.isArray(payload.contextFiles) ? payload.contextFiles : [], notice: typeof payload.notice === "string" ? payload.notice : typeof payload.answer?.notice === "string" ? payload.answer.notice : undefined, transparency: payload.transparency }); } catch (cause: unknown) { setAnswer(cause instanceof Error ? cause.message : "Ask KForge failed."); setSource(null); } }; const sourceLabel = source?.mode === "local-ai" ? `Local model · ${source.provider || "unknown provider"}${source.model ? ` / ${source.model}` : ""}` : source?.mode === "rules" ? "Evidence-based local rules · no active local model" : source?.mode || "Source unavailable"; return <section className="kf-capability-panel"><div className="kf-card-heading"><div><MessageSquare size={17} /><h3>Ask KForge</h3></div><span>Project-grounded</span></div><div className="kf-agent-panel"><textarea value={question} onChange={(event) => setQuestion(event.target.value)} /><button className="kf-button kf-button--primary" onClick={() => void ask()}>Ask</button>{source && <div className="kf-command-evidence"><strong>Response source</strong><p>{sourceLabel}</p><small>Context files: {source.contextFiles?.length || 0}</small>{source.notice && <small>{source.notice}</small>}{source.transparency && <details><summary>Execution and data disclosure</summary><pre>{JSON.stringify(source.transparency, null, 2)}</pre></details>}</div>}{answer && <pre>{answer}</pre>}</div></section>; }

function ReleaseGatePanel({ project }: { project: ProjectSummary }) {
  const [result, setResult] = useState<ReleaseGateResult | null>(null);
  const [message, setMessage] = useState("");
  const [preparation, setPreparation] = useState<unknown>(null);
  const run = async () => { try { setMessage("Running local verification and collecting independent source evidence…"); const response = await fetch(`/api/workspace/projects/${project.id}/release-gate`, { method: "POST" }); const payload = await response.json(); if (!response.ok && !payload.verdicts) throw new Error(payload.error || "Release Gate failed."); setResult(payload); setMessage(response.ok ? "" : "Release Gate is blocked; source evidence is preserved below."); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Release Gate failed."); } };
  const prepare = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/release/preparation`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Release preparation is unavailable."); setPreparation(payload.preparation); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Release preparation failed."); } };
  const sourceOrder: ReleaseGateSourceKind[] = ["LOCAL", "GITHUB", "CI", "PREVIEW"];
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Rocket size={17} /><h3>KForge Release Gate</h3></div><span>Local · GitHub · CI · Preview</span></div><p className="kf-capability-copy">The gate runs local verification, then shows every release source independently before calculating an overall verdict. It does not contact GitHub or CI implicitly, and missing remote evidence cannot become a local pass.</p><div className="kf-inline-controls"><button className="kf-button kf-button--primary" onClick={() => void run()}>Run Release Gate</button><button onClick={() => void prepare()}>Prepare release notes</button></div>{message && <StatusMessage>{message}</StatusMessage>}{result && <><div className="kf-provider-grid">{sourceOrder.map((kind) => { const verdict = result.verdicts[kind]; return <article className="kf-provider-card" key={kind}><div><strong>{kind}</strong><span>{verdict.state}</span></div><p>{verdict.source}</p><small>{verdict.freshness} · {formatDate(verdict.timestamp || undefined)}</small><small>{verdict.evidence.join(" ")}</small>{(verdict.blocker || verdict.reason) && <small>{verdict.blocker || verdict.reason}</small>}</article>; })}</div><article className="kf-command-evidence"><strong>Overall release verdict · {result.readiness}</strong><pre>{JSON.stringify({ checks: result.checks, missingChecks: result.missingChecks, blockers: result.blockers.map((entry) => entry.title), warnings: result.warnings.map((entry) => entry.title) }, null, 2)}</pre></article></>}{preparation && <article className="kf-command-evidence"><strong>Release preparation</strong><pre>{JSON.stringify(preparation, null, 2)}</pre></article>}</section>;
}

function ReleasePreparationPanel({ project, view }: { project: ProjectSummary; view: "Release preparation" | "Artifacts" | "Versioning" }) {
  const [preparation, setPreparation] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState("Loading local release preparation evidence…");
  const refresh = async () => { try { const response = await fetch(`/api/workspace/projects/${project.id}/release/preparation`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Release preparation is unavailable."); setPreparation(payload.preparation); setMessage(""); } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Release preparation failed."); } };
  useEffect(() => { void refresh(); }, [project.id]);
  const value = view === "Artifacts" ? preparation?.artifacts : view === "Versioning" ? { baselineTag: preparation?.baselineTag, version: preparation?.version } : preparation;
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><Rocket size={17} /><h3>{view}</h3></div><button onClick={() => void refresh()}>Refresh evidence</button></div><p className="kf-capability-copy">This is a local, read-only release preparation preview. It does not create tags, artifacts, releases, or remote requests.</p>{message && <StatusMessage>{message}</StatusMessage>}{preparation && <article className="kf-command-evidence"><strong>Local release evidence</strong><pre>{JSON.stringify(value, null, 2)}</pre></article>}</section>;
}

type MarketplaceEvidenceView = { state: "VERIFIED" | "UNKNOWN" | "NOT_AVAILABLE" | "NOT_CONFIGURED"; value?: string; source: string };
type MarketplaceEvidenceListView = { state: "VERIFIED" | "UNKNOWN" | "NOT_AVAILABLE" | "NOT_CONFIGURED"; items: string[]; source: string };
type MarketplaceTaxonomyView = { id: string; label: string; state: "AVAILABLE" | "NOT_CONFIGURED" | "UNAVAILABLE"; itemCount: number; source: string; reason: string };
type MarketplaceLifecycleView = { id: string; label: string; state: "VERIFIED" | "READY" | "REQUIRED" | "BLOCKED" | "NOT_CONFIGURED" | "NOT_AVAILABLE" | "NOT_APPLICABLE"; evidence: string };
type MarketplaceProjectCompatibilityView = { state: "COMPATIBLE" | "INCOMPATIBLE" | "UNKNOWN"; evidence: string[]; source: string; flow: Array<{ stage: string; state: MarketplaceLifecycleView["state"]; evidence: string }> };
type MarketplaceItemView = { id: string; category: string; taxonomy: string[]; name: string; description: string; overview: string; features: string[]; source: string; sourceUrl?: string; version?: string; license?: string; capabilities: string[]; requirements: string[]; compatibility: string; permissions: Array<{ id: string; required: boolean; detail: string }>; security: MarketplaceEvidenceView; publisher: MarketplaceEvidenceView; repository: MarketplaceEvidenceView; releaseHistory: MarketplaceEvidenceListView; changelog: MarketplaceEvidenceView; installationState: MarketplaceEvidenceView; updateState: MarketplaceEvidenceView; dependencies: MarketplaceEvidenceListView; provenance: MarketplaceEvidenceView; integrity: MarketplaceEvidenceView; lifecycle: MarketplaceLifecycleView[]; projectCompatibility?: MarketplaceProjectCompatibilityView; trust: string; installed: boolean; enabled: boolean; local: boolean; installAction: string; dataState: string; updatedAt?: string };
type MarketplaceProviderView = { id: string; label: string; state: string; detail: string; sourceUrl?: string; adapterKind?: "local" | "remote"; configured?: boolean; capabilities?: string[] };
type OnlineHubView = "discover" | "marketplace" | "extensions" | "models" | "agents" | "tools" | "integrations" | "providers" | "installed" | "updates" | "security" | "remote-sources" | "downloads" | "activity";
type OnlineActivityTask = { id: string; projectId: string; kind: string; status: string; progress: number; startedAt: string; finishedAt?: string; error?: string; output?: string; logs?: Array<{ at: string; message: string; stream?: string }> };
type OnlineInfoCardData = { icon: ReactNode; name: string; description: string; status: string; health: string; availability: string; privacy: string; quickAction: string };

function marketplaceInfoCardData(item: MarketplaceItemView): OnlineInfoCardData {
  const networkPermission = item.permissions.find((permission) => permission.id === "network");
  return {
    icon: item.category === "models" ? <Cpu size={17} /> : item.category === "agents" ? <Bot size={17} /> : item.category === "tools" ? <Wrench size={17} /> : <Box size={17} />,
    name: item.name,
    description: item.description,
    status: item.enabled ? "ACTIVE" : item.installed ? "INSTALLED" : item.trust,
    health: item.security.state,
    availability: `${item.dataState} · ${item.installAction}`,
    privacy: networkPermission?.required ? `Network permission disclosed: ${networkPermission.detail}` : item.local ? "Local evidence; no network permission requested." : "Review declared permissions before any optional online action.",
    quickAction: "Open full item inspector",
  };
}

function OnlineInfoCard({ info }: { info: OnlineInfoCardData }) {
  return <article className="kf-online-info-card" role="status" aria-label={`Information card for ${info.name}`}><header><span>{info.icon}</span><div><strong>{info.name}</strong><small>{info.status}</small></div></header><p>{info.description}</p><dl><div><dt>Health</dt><dd>{info.health}</dd></div><div><dt>Availability</dt><dd>{info.availability}</dd></div><div><dt>Privacy</dt><dd>{info.privacy}</dd></div><div><dt>Quick action</dt><dd>{info.quickAction}</dd></div></dl></article>;
}

const ONLINE_HUB_VIEWS: Array<{ id: OnlineHubView; label: string; icon: typeof Search }> = [
  { id: "discover", label: "Discover", icon: Search },
  { id: "marketplace", label: "Marketplace", icon: Box },
  { id: "extensions", label: "Extensions", icon: Code2 },
  { id: "models", label: "Models", icon: Cpu },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "integrations", label: "Integrations", icon: Network },
  { id: "providers", label: "Providers", icon: CircleDot },
  { id: "installed", label: "Installed", icon: FolderOpen },
  { id: "updates", label: "Updates", icon: RefreshCw },
  { id: "security", label: "Security", icon: ShieldAlert },
  { id: "remote-sources", label: "Remote Sources", icon: Network },
  { id: "downloads", label: "Downloads", icon: ArrowDownUp },
  { id: "activity", label: "Activity", icon: Activity },
];

function OnlineHubPanel({ initialView, project, platform, initialSelectionId }: { initialView: OnlineHubView; project: ProjectSummary; platform?: LocalPlatformStatus; initialSelectionId?: string }) {
  const [view, setView] = useState<OnlineHubView>(initialView);
  const [mobileView, setMobileView] = useState<"browse" | "detail">(initialSelectionId ? "detail" : "browse");
  const [items, setItems] = useState<MarketplaceItemView[]>([]);
  const [categories, setCategories] = useState<MarketplaceTaxonomyView[]>([]);
  const [taxonomyFilter, setTaxonomyFilter] = useState("all");
  const [projectRecommendations, setProjectRecommendations] = useState<Array<{ itemId: string; name: string; state: string; evidence: string[]; installed: boolean; returnToAgent: string }>>([]);
  const [capabilityGaps, setCapabilityGaps] = useState<Array<{ capability: string; state: string; evidence: string; recommendationState: string; itemId: null; reason: string; flow: Array<{ stage: string; state: MarketplaceLifecycleView["state"]; evidence: string }> }>>([]);
  const [providers, setProviders] = useState<MarketplaceProviderView[]>([]);
  const [onlineTasks, setOnlineTasks] = useState<OnlineActivityTask[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"name" | "category" | "state">("name");
  const [selected, setSelected] = useState<MarketplaceItemView | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<MarketplaceProviderView | null>(null);
  const [selectedTask, setSelectedTask] = useState<OnlineActivityTask | null>(null);
  const [controlCenter, setControlCenter] = useState<OnlineControlCenter | null>(null);
  const [hoverInfo, setHoverInfo] = useState<OnlineInfoCardData | null>(null);
  const [message, setMessage] = useState("Loading verified registry evidence…");

  const load = async () => {
    try {
      const [response, taskResponse, controlResponse] = await Promise.all([fetch(`/api/workspace/projects/${project.id}/marketplace`), fetch("/api/workspace/tasks"), fetch(`/api/workspace/projects/${project.id}/online/control-center`)]);
      const payload = await response.json();
      const taskPayload = await taskResponse.json();
      const controlPayload = await controlResponse.json();
      if (!response.ok) throw new Error(payload.error || "Online Hub is unavailable.");
      if (!controlResponse.ok) throw new Error(controlPayload.error || "Online Control Center is unavailable.");
      const nextItems = Array.isArray(payload.items) ? payload.items : [];
      const nextCategories = Array.isArray(payload.categories) ? payload.categories : [];
      const nextProviders = Array.isArray(payload.providers) ? payload.providers : [];
      const nextTasks = taskResponse.ok && Array.isArray(taskPayload.tasks) ? taskPayload.tasks.filter((task: OnlineActivityTask) => task.projectId === "ai-center") : [];
      setItems(nextItems);
      setCategories(nextCategories);
      setProjectRecommendations(Array.isArray(payload.recommendations) ? payload.recommendations : []);
      setCapabilityGaps(Array.isArray(payload.capabilityGaps) ? payload.capabilityGaps : []);
      setProviders(nextProviders);
      setOnlineTasks(nextTasks);
      setControlCenter(controlPayload as OnlineControlCenter);
      setSelected((current) => nextItems.find((item: MarketplaceItemView) => item.id === initialSelectionId) || nextItems.find((item: MarketplaceItemView) => item.id === current?.id) || nextItems[0] || null);
      setSelectedProvider((current) => nextProviders.find((provider: MarketplaceProviderView) => provider.id === current?.id) || nextProviders[0] || null);
      setSelectedTask((current) => nextTasks.find((task: OnlineActivityTask) => task.id === current?.id) || nextTasks[0] || null);
      setMessage("");
    } catch (cause: unknown) {
      setMessage(cause instanceof Error ? cause.message : "Online Hub could not load registry evidence.");
    }
  };

  useEffect(() => { setView(initialView); setMobileView(initialSelectionId ? "detail" : "browse"); setHoverInfo(null); }, [initialSelectionId, initialView]);
  useEffect(() => { void load(); setMobileView(initialSelectionId ? "detail" : "browse"); }, [project.id]);
  useEffect(() => { if (initialSelectionId) { setSelected(items.find((item) => item.id === initialSelectionId) || null); setMobileView("detail"); } }, [initialSelectionId, items]);

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matchesView = (item: MarketplaceItemView) => {
      if (view === "extensions") return item.category === "plugins";
      if (["models", "agents", "tools", "integrations"].includes(view)) return item.category === view;
      if (view === "installed") return item.installed;
      if (view === "updates") return item.installed && Boolean(item.updatedAt);
      if (view === "security") return item.permissions.length > 0 || item.trust !== "TRUSTED";
      return true;
    };
    return items
      .filter((item) => matchesView(item) && (taxonomyFilter === "all" || item.taxonomy.includes(taxonomyFilter)) && (!normalized || `${item.name} ${item.description} ${item.category} ${item.taxonomy.join(" ")} ${item.source} ${item.capabilities.join(" ")}`.toLowerCase().includes(normalized)))
      .sort((left, right) => {
        if (sort === "category") return `${left.category}:${left.name}`.localeCompare(`${right.category}:${right.name}`);
        if (sort === "state") return `${left.installed ? 0 : 1}:${left.enabled ? 0 : 1}:${left.name}`.localeCompare(`${right.installed ? 0 : 1}:${right.enabled ? 0 : 1}:${right.name}`);
        return left.name.localeCompare(right.name);
      });
  }, [items, query, sort, taxonomyFilter, view]);

  const visibleProviders = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return providers.filter((provider) => (view !== "remote-sources" || provider.adapterKind === "remote") && (!normalized || `${provider.label} ${provider.detail} ${provider.state} ${(provider.capabilities || []).join(" ")}`.toLowerCase().includes(normalized)));
  }, [providers, query, view]);

  const visibleOnlineTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return onlineTasks.filter((task) => !normalized || `${task.id} ${task.kind} ${task.status} ${task.error || ""} ${task.output || ""} ${(task.logs || []).map((entry) => entry.message).join(" ")}`.toLowerCase().includes(normalized));
  }, [onlineTasks, query]);

  useEffect(() => {
    if (view === "providers" || view === "remote-sources" || view === "downloads" || view === "activity") return;
    setSelected((current) => visibleItems.find((item) => item.id === current?.id) || visibleItems[0] || null);
  }, [view, visibleItems]);

  useEffect(() => {
    if (view !== "providers" && view !== "remote-sources") return;
    setSelectedProvider((current) => visibleProviders.find((provider) => provider.id === current?.id) || visibleProviders[0] || null);
  }, [view, visibleProviders]);

  useEffect(() => {
    if (view !== "downloads" && view !== "activity") return;
    setSelectedTask((current) => visibleOnlineTasks.find((task) => task.id === current?.id) || visibleOnlineTasks[0] || null);
  }, [view, visibleOnlineTasks]);

  const viewCount = (id: OnlineHubView) => {
    if (id === "providers") return providers.length;
    if (id === "remote-sources") return providers.filter((provider) => provider.adapterKind === "remote").length;
    if (id === "downloads" || id === "activity") return onlineTasks.length;
    if (id === "extensions") return items.filter((item) => item.category === "plugins").length;
    if (["models", "agents", "tools", "integrations"].includes(id)) return items.filter((item) => item.category === id).length;
    if (id === "installed") return items.filter((item) => item.installed).length;
    if (id === "updates") return items.filter((item) => item.installed && item.updatedAt).length;
    if (id === "security") return items.filter((item) => item.permissions.length > 0 || item.trust !== "TRUSTED").length;
    return items.length;
  };

  const inspect = async (item: MarketplaceItemView) => {
    try {
      const response = await fetch(`/api/workspace/marketplace/items/${encodeURIComponent(item.id)}/install-preview`);
      const payload = await response.json();
      if (!response.ok && !payload.reason) throw new Error(payload.error || "Install review is unavailable.");
      setMessage(payload.reason || "Registry review completed.");
    } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Marketplace inspection failed."); }
  };

  const installModel = async (item: MarketplaceItemView) => {
    const model = item.id.replace(/^ollama:/, "");
    if (item.category !== "models" || item.installAction !== "INSTALL_REQUIRES_CONFIRMATION") { setMessage("No verified installation adapter is available for this item."); return; }
    if (!window.confirm(`Download ${model} after reviewing its source, requirements, and permissions?`)) return;
    try {
      const response = await fetch("/api/workspace/ai/models/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "ollama", model, confirmed: true }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Model installation could not start.");
      setMessage(`Installation task ${payload.task?.id || "started"} is available in Task Center.`);
    } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Model installation failed."); }
  };

  const activateModel = async (item: MarketplaceItemView) => {
    const model = item.id.replace(/^ollama:/, "");
    try {
      const response = await fetch("/api/workspace/ai/models/active", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "ollama", model }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Model activation failed.");
      setMessage(`Local model ${model} is active.`);
      await load();
    } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Model activation failed."); }
  };

  const removeModel = async (item: MarketplaceItemView) => {
    const model = item.id.replace(/^ollama:/, "");
    if (!window.confirm(`Remove installed local model ${model}?`)) return;
    try {
      const response = await fetch(`/api/workspace/ai/models/${encodeURIComponent(model)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "ollama", confirmed: true }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Model removal failed.");
      setMessage(payload.message || `Removed ${model}.`);
      await load();
    } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Model removal failed."); }
  };

  const providerMode = view === "providers" || view === "remote-sources";
  const taskMode = view === "downloads" || view === "activity";
  const emptyCopy = view === "updates"
    ? "No update is claimed because no configured provider supplied a trustworthy installed-versus-latest version comparison."
    : `No verified ${ONLINE_HUB_VIEWS.find((entry) => entry.id === view)?.label.toLowerCase() || "catalog"} item matches the current search.`;

  return <section className="kf-online-hub" data-mobile-view={mobileView}>{hoverInfo && <OnlineInfoCard info={hoverInfo} />}
    <div className="kf-online-results kf-online-results--full">
      <header className="kf-online-results-header"><div><p className="kf-eyebrow">{ONLINE_HUB_VIEWS.find((entry) => entry.id === view)?.label}</p><h2>{taskMode ? "Persisted Online activity" : providerMode ? view === "remote-sources" ? "Declared remote sources" : "Registry providers" : "Verified catalog"}</h2><small>Project context: {project.name} · {project.projectType}</small></div><button className="kf-button kf-button--ghost" onClick={() => void load()}><RefreshCw size={14} />Refresh</button></header>
      {controlCenter && <section className="kf-online-control" aria-label="Online Control Center"><header><div><strong>Online Control Center</strong><small>{controlCenter.mode} · inspected {formatDate(controlCenter.inspectedAt)}</small></div><span>{controlCenter.remoteContactPerformed ? "REMOTE CONTACT" : "NO REMOTE CONTACT"}</span></header><p>Opening this screen reads local configuration and cached evidence only. It never probes a provider.</p><div>{controlCenter.services.map((service) => <details key={service.id}><summary onMouseEnter={() => setHoverInfo({ icon: <CircleDot size={17} />, name: service.label, description: service.reason, status: service.state, health: service.lastSuccessfulContact ? `Last success ${formatDate(service.lastSuccessfulContact)}` : "No successful contact recorded", availability: service.cachedEvidenceAvailable ? `${service.freshness} cached evidence` : service.state, privacy: `${service.networkRequirement}; opening this surface performs no remote contact.`, quickAction: "Expand service evidence" })} onMouseLeave={() => setHoverInfo(null)} onFocus={() => setHoverInfo({ icon: <CircleDot size={17} />, name: service.label, description: service.reason, status: service.state, health: service.lastSuccessfulContact ? `Last success ${formatDate(service.lastSuccessfulContact)}` : "No successful contact recorded", availability: service.cachedEvidenceAvailable ? `${service.freshness} cached evidence` : service.state, privacy: `${service.networkRequirement}; opening this surface performs no remote contact.`, quickAction: "Expand service evidence" })} onBlur={() => setHoverInfo(null)}><span>{service.label}</span><b className={`kf-online-state kf-online-state--${service.state.toLowerCase()}`}>{service.state}</b></summary><dl><div><dt>Last success</dt><dd>{service.lastSuccessfulContact ? formatDate(service.lastSuccessfulContact) : "None"}</dd></div><div><dt>Last attempt</dt><dd>{service.lastAttemptedContact ? formatDate(service.lastAttemptedContact) : "None"}</dd></div><div><dt>Source</dt><dd>{service.source}</dd></div><div><dt>Destination</dt><dd>{service.destination || "Not configured"}</dd></div><div><dt>Network</dt><dd>{service.networkRequirement}</dd></div><div><dt>Cache</dt><dd>{service.cachedEvidenceAvailable ? `${service.freshness} · ${formatDate(service.cachedEvidenceTimestamp || undefined)}` : "No cached evidence"}</dd></div><div><dt>Reason</dt><dd>{service.reason}</dd></div>{service.error && <div><dt>Error</dt><dd>{service.error}</dd></div>}</dl></details>)}</div><details className="kf-online-control-disclosure"><summary>Opening disclosure</summary><pre>{JSON.stringify(controlCenter.openingDisclosure, null, 2)}</pre></details></section>}
      {!taskMode && !providerMode && <section className="kf-marketplace-taxonomy" aria-label="Marketplace product taxonomy"><button className={taxonomyFilter === "all" ? "is-active" : ""} onClick={() => setTaxonomyFilter("all")}><strong>All</strong><span>{items.length}</span><small>Verified catalog evidence</small></button>{categories.map((category) => <button key={category.id} className={taxonomyFilter === category.id ? "is-active" : ""} onClick={() => setTaxonomyFilter(category.id)} title={`${category.source}: ${category.reason}`}><strong>{category.label}</strong><span>{category.itemCount}</span><small>{category.state}</small></button>)}</section>}
      {!taskMode && !providerMode && <details className="kf-project-marketplace"><summary>Agent → Marketplace project evidence <span>{projectRecommendations.length} compatible · {capabilityGaps.length} unresolved gaps</span></summary><div><section><h3>Evidence-backed matches</h3>{projectRecommendations.length ? <ul>{projectRecommendations.slice(0, 12).map((recommendation) => <li key={recommendation.itemId}><button onClick={() => { setSelected(items.find((item) => item.id === recommendation.itemId) || null); setMobileView("detail"); }}><strong>{recommendation.name}</strong><span>{recommendation.state} · {recommendation.installed ? "installed" : "not installed"} · return {recommendation.returnToAgent}</span><small>{recommendation.evidence.join(" ")}</small></button></li>)}</ul> : <p>No item passed the project compatibility rules.</p>}</section><section><h3>Missing capabilities</h3>{capabilityGaps.length ? <ul>{capabilityGaps.map((gap) => <li key={gap.capability}><details><summary><strong>{gap.capability} · {gap.recommendationState}</strong></summary><span>{gap.evidence}</span><small>{gap.reason}</small><ol className="kf-marketplace-lifecycle">{gap.flow.map((stage) => <li key={stage.stage}><strong>{stage.stage}</strong><span>{stage.state}</span><small>{stage.evidence}</small></li>)}</ol></details></li>)}</ul> : <p>No command capability gap was detected.</p>}</section></div></details>}
      <div className="kf-online-search"><Search size={16} /><input aria-label="Search Online Hub" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names, capabilities, sources…" /><select aria-label="Sort Online Hub results" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="name">Sort: name</option><option value="category">Sort: category</option><option value="state">Sort: install state</option></select></div>
      {message && <StatusMessage>{message}</StatusMessage>}
      <div className="kf-online-list" aria-live="polite">
        {taskMode ? visibleOnlineTasks.map((task) => <button key={task.id} className={selectedTask?.id === task.id ? "is-selected" : ""} onClick={() => { setSelectedTask(task); setMobileView("detail"); }} onMouseEnter={() => setHoverInfo({ icon: <Activity size={17} />, name: `${task.kind} task`, description: task.error || task.logs?.at(-1)?.message || "Persisted Online Hub task evidence.", status: task.status, health: `${task.progress}% complete`, availability: task.finishedAt ? "Persisted result" : "Current task evidence", privacy: "Task evidence is stored locally; network depends on the explicitly started adapter.", quickAction: "Open complete task evidence" })} onMouseLeave={() => setHoverInfo(null)} onFocus={() => setHoverInfo({ icon: <Activity size={17} />, name: `${task.kind} task`, description: task.error || task.logs?.at(-1)?.message || "Persisted Online Hub task evidence.", status: task.status, health: `${task.progress}% complete`, availability: task.finishedAt ? "Persisted result" : "Current task evidence", privacy: "Task evidence is stored locally; network depends on the explicitly started adapter.", quickAction: "Open complete task evidence" })} onBlur={() => setHoverInfo(null)}><span className="kf-online-item-icon"><Activity size={16} /></span><span><strong>{task.kind} · {task.status}</strong><small>{task.error || task.logs?.at(-1)?.message || "Persisted Online Hub task evidence."}</small><em>{task.id} · {formatDate(task.startedAt)}</em></span><span className="kf-online-row-meta"><b>{task.progress}%</b><i>{task.status}</i></span></button>) : providerMode ? visibleProviders.map((provider) => { const info: OnlineInfoCardData = { icon: <CircleDot size={17} />, name: provider.label, description: provider.detail, status: provider.state, health: provider.configured ? "Configured" : "Not configured", availability: provider.capabilities?.join(", ") || provider.state, privacy: provider.adapterKind === "remote" ? "Network is used only by explicit provider actions." : "Local adapter; no remote registry contact.", quickAction: "Open provider inspector" }; return <button key={provider.id} className={selectedProvider?.id === provider.id ? "is-selected" : ""} onClick={() => { setSelectedProvider(provider); setMobileView("detail"); }} onMouseEnter={() => setHoverInfo(info)} onMouseLeave={() => setHoverInfo(null)} onFocus={() => setHoverInfo(info)} onBlur={() => setHoverInfo(null)}><span className="kf-online-item-icon"><CircleDot size={16} /></span><span><strong>{provider.label}</strong><small>{provider.detail}</small><em>{provider.adapterKind || "registry"} · {provider.configured ? "configured" : "not configured"}</em></span><span className={`kf-online-state kf-online-state--${provider.state.toLowerCase()}`}>{provider.state}</span></button>; }) : visibleItems.map((item) => { const info = marketplaceInfoCardData(item); return <button key={item.id} className={selected?.id === item.id ? "is-selected" : ""} onClick={() => { setSelected(item); setMobileView("detail"); }} onMouseEnter={() => setHoverInfo(info)} onMouseLeave={() => setHoverInfo(null)} onFocus={() => setHoverInfo(info)} onBlur={() => setHoverInfo(null)}><span className="kf-online-item-icon">{item.category === "models" ? <Cpu size={16} /> : item.category === "agents" ? <Bot size={16} /> : item.category === "tools" ? <Wrench size={16} /> : <Box size={16} />}</span><span><strong>{item.name}</strong><small>{item.description}</small><em>{item.source} · {item.version || "version unavailable"}</em></span><span className="kf-online-row-meta"><b>{item.category}</b><i>{item.enabled ? "Active" : item.installed ? "Installed" : item.dataState}</i></span></button>; })}
        {!providerMode && !taskMode && visibleItems.length === 0 && <div className="kf-online-empty"><Box size={24} /><strong>No verified results</strong><p>{emptyCopy}</p></div>}
        {providerMode && visibleProviders.length === 0 && <div className="kf-online-empty"><CircleDot size={24} /><strong>No provider matches</strong><p>No configured registry provider matches the current search.</p></div>}
        {taskMode && visibleOnlineTasks.length === 0 && <div className="kf-online-empty"><Activity size={24} /><strong>No persisted Online activity</strong><p>No verified model/package operation has started through the Online Hub. KForge does not synthesize download history.</p></div>}
      </div>
    </div>

    <aside className="kf-online-detail" aria-label="Online item details"><button className="kf-online-mobile-back" type="button" onClick={() => setMobileView("browse")}><ChevronRight size={15} />Back to results</button>
      {taskMode ? selectedTask ? <><div className="kf-online-detail-heading"><span><Activity size={18} /></span><div><p className="kf-eyebrow">Online task</p><h2>{selectedTask.kind}</h2><small>{selectedTask.status} · {selectedTask.progress}%</small></div></div><p>{selectedTask.error || selectedTask.logs?.at(-1)?.message || "Persisted lifecycle evidence from the existing Task Center."}</p><dl><div><dt>Task</dt><dd>{selectedTask.id}</dd></div><div><dt>Started</dt><dd>{formatDate(selectedTask.startedAt)}</dd></div><div><dt>Finished</dt><dd>{selectedTask.finishedAt ? formatDate(selectedTask.finishedAt) : "Still active or unavailable"}</dd></div><div><dt>Execution</dt><dd>LOCAL process · network only when the verified adapter requires it</dd></div></dl><section><h3>Evidence</h3><ul>{(selectedTask.logs || []).slice(-12).map((entry) => <li key={`${entry.at}:${entry.message}`}><strong>{entry.stream || "system"}</strong><span>{entry.message}</span></li>)}</ul></section></> : <OnlineDetailEmpty /> : providerMode ? selectedProvider ? <><div className="kf-online-detail-heading"><span><CircleDot size={18} /></span><div><p className="kf-eyebrow">Provider</p><h2>{selectedProvider.label}</h2><small>{selectedProvider.state}</small></div></div><p>{selectedProvider.detail}</p><dl><div><dt>Adapter</dt><dd>{selectedProvider.adapterKind || "registry"}</dd></div><div><dt>Configuration</dt><dd>{selectedProvider.configured ? "Configured" : "Not configured"}</dd></div><div><dt>Capabilities</dt><dd>{selectedProvider.capabilities?.join(", ") || "Not declared"}</dd></div><div><dt>Network</dt><dd>{selectedProvider.adapterKind === "remote" ? "REQUIRED when explicitly refreshed" : "NOT REQUIRED"}</dd></div></dl>{selectedProvider.sourceUrl && <a className="kf-button kf-button--ghost" href={selectedProvider.sourceUrl} target="_blank" rel="noreferrer">Official source</a>}</> : <OnlineDetailEmpty /> : selected ? <MarketplaceItemDetail item={selected} onInspect={inspect} onInstall={installModel} onActivate={activateModel} onRemove={removeModel} /> : <OnlineDetailEmpty />}
    </aside>
  </section>;
}

function MarketplaceEvidenceRow({ label, evidence }: { label: string; evidence: MarketplaceEvidenceView }) {
  return <div><dt>{label}</dt><dd><strong>{evidence.state}</strong>{evidence.value ? ` · ${evidence.value}` : ""}<small>{evidence.source}</small></dd></div>;
}

function MarketplaceItemDetail({ item, onInspect, onInstall, onActivate, onRemove }: { item: MarketplaceItemView; onInspect: (item: MarketplaceItemView) => Promise<void>; onInstall: (item: MarketplaceItemView) => Promise<void>; onActivate: (item: MarketplaceItemView) => Promise<void>; onRemove: (item: MarketplaceItemView) => Promise<void> }) {
  return <>
    <div className="kf-online-detail-heading"><span>{item.category === "models" ? <Cpu size={18} /> : item.category === "agents" ? <Bot size={18} /> : <Box size={18} />}</span><div><p className="kf-eyebrow">{item.taxonomy.join(" · ")}</p><h2>{item.name}</h2><small>{item.enabled ? "Active locally" : item.installed ? "Installed locally" : item.dataState}</small></div></div>
    <section><h3>Overview</h3><p>{item.overview}</p></section>
    <dl><div><dt>Source</dt><dd>{item.source}</dd></div><div><dt>Version</dt><dd>{item.version || "UNKNOWN"}</dd></div><div><dt>License</dt><dd>{item.license || "UNKNOWN"}</dd></div><div><dt>Trust</dt><dd>{item.trust}</dd></div><div><dt>Compatibility</dt><dd>{item.compatibility || "UNKNOWN"}</dd></div><MarketplaceEvidenceRow label="Publisher" evidence={item.publisher} /><MarketplaceEvidenceRow label="Repository" evidence={item.repository} /><MarketplaceEvidenceRow label="Security" evidence={item.security} /><MarketplaceEvidenceRow label="Installation" evidence={item.installationState} /><MarketplaceEvidenceRow label="Update" evidence={item.updateState} /><MarketplaceEvidenceRow label="Changelog" evidence={item.changelog} /><MarketplaceEvidenceRow label="Provenance" evidence={item.provenance} /><MarketplaceEvidenceRow label="Integrity / checksum" evidence={item.integrity} /></dl>
    <section><h3>Features</h3>{item.features.length ? <div className="kf-online-tags">{item.features.map((feature) => <span key={feature}>{feature}</span>)}</div> : <p>NOT_AVAILABLE · no feature metadata was supplied.</p>}</section>
    <section><h3>Requirements</h3>{item.requirements.length ? <ul>{item.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul> : <p>NOT_AVAILABLE · no requirements were supplied.</p>}</section>
    <section><h3>Permissions</h3><p>Review all capability classes before installation or enablement.</p><ul>{item.permissions.map((permission) => <li key={permission.id}><strong>{permission.id} · {permission.required ? "required" : "not requested"}</strong><span>{permission.detail}</span></li>)}</ul></section>
    <section><h3>Release History</h3><p>{item.releaseHistory.state} · {item.releaseHistory.source}</p>{item.releaseHistory.items.length > 0 && <ul>{item.releaseHistory.items.map((entry) => <li key={entry}>{entry}</li>)}</ul>}</section>
    <section><h3>Dependencies</h3><p>{item.dependencies.state} · {item.dependencies.source}</p>{item.dependencies.items.length > 0 && <ul>{item.dependencies.items.map((entry) => <li key={entry}>{entry}</li>)}</ul>}</section>
    <section><h3>Complete Lifecycle</h3><ol className="kf-marketplace-lifecycle">{item.lifecycle.map((stage) => <li key={stage.id}><strong>{stage.label}</strong><span>{stage.state}</span><small>{stage.evidence}</small></li>)}</ol></section>
    {item.projectCompatibility && <section><h3>Project-Aware Agent Flow</h3><p>{item.projectCompatibility.state} · {item.projectCompatibility.source}</p><ol className="kf-marketplace-lifecycle">{item.projectCompatibility.flow.map((stage) => <li key={stage.stage}><strong>{stage.stage}</strong><span>{stage.state}</span><small>{stage.evidence}</small></li>)}</ol></section>}
    <div className="kf-online-detail-actions"><button onClick={() => void onInspect(item)}>Review install</button>{item.category === "models" && !item.installed && <button className="is-primary" disabled={item.installAction !== "INSTALL_REQUIRES_CONFIRMATION"} onClick={() => void onInstall(item)}>Install</button>}{item.category === "models" && item.installed && !item.enabled && <button className="is-primary" onClick={() => void onActivate(item)}>Activate</button>}{item.category === "models" && item.installed && <button onClick={() => void onRemove(item)}>Remove</button>}{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Official source</a>}</div>
  </>;
}

function OnlineDetailEmpty() { return <div className="kf-online-detail-empty"><Box size={24} /><strong>Select a verified item</strong><p>Details, compatibility, trust, requirements, and permissions will appear here.</p></div>; }

type SecurityToolView = { id: string; label: string; state: string; executable?: string; version?: string; detail: string; lastRun?: string; exitCode?: number; stdout?: string; stderr?: string; findings?: unknown[]; transparency?: OperationTransparency };

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
      const remote = id === "sonar" || id === "npm-audit";
      if (remote && !window.confirm(id === "sonar" ? "Run Sonar against its configured server?\n\nExecution: HYBRID\nNetwork: REQUIRED\nData: PROJECT_CONTEXT, SOURCE_CODE, credential reference\nSecret redaction: enforced" : "Run npm audit?\n\nExecution: HYBRID\nNetwork: REQUIRED\nData: dependency METADATA from package-lock.json\nProject source sent: NO\nSecret redaction: enforced")) return;
      setMessage(`Running ${id} with captured local evidence…`);
      const response = await fetch(`/api/workspace/projects/${project.id}/security/tools/${id}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: remote }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || payload.tool?.detail || `${id} did not complete.`);
      setTools((current) => current.map((tool) => tool.id === id ? { ...payload.tool, transparency: payload.transparency } : tool)); setMessage("");
    } catch (cause: unknown) { setMessage(cause instanceof Error ? cause.message : "Security tool run failed."); }
  };
  return <section className="kf-capability-panel"><div className="kf-card-heading"><div><ShieldAlert size={17} /><h3>Knoux Sonar · Security Tool Manager</h3></div><button onClick={() => void refresh()}>Detect local tools</button></div><p className="kf-capability-copy">No tool is downloaded or run silently. UNAVAILABLE means no executable was found; BLOCKED preserves the trust or offline policy; PASSED appears only after an explicit scan succeeds. Sonar and npm audit show a data disclosure and require confirmation before network access.</p>{message && <StatusMessage>{message}</StatusMessage>}<div className="kf-hardware-grid"><span><strong>Project trust</strong>{trust}</span><span><strong>Detected tools</strong>{tools.length}</span><span><strong>Available</strong>{tools.filter((tool) => tool.state === "AVAILABLE").length}</span><span><strong>Passed</strong>{tools.filter((tool) => tool.state === "PASSED").length}</span></div><div className="kf-provider-grid">{tools.map((tool) => <article className="kf-provider-card" key={tool.id}><div><strong>{tool.label}</strong><span>{tool.state}</span></div><p>{tool.version || tool.executable || "No local executable path available"}</p><small>{tool.detail}</small><button disabled={!(["AVAILABLE", "CONFIGURED"] as string[]).includes(tool.state)} onClick={() => void runTool(tool.id)}>Run explicit scan</button>{tool.lastRun && <details><summary>Captured evidence · exit {tool.exitCode}</summary><pre>{JSON.stringify({ findings: tool.findings, stdout: tool.stdout, stderr: tool.stderr }, null, 2)}</pre></details>}{tool.transparency && <details><summary>Execution and data disclosure</summary><pre>{JSON.stringify(tool.transparency, null, 2)}</pre></details>}</article>)}</div><QualityPanel title="Current normalized security findings" scan={scan} onScan={onScan} /></section>;
}

function QualityPanel({ title, scan, onScan, selectedIssueId }: { title: string; scan?: ProjectScan; onScan: () => void; selectedIssueId?: string }) { const issues = [...(scan?.issues || [])].sort((left, right) => Number(right.id === selectedIssueId) - Number(left.id === selectedIssueId)); return <section className="kf-capability-panel"><div className="kf-card-heading"><div><ShieldAlert size={17} /><h3>{title}</h3></div><button onClick={onScan}>Run current scan</button></div>{scan ? <div className="kf-issues">{issues.slice(0, 8).map((entry) => <details key={entry.id} className="kf-issue" open={entry.id === selectedIssueId || undefined}><summary><span className={`kf-severity kf-severity--${entry.severity}`}>{entry.severity}</span><span><strong>{entry.title}</strong><small>{entry.source} · {entry.rule || entry.category}</small></span><ChevronRight size={15} /></summary><p>{entry.suggestion || entry.description}</p></details>)}</div> : <p className="kf-capability-copy">No scan is loaded. Start a real local scan to populate this panel.</p>}</section>; }

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
  return <><div className="kf-card-heading"><div><ShieldAlert size={17} /><h3>Problems center</h3></div><span>{scannedAt ? `Scan ${formatDate(scannedAt)}` : "Run scan to load"}</span></div>{!scannedAt ? <div className="kf-card-empty"><p>No normalized diagnostics are loaded for this project.</p></div> : <><div className="kf-problem-filters"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search diagnostics" aria-label="Search problems" /><select value={severity} onChange={(event) => setSeverity(event.target.value)} aria-label="Filter problems by severity"><option value="all">All severity</option>{["critical", "high", "medium", "low", "info"].map((value) => <option key={value}>{value}</option>)}</select><select value={source} onChange={(event) => setSource(event.target.value)} aria-label="Filter problems by source"><option value="all">All sources</option>{sources.map((value) => <option key={value}>{value}</option>)}</select><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter problems by category"><option value="all">All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select></div><div className="kf-issues">{filtered.length ? <>{filtered.map((entry) => <details key={entry.id} className="kf-issue"><summary><span className={`kf-severity kf-severity--${entry.severity}`}>{entry.severity}</span><span><strong>{entry.title}</strong><small>{entry.source} · {entry.file || entry.category}</small></span><ChevronRight size={15} /></summary><div><p>{entry.description}</p><p className="kf-suggestion"><Wrench size={14} />{entry.fixability === "automatic" ? "Automatic patch may be available after review." : entry.suggestion || "Manual review is required."}</p>{entry.id.endsWith(":missing-env-example") && <button className="kf-solution-button" onClick={() => void applyEnvironmentTemplate(entry)}>Preview + Apply safe template</button>}</div></details>)}{solutionStatus && <p className="kf-solution-status">{solutionStatus}</p>}</> : <div className="kf-card-empty"><p>No problems match the selected filters.</p></div>}</div></>}</>;
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

type CloudProviderView = { id: string; name: string; configured: boolean; state: "CONFIGURED" | "NOT_CONFIGURED"; destination: string; model: string | null; reason: string };
type CloudDisclosureView = { execution: string; network: string; dataClasses: string[]; projectSourceSent: boolean; secretRedaction: true; provider: string; destination: string; purpose: string; confirmation: string; startedAt: string; completedAt: string | null; durationMs: number | null; result: string; reason?: string };

function AgentPanel({ projectId }: { projectId: string }) {
  const [mission, setMission] = useState("Review diagnostics and produce a safe implementation plan.");
  const [result, setResult] = useState<unknown>(null);
  const [status, setStatus] = useState("KForge Engineer reads project context and uses a local model only when one is available.");
  const [working, setWorking] = useState(false);
  const [cloudProviders, setCloudProviders] = useState<CloudProviderView[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("local-only");
  const [disclosure, setDisclosure] = useState<CloudDisclosureView | null>(null);
  useEffect(() => {
    let active = true;
    void fetch("/api/workspace/ai/providers?kind=cloud").then(async (response) => {
      const payload = await response.json() as { providers?: CloudProviderView[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Cloud provider registry is unavailable.");
      if (active) setCloudProviders(payload.providers || []);
    }).catch((cause: unknown) => { if (active) setStatus(cause instanceof Error ? cause.message : "Cloud provider registry is unavailable."); });
    return () => { active = false; };
  }, []);
  const plan = async (confirmedCloud = false) => {
    setWorking(true);
    try {
      const cloudProvider = selectedProvider === "local-only" ? undefined : selectedProvider;
      const response = await fetch(`/api/workspace/projects/${projectId}/agent/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mission, cloudProvider, confirmedCloud }) });
      const payload = await response.json() as { plan?: unknown; error?: string; state?: string; mode?: "local-ai" | "cloud-ai" | "rules"; provider?: string | { id?: string; name?: string; reason?: string }; disclosure?: CloudDisclosureView };
      const providerReason = typeof payload.provider === "object" && payload.provider ? payload.provider.reason : undefined;
      if (payload.disclosure) setDisclosure(payload.disclosure);
      if (!response.ok) {
        setResult(null);
        setStatus(payload.error || providerReason || "AI planning is unavailable.");
        return;
      }
      setDisclosure(payload.disclosure || null);
      setResult(payload.plan ?? null);
      const providerName = typeof payload.provider === "string" ? payload.provider : payload.provider?.name || payload.provider?.id;
      setStatus(payload.mode === "cloud-ai" ? `Plan generated by explicitly confirmed ${providerName || "cloud AI"}.` : payload.mode === "local-ai" ? `Plan generated by local ${providerName || "AI"}.` : "Evidence-based deterministic plan generated from the current scan.");
    } catch (cause: unknown) { setStatus(cause instanceof Error ? cause.message : "AI planning request failed."); }
    finally { setWorking(false); }
  };
  return <><div className="kf-card-heading"><div><Bot size={17} /><h3>KForge Engineer</h3></div><span>Read + plan</span></div><div className="kf-agent-panel"><textarea value={mission} onChange={(event) => { setMission(event.target.value); setDisclosure(null); }} aria-label="KForge Engineer mission" /><label>Planning provider<select value={selectedProvider} onChange={(event) => { setSelectedProvider(event.target.value); setDisclosure(null); setResult(null); }} aria-label="Planning provider"><option value="local-only">Local model or deterministic rules (default)</option>{cloudProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.state}{provider.model ? ` · ${provider.model}` : ""}</option>)}</select></label><button className="kf-button kf-button--ghost" onClick={() => void plan(false)} disabled={working}>{working ? "Planning…" : selectedProvider === "local-only" ? "Generate local plan" : "Review cloud disclosure"}</button><p>{status}</p>{disclosure && <article className="kf-command-evidence" aria-live="polite"><strong>Exact cloud data disclosure</strong><pre>{JSON.stringify({ provider: disclosure.provider, destination: disclosure.destination, dataClasses: disclosure.dataClasses, sourceCodeIncluded: disclosure.projectSourceSent, secretRedaction: disclosure.secretRedaction, purpose: disclosure.purpose, confirmation: disclosure.confirmation, timestamp: disclosure.startedAt, result: disclosure.result, reason: disclosure.reason }, null, 2)}</pre>{disclosure.result === "NOT_STARTED" && disclosure.confirmation === "REQUIRED" && <button className="kf-button kf-button--primary" onClick={() => void plan(true)} disabled={working}>Confirm and send disclosed context</button>}</article>}{result !== null && <PlanOutput value={result} />}</div></>;
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: "good" | "warning" | "bad" | "neutral" }) { return <div className={`kf-metric kf-metric--${tone}`}><span>{icon}</span><small>{label}</small><strong>{value}</strong></div>; }

function WorkspaceLoading() { return <div className="kf-loading"><div /><div /><div /><div /></div>; }
function WorkspaceEmpty({ onOpen }: { onOpen: () => void }) { return <div className="kf-empty"><FolderOpen size={28} /><h2>No projects found</h2><p>Choose a local repository or clone one into the configured KForge workspace to begin.</p><button className="kf-button kf-button--primary" onClick={onOpen}><Plus size={16} />Open local project</button></div>; }

function ProjectModal({ mode, localPath, setLocalPath, remoteUrl, setRemoteUrl, targetName, setTargetName, submitting, onClose, onSubmit }: { mode: "open" | "clone"; localPath: string; setLocalPath: (value: string) => void; remoteUrl: string; setRemoteUrl: (value: string) => void; targetName: string; setTargetName: (value: string) => void; submitting: boolean; onClose: () => void; onSubmit: () => void }) { const clone = mode === "clone"; return <div className="kf-overlay" role="dialog" aria-modal="true" aria-labelledby="project-modal-title"><form className="kf-modal" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}><div><p className="kf-eyebrow">{clone ? "Remote repository" : "Local project"}</p><h2 id="project-modal-title">{clone ? "Clone repository" : "Open project"}</h2><p>{clone ? "Clone a GitHub or GitLab HTTPS repository directly into the configured KForge workspace." : "Enter an existing local project folder. KForge will detect its stack and real Git state."}</p></div>{clone ? <><label>Repository HTTPS URL<input required value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://github.com/owner/repository.git" /></label><label>Destination folder name<input required pattern="[A-Za-z0-9._-]+" value={targetName} onChange={(event) => setTargetName(event.target.value)} placeholder="my-repository" /></label></> : <label>Local project path<input required value={localPath} onChange={(event) => setLocalPath(event.target.value)} placeholder="D:\\Projects\\my-repository" /></label>}<div className="kf-modal-actions"><button type="button" className="kf-button kf-button--ghost" onClick={onClose}>Cancel</button><button type="submit" className="kf-button kf-button--primary" disabled={submitting}>{submitting ? "Working…" : clone ? "Clone repository" : "Open project"}</button></div></form></div>; }

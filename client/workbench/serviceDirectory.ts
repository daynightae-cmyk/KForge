import {
  Activity, Archive, Bot, Boxes, BrainCircuit, Braces, Bug, Building2, Cpu, Database, FileSearch,
  Fingerprint, FolderKanban, Gauge, GitBranch, GitCommitHorizontal, HardDrive, HeartPulse, History,
  KeyRound, LayoutDashboard, Library, ListChecks, Map as MapIcon, MessageSquareCode, Package, Puzzle,
  Radar, Radio, Rocket, ScanSearch, Server, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Star,
  Store, Terminal, TestTube2, Truck, Wrench, type LucideIcon,
} from "lucide-react";
import type { KForgeActivity } from "@shared/workspace";
import { ACTIVITIES, defaultView, type WorkbenchView } from "./navigation";

/**
 * Canonical KForge service directory.
 *
 * This module is the single source of truth for the product information
 * architecture:
 *
 *   DOMAIN -> SECTION (group) -> SERVICE -> PRIMARY ACTION -> HANDLER -> API
 *
 * Every entry describes one real, reachable user-facing destination. It never
 * describes an API endpoint that has no user benefit, and it never claims a
 * runtime state: availability is derived separately from real evidence in
 * `serviceAvailability.ts`.
 */

export type ServiceContext = "global" | "project" | "optional";

export type ServiceAvailability =
  | "READY"
  | "NEEDS_SETUP"
  | "REQUIRES_PROJECT"
  | "REQUIRES_PERMISSION"
  | "OFFLINE"
  | "UNAVAILABLE"
  | "RUNNING"
  | "FAILED"
  | "COMPLETED";

export type ServicePurpose = {
  /** What the service actually does, in product language. */
  description: string;
  /** The user outcome the service delivers. */
  capability: string;
  /** The prerequisite the destination has, not a readiness claim. */
  context: ServiceContext;
  /** The single action that best represents the service. */
  primaryAction: string;
  /** The React handler module that owns the service implementation. */
  handler: string;
  /** The canonical API or IPC contract the handler executes against. */
  api: string;
  /** Extra search terms so the palette can find the service by intent. */
  keywords?: string[];
};

export type WorkbenchService = WorkbenchView & ServicePurpose & {
  activity: KForgeActivity;
  activityLabel: string;
  target: string;
  icon: LucideIcon;
};

const global = (description: string, capability: string, primaryAction: string, handler: string, api: string, keywords?: string[]): ServicePurpose =>
  ({ description, capability, context: "global", primaryAction, handler, api, keywords });
const project = (description: string, capability: string, primaryAction: string, handler: string, api: string, keywords?: string[]): ServicePurpose =>
  ({ description, capability, context: "project", primaryAction, handler, api, keywords });
const optional = (description: string, capability: string, primaryAction: string, handler: string, api: string, keywords?: string[]): ServicePurpose =>
  ({ description, capability, context: "optional", primaryAction, handler, api, keywords });

export const ACTIVITY_PURPOSE: Record<KForgeActivity, string> = {
  projects: "Open, discover and organize your local projects, then reach every service that acts on the selected project.",
  ai: "Configure providers and models, then run project agent missions and follow the tasks they create.",
  online: "Discover integrations and manage verified local packages. Remote searches run only when you request them.",
  intelligence: "Understand project structure, dependencies and the impact of a change using bounded local analysis.",
  quality: "Assess project health and security, review findings and recover changes from snapshots.",
  "developer-tools": "Run registered commands, verify changes and manage the local Preview runtime.",
  remote: "Inspect your local Git repository and explicitly request GitHub evidence.",
  release: "Prepare distribution and qualify independent release evidence for the selected project.",
  system: "Manage appearance, trust, permissions, operating mode and application diagnostics.",
};

const SERVICE_ICONS: Record<string, LucideIcon> = {
  workspace: LayoutDashboard, health: HeartPulse, recent: History, favorites: Star, pinned: MapIcon,
  archive: Archive, "open-project": FolderKanban, "import-project": GitBranch,
  providers: KeyRound, models: Cpu, agents: Bot, tasks: ListChecks,
  discover: ScanSearch, marketplace: Store, extensions: Puzzle, tools: Wrench, integrations: Boxes,
  installed: Package, updates: Truck, downloads: Library, "remote-sources": Radio, documentation: FileSearch,
  security: ShieldCheck, activity: Activity,
  "project-graph": BrainCircuit, dependencies: Braces, "impact-analysis": GitCommitHorizontal,
  "code-understanding": MessageSquareCode, "ask-kforge": Sparkles, architecture: Building2,
  sonar: Radar, problems: Bug, solutions: Wrench, performance: Gauge, "technical-debt": Database,
  snapshots: History,
  terminal: Terminal, tests: TestTube2, build: Boxes, runtime: Server, lint: SlidersHorizontal,
  logs: ListChecks, diagnostics: Activity, preview: Rocket,
  git: GitBranch, branches: GitBranch, commits: GitCommitHorizontal, github: GitBranch,
  "pull-requests": GitBranch, issues: Bug, actions: Activity, releases: Truck,
  "release-gate": ShieldCheck, "release-preparation": Rocket, artifacts: Package, versioning: Fingerprint,
  settings: Settings2, trust: ShieldCheck, permissions: KeyRound, storage: HardDrive,
  "online-offline": Radio, "self-audit": Radar, "system-diagnostics": Activity,
};

// One description per existing destination, not one card per API endpoint.
const PURPOSES: Record<KForgeActivity, Record<string, ServicePurpose>> = {
  projects: {
    workspace: global("Discover and select local projects, inspect their evidence and open their tools.", "A single overview of every project KForge knows about.", "Open workspace", "projectsSurface", "GET /api/workspace/projects"),
    health: optional("Compare persisted project health and inspect the selected project's checks.", "The last stored health verdict for a project, with its source.", "Review health", "ProjectHealthWorkbench", "GET /api/workspace/projects/:id/health"),
    recent: global("Reopen projects from your local activity history.", "The projects you worked on most recently.", "Open recent", "ProjectCollectionsWorkbench", "GET /api/workspace/projects"),
    favorites: global("Find the projects you have marked as favorites.", "Your hand-picked projects in one place.", "Open favorites", "ProjectCollectionsWorkbench", "GET /api/workspace/projects"),
    pinned: global("Return to projects pinned in your workspace.", "The projects you keep one click away.", "Open pinned", "ProjectCollectionsWorkbench", "GET /api/workspace/projects"),
    archive: global("Review archived project registrations and restore them to your workspace.", "Retired registrations you can bring back.", "Open archive", "ProjectCollectionsWorkbench", "GET /api/workspace/projects"),
    "open-project": global("Register an existing local project directory without contacting a remote service.", "Add a folder on this machine to the workspace.", "Open project", "ProjectStartActions", "POST /api/workspace/projects/open"),
    "import-project": global("Clone a repository into the workspace with explicit confirmation and network permission.", "Bring a remote repository into the local workspace.", "Import repository", "ProjectStartActions", "POST /api/workspace/projects/clone"),
  },
  ai: {
    providers: global("Configure AI providers, credentials and connection settings in Provider Studio.", "Add a provider key and prove the connection before you rely on it.", "Configure provider", "ProviderStudio", "GET /api/workspace/ai/command-center/providers"),
    models: global("Inspect provider models and assign a model to a session. Discovery requires an explicit request.", "Know which model answers, and change it deliberately.", "Review models", "ProviderStudio", "GET /api/workspace/ai/models"),
    agents: project("Inspect agent tool permissions and start a typed audit mission for the active project.", "Give an agent a scoped, reviewable job inside your project.", "Start mission", "aiSurface", "GET /api/workspace/projects/:id/agent/tools"),
    tasks: global("Follow persisted AI and agent tasks, including progress, results and errors.", "The live record of what each automated run is doing.", "Open tasks", "aiSurface", "GET /api/workspace/tasks"),
  },
  online: {
    discover: optional("Browse available integration evidence. Project compatibility is not evaluated until a project is selected.", "See what KForge can work with before you install anything.", "Browse integrations", "onlineSurface", "GET /api/workspace/online/control-center"),
    marketplace: optional("Browse package evidence and use lifecycle actions only where a verified adapter permits them.", "Find and manage first-party packages with real install evidence.", "Open marketplace", "onlineSurface", "GET /api/workspace/marketplace"),
    extensions: optional("Discover extension catalog records. A catalog listing does not mean an extension is installed.", "Know which extensions exist in the catalog.", "Browse extensions", "onlineSurface", "GET /api/workspace/online/control-center"),
    models: optional("Discover model catalog records. Configure execution models in AI / Models.", "Compare catalog models; activation stays in AI / Models.", "Browse models", "onlineSurface", "GET /api/workspace/online/control-center"),
    agents: optional("Browse agent catalog records. Run project missions in AI / Agents.", "Compare the agents KForge can describe.", "Browse agents", "onlineSurface", "GET /api/workspace/online/control-center"),
    tools: optional("Discover tools and MCP server records without assuming they are installed or runnable.", "See which tools and MCP servers exist, and which are merely listed.", "Browse tools", "onlineSurface", "GET /api/workspace/online/control-center"),
    integrations: optional("Browse integration records and inspect their source, permissions and compatibility.", "Understand each integration before it touches your project.", "Browse integrations", "onlineSurface", "GET /api/workspace/online/control-center"),
    installed: optional("Manage locally installed packages with verified management adapters.", "Audit and maintain what is actually installed locally.", "Manage installed", "onlineSurface", "GET /api/workspace/online/control-center"),
    updates: optional("Inspect update evidence. Availability remains unknown until explicitly evaluated.", "See update state without pretending a remote check happened.", "Review updates", "onlineSurface", "GET /api/workspace/online/control-center"),
    downloads: global("Review persisted download, install and update task results.", "The history of package operations KForge actually performed.", "Review downloads", "onlineSurface", "GET /api/workspace/tasks"),
    providers: global("Inspect catalog source availability. Configure AI credentials in AI / Providers.", "See which package sources this machine can reach.", "Review sources", "onlineSurface", "GET /api/workspace/online/control-center"),
    "remote-sources": global("Request remote catalog searches explicitly under the current network policy.", "Search npm, PyPI, NuGet, winget, Open VSX and MCP on demand only.", "Search sources", "onlineSurface", "GET /api/workspace/remote-sources"),
    documentation: global("Look up allowlisted external documentation explicitly. Project document checks live in Quality.", "Read vendor documentation without leaving the workbench.", "Search documentation", "onlineSurface", "GET /api/workspace/remote-sources/documentation/sources"),
    security: optional("Inspect package trust, permissions and integrity. Project security scans live in Quality.", "Judge whether a package is safe to trust before installing it.", "Review package trust", "onlineSurface", "GET /api/workspace/online/control-center"),
    activity: global("Review the persisted activity of Online and package operations.", "An audit trail of package and source activity.", "Review activity", "onlineSurface", "GET /api/workspace/online/control-center"),
  },
  intelligence: {
    "project-graph": project("Explore files, symbols and relationships from the bounded local project graph.", "A map of your codebase that respects explicit scan limits.", "Open project graph", "intelligenceSurface", "GET /api/workspace/projects/:id/graph"),
    dependencies: project("Inspect dependencies and scripts detected in local project manifests.", "Know what your project depends on without guessing.", "Review dependencies", "intelligenceSurface", "GET /api/workspace/projects/:id/profile"),
    "impact-analysis": project("Evaluate a change against the local project graph and inspect its analysis limits.", "See what a change could touch before you make it.", "Analyze impact", "intelligenceSurface", "GET /api/workspace/projects/:id/graph/impact"),
    "code-understanding": project("Review indexed files, symbols, tests and imports with coverage evidence.", "Understand how the code is actually shaped, with honest coverage.", "Review understanding", "intelligenceSurface", "GET /api/workspace/projects/:id/graph"),
    "ask-kforge": project("Ask a bounded project question and inspect the local evidence used to answer it.", "A grounded answer that shows the local evidence behind it.", "Ask KForge", "intelligenceSurface", "POST /api/workspace/projects/:id/ask"),
    architecture: project("Inspect architecture derived from the selected project's local structure.", "A structural view of the project derived from real files.", "Review architecture", "intelligenceSurface", "GET /api/workspace/projects/:id/architecture"),
  },
  quality: {
    sonar: project("Run a bounded project health scan and inspect persisted findings.", "A health verdict with the findings that produced it.", "Run scan", "qualitySurface", "POST /api/workspace/projects/:id/tasks"),
    problems: project("Inspect project diagnostics and select a finding for investigation.", "Every detected problem, with severity and source.", "Review problems", "QualityTriageWorkbench", "GET /api/workspace/projects/:id/problems"),
    solutions: project("Preview eligible fixes and review confirmation and snapshot requirements before applying them.", "A reviewed, reversible fix for an eligible finding.", "Review solutions", "QualityTriageWorkbench", "POST /api/workspace/projects/:id/problems/:problemId/apply"),
    security: project("Inspect project security checks, dependency evidence and scanner availability.", "Know which security checks ran and which tools were unavailable.", "Review security", "SecurityQualityWorkbench", "GET /api/workspace/projects/:id/security/tools"),
    performance: project("Review measured project performance evidence and its limitations.", "Measured performance, with the limits of the measurement stated.", "Review performance", "PerformanceQualityWorkbench", "GET /api/workspace/projects/:id/profile"),
    "technical-debt": project("Inspect locally derived technical debt and its supporting findings.", "The debt KForge can actually point at in your files.", "Review technical debt", "TechnicalDebtWorkbench", "GET /api/workspace/projects/:id/profile"),
    documentation: project("Check project documentation consistency against local source evidence.", "Know where the docs and the code disagree.", "Review documentation", "DocumentationConsistencyWorkbench", "GET /api/workspace/projects/:id/documentation"),
    snapshots: project("Inspect recovery snapshots and preview a restore before confirming it.", "A restorable point in time, previewed before you commit to it.", "Review snapshots", "SnapshotRecoveryWorkbench", "GET /api/workspace/projects/:id/snapshots"),
  },
  "developer-tools": {
    terminal: project("Run registered project commands with explicit permission and inspect their output.", "The project's own commands, with their real output.", "Open commands", "developerSurface", "GET /api/workspace/projects/:id/actions"),
    tests: project("Run the detected test command and inspect its real execution result.", "A real test run with its exit status and output.", "Run tests", "DeveloperTestsWorkbench", "POST /api/workspace/projects/:id/actions"),
    build: project("Run the detected build command and inspect generated artifact evidence.", "A real build and the artifacts it produced.", "Run build", "DeveloperBuildWorkbench", "POST /api/workspace/projects/:id/actions"),
    runtime: project("Inspect registered runtime capabilities and their execution state.", "What the project can run, and what is running now.", "Review runtime", "DeveloperRuntimeWorkbench", "GET /api/workspace/projects/:id/actions"),
    lint: project("Run the detected lint command and review its diagnostics and exit status.", "A real lint run with the exact diagnostics it emitted.", "Run lint", "DeveloperLintWorkbench", "POST /api/workspace/projects/:id/actions"),
    logs: optional("Review persisted execution events and output, optionally filtered to the active project.", "A replayable ledger of what KForge executed.", "Review logs", "DeveloperExecutionLedger", "GET /api/workspace/projects/:id/execution-ledger"),
    diagnostics: optional("Inspect local execution and runtime diagnostics with their source evidence.", "The evidence behind the current runtime state.", "Review diagnostics", "DeveloperObservabilityWorkbench", "GET /api/workspace/tasks"),
    preview: project("Start, inspect, restart or stop the KForge-owned local Preview runtime.", "A live local preview of the project you are working on.", "Open preview", "PreviewStudioWorkbench", "GET /api/workspace/projects/:id/preview"),
  },
  remote: {
    git: project("Inspect working tree changes and diffs; stage, unstage and commit only with trust and confirmation.", "The truth about what changed in your working tree.", "Inspect changes", "remoteSurface", "GET /api/workspace/projects/:id/git"),
    branches: project("Inspect branches in the selected local Git repository.", "Every local branch and where it points.", "Review branches", "remoteSurface", "GET /api/workspace/projects/:id/git"),
    commits: project("Read commit history from the selected local Git repository.", "The project's own history, read locally.", "Review commits", "remoteSurface", "GET /api/workspace/projects/:id/git"),
    github: project("Explicitly refresh GitHub repository evidence when the provider and network policy permit it.", "Remote repository facts, fetched only on request.", "Refresh GitHub", "GitHubRemoteWorkbench", "GET /api/workspace/projects/:id/github"),
    "pull-requests": project("Inspect remote pull request evidence and its freshness.", "Open pull requests with the moment they were fetched.", "Review pull requests", "GitHubRemoteWorkbench", "GET /api/workspace/projects/:id/github"),
    issues: project("Inspect remote issue evidence and its freshness.", "Open issues with the moment they were fetched.", "Review issues", "GitHubRemoteWorkbench", "GET /api/workspace/projects/:id/github"),
    actions: project("Inspect GitHub Actions and CI evidence without inferring a local build result.", "What CI actually reported, never a guess.", "Review actions", "GitHubRemoteWorkbench", "GET /api/workspace/projects/:id/github"),
    releases: project("Inspect published GitHub release evidence. Prepare local distribution in Release.", "Published releases as the remote reports them.", "Review releases", "GitHubRemoteWorkbench", "GET /api/workspace/projects/:id/github"),
  },
  release: {
    "release-gate": project("Evaluate source, local, desktop, installer and remote evidence as independent release verdicts.", "An honest release verdict assembled from independent evidence.", "Evaluate release", "releaseSurface", "POST /api/workspace/projects/:id/release-gate"),
    "release-preparation": project("Review distribution prerequisites and readiness for the selected project.", "What is still missing before you can ship.", "Review preparation", "ReleaseDistributionWorkbench", "GET /api/workspace/projects/:id/release/preparation"),
    artifacts: project("Inspect release artifact provenance and verification evidence.", "Every built artifact with its provenance and checksum.", "Review artifacts", "ReleaseDistributionWorkbench", "GET /api/workspace/projects/:id/release/preparation"),
    versioning: project("Review project version evidence before preparing distribution.", "The version KForge will publish, and where it came from.", "Review versioning", "ReleaseDistributionWorkbench", "GET /api/workspace/projects/:id/release/preparation"),
  },
  system: {
    settings: global("Set theme, density, motion, startup navigation and other persisted preferences.", "Make the workbench behave the way you want it to.", "Open settings", "systemSurface", "GET /api/workspace/settings"),
    trust: optional("Review project trust decisions and their effect on execution permissions.", "Decide which projects KForge may act on, and change that decision explicitly.", "Review trust", "SystemTrustCenter", "GET /api/workspace/projects"),
    permissions: optional("Inspect effective permissions and the reasons an operation is blocked.", "The exact permission and reason behind every gate.", "Review permissions", "SystemPermissionsCenter", "GET /api/workspace/projects/:id/agent/tools"),
    storage: global("Inspect local storage and eligible maintenance operations before confirming changes.", "See what KForge stores locally and reclaim it safely.", "Review storage", "SystemStorageCenter", "GET /api/workspace/projects/:id/cache"),
    "online-offline": global("Choose an operating mode and inspect the network policy it permits.", "Control exactly when KForge may reach the network.", "Review mode", "SystemControlCenter", "GET /api/workspace/platform"),
    "self-audit": optional("Run KForge's self audit and inspect persisted verification evidence.", "KForge checking its own work with stored evidence.", "Run self audit", "SystemControlCenter", "GET /api/workspace/projects/:id/self-audit"),
    "system-diagnostics": optional("Inspect application environment, desktop runtime and diagnostic evidence.", "The environment facts behind the current session.", "Review diagnostics", "SystemControlCenter", "GET /api/workspace/platform"),
  },
};

// Search terms that describe intent rather than the visible label, so the
// command palette can find a service the way a user asks for it.
const SERVICE_KEYWORDS: Record<string, string[]> = {
  "ai:providers": ["credential", "key", "secret", "connection", "connect", "openai", "anthropic", "ollama"],
  "ai:models": ["llm", "select", "activate", "gpt", "claude", "llama", "model picker"],
  "ai:agents": ["mission", "run", "tool", "permission", "automation", "copilot"],
  "ai:tasks": ["history", "job", "progress", "run log", "queue"],
  "online:discover": ["browse", "catalog", "overview", "explore"],
  "online:marketplace": ["store", "packages", "install", "download extension"],
  "online:extensions": ["plugin", "vsix", "add-on", "editor extension"],
  "online:tools": ["mcp", "server", "connector"],
  "online:integrations": ["connector", "service", "binding"],
  "online:remote-sources": ["npm", "pypi", "nuget", "winget", "vsx", "mcp", "registry", "search"],
  "online:documentation": ["docs", "manual", "reference", "lookup", "help"],
  "online:security": ["trust", "integrity", "signature", "package safety"],
  "online:updates": ["upgrade", "new version", "update check"],
  "quality:sonar": ["scan", "health", "audit", "check", "review"],
  "quality:problems": ["diagnostics", "issues", "errors", "warnings", "defects"],
  "quality:solutions": ["fix", "apply", "repair", "resolve", "remediation"],
  "quality:security": ["vulnerability", "cve", "osv", "advisory", "scanner"],
  "quality:performance": ["speed", "profiling", "slow", "optimization"],
  "quality:technical-debt": ["smell", "complexity", "todo", "cleanup", "maintenance"],
  "quality:documentation": ["docs", "stale", "readme", "consistency", "comments"],
  "quality:snapshots": ["restore", "rollback", "backup", "undo", "revert"],
  "developer-tools:terminal": ["command", "shell", "console", "execute", "task runner"],
  "developer-tools:tests": ["test suite", "unit", "vitest", "jest", "spec"],
  "developer-tools:build": ["compile", "bundle", "production", "artifact", "dist"],
  "developer-tools:runtime": ["process", "serve", "node", "electron", "running"],
  "developer-tools:lint": ["style", "format", "eslint", "static analysis"],
  "developer-tools:logs": ["output", "history", "events", "ledger", "stdout"],
  "developer-tools:diagnostics": ["issues", "runtime health", "debug", "troubleshoot"],
  "developer-tools:preview": ["serve", "localhost", "url", "dev server", "live"],
  "remote:git": ["diff", "stage", "commit", "changes", "working tree", "version control"],
  "remote:branches": ["branch", "checkout", "switch", "merge branch"],
  "remote:commits": ["history", "log", "sha", "revision"],
  "remote:github": ["remote repository", "hosted", "cloud git"],
  "remote:pull-requests": ["pr", "merge request", "review", "diff review"],
  "remote:issues": ["tickets", "bugs", "defect tracker"],
  "remote:actions": ["ci", "workflow", "run", "pipeline", "build status"],
  "remote:releases": ["tags", "publish", "published version"],
  "release:release-gate": ["qualify", "ship", "readiness", "verdict", "go live"],
  "release:artifacts": ["installer", "output", "checksum", "package", "bundle"],
  "release:versioning": ["version number", "semver", "tagging"],
  "system:settings": ["preferences", "theme", "appearance", "density", "motion"],
  "system:trust": ["allow", "deny", "approve", "revoke", "safety"],
  "system:permissions": ["policy", "capability", "grant", "blocked reason", "access"],
  "system:storage": ["cache", "disk", "cleanup", "usage", "reclaim"],
  "system:online-offline": ["network", "mode", "policy", "connectivity"],
  "system:self-audit": ["verify", "self check", "integrity", "diagnose kforge"],
  "system:system-diagnostics": ["environment", "runtime info", "platform", "support"],
};

export const WORKBENCH_SERVICES: WorkbenchService[] = ACTIVITIES.flatMap((activity) =>
  activity.views.map((view) => {
    const purpose = PURPOSES[activity.id][view.id];
    if (!purpose) throw new Error(`KForge service directory is missing a purpose for ${activity.id}:${view.id}`);
    return {
      ...view,
      ...purpose,
      keywords: [...(purpose.keywords || []), ...(SERVICE_KEYWORDS[`${activity.id}:${view.id}`] || [])],
      activity: activity.id,
      activityLabel: activity.label,
      target: `${activity.id}:${view.id}`,
      icon: SERVICE_ICONS[view.id] || Boxes,
    };
  }));

export const WORKBENCH_SERVICE_BY_TARGET = new Map<string, WorkbenchService>(
  WORKBENCH_SERVICES.map((service): [string, WorkbenchService] => [service.target, service]));

/**
 * The project-scoped shortcut set. These are contextual entries to services
 * that already own a canonical home in the Explorer, so the same service is
 * never implemented twice.
 */
export const PROJECT_SERVICE_GROUPS: Array<{ name: string; targets: string[] }> = [
  { name: "Development", targets: ["developer-tools:terminal", "developer-tools:tests", "developer-tools:build", "developer-tools:runtime", "developer-tools:preview"] },
  { name: "Intelligence", targets: ["intelligence:project-graph", "intelligence:dependencies", "intelligence:architecture"] },
  { name: "Quality", targets: ["quality:sonar", "quality:problems"] },
  { name: "AI", targets: ["ai:providers", "ai:agents", "ai:tasks"] },
  { name: "Delivery", targets: ["remote:git", "remote:github", "release:release-gate"] },
];

export function serviceByTarget(target: string): WorkbenchService | undefined {
  return WORKBENCH_SERVICE_BY_TARGET.get(target);
}

// Keep established contextual/event/search targets pointing to their original owner.
const LEGACY_TARGETS: Record<string, string> = {
  Workspace: "projects:workspace", Agents: "ai:agents", Models: "ai:models", Tasks: "ai:tasks", Providers: "ai:providers",
  Marketplace: "online:marketplace", Extensions: "online:extensions", "Online Documentation": "online:documentation",
  "Project graph": "intelligence:project-graph", Dependencies: "intelligence:dependencies", Architecture: "intelligence:architecture",
  Problems: "quality:problems", Documentation: "quality:documentation", "KForge Sonar": "quality:sonar",
  Tests: "developer-tools:tests", Build: "developer-tools:build", Runtime: "developer-tools:runtime", "Project commands": "developer-tools:terminal",
  Preview: "developer-tools:preview", Git: "remote:git", GitHub: "remote:github", "Release Gate": "release:release-gate",
  Settings: "system:settings", Trust: "system:trust", Permissions: "system:permissions", Storage: "system:storage",
  "System Diagnostics": "system:system-diagnostics", "Online / Offline": "system:online-offline", Updates: "online:updates",
  "Project Health": "projects:health", Recent: "projects:recent", Favorites: "projects:favorites", Pinned: "projects:pinned",
  Archive: "projects:archive", "Open Project": "projects:open-project", "Import Project": "projects:import-project",
  Sonar: "quality:sonar", Solutions: "quality:solutions", "Project Graph": "intelligence:project-graph",
  "Impact Analysis": "intelligence:impact-analysis", "Code Understanding": "intelligence:code-understanding",
  "Ask KForge": "intelligence:ask-kforge", "Technical Debt": "quality:technical-debt", Performance: "quality:performance",
  Snapshots: "quality:snapshots", Terminal: "developer-tools:terminal", Lint: "developer-tools:lint", Logs: "developer-tools:logs",
  Diagnostics: "developer-tools:diagnostics", Branches: "remote:branches", Commits: "remote:commits",
  "Pull Requests": "remote:pull-requests", Issues: "remote:issues", Actions: "remote:actions", Releases: "remote:releases",
  "Release Preparation": "release:release-preparation", Artifacts: "release:artifacts", Versioning: "release:versioning",
  "Self Audit": "system:self-audit", "Remote Sources": "online:remote-sources", Downloads: "online:downloads",
  Installed: "online:installed", Tools: "online:tools", Integrations: "online:integrations", Activity: "online:activity",
  Discover: "online:discover",
};

/**
 * Resolve any established contextual target (event payloads, quick actions,
 * search results) to the single service that owns it.
 */
export function resolveWorkbenchTarget(target: string): WorkbenchService | undefined {
  const trimmed = String(target || "").trim();
  if (!trimmed) return undefined;
  const qualified = LEGACY_TARGETS[trimmed] || trimmed;
  const exact = WORKBENCH_SERVICE_BY_TARGET.get(qualified);
  if (exact) return exact;
  const lowered = trimmed.toLowerCase();
  const matches = WORKBENCH_SERVICES.filter((service) => service.label.toLowerCase() === lowered);
  return matches.length === 1 ? matches[0] : undefined;
}

export function serviceDefinition(activity: KForgeActivity, view: string) {
  return WORKBENCH_SERVICES.find((service) => service.activity === activity && service.id === view);
}

/**
 * Search the whole service catalogue. An empty query returns nothing, because
 * an empty palette shows the nine domains through `browseWorkbenchDomains`.
 */
export function searchWorkbenchServices(query: string): WorkbenchService[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const terms = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  const needle = trimmed.toLowerCase();
  return WORKBENCH_SERVICES.filter((service) => {
    const haystack = `${service.activityLabel} ${service.group || ""} ${service.label} ${service.description} ${service.capability} ${service.keywords || ""} ${service.target}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  }).sort((a, b) => Number(b.label.toLowerCase().includes(needle)) - Number(a.label.toLowerCase().includes(needle)));
}

export type WorkbenchDomain = {
  id: KForgeActivity;
  label: string;
  purpose: string;
  firstView: string;
  serviceCount: number;
  projectScoped: boolean;
};

export function browseWorkbenchDomains(): WorkbenchDomain[] {
  return ACTIVITIES.map((activity) => {
    const services = WORKBENCH_SERVICES.filter((service) => service.activity === activity.id);
    return {
      id: activity.id,
      label: activity.label,
      purpose: ACTIVITY_PURPOSE[activity.id],
      firstView: services[0]?.id || defaultView(activity.id),
      serviceCount: services.length,
      projectScoped: services.some((service) => service.context === "project"),
    };
  });
}

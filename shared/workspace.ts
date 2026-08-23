export type WorkspaceStatus = "pass" | "warning" | "fail" | "unknown" | "running" | "unavailable";
export type DiagnosticSeverity = "critical" | "high" | "medium" | "low" | "info";
export type IssuePriority = "P0" | "P1" | "P2" | "P3";
export type DiagnosticCategory = "security" | "dependency" | "quality" | "configuration" | "typecheck" | "test" | "build" | "runtime" | "git" | "completeness" | "architecture" | "api" | "ui" | "mock";
export type Fixability = "automatic" | "guided" | "manual" | "unavailable";
export type IssueStatus = "open" | "in_progress" | "fixed" | "verified" | "ignored";
export type FixRisk = "safe" | "review" | "approval" | "blocked";

export interface ProjectSummary {
  id: string;
  name: string;
  trust: "trusted" | "untrusted";
  path: string;
  provider: "GitHub" | "Git" | "Local";
  remoteUrl?: string;
  branch: string;
  lastActivity: string;
  projectType: string;
  modifiedFiles: number;
  untrackedFiles: number;
  ahead: number;
  behind: number;
  healthScore: number | null;
  securityStatus: WorkspaceStatus;
  buildStatus: WorkspaceStatus;
  testStatus: WorkspaceStatus;
  syncStatus: WorkspaceStatus;
  lastScan?: string;
  lastOpenedAt?: string;
  lastScannedAt?: string;
  lastTaskAt?: string;
  tags: string[];
  favorite: boolean;
  pinned: boolean;
  archived: boolean;
  categories: {
    recent: boolean;
    favorite: boolean;
    pinned: boolean;
    archive: boolean;
  };
}

export interface ProjectCommands {
  typecheck?: string;
  test?: string;
  build?: string;
  dev?: string;
  production?: string;
  runtime?: string;
}

export interface CommandEvidence {
  kind: "typecheck" | "test" | "build" | "dev" | "production" | "runtime";
  command?: string;
  source: string;
  known: boolean;
  detail: string;
}

export type ProjectScale = "small" | "medium" | "large" | "very-large";

export interface ProjectPerformanceStrategy {
  scale: ProjectScale;
  parallelism: number;
  maxIndexedFiles: number;
  graphDepth: number;
  scannerConcurrency: number;
  cacheEnabled: boolean;
  rationale: string;
}

export interface ProjectProfile {
  projectId: string;
  rootPath: string;
  framework: string[];
  languages: string[];
  packageManager: string | null;
  dependencies: Array<{ name: string; version: string; kind: "production" | "development" }>;
  scripts: Record<string, string>;
  commands: ProjectCommands;
  commandEvidence: CommandEvidence[];
  manifests: string[];
  lockfiles: string[];
  workspaceKind: "single" | "workspace" | "monorepo";
  testRoots: string[];
  runtimeEntrypoint?: string;
  performance: ProjectPerformanceStrategy;
  envFiles: string[];
  ci: string[];
  docker: string[];
  deployment: string[];
  sourceFileCount: number;
  totalFileCount: number;
  projectSizeBytes: number;
  sourceRoots: string[];
  detectedAt: string;
}

export interface ScanIssue {
  id: string;
  severity: DiagnosticSeverity;
  priority: IssuePriority;
  category: DiagnosticCategory;
  title: string;
  message: string;
  description: string;
  file?: string;
  line?: number;
  confidence: "high" | "medium" | "low";
  fixability: Fixability;
  source: string;
  status: IssueStatus;
  rule?: string;
  risk?: FixRisk;
  suggestion?: string;
}

export interface HealthMetric {
  key: "codeQuality" | "security" | "dependencies" | "tests" | "build" | "runtime" | "git" | "documentation" | "architecture" | "completeness";
  label: string;
  status: WorkspaceStatus;
  score: number | null;
  weight: number;
  evidence: string[];
  findings: string[];
  lastScan: string;
  evidenceSource: string;
  evidenceAgeMs: number;
  freshness: "current-scan" | "live-task" | "persisted-task" | "stale-task" | "unknown";
}

export type ReleaseDecisionState = "READY" | "READY WITH WARNINGS" | "BLOCKED";

export interface ReleaseDecision {
  state: ReleaseDecisionState;
  blockers: Array<{ title: string; source: string; file?: string; issueId?: string }>;
  warnings: Array<{ title: string; source: string; file?: string; issueId?: string }>;
  evidence: string[];
}

export interface ProjectHealth {
  score: number | null;
  evidenceCoverage: number;
  metrics: HealthMetric[];
  sources: Record<ProjectHealthEvidenceSourceKind, ProjectHealthEvidenceSource>;
  release: ReleaseDecision;
  calculatedAt: string;
}

export type ProjectHealthEvidenceSourceKind = "LOCAL" | "GITHUB" | "CI" | "REMOTE_REGISTRY" | "PREVIEW";
export type ProjectHealthEvidenceState = "READY" | "READY_WITH_WARNINGS" | "BLOCKED" | "UNKNOWN" | "OFFLINE" | "NOT_CONFIGURED" | "UNAVAILABLE" | "ERROR";

export interface ProjectHealthEvidenceSource {
  kind: ProjectHealthEvidenceSourceKind;
  state: ProjectHealthEvidenceState;
  timestamp: string | null;
  freshness: "LIVE" | "CURRENT_SCAN" | "CACHED" | "STALE" | "UNKNOWN" | "NOT_APPLICABLE";
  evidence: string[];
  source: string;
  provider: string;
  network: "NOT_REQUIRED" | "REQUIRED_NOT_CONTACTED";
  error?: string;
  blocker?: string;
}

export type ReleaseGateSourceKind = "LOCAL" | "GITHUB" | "CI" | "PREVIEW";

export interface ReleaseGateSourceVerdict {
  kind: ReleaseGateSourceKind;
  state: ProjectHealthEvidenceState;
  source: string;
  timestamp: string | null;
  freshness: ProjectHealthEvidenceSource["freshness"];
  evidence: string[];
  blocker?: string;
  reason?: string;
}

export interface ReleaseGateResult {
  readiness: ReleaseDecisionState;
  verdicts: Record<ReleaseGateSourceKind, ReleaseGateSourceVerdict>;
  checks: Array<{ action: WorkspaceAction; ok: boolean; message: string }>;
  missingChecks: WorkspaceAction[];
  security: ScanIssue[];
  dependencies: ScanIssue[];
  completeness: ScanIssue[];
  blockers: ScanIssue[];
  warnings: ScanIssue[];
  scan: ProjectScan;
}

export interface ToolAvailability {
  name: "typescript" | "eslint" | "npm-audit" | "gitleaks" | "semgrep" | "sonar";
  available: boolean;
  version?: string;
  reason?: string;
}

export interface ProjectScan {
  projectId: string;
  scannedAt: string;
  profile: ProjectProfile;
  health: ProjectHealth;
  technology: string[];
  git: {
    branch: string;
    remoteUrl?: string;
    modifiedFiles: number;
    untrackedFiles: number;
    ahead: number;
    behind: number;
  };
  issues: ScanIssue[];
  summaries: {
    security: WorkspaceStatus;
    dependencies: WorkspaceStatus;
    tests: WorkspaceStatus;
    build: WorkspaceStatus;
    typecheck: WorkspaceStatus;
  };
  tools: ToolAvailability[];
}

export interface CommandResult {
  action: "scan" | "test" | "build" | "typecheck" | "pull" | "push" | "runtime";
  projectId: string;
  ok: boolean;
  startedAt: string;
  completedAt: string;
  exitCode?: number;
  output: string;
  message: string;
  evidenceSource?: "live" | "persisted";
}

export type LocalCapabilityState = "ready" | "available" | "limited" | "unavailable";

export interface LocalCapability {
  id: "projects" | "git" | "file-inspection" | "project-graph" | "quality" | "problems" | "tests-build" | "release-gate" | "agents" | "local-ai" | "artifacts";
  label: string;
  state: LocalCapabilityState;
  detail: string;
}

export interface LocalPlatformStatus {
  mode: "offline" | "online-optional";
  coreReady: boolean;
  networkRequiredForCore: false;
  storagePath: string;
  checkedAt: string;
  capabilities: LocalCapability[];
  optionalOnlineFeatures: Array<{ id: "clone" | "git-sync" | "model-download" | "cloud-ai"; label: string; enabled: boolean; detail: string }>;
}

export const KFORGE_STARTUP_CAPABILITIES = [
  "Workspace",
  "Recent projects",
  "Favorites",
  "Pinned",
  "Project health",
  "Agents",
  "Discover",
  "Preview",
] as const;

export type KForgeStartupCapability = (typeof KFORGE_STARTUP_CAPABILITIES)[number];

export type SettingsDomainHandling = "EDITABLE_REAL" | "MANAGED_ELSEWHERE" | "UNAVAILABLE" | "NOT_CONFIGURED";

export const KFORGE_SETTINGS_DOMAIN_HANDLING = [
  ["General", "EDITABLE_REAL", "Startup capability is validated, atomically persisted, reloaded after restart, and changes the initial workspace surface."],
  ["Appearance", "EDITABLE_REAL", "Density and reduced-motion preferences are validated, persisted, and applied to the document immediately."],
  ["Workspace", "MANAGED_ELSEWHERE", "Workspace discovery and root selection are owned by the existing workspace engine and KFORGE_WORKSPACE_ROOT."],
  ["Projects", "MANAGED_ELSEWHERE", "Recent, favorite, pinned, archived, and collection state use the existing project collection store."],
  ["AI", "MANAGED_ELSEWHERE", "AI activation and evidence-backed planning use the existing AI Center and agent engine."],
  ["Models", "MANAGED_ELSEWHERE", "Installed models, activation, fallback, health, and removal use the existing AI Center store."],
  ["Providers", "MANAGED_ELSEWHERE", "Local providers are detected by the AI Center; cloud credentials are not accepted by the renderer settings API."],
  ["Marketplace", "MANAGED_ELSEWHERE", "Registry adapters, provenance, and install eligibility are owned by the existing Marketplace service."],
  ["Privacy", "EDITABLE_REAL", "Remote context may be blocked or require confirmation; secret redaction remains enforced."],
  ["Security", "MANAGED_ELSEWHERE", "Trust gates, snapshots, confirmation, and verification are enforced by the action engines."],
  ["Permissions", "MANAGED_ELSEWHERE", "Per-action permissions are declared by the existing agent tool registry."],
  ["Trust", "MANAGED_ELSEWHERE", "Project trust decisions persist in the existing trust store."],
  ["Git", "MANAGED_ELSEWHERE", "Git operations use the Git engine; remote writes always require confirmation."],
  ["GitHub", "MANAGED_ELSEWHERE", "GitHub connection and evidence are reported by the GitHub workspace when explicitly opened."],
  ["Online / Offline", "MANAGED_ELSEWHERE", "The real operating mode is persisted by the existing local-platform service and changes network behavior."],
  ["Updates", "NOT_CONFIGURED", "No verified KForge update registry is configured."],
  ["Storage", "MANAGED_ELSEWHERE", "KForge-owned evidence, tasks, snapshots, and caches use their existing bounded stores."],
  ["Cache", "MANAGED_ELSEWHERE", "Marketplace, graph, task, and evidence caches remain owned by their canonical services."],
  ["Tasks", "MANAGED_ELSEWHERE", "Task concurrency, lifecycle, evidence, retry, and cancellation use the existing task store."],
  ["Agents", "MANAGED_ELSEWHERE", "Mission limits, permissions, snapshots, and verification are enforced by the agent orchestrator."],
  ["Preview", "EDITABLE_REAL", "Automatic local health checks and their interval are validated, persisted, and applied by the active Preview panel."],
  ["Notifications", "UNAVAILABLE", "No desktop notification adapter exists in this browser-hosted runtime."],
  ["Keyboard Shortcuts", "UNAVAILABLE", "Ctrl/Cmd+K and Escape are active product commands; a shortcut editor is not implemented."],
  ["Diagnostics", "MANAGED_ELSEWHERE", "Measured diagnostics and performance evidence are generated by the existing scan and System surfaces."],
] as const satisfies readonly (readonly [string, SettingsDomainHandling, string])[];

export interface KForgePlatformSettings {
  version: 2;
  general: {
    startupCapability: KForgeStartupCapability;
  };
  appearance: {
    density: "compact" | "comfortable";
    reducedMotion: boolean;
  };
  privacy: {
    secretRedaction: true;
    remoteContextPolicy: "blocked" | "ask";
  };
  git: {
    confirmRemoteWrites: true;
  };
  preview: {
    autoHealthCheck: boolean;
    healthIntervalMs: 3_000 | 5_000 | 10_000 | 30_000;
  };
  updatedAt: string;
}

export interface WorkspaceResponse {
  root: string;
  projects: ProjectSummary[];
  generatedAt: string;
  localPlatform: LocalPlatformStatus;
}

export interface WorkspaceActivity {
  id: string;
  at: string;
  kind: "scan" | "test" | "build" | "git" | "system" | "runtime" | "typecheck";
  title: string;
  detail: string;
}

export interface ProjectDetailResponse {
  project: ProjectSummary;
  scan?: ProjectScan;
  activities: WorkspaceActivity[];
}

export const WORKSPACE_ACTIONS = ["scan", "test", "build", "typecheck", "pull", "push", "runtime"] as const;
export type WorkspaceAction = (typeof WORKSPACE_ACTIONS)[number];

export function isWorkspaceAction(value: unknown): value is WorkspaceAction {
  return typeof value === "string" && WORKSPACE_ACTIONS.includes(value as WorkspaceAction);
}

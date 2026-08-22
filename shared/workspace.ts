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
}

export interface ProjectCommands {
  typecheck?: string;
  test?: string;
  build?: string;
  dev?: string;
  production?: string;
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
  release: ReleaseDecision;
  calculatedAt: string;
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

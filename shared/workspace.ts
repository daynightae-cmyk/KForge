export type WorkspaceStatus = "pass" | "warning" | "fail" | "unknown" | "running";

export interface ProjectSummary {
  id: string;
  name: string;
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

export interface ScanIssue {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: "security" | "dependency" | "quality" | "configuration";
  title: string;
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

export interface ProjectScan {
  projectId: string;
  scannedAt: string;
  healthScore: number;
  technology: string[];
  git: {
    branch: string;
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
  };
}

export interface CommandResult {
  action: "scan" | "test" | "build" | "pull" | "push";
  projectId: string;
  ok: boolean;
  startedAt: string;
  completedAt: string;
  exitCode?: number;
  output: string;
  message: string;
}

export interface WorkspaceResponse {
  root: string;
  projects: ProjectSummary[];
  generatedAt: string;
}

export interface WorkspaceActivity {
  id: string;
  at: string;
  kind: "scan" | "test" | "build" | "git" | "system";
  title: string;
  detail: string;
}

export interface ProjectDetailResponse {
  project: ProjectSummary;
  scan?: ProjectScan;
  activities: WorkspaceActivity[];
}

export const WORKSPACE_ACTIONS = ["scan", "test", "build", "pull", "push"] as const;
export type WorkspaceAction = (typeof WORKSPACE_ACTIONS)[number];

export function isWorkspaceAction(value: unknown): value is WorkspaceAction {
  return typeof value === "string" && WORKSPACE_ACTIONS.includes(value as WorkspaceAction);
}

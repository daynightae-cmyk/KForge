import type { KForgeActivity, WorkspaceResponse, ProjectSummary, KForgePlatformSettings } from "@shared/workspace";

export type SurfaceProps = {
  activity: KForgeActivity;
  view: string;
  workspace: WorkspaceResponse | null;
  project?: ProjectSummary;
  settings: KForgePlatformSettings | null;
  onProjectSelect: (id: string) => void;
  onRefresh: () => Promise<void>;
  onSettings: (settings: KForgePlatformSettings) => void;
  onNavigate: (activity: KForgeActivity, view: string) => void;
  onExecution: (execution: ExecutionSnapshot | null) => void;
  onInspectorContext?: (context: InspectorContext | null) => void;
};

export type ExecutionSnapshot = {
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

export type RecordRow = Record<string, unknown>;
export type TaskRow = RecordRow & {
  id: string;
  projectId: string;
  kind: string;
  status: string;
  progress?: number;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  output?: string;
  error?: string;
  logs?: Array<{ at?: string; message?: string }>;
};

export type MarketplaceItem = RecordRow & {
  id: string;
  name: string;
  category: string;
  taxonomy?: string[];
  description?: string;
  overview?: string;
  source?: string;
  version?: string;
  capabilities?: string[];
  requirements?: string[];
  installed?: boolean;
  enabled?: boolean;
  installAction?: string;
  trust?: string;
  availability?: string;
  authority?: { kind?: string; originalKind?: string };
  projectCompatibility?: { state?: string; evidence?: string[]; source?: string };
  permissions?: Array<{ id: string; required: boolean; detail: string }>;
  runtimeEvidence?: { state?: string; sources?: string[] };
  healthState?: string;
  freshness?: { state?: string; at?: string | null };
  unavailableReason?: string;
  integrity?: { state?: string; value?: string; source?: string };
  updateState?: { state?: string; value?: string; source?: string };
  lifecycle?: Array<{ id: string; label: string; state: string; evidence: string }>;
};

export type InspectorAction = {
  id: string;
  label: string;
  disabled?: boolean;
  reason?: string;
  invoke?: () => void;
};

export type InspectorContext = {
  kind: "online-item" | "project" | "execution" | null;
  item?: MarketplaceItem | null;
  title?: string;
  view?: string;
  compatibility?: string;
  projectName?: string;
  actions?: InspectorAction[];
  operation?: RecordRow | null;
};

export type CanonicalInspectorProps = {
  activity: KForgeActivity;
  view: string;
  project?: ProjectSummary;
  execution: ExecutionSnapshot | null;
  context: InspectorContext | null;
};

export type MarketplaceData = {
  items?: MarketplaceItem[];
  providers?: RecordRow[];
  adapters?: RecordRow[];
  categories?: RecordRow[];
};

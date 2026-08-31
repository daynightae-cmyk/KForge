export const RUNTIME_SERVICE_STATES = [
  "DISCOVERED", "NOT_STARTED", "STARTING", "RUNNING", "HEALTHY", "DEGRADED",
  "FAILED", "STOPPING", "STOPPED", "BLOCKED", "UNAVAILABLE", "UNKNOWN",
] as const;

export type RuntimeServiceState = (typeof RUNTIME_SERVICE_STATES)[number];
export type RuntimeServiceKind = "frontend" | "backend" | "api" | "worker" | "websocket" | "documentation" | "admin" | "runtime" | "unknown";
export type RuntimeHealthKind = "HTTP" | "TCP" | "PROCESS" | "CUSTOM" | "NOT_APPLICABLE";

export interface RuntimeEvidence {
  source: string;
  detail: string;
  confidence: "explicit" | "high" | "medium" | "unknown";
}
export interface RuntimeDependency {
  serviceId: string;
  relationship: "CONFIGURED_DEPENDENCY" | "WORKSPACE_PACKAGE_DEPENDENCY" | "UNKNOWN";
  evidence: RuntimeEvidence;
}

export interface RuntimeHealth {
  kind: RuntimeHealthKind;
  verdict: "HEALTHY" | "UNHEALTHY" | "RUNNING" | "NOT_APPLICABLE" | "NOT_CAPTURED" | "UNKNOWN";
  checkedAt?: string;
  status?: number;
  latencyMs?: number;
  detail: string;
  endpoint?: string;
}

export interface RuntimePort {
  requested?: number;
  allocated?: number;
  protocol: "http" | "tcp" | "process";
  host: "127.0.0.1";
  ownership: "KFORGE_SESSION" | "EXTERNAL" | "UNALLOCATED" | "UNKNOWN";
  collision: "NONE" | "PORT_CONFLICT" | "NOT_CHECKED";
  evidence: string;
}

export interface RuntimeEnvironmentDisclosure {
  name: string;
  state: "PRESENT" | "MISSING" | "REDACTED";
  safeValue?: string;
  source: string;
}

export interface RuntimeTimelineEvent {
  at: string;
  serviceId?: string;
  phase: "discovered" | "dependency-resolved" | "port-allocated" | "process-spawned" | "listener-detected" | "first-health-probe" | "healthy" | "failed" | "stop-requested" | "stopped" | "session-created";
  detail: string;
}

export interface RuntimeLogLine {
  at: string;
  serviceId: string;
  stream: "stdout" | "stderr" | "system";
  message: string;
}

export interface RuntimeProblem {
  id: string;
  serviceId?: string;
  kind: "PORT_CONFLICT" | "MISSING_RUNTIME" | "DEPENDENCY_UNAVAILABLE" | "HEALTH_FAILURE" | "UNEXPECTED_EXIT" | "MISSING_ENVIRONMENT" | "BLOCKED_EMBEDDING" | "COMMAND_UNAVAILABLE";
  severity: "error" | "warning" | "info";
  detail: string;
  evidence: string;
  at: string;
}

export interface RuntimeService {
  id: string;
  projectId: string;
  name: string;
  kind: RuntimeServiceKind;
  rootPath: string;
  relativeRoot: string;
  command: { executable: string; args: string[]; display: string };
  source: RuntimeEvidence;
  dependencies: RuntimeDependency[];
  port: RuntimePort;
  processId?: number;
  processOwner?: { sessionId: string; serviceId: string; pid: number; spawnedAt: string; command: string };
  state: RuntimeServiceState;
  startedAt?: string;
  stoppedAt?: string;
  exitCode?: number | null;
  exitSignal?: string | null;
  health: RuntimeHealth;
  healthEndpoint?: string;
  browserEntrypoint?: string;
  browserLabel?: string;
  networkPolicy: "PROJECT_DECLARED_LOCAL_BEHAVIOR" | "PROCESS_ONLY";
  environment: RuntimeEnvironmentDisclosure[];
  restartPolicy: "MANUAL" | "RESTART_FAILED_SERVICE" | "RESTART_DEPENDENCY_CHAIN";
  logs: RuntimeLogLine[];
}

export interface RuntimeTopologyDiscovery {
  projectId: string;
  projectPath: string;
  discoveredAt: string;
  state: "DISCOVERED" | "UNAVAILABLE" | "UNKNOWN";
  services: RuntimeService[];
  evidenceSources: string[];
  limitations: string[];
}

export interface TopologySession {
  id: string;
  projectId: string;
  projectPath: string;
  createdAt: string;
  endedAt?: string;
  state: RuntimeServiceState;
  services: RuntimeService[];
  selectedEntrypoint?: string;
  timeline: RuntimeTimelineEvent[];
  logs: RuntimeLogLine[];
  problems: RuntimeProblem[];
  networkEvidence: Array<{ at: string; sourceServiceId?: string; destinationServiceId?: string; relationship: "CONFIGURED_DEPENDENCY" | "OBSERVED_TRAFFIC"; detail: string; evidence: string }>;
  limits: { logLines: number; healthRecordsPerService: number; timelineEvents: number; networkRecords: number };
}

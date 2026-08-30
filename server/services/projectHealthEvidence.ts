import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { ProjectHealth, ReleaseDecisionState, WorkspaceStatus } from "../../shared/workspace";

export interface PersistedProjectHealthSummary {
  path: string;
  scannedAt: string;
  score: number | null;
  evidenceCoverage: number;
  releaseState: ReleaseDecisionState;
  securityStatus: WorkspaceStatus;
  buildStatus: WorkspaceStatus;
  testStatus: WorkspaceStatus;
  source: "persisted-project-health";
}

interface HealthStore {
  version: 1;
  projects: Record<string, PersistedProjectHealthSummary>;
}

const defaultStore = (): HealthStore => ({ version: 1, projects: {} });
const storeMutationLocks = new Map<string, Promise<void>>();

function healthPath(workspaceRoot: string) {
  return path.join(workspaceRoot, ".kforge", "project-health.json");
}

function normalize(projectPath: string) {
  return path.resolve(projectPath);
}

function isWorkspaceStatus(value: unknown): value is WorkspaceStatus {
  return ["pass", "warning", "fail", "unknown", "running", "unavailable"].includes(String(value));
}

function isReleaseState(value: unknown): value is ReleaseDecisionState {
  return ["READY", "READY WITH WARNINGS", "BLOCKED"].includes(String(value));
}

async function readStore(workspaceRoot: string): Promise<HealthStore> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(healthPath(workspaceRoot), "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return defaultStore();
    const data = parsed as { version?: unknown; projects?: unknown };
    if (data.version !== 1 || typeof data.projects !== "object" || data.projects === null || Array.isArray(data.projects)) return defaultStore();
    const projects: Record<string, PersistedProjectHealthSummary> = {};
    for (const [key, value] of Object.entries(data.projects)) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      const entry = value as Partial<PersistedProjectHealthSummary>;
      if (typeof entry.scannedAt !== "string" || !isReleaseState(entry.releaseState) || !isWorkspaceStatus(entry.securityStatus) || !isWorkspaceStatus(entry.buildStatus) || !isWorkspaceStatus(entry.testStatus)) continue;
      const score = entry.score === null || typeof entry.score === "number" ? entry.score : null;
      const evidenceCoverage = typeof entry.evidenceCoverage === "number" && Number.isFinite(entry.evidenceCoverage) ? Math.max(0, Math.min(100, entry.evidenceCoverage)) : 0;
      const projectPath = normalize(typeof entry.path === "string" ? entry.path : key);
      projects[projectPath] = {
        path: projectPath,
        scannedAt: entry.scannedAt,
        score,
        evidenceCoverage,
        releaseState: entry.releaseState,
        securityStatus: entry.securityStatus,
        buildStatus: entry.buildStatus,
        testStatus: entry.testStatus,
        source: "persisted-project-health",
      };
    }
    return { version: 1, projects };
  } catch {
    return defaultStore();
  }
}

async function writeStore(workspaceRoot: string, store: HealthStore) {
  const destination = healthPath(workspaceRoot);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function withStoreMutationLock<T>(workspaceRoot: string, mutation: () => Promise<T>) {
  const key = path.resolve(healthPath(workspaceRoot));
  const previous = storeMutationLocks.get(key) || Promise.resolve();
  let release = () => undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  storeMutationLocks.set(key, pending);
  await previous;
  try {
    return await mutation();
  } finally {
    release();
    if (storeMutationLocks.get(key) === pending) storeMutationLocks.delete(key);
  }
}

export async function listPersistedProjectHealthSummaries(workspaceRoot: string) {
  const store = await readStore(workspaceRoot);
  return Object.values(store.projects).sort((left, right) => right.scannedAt.localeCompare(left.scannedAt));
}

export async function getPersistedProjectHealthSummary(workspaceRoot: string, projectPath: string) {
  const store = await readStore(workspaceRoot);
  return store.projects[normalize(projectPath)] || null;
}

export async function persistProjectHealthSummary(workspaceRoot: string, projectPath: string, health: ProjectHealth, scannedAt: string) {
  const metricStatus = (key: "security" | "build" | "tests"): WorkspaceStatus => health.metrics.find((metric) => metric.key === key)?.status || "unknown";
  const entry: PersistedProjectHealthSummary = {
    path: normalize(projectPath),
    scannedAt,
    score: health.score,
    evidenceCoverage: health.evidenceCoverage,
    releaseState: health.release.state,
    securityStatus: metricStatus("security"),
    buildStatus: metricStatus("build"),
    testStatus: metricStatus("tests"),
    source: "persisted-project-health",
  };
  return withStoreMutationLock(workspaceRoot, async () => {
    const store = await readStore(workspaceRoot);
    store.projects[entry.path] = entry;
    await writeStore(workspaceRoot, store);
    return entry;
  });
}

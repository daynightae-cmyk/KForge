import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

export type TaskKind = "scan" | "audit" | "test" | "build" | "typecheck" | "runtime" | "git" | "github" | "clone" | "agent" | "snapshot";
export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "blocked" | "retrying";
export type MissionStepStatus = "queued" | "running" | "waiting-confirmation" | "succeeded" | "failed" | "blocked" | "skipped";
export type MissionType = "audit" | "fix-critical" | "improve-security" | "improve-tests" | "refactor" | "prepare-release" | "prepare-github" | "documentation" | "performance";
export type MissionState = "queued" | "planning" | "running" | "waiting-confirmation" | "verifying" | "succeeded" | "failed" | "blocked" | "recovering" | "cancelled" | "interrupted";

export interface MissionEvidence {
  id: string;
  stepId: string;
  kind: string;
  recordedAt: string;
  summary: string;
  data?: unknown;
}

export interface MissionStep {
  id: string;
  missionId: string;
  index: number;
  name: string;
  kind: string;
  tool: string;
  status: MissionStepStatus;
  dependencies: string[];
  startedAt?: string;
  finishedAt?: string;
  logs: string[];
  output?: string;
  error?: string;
  evidence: MissionEvidence[];
  requiresConfirmation: boolean;
  attempts: number;
  retryCount: number;
}

export interface KForgeMission {
  id: string;
  projectId: string;
  type: MissionType;
  name: string;
  goal: string;
  state: MissionState;
  status: MissionState;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  currentStepId?: string;
  currentStep?: string;
  progress: number;
  steps: MissionStep[];
  evidence: MissionEvidence[];
  changedFiles: string[];
  snapshotId?: string;
  warnings: string[];
  recovery: { resume: boolean; rollback: boolean; inspect: boolean; detail: string; recoveryRequired?: boolean };
  finalResult?: { summary: string; state: MissionState; recordedAt: string };
}

export interface KForgeTask {
  id: string;
  projectId: string;
  kind: TaskKind;
  status: TaskStatus;
  progress: number;
  logs: Array<{ at: string; message: string; stream: "system" | "stdout" | "stderr" }>;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number;
  error?: string;
  output?: string;
  artifacts?: string[];
  retryOf?: string;
  interrupted?: boolean;
  recovery?: { strategy: "replay-action" | "inspect-only"; action?: string; detail: string };
  mission?: KForgeMission;
}

export interface TaskExecutionResult {
  ok: boolean;
  output: string;
  exitCode?: number;
  message: string;
  blocked?: boolean;
  artifacts?: string[];
}

const tasks = new Map<string, KForgeTask>();
const executors = new Map<string, () => Promise<TaskExecutionResult>>();
let storeFile: string | undefined;
let persistenceQueue = Promise.resolve();

function append(task: KForgeTask, message: string, stream: "system" | "stdout" | "stderr" = "system") {
  task.logs.push({ at: new Date().toISOString(), message, stream });
  task.logs = task.logs.slice(-200);
}

function queuePersist() {
  if (!storeFile) return;
  persistenceQueue = persistenceQueue.then(async () => {
    const directory = path.dirname(storeFile!);
    await fs.mkdir(directory, { recursive: true });
    const temporary = `${storeFile}.tmp`;
    await fs.writeFile(temporary, JSON.stringify({ tasks: [...tasks.values()] }, null, 2), "utf8");
    await fs.rename(temporary, storeFile!);
  }).catch(() => undefined);
}

export async function initializeTaskStore(workspaceRoot: string) {
  storeFile = path.join(workspaceRoot, ".kforge", "tasks.json");
  const saved = await fs.readFile(storeFile, "utf8").then((text) => JSON.parse(text) as { tasks?: KForgeTask[] }).catch(() => ({ tasks: [] }));
  let interrupted = 0;
  for (const task of saved.tasks || []) {
    if (["queued", "running", "retrying"].includes(task.status)) {
      task.status = "blocked";
      task.interrupted = true;
      task.finishedAt = new Date().toISOString();
      task.durationMs = new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime();
      task.error = task.recovery?.strategy === "replay-action"
        ? "Interrupted by a previous KForge session. Inspect the task evidence, then replay this explicit project action only after retry and current trust checks."
        : "Interrupted by a previous KForge session. Inspect the task evidence and related snapshots before creating a new mission or rollback action.";
      if (task.mission) {
        task.mission.state = "interrupted";
        const current = task.mission.steps.find((step) => step.status === "running" || step.status === "waiting-confirmation");
        if (current) { current.status = "blocked"; current.finishedAt = task.finishedAt; current.error = "Interrupted by a previous KForge session. Inspect, resume safely, or roll back explicitly."; current.logs.push(current.error); }
        task.mission.recovery = { resume: false, rollback: Boolean(task.mission.snapshotId), inspect: true, detail: "The prior session interrupted this mission. Inspect persisted steps and logs before creating a new execution." };
      }
      append(task, task.error, "stderr");
      interrupted += 1;
    }
    tasks.set(task.id, task);
  }
  queuePersist();
  return { interrupted };
}

export function flushTaskStore() {
  return persistenceQueue;
}

export function listTasks(projectId?: string) {
  return [...tasks.values()].filter((task) => !projectId || task.projectId === projectId).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export function getTask(taskId: string) {
  return tasks.get(taskId);
}

function terminalStepStatus(status: MissionStepStatus) {
  return ["succeeded", "failed", "blocked", "skipped"].includes(status);
}

function refreshMission(task: KForgeTask, mission: KForgeMission) {
  const total = mission.steps.length;
  const completed = mission.steps.filter((step) => terminalStepStatus(step.status)).length;
  mission.progress = total ? Math.round((completed / total) * 100) : 0;
  task.progress = mission.progress;
  mission.status = mission.state;
  mission.currentStep = mission.currentStepId;
  if (!mission.startedAt && mission.steps.some((step) => step.status !== "queued")) mission.startedAt = new Date().toISOString();
}

export function attachMission(taskId: string, mission: KForgeMission) {
  const task = tasks.get(taskId);
  if (!task) return undefined;
  refreshMission(task, mission);
  task.mission = mission;
  queuePersist();
  return task;
}

export function updateMissionStep(taskId: string, stepId: string, patch: Partial<Omit<MissionStep, "id" | "missionId" | "index" | "dependencies">>) {
  const task = tasks.get(taskId);
  const mission = task?.mission;
  const step = mission?.steps.find((entry) => entry.id === stepId);
  if (!task || !mission || !step) return undefined;
  const now = new Date().toISOString();
  Object.assign(step, patch);
  if (patch.status === "running") { if (!step.startedAt) step.startedAt = now; step.attempts += 1; }
  if (terminalStepStatus(patch.status || step.status)) step.finishedAt = now;
  if (patch.logs?.length) step.logs = step.logs.slice(-100);
  const evidence = patch.evidence || (patch.output === undefined ? [] : [{ id: `${step.id}:${Date.now()}`, stepId: step.id, kind: step.kind, recordedAt: now, summary: `${step.name} recorded output.`, data: patch.output }]);
  if (evidence.length) { step.evidence = [...step.evidence, ...evidence].slice(-50); mission.evidence = [...mission.evidence, ...evidence].slice(-250); }
  mission.currentStepId = ["running", "waiting-confirmation"].includes(step.status) ? step.id : mission.currentStepId === step.id ? undefined : mission.currentStepId;
  mission.state = step.status === "waiting-confirmation" ? "waiting-confirmation" : step.status === "failed" ? "failed" : step.status === "blocked" ? "blocked" : mission.state === "queued" || mission.state === "planning" ? "running" : mission.state;
  refreshMission(task, mission);
  append(task, `Mission step ${step.name}: ${step.status}.`);
  queuePersist();
  return task;
}

export function completeMission(taskId: string, state: Extract<MissionState, "succeeded" | "failed" | "blocked">, warning?: string) {
  const task = tasks.get(taskId);
  if (!task?.mission) return undefined;
  task.mission.state = state;
  task.mission.status = state;
  task.mission.currentStepId = undefined;
  task.mission.currentStep = undefined;
  task.mission.finishedAt = new Date().toISOString();
  task.mission.finalResult = { summary: warning || `Mission ${state}.`, state, recordedAt: task.mission.finishedAt };
  if (warning) task.mission.warnings.push(warning);
  refreshMission(task, task.mission);
  queuePersist();
  return task;
}

export function appendTaskLog(taskId: string, message: string, progress?: number) {
  const task = tasks.get(taskId);
  if (!task) return undefined;
  if (typeof progress === "number") task.progress = Math.max(task.progress, Math.min(99, Math.round(progress)));
  append(task, message);
  queuePersist();
  return task;
}

export function startTask(projectId: string, kind: TaskKind, executor: () => Promise<TaskExecutionResult>, retryOf?: string, recovery?: KForgeTask["recovery"]): KForgeTask {
  const task: KForgeTask = { id: randomUUID(), projectId, kind, status: retryOf ? "retrying" : "queued", progress: 0, logs: [], startedAt: new Date().toISOString(), retryOf, recovery };
  tasks.set(task.id, task);
  executors.set(task.id, executor);
  queuePersist();
  queueMicrotask(async () => {
    if (task.status === "cancelled") return;
    task.status = "running";
    task.progress = 10;
    append(task, retryOf ? `${kind} retry started.` : `${kind} started.`);
    queuePersist();
    try {
      const result = await executor();
      task.progress = 100;
      task.status = result.ok ? "succeeded" : result.blocked ? "blocked" : "failed";
      task.exitCode = result.exitCode;
      task.error = result.ok ? undefined : result.message;
      task.output = result.output;
      task.artifacts = result.artifacts;
      if (task.mission) {
        task.mission.state = result.ok ? "succeeded" : result.blocked ? "blocked" : "failed";
        task.mission.currentStepId = undefined;
        for (const step of task.mission.steps) {
          if (step.status === "queued") { step.status = result.ok ? "skipped" : "blocked"; step.finishedAt = new Date().toISOString(); step.logs.push(result.ok ? "Skipped because the mission completed before this dependent step was reached." : "Blocked because an earlier mission step failed."); }
        }
      }
      append(task, result.message, result.ok ? "system" : "stderr");
      if (result.output) append(task, result.output.slice(-12_000), "stdout");
      task.finishedAt = new Date().toISOString();
      task.durationMs = new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime();
    } catch (error: unknown) {
      task.progress = 100;
      task.status = "failed";
      task.error = error instanceof Error ? error.message : "Task failed.";
      if (task.mission) {
        task.mission.state = "failed";
        const current = task.mission.steps.find((step) => step.id === task.mission?.currentStepId || step.status === "running");
        if (current) { current.status = "failed"; current.error = task.error; current.finishedAt = new Date().toISOString(); current.logs.push(task.error); }
        task.mission.currentStepId = undefined;
        for (const step of task.mission.steps) {
          if (step.status === "queued") { step.status = "blocked"; step.finishedAt = new Date().toISOString(); step.logs.push("Blocked because an earlier mission step failed."); }
        }
      }
      append(task, task.error, "stderr");
      task.finishedAt = new Date().toISOString();
      task.durationMs = new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime();
    }
    queuePersist();
  });
  return task;
}

export function cancelTask(taskId: string) {
  const task = tasks.get(taskId);
  if (!task) return { task: undefined, cancellable: false };
  if (task.status !== "queued") return { task, cancellable: false };
  task.status = "cancelled";
  task.finishedAt = new Date().toISOString();
  append(task, "Task was cancelled before execution started.");
  task.durationMs = new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime();
  queuePersist();
  return { task, cancellable: true };
}

export function retryTask(taskId: string) {
  const original = tasks.get(taskId);
  const executor = executors.get(taskId);
  if (!original || !executor || original.status === "running" || original.status === "queued") return undefined;
  return startTask(original.projectId, original.kind, executor, original.id);
}

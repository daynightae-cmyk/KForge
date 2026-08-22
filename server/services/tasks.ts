import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

export type TaskKind = "scan" | "audit" | "test" | "build" | "typecheck" | "runtime" | "git" | "github" | "clone" | "agent" | "snapshot";
export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "blocked" | "retrying";

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
      append(task, result.message, result.ok ? "system" : "stderr");
      if (result.output) append(task, result.output.slice(-12_000), "stdout");
      task.finishedAt = new Date().toISOString();
      task.durationMs = new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime();
    } catch (error: unknown) {
      task.progress = 100;
      task.status = "failed";
      task.error = error instanceof Error ? error.message : "Task failed.";
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

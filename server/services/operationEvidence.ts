import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { redactProjectText } from "./redaction";

export type LedgerAction = "scan" | "test" | "build" | "typecheck" | "pull" | "push" | "runtime";
export type LedgerResult = "NOT_STARTED" | "PENDING" | "SUCCEEDED" | "FAILED" | "BLOCKED";

export interface LedgerTransparency {
  execution: "LOCAL" | "REMOTE" | "HYBRID";
  network: "REQUIRED" | "NOT_REQUIRED";
  dataClasses: string[];
  projectSourceSent: boolean;
  secretRedaction: true;
  provider: string;
  destination: string;
  purpose: string;
  confirmation: "NOT_REQUIRED" | "REQUIRED" | "CONFIRMED";
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  result: LedgerResult;
  reason?: string;
}

export interface OperationEvidenceRecord {
  id: string;
  projectId: string;
  action: LedgerAction;
  at: string;
  ok: boolean;
  httpStatus: number;
  message: string;
  exitCode: number | null;
  transparency: LedgerTransparency;
  source: "workspace-action-response";
  persisted: true;
}

export interface OperationEvidenceStoreStatus {
  state: "READY" | "ERROR";
  source: string;
  recordCount: number;
  lastError: string | null;
}

const records: OperationEvidenceRecord[] = [];
let storeFile: string | undefined;
let initializedRoot: string | undefined;
let initialization: Promise<void> | undefined;
let persistenceQueue = Promise.resolve();
let lastPersistenceError: string | null = null;
const MAX_RECORDS = 1_000;
const MAX_PROJECT_RECORDS = 200;

function boundedRedacted(label: string, value: unknown, limit: number) {
  const raw = typeof value === "string" ? value : value == null ? "" : String(value);
  return redactProjectText(`operation-evidence:${label}`, raw).content.slice(0, limit);
}

function isAction(value: unknown): value is LedgerAction {
  return typeof value === "string" && ["scan", "test", "build", "typecheck", "pull", "push", "runtime"].includes(value);
}

function sanitizeTransparency(value: unknown): LedgerTransparency | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const execution = source.execution;
  const network = source.network;
  const confirmation = source.confirmation;
  const result = source.result;
  if (!["LOCAL", "REMOTE", "HYBRID"].includes(String(execution))) return null;
  if (!["REQUIRED", "NOT_REQUIRED"].includes(String(network))) return null;
  if (!["NOT_REQUIRED", "REQUIRED", "CONFIRMED"].includes(String(confirmation))) return null;
  if (!["NOT_STARTED", "PENDING", "SUCCEEDED", "FAILED", "BLOCKED"].includes(String(result))) return null;
  return {
    execution: execution as LedgerTransparency["execution"],
    network: network as LedgerTransparency["network"],
    dataClasses: Array.isArray(source.dataClasses) ? source.dataClasses.filter((entry): entry is string => typeof entry === "string").slice(0, 12) : [],
    projectSourceSent: source.projectSourceSent === true,
    secretRedaction: true,
    provider: boundedRedacted("provider", source.provider, 500),
    destination: boundedRedacted("destination", source.destination, 1_000),
    purpose: boundedRedacted("purpose", source.purpose, 2_000),
    confirmation: confirmation as LedgerTransparency["confirmation"],
    startedAt: boundedRedacted("started-at", source.startedAt, 100),
    completedAt: typeof source.completedAt === "string" ? boundedRedacted("completed-at", source.completedAt, 100) : null,
    durationMs: typeof source.durationMs === "number" && Number.isFinite(source.durationMs) ? Math.max(0, source.durationMs) : null,
    result: result as LedgerResult,
    ...(typeof source.reason === "string" ? { reason: boundedRedacted("reason", source.reason, 2_000) } : {}),
  };
}

function validStoredRecord(value: unknown): value is OperationEvidenceRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<OperationEvidenceRecord>;
  return typeof record.id === "string" && typeof record.projectId === "string" && isAction(record.action) && typeof record.at === "string" && typeof record.message === "string" && record.persisted === true && Boolean(sanitizeTransparency(record.transparency));
}

async function persist() {
  if (!storeFile) return;
  persistenceQueue = persistenceQueue.then(async () => {
    const directory = path.dirname(storeFile!);
    await fs.mkdir(directory, { recursive: true });
    const temporary = `${storeFile}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, records }, null, 2), "utf8");
      await fs.rename(temporary, storeFile!);
      lastPersistenceError = null;
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }).catch((error: unknown) => {
    lastPersistenceError = error instanceof Error ? error.message : String(error);
  });
  await persistenceQueue;
}

export async function initializeOperationEvidenceStore(workspaceRoot: string) {
  const resolvedRoot = path.resolve(workspaceRoot);
  if (initializedRoot === resolvedRoot && initialization) return initialization;
  initializedRoot = resolvedRoot;
  initialization = (async () => {
    await persistenceQueue;
    records.splice(0, records.length);
    storeFile = path.join(resolvedRoot, ".kforge", "operation-evidence.json");
    const saved = await fs.readFile(storeFile, "utf8").then((text) => JSON.parse(text) as { records?: unknown[] }).catch(() => ({ records: [] }));
    for (const candidate of saved.records || []) {
      if (!validStoredRecord(candidate)) continue;
      const transparency = sanitizeTransparency(candidate.transparency);
      if (!transparency) continue;
      records.push({ ...candidate, message: boundedRedacted("message", candidate.message, 4_000), transparency });
      if (records.length >= MAX_RECORDS) break;
    }
    records.sort((left, right) => right.at.localeCompare(left.at));
    lastPersistenceError = null;
  })();
  return initialization;
}

export async function recordOperationEvidence(workspaceRoot: string, input: {
  projectId: string;
  action: unknown;
  ok: unknown;
  httpStatus: number;
  message: unknown;
  exitCode?: unknown;
  transparency: unknown;
}) {
  await initializeOperationEvidenceStore(workspaceRoot);
  if (!isAction(input.action)) return null;
  const transparency = sanitizeTransparency(input.transparency);
  if (!transparency) return null;
  const record: OperationEvidenceRecord = {
    id: randomUUID(),
    projectId: boundedRedacted("project-id", input.projectId, 2_000),
    action: input.action,
    at: transparency.completedAt || transparency.startedAt || new Date().toISOString(),
    ok: input.ok === true,
    httpStatus: Number.isInteger(input.httpStatus) ? input.httpStatus : 0,
    message: boundedRedacted("message", input.message, 4_000),
    exitCode: typeof input.exitCode === "number" && Number.isFinite(input.exitCode) ? input.exitCode : null,
    transparency,
    source: "workspace-action-response",
    persisted: true,
  };
  records.unshift(record);
  const projectRecords = records.filter((entry) => entry.projectId === record.projectId);
  if (projectRecords.length > MAX_PROJECT_RECORDS) {
    const keep = new Set(projectRecords.slice(0, MAX_PROJECT_RECORDS).map((entry) => entry.id));
    for (let index = records.length - 1; index >= 0; index -= 1) if (records[index].projectId === record.projectId && !keep.has(records[index].id)) records.splice(index, 1);
  }
  if (records.length > MAX_RECORDS) records.splice(MAX_RECORDS);
  await persist();
  return record;
}

export async function listOperationEvidence(workspaceRoot: string, projectId?: string) {
  await initializeOperationEvidenceStore(workspaceRoot);
  const selected = records.filter((entry) => !projectId || entry.projectId === projectId).slice(0, projectId ? MAX_PROJECT_RECORDS : MAX_RECORDS);
  return {
    records: selected,
    store: {
      state: lastPersistenceError ? "ERROR" : "READY",
      source: storeFile || path.join(path.resolve(workspaceRoot), ".kforge", "operation-evidence.json"),
      recordCount: selected.length,
      lastError: lastPersistenceError,
    } satisfies OperationEvidenceStoreStatus,
  };
}

export async function flushOperationEvidenceStore() {
  await persistenceQueue;
}

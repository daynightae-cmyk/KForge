import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { ProjectSummary, SelfAuditRecord, SelfAuditStageId, SelfAuditStageState } from "../../shared/workspace";
import { KFORGE_SELF_AUDIT_STAGES } from "../../shared/workspace";

const requiredIdentityFiles = [
  "client/pages/KForgeWorkspace.tsx",
  "server/routes/workspace.ts",
  "server/services/platformSettings.ts",
  "shared/workspace.ts",
] as const;

function safeProjectId(projectId: string) {
  return projectId.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function selfAuditEvidencePath(workspaceRoot: string, projectId: string) {
  return path.join(workspaceRoot, ".kforge", "self-audit", `${safeProjectId(projectId)}.json`);
}

export async function inspectKForgeIdentity(projectPath: string) {
  const present = await Promise.all(requiredIdentityFiles.map(async (relative) => {
    try { return (await fs.stat(path.join(projectPath, relative))).isFile() ? relative : null; }
    catch { return null; }
  }));
  const matchedFiles = present.filter((entry): entry is typeof requiredIdentityFiles[number] => Boolean(entry));
  return {
    matched: matchedFiles.length === requiredIdentityFiles.length,
    matchedFiles,
    missingFiles: requiredIdentityFiles.filter((relative) => !matchedFiles.includes(relative)),
    source: "KForge repository identity files",
  };
}

export function createSelfAuditRecord(project: ProjectSummary, workspaceRoot: string, instanceId: string): SelfAuditRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: randomUUID(),
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    status: "RUNNING",
    outcome: "PENDING",
    observational: true,
    sourceMutationDetected: false,
    evidenceFile: selfAuditEvidencePath(workspaceRoot, project.id),
    originInstanceId: instanceId,
    reloadedByInstanceId: null,
    stages: KFORGE_SELF_AUDIT_STAGES.map(([id, label]) => ({ id, label, state: "QUEUED", startedAt: null, completedAt: null, evidence: null })),
  };
}

export function recordSelfAuditStage(record: SelfAuditRecord, id: SelfAuditStageId, state: SelfAuditStageState, evidence: unknown, startedAt = new Date().toISOString()) {
  const stage = record.stages.find((entry) => entry.id === id);
  if (!stage) throw new Error(`Unknown Self Audit stage: ${id}`);
  stage.state = state;
  stage.startedAt = stage.startedAt || startedAt;
  stage.completedAt = state === "QUEUED" || state === "WAITING_RESTART" ? null : new Date().toISOString();
  stage.evidence = evidence;
  record.updatedAt = new Date().toISOString();
  return stage;
}

function validateRecord(value: unknown): SelfAuditRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<SelfAuditRecord>;
  if (record.schemaVersion !== 1 || typeof record.projectId !== "string" || typeof record.originInstanceId !== "string" || !Array.isArray(record.stages)) return null;
  const ids = record.stages.map((stage) => stage?.id);
  if (KFORGE_SELF_AUDIT_STAGES.some(([id], index) => ids[index] !== id)) return null;
  return record as SelfAuditRecord;
}

export async function persistSelfAuditRecord(record: SelfAuditRecord) {
  const directory = path.dirname(record.evidenceFile);
  await fs.mkdir(directory, { recursive: true });
  const temporary = `${record.evidenceFile}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await fs.rename(temporary, record.evidenceFile);
  return record;
}

function executionOutcome(record: SelfAuditRecord) {
  return record.stages.some((stage) => stage.state === "FAILED" || stage.state === "BLOCKED") ? "FAILED" as const : "PASSED" as const;
}

export async function markSelfAuditWaitingForRestart(record: SelfAuditRecord) {
  record.status = "WAITING_RESTART";
  record.outcome = executionOutcome(record);
  recordSelfAuditStage(record, "restart", "WAITING_RESTART", {
    state: "WAITING_RESTART",
    originInstanceId: record.originInstanceId,
    instruction: "Restart the KForge server process, then reload this evidence. A renderer refresh alone does not prove restart.",
  });
  recordSelfAuditStage(record, "reload-evidence", "QUEUED", {
    state: "QUEUED",
    source: record.evidenceFile,
    reason: "Reload can be verified only by a different KForge server instance.",
  });
  return persistSelfAuditRecord(record);
}

export async function readSelfAuditRecord(workspaceRoot: string, projectId: string, currentInstanceId: string): Promise<SelfAuditRecord | null> {
  const evidenceFile = selfAuditEvidencePath(workspaceRoot, projectId);
  let parsed: unknown;
  try { parsed = JSON.parse(await fs.readFile(evidenceFile, "utf8")); }
  catch { return null; }
  const record = validateRecord(parsed);
  if (!record || record.projectId !== projectId || path.resolve(record.evidenceFile) !== path.resolve(evidenceFile)) return null;
  if (record.status === "WAITING_RESTART" && record.originInstanceId !== currentInstanceId) {
    const now = new Date().toISOString();
    recordSelfAuditStage(record, "restart", "PASSED", {
      state: "PASSED",
      originInstanceId: record.originInstanceId,
      reloadedByInstanceId: currentInstanceId,
      verifiedAt: now,
      evidence: "The persisted record was loaded by a different KForge server instance.",
    });
    recordSelfAuditStage(record, "reload-evidence", "PASSED", {
      state: "PASSED",
      source: evidenceFile,
      verifiedAt: now,
      evidence: "The complete ordered Self Audit record was parsed from the atomic evidence file after restart.",
    });
    record.status = "COMPLETE";
    record.completedAt = now;
    record.reloadedByInstanceId = currentInstanceId;
    record.outcome = executionOutcome(record);
    await persistSelfAuditRecord(record);
  }
  return record;
}

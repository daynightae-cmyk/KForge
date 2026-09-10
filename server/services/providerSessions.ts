import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { ProjectProfile, ProjectSummary } from "../../shared/workspace";
import { getProviderSession, updateProviderSession, type ProviderSession } from "./providerCommandCenter";
import { createCredentialVault } from "./credentialVault";
import { getAdapter, type AdapterContext } from "./providerAdapters";
import { executeAgentTool, isAgentToolName, type ProjectToolHandlers } from "./agentTools";
import { createSnapshot, restoreSnapshot } from "./snapshots";
import { checkPreviewHealth, getPreviewStatus, restartPreview, startPreview } from "./previewRuntime";
import { evaluatePatchQuality, validateAndApplyPatch, type AgentPatch } from "./agent";

export type SessionEventKind =
  | "MODEL_TOKEN" | "MODEL_MESSAGE" | "TOOL_REQUEST" | "TOOL_STARTED" | "TOOL_FINISHED"
  | "FILE_READ" | "PATCH_PROPOSED" | "PATCH_APPLIED" | "COMMAND_STARTED" | "COMMAND_FINISHED"
  | "TEST_RESULT" | "BUILD_RESULT" | "PREVIEW_STATE" | "APPROVAL_REQUIRED" | "USAGE_UPDATE"
  | "ERROR" | "SESSION_STATE" | "SESSION_COMPLETED";

export interface SessionEvent {
  id: string;
  sessionId: string;
  kind: SessionEventKind;
  at: string;
  summary: string;
  data?: Record<string, unknown>;
}

export interface SessionPatch {
  id: string;
  file: string;
  before: string;
  after: string;
  added: number;
  removed: number;
  risk: AgentPatch["risk"];
  reason: string;
  state: "PROPOSED" | "ACCEPTED" | "REJECTED" | "APPLIED" | "ROLLED_BACK";
  createdAt: string;
}

export interface SessionRunDeps {
  workspaceRoot: string;
  session: ProviderSession;
  project: ProjectSummary;
  handlers: ProjectToolHandlers;
  profile: ProjectProfile;
  selectedFiles: string[];
  autonomy: string;
  startPreviewForSession: boolean;
}

interface Runner {
  controller: AbortController;
  startedAt: string;
}

const runners = new Map<string, Runner>();
const listeners = new Map<string, Set<(event: SessionEvent) => void>>();
const MAX_TOOL_ITERATIONS = 8;

function eventsPath(workspaceRoot: string, sessionId: string) {
  return path.join(workspaceRoot, ".kforge", `provider-session-events-${sessionId}.json`);
}

function patchesPath(workspaceRoot: string, sessionId: string) {
  return path.join(workspaceRoot, ".kforge", `provider-session-patches-${sessionId}.json`);
}

async function readJson<T>(target: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(target, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(target: string, value: unknown) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function sessionEvents(workspaceRoot: string, sessionId: string, since?: string): Promise<SessionEvent[]> {
  const all = await readJson<SessionEvent[]>(eventsPath(workspaceRoot, sessionId), []);
  if (!since) return all.slice(-200);
  const index = all.findIndex((entry) => entry.id === since);
  return (index >= 0 ? all.slice(index + 1) : all).slice(-200);
}

export async function sessionPatches(workspaceRoot: string, sessionId: string): Promise<SessionPatch[]> {
  return readJson<SessionPatch[]>(patchesPath(workspaceRoot, sessionId), []);
}

export function subscribeSession(sessionId: string, listener: (event: SessionEvent) => void): () => void {
  let scoped = listeners.get(sessionId);
  if (!scoped) {
    scoped = new Set();
    listeners.set(sessionId, scoped);
  }
  scoped.add(listener);
  return () => {
    scoped?.delete(listener);
  };
}

export async function emitSessionEvent(workspaceRoot: string, sessionId: string, kind: SessionEventKind, summary: string, data?: Record<string, unknown>): Promise<SessionEvent> {
  const event: SessionEvent = { id: randomUUID(), sessionId, kind, at: new Date().toISOString(), summary, data };
  const all = await readJson<SessionEvent[]>(eventsPath(workspaceRoot, sessionId), []);
  await writeJson(eventsPath(workspaceRoot, sessionId), [...all, event].slice(-500));
  listeners.get(sessionId)?.forEach((listener) => {
    try {
      listener(event);
    } catch {
      /* listener failures never break the session */
    }
  });
  return event;
}

function safeRelative(projectPath: string, relative: string): string | null {
  const resolved = path.resolve(projectPath, relative);
  const check = path.relative(projectPath, resolved);
  if (!relative || check.startsWith("..") || path.isAbsolute(check)) return null;
  return check.split(path.sep).join("/");
}

function diffStat(before: string, after: string): { added: number; removed: number } {
  const beforeLines = new Set(before.split("\n"));
  const afterLines = new Set(after.split("\n"));
  let added = 0;
  for (const line of afterLines) if (!beforeLines.has(line)) added += 1;
  let removed = 0;
  for (const line of beforeLines) if (!afterLines.has(line)) removed += 1;
  return { added, removed };
}

async function adapterContext(workspaceRoot: string, session: ProviderSession, providerBaseUrl: string, providerKind: string, organization: string | null, headerNames: string[], timeoutMs: number): Promise<AdapterContext> {
  const vault = createCredentialVault(workspaceRoot);
  const credential = (await vault.reveal(session.providerId)) || "";
  const customHeaders: Record<string, string> = {};
  for (const name of headerNames) {
    const value = await vault.reveal(`headers.${session.providerId}.${name.toLowerCase()}`);
    if (value) customHeaders[name] = value;
  }
  void providerKind;
  return { baseUrl: providerBaseUrl, credential, organization, customHeaders, timeoutMs };
}

function readToolName(call: { name: string }): string {
  return call.name.trim();
}

export async function startSessionRun(deps: SessionRunDeps & { providerBaseUrl: string; providerKind: string; organization: string | null; headerNames: string[]; timeoutMs: number }): Promise<ProviderSession> {
  const { workspaceRoot, session, project } = deps;
  if (runners.has(session.id)) throw new Error("Session is already running.");
  if (project.trust !== "trusted" && ["IMPLEMENT", "REFACTOR", "FULL_MISSION", "DEBUG", "TEST"].includes(session.mode)) {
    throw new Error("UNTRUSTED PROJECT: write-capable session modes require explicit project trust.");
  }
  const controller = new AbortController();
  runners.set(session.id, { controller, startedAt: new Date().toISOString() });
  void runSession(deps, controller).finally(() => {
    runners.delete(session.id);
  });
  return updateProviderSession(workspaceRoot, session.id, { status: "CONTEXT_PREPARING", error: null });
}

async function runSession(deps: SessionRunDeps & { providerBaseUrl: string; providerKind: string; organization: string | null; headerNames: string[]; timeoutMs: number }, controller: AbortController) {
  const { workspaceRoot, project, handlers } = deps;
  let session = await getProviderSession(workspaceRoot, deps.session.id);
  if (!session) return;
  const fail = async (message: string) => {
    await updateProviderSession(workspaceRoot, session.id, { status: "FAILED", error: message });
    await emitSessionEvent(workspaceRoot, session.id, "ERROR", message);
    await emitSessionEvent(workspaceRoot, session.id, "SESSION_STATE", "Session FAILED.", { status: "FAILED" });
  };
  try {
    const selected = deps.selectedFiles.map((file) => safeRelative(project.path, file)).filter((file): file is string => file !== null).slice(0, 40);
    await emitSessionEvent(workspaceRoot, session.id, "SESSION_STATE", `Context prepared: ${selected.length} file(s) in scope.`, { files: selected, scope: session.contextScope });
    if (session.cloudDisclosure && session.disclosureDestination !== session.providerId && session.disclosureDestination !== null) {
      await updateProviderSession(workspaceRoot, session.id, { status: "WAITING_FOR_DISCLOSURE" });
      await emitSessionEvent(workspaceRoot, session.id, "SESSION_STATE", "Waiting for fresh cloud disclosure confirmation after provider change.", { status: "WAITING_FOR_DISCLOSURE" });
      return;
    }
    session = (await getProviderSession(workspaceRoot, session.id)) || session;

    const ctx = await adapterContext(workspaceRoot, session, deps.providerBaseUrl, deps.providerKind, deps.organization, deps.headerNames, deps.timeoutMs);
    if (!ctx.credential && deps.providerKind !== "ollama" && deps.providerKind !== "lm-studio" && deps.providerKind !== "llama-cpp") {
      await fail("NOT_CONFIGURED: provider credential is missing.");
      return;
    }
    const adapter = getAdapter(deps.providerKind as Parameters<typeof getAdapter>[0]);

    const snapshotFiles = selected.length ? selected : ["package.json"];
    const snapshot = await createSnapshot(project.path, snapshotFiles, `Provider session ${session.id} checkpoint before mutation`);
    session = await updateProviderSession(workspaceRoot, session.id, { status: "PLANNING", checkpointId: snapshot.id });
    await emitSessionEvent(workspaceRoot, session.id, "SESSION_STATE", `Checkpoint ${snapshot.id} created before any mutation.`, { status: "PLANNING", checkpointId: snapshot.id });

    if (controller.signal.aborted) {
      await updateProviderSession(workspaceRoot, session.id, { status: "CANCELLED" });
      return;
    }
    const fileContents: string[] = [];
    for (const file of selected.slice(0, 12)) {
      try {
        const raw = await fs.readFile(path.join(project.path, file), "utf8");
        fileContents.push(`--- ${file} ---\n${raw.slice(0, 6_000)}`);
        await emitSessionEvent(workspaceRoot, session.id, "FILE_READ", `Read ${file} into bounded context.`, { file });
      } catch {
        /* unreadable files are excluded with provenance */
      }
    }
    const planPrompt = `Project: ${project.name} (${project.projectType}). Task: ${session.task}. Mode: ${session.mode}. Context files:\n${fileContents.join("\n").slice(0, 24_000)}\nRespond with a short numbered plan, then list any tool requests as tool calls.`;
    await emitSessionEvent(workspaceRoot, session.id, "MODEL_TOKEN", "Requesting plan from model…");
    const planStarted = Date.now();
    const plan = await adapter.createResponse(ctx, session.modelId, "You are an engineering assistant operating through KForge tools. Be concise.", planPrompt);
    session = await updateProviderSession(workspaceRoot, session.id, {
      telemetry: { ...session.telemetry, ttftMs: Date.now() - planStarted, latencyMs: (session.telemetry.latencyMs || 0) + (Date.now() - planStarted), inputTokens: (session.telemetry.inputTokens || 0) + (plan.usage.input || 0), outputTokens: (session.telemetry.outputTokens || 0) + (plan.usage.output || 0), totalTokens: (session.telemetry.totalTokens || 0) + (plan.usage.total || 0), providerRequestId: plan.requestId, finishReason: plan.finishReason },
    });
    await emitSessionEvent(workspaceRoot, session.id, "MODEL_MESSAGE", plan.text.slice(0, 4_000) || "(model returned tool calls only)", { requestId: plan.requestId });
    await emitSessionEvent(workspaceRoot, session.id, "USAGE_UPDATE", "Plan usage recorded.", { usage: plan.usage });

    const writeCapable = ["IMPLEMENT", "REFACTOR", "DEBUG", "TEST", "FULL_MISSION"].includes(session.mode);
    let iterations = 0;
    const pendingCalls = [...plan.toolCalls];
    session = await updateProviderSession(workspaceRoot, session.id, { status: "RUNNING" });
    while (pendingCalls.length > 0 && iterations < MAX_TOOL_ITERATIONS) {
      if (controller.signal.aborted) {
        await updateProviderSession(workspaceRoot, session.id, { status: "CANCELLED" });
        await emitSessionEvent(workspaceRoot, session.id, "SESSION_STATE", "Session CANCELLED by user. Queued model work stopped.", { status: "CANCELLED" });
        return;
      }
      iterations += 1;
      const call = pendingCalls.shift();
      if (!call) break;
      const toolName = readToolName(call);
      await emitSessionEvent(workspaceRoot, session.id, "TOOL_REQUEST", `Model requested tool: ${toolName}.`, { tool: toolName });
      if (toolName === "propose_patch") {
        const args = call.arguments;
        const file = typeof args.file === "string" ? safeRelative(project.path, args.file) : null;
        const newText = typeof args.newText === "string" ? args.newText : null;
        if (!file || newText === null) {
          await emitSessionEvent(workspaceRoot, session.id, "ERROR", "Rejected malformed patch proposal (missing file/newText).");
          continue;
        }
        const before = await fs.readFile(path.join(project.path, file), "utf8").catch(() => "");
        const quality = await evaluatePatchQuality(project.path, { id: randomUUID(), file, oldText: before, newText, reason: typeof args.reason === "string" ? args.reason : session.task, confidence: "medium", risk: "review", verification: [] });
        void quality;
        const stat = diffStat(before, newText);
        const patches = await sessionPatches(workspaceRoot, session.id);
        const record: SessionPatch = { id: randomUUID(), file, before, after: newText, added: stat.added, removed: stat.removed, risk: "review", reason: typeof args.reason === "string" ? args.reason : session.task, state: "PROPOSED", createdAt: new Date().toISOString() };
        await writeJson(patchesPath(workspaceRoot, session.id), [...patches, record].slice(-100));
        session = await updateProviderSession(workspaceRoot, session.id, { status: "WAITING_FOR_APPROVAL", pendingApproval: { id: record.id, kind: "patch", summary: `${file} (+${stat.added}/-${stat.removed})`, createdAt: record.createdAt } });
        await emitSessionEvent(workspaceRoot, session.id, "PATCH_PROPOSED", `Patch proposed for ${file} (+${stat.added}/-${stat.removed}). Awaiting approval.`, { patchId: record.id, file });
        await emitSessionEvent(workspaceRoot, session.id, "APPROVAL_REQUIRED", `Approval required: apply patch to ${file}?`, { patchId: record.id });
        if (deps.autonomy === "SAFE IMPLEMENTATION" || deps.autonomy === "FULL PROJECT MISSION") {
          // Approvals still gate by default; auto-apply only when the caller already approved this patch id.
          return;
        }
        return;
      }
      if (!isAgentToolName(toolName)) {
        await emitSessionEvent(workspaceRoot, session.id, "ERROR", `Unknown tool requested: ${toolName}. Only registered KForge tools are available.`);
        continue;
      }
      if (["git_commit"].includes(toolName)) {
        await emitSessionEvent(workspaceRoot, session.id, "APPROVAL_REQUIRED", `Approval required: ${toolName} is never auto-executed.`, { tool: toolName });
        session = await updateProviderSession(workspaceRoot, session.id, { status: "WAITING_FOR_APPROVAL", pendingApproval: { id: randomUUID(), kind: "tool", summary: toolName, createdAt: new Date().toISOString() } });
        return;
      }
      session = await updateProviderSession(workspaceRoot, session.id, { status: "TOOL_EXECUTING", telemetry: { ...session.telemetry, toolCalls: session.telemetry.toolCalls + 1 } });
      await emitSessionEvent(workspaceRoot, session.id, "TOOL_STARTED", `Executing ${toolName} through KForge authority.`, { tool: toolName });
      try {
        const args = (call.arguments || {}) as Record<string, unknown>;
        const result = await executeAgentTool(project.path, handlers, toolName, args);
        await emitSessionEvent(workspaceRoot, session.id, "TOOL_FINISHED", result.ok ? `${toolName} completed.` : `${toolName} failed: ${result.message}`, { tool: toolName, ok: result.ok });
        if ((toolName === "test" || toolName === "build") && result.ok === false && session.telemetry.retries < 2) {
          session = await updateProviderSession(workspaceRoot, session.id, { telemetry: { ...session.telemetry, retries: session.telemetry.retries + 1 } });
          const fix = await adapter.createResponse(ctx, session.modelId, "You fix engineering failures concisely.", `The ${toolName} step failed with bounded evidence:\n${JSON.stringify(result.output || result.message).slice(0, 4_000)}\nPropose next tool actions as tool calls.`);
          pendingCalls.push(...fix.toolCalls);
          await emitSessionEvent(workspaceRoot, session.id, "MODEL_MESSAGE", fix.text.slice(0, 2_000) || "(model returned tool calls only)");
        }
      } catch (error: unknown) {
        await emitSessionEvent(workspaceRoot, session.id, "ERROR", `${toolName} execution failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    session = (await getProviderSession(workspaceRoot, session.id)) || session;
    if (session.status === "WAITING_FOR_APPROVAL") return;
    if (writeCapable && ["IMPLEMENT", "TEST", "FULL_MISSION"].includes(session.mode)) {
      session = await updateProviderSession(workspaceRoot, session.id, { status: "VERIFYING" });
      await emitSessionEvent(workspaceRoot, session.id, "SESSION_STATE", "Running verification (typecheck/test/build) through detected project commands.", { status: "VERIFYING" });
      for (const step of ["typecheck", "test", "build"] as const) {
        if (controller.signal.aborted) break;
        await emitSessionEvent(workspaceRoot, session.id, "COMMAND_STARTED", `Verification step: ${step}.`, { command: step });
        try {
          const result = await executeAgentTool(project.path, handlers, step, {});
          await emitSessionEvent(workspaceRoot, session.id, step === "test" ? "TEST_RESULT" : step === "build" ? "BUILD_RESULT" : "COMMAND_FINISHED", `${step}: ${result.ok ? "PASS" : "FAIL"}`, { command: step, ok: result.ok });
          session = await updateProviderSession(workspaceRoot, session.id, { telemetry: { ...session.telemetry, testState: step === "test" ? (result.ok ? "PASS" : "FAIL") : session.telemetry.testState, buildState: step === "build" ? (result.ok ? "PASS" : "FAIL") : session.telemetry.buildState } });
        } catch (error: unknown) {
          await emitSessionEvent(workspaceRoot, session.id, "ERROR", `${step} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    session = (await getProviderSession(workspaceRoot, session.id)) || session;
    if (deps.startPreviewForSession && (deps.profile.commands.runtime || deps.profile.commands.production)) {
      session = await updateProviderSession(workspaceRoot, session.id, { status: "PREVIEW_STARTING" });
      await emitSessionEvent(workspaceRoot, session.id, "PREVIEW_STATE", "Starting canonical Preview runtime for this session.", { status: "PREVIEW_STARTING" });
      try {
        const launched = await startPreview(session.projectId || project.id, project.path, deps.profile);
        const health = await checkPreviewHealth(session.projectId || project.id);
        session = await updateProviderSession(workspaceRoot, session.id, { status: "PREVIEWING", previewSessionId: launched.sessionId || null, telemetry: { ...session.telemetry, previewState: health.state } });
        await emitSessionEvent(workspaceRoot, session.id, "PREVIEW_STATE", `Preview ${health.state} at ${launched.url || "unknown URL"}.`, { status: health.state, url: launched.url, port: launched.port, pid: launched.pid, previewSessionId: launched.sessionId });
      } catch (error: unknown) {
        await emitSessionEvent(workspaceRoot, session.id, "ERROR", `Preview launch failed: ${error instanceof Error ? error.message : String(error)}`);
        session = await updateProviderSession(workspaceRoot, session.id, { status: "VERIFYING", telemetry: { ...session.telemetry, previewState: "unavailable" } });
      }
    }

    session = await updateProviderSession(workspaceRoot, session.id, { status: "COMPLETED", pendingApproval: null });
    await emitSessionEvent(workspaceRoot, session.id, "SESSION_COMPLETED", "Session COMPLETED with auditable evidence.", { status: "COMPLETED" });
  } catch (error: unknown) {
    await fail(error instanceof Error ? error.message : "Session execution failed.");
  }
}

export async function cancelSessionRun(workspaceRoot: string, sessionId: string, stopOwnedRuntime: boolean): Promise<ProviderSession> {
  const runner = runners.get(sessionId);
  if (runner) runner.controller.abort();
  const session = await getProviderSession(workspaceRoot, sessionId);
  if (!session) throw new Error("Session not found.");
  if (stopOwnedRuntime && session.projectId) {
    const status = getPreviewStatus(session.projectId);
    if (session.previewSessionId && status.sessionId === session.previewSessionId) {
      const { stopPreview } = await import("./previewRuntime");
      stopPreview(session.projectId);
      await emitSessionEvent(workspaceRoot, sessionId, "PREVIEW_STATE", "Session-owned Preview stopped at explicit user request.", { status: "STOPPED" });
    } else {
      await emitSessionEvent(workspaceRoot, sessionId, "PREVIEW_STATE", "Preview left running: it is not owned by this session.", { status: "NOT_OWNED" });
    }
  }
  const next = await updateProviderSession(workspaceRoot, sessionId, { status: "CANCELLED", pendingApproval: null });
  await emitSessionEvent(workspaceRoot, sessionId, "SESSION_STATE", "Session CANCELLED. Streaming aborted; queued model work will not dispatch.", { status: "CANCELLED" });
  return next;
}

export async function approveSessionAction(workspaceRoot: string, sessionId: string, approvalId: string, projectPath: string): Promise<ProviderSession> {
  const session = await getProviderSession(workspaceRoot, sessionId);
  if (!session) throw new Error("Session not found.");
  if (!session.pendingApproval || session.pendingApproval.id !== approvalId) throw new Error("Approval is stale or unknown.");
  const patches = await sessionPatches(workspaceRoot, sessionId);
  const patch = patches.find((entry) => entry.id === approvalId);
  if (patch) {
    await validateAndApplyPatch(projectPath, { id: patch.id, file: patch.file, oldText: patch.before, newText: patch.after, reason: patch.reason, confidence: "medium", risk: patch.risk, verification: [] });
    await writeJson(patchesPath(workspaceRoot, sessionId), patches.map((entry) => (entry.id === approvalId ? { ...entry, state: "APPLIED" as const } : entry)));
    await emitSessionEvent(workspaceRoot, sessionId, "PATCH_APPLIED", `Patch applied to ${patch.file} after explicit approval.`, { patchId: patch.id, file: patch.file });
    const applied = await sessionPatches(workspaceRoot, sessionId);
    const changed = applied.filter((entry) => entry.state === "APPLIED").length;
    return updateProviderSession(workspaceRoot, sessionId, { status: "RUNNING", pendingApproval: null, telemetry: { ...session.telemetry, filesChanged: changed } });
  }
  await emitSessionEvent(workspaceRoot, sessionId, "APPROVAL_REQUIRED", `Tool approval ${approvalId} confirmed; dispatch remains operator-driven.`, { approvalId });
  return updateProviderSession(workspaceRoot, sessionId, { status: "RUNNING", pendingApproval: null });
}

export async function rejectSessionAction(workspaceRoot: string, sessionId: string, approvalId: string): Promise<ProviderSession> {
  const session = await getProviderSession(workspaceRoot, sessionId);
  if (!session) throw new Error("Session not found.");
  const patches = await sessionPatches(workspaceRoot, sessionId);
  await writeJson(patchesPath(workspaceRoot, sessionId), patches.map((entry) => (entry.id === approvalId ? { ...entry, state: "REJECTED" as const } : entry)));
  await emitSessionEvent(workspaceRoot, sessionId, "SESSION_STATE", `Proposal ${approvalId} rejected; no files changed.`, { approvalId });
  return updateProviderSession(workspaceRoot, sessionId, { status: "RUNNING", pendingApproval: null });
}

export async function rollbackSession(workspaceRoot: string, sessionId: string, projectPath: string): Promise<ProviderSession> {
  const session = await getProviderSession(workspaceRoot, sessionId);
  if (!session) throw new Error("Session not found.");
  if (!session.checkpointId) throw new Error("No checkpoint exists for this session; nothing to roll back.");
  await restoreSnapshot(projectPath, session.checkpointId);
  const patches = await sessionPatches(workspaceRoot, sessionId);
  await writeJson(patchesPath(workspaceRoot, sessionId), patches.map((entry) => (entry.state === "APPLIED" ? { ...entry, state: "ROLLED_BACK" as const } : entry)));
  await emitSessionEvent(workspaceRoot, sessionId, "SESSION_STATE", `Rolled back to checkpoint ${session.checkpointId}.`, { checkpointId: session.checkpointId });
  return updateProviderSession(workspaceRoot, sessionId, { status: "ROLLED_BACK", pendingApproval: null });
}

export async function switchSessionModel(workspaceRoot: string, sessionId: string, providerId: string, modelId: string, disclosureConfirmed: boolean, destination: string): Promise<ProviderSession> {
  const session = await getProviderSession(workspaceRoot, sessionId);
  if (!session) throw new Error("Session not found.");
  if (runners.has(sessionId)) throw new Error("Stop or wait for the running session before switching models.");
  const destinationChanged = session.disclosureDestination !== null && session.disclosureDestination !== destination;
  if (destinationChanged && disclosureConfirmed !== true) {
    await updateProviderSession(workspaceRoot, sessionId, { status: "WAITING_FOR_DISCLOSURE" });
    throw new Error("Fresh cloud disclosure confirmation is required: the destination changed.");
  }
  await emitSessionEvent(workspaceRoot, sessionId, "SESSION_STATE", `Model switched from ${session.providerId}/${session.modelId} to ${providerId}/${modelId}. Context and checkpoint preserved.`, { from: `${session.providerId}/${session.modelId}`, to: `${providerId}/${modelId}` });
  return updateProviderSession(workspaceRoot, sessionId, { providerId, modelId, status: "READY", disclosureConfirmed: disclosureConfirmed || session.disclosureConfirmed, disclosureDestination: destination, pendingApproval: null, error: null });
}

export async function applySessionPatch(workspaceRoot: string, sessionId: string, patchId: string, projectPath: string): Promise<SessionPatch> {
  const patches = await sessionPatches(workspaceRoot, sessionId);
  const patch = patches.find((entry) => entry.id === patchId);
  if (!patch) throw new Error("Patch not found.");
  if (patch.state === "APPLIED") return patch;
  await validateAndApplyPatch(projectPath, { id: patch.id, file: patch.file, oldText: patch.before, newText: patch.after, reason: patch.reason, confidence: "medium", risk: patch.risk, verification: [] });
  const next = { ...patch, state: "APPLIED" as const };
  await writeJson(patchesPath(workspaceRoot, sessionId), patches.map((entry) => (entry.id === patchId ? next : entry)));
  await emitSessionEvent(workspaceRoot, sessionId, "PATCH_APPLIED", `Patch applied to ${patch.file}.`, { patchId, file: patch.file });
  return next;
}

export { checkPreviewHealth, restartPreview, startPreview };

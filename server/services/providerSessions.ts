import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { AgentPatch } from "./agent";
import { validateAndApplyPatch } from "./agent";
import { createSnapshot, restoreSnapshot } from "./snapshots";
import { getAdapter, type AdapterContext, type AdapterMessage, type AdapterToolDefinition } from "./providerAdapters";
import { getProviderSession, updateProviderSession, type ProviderRuntimeConfig } from "./providerCommandCenter";
import type {
  ProviderSessionEvent,
  ProviderSessionEventType,
  ProviderSessionPatch,
  ProviderSessionSummary,
} from "../../shared/providerCommandCenter";

export interface SessionProject {
  id: string;
  name: string;
  path: string;
  branch: string;
  trust: "trusted" | "untrusted";
}

export interface SessionContextPayload {
  project: { id: string; name: string; path: string; branch: string };
  task: string;
  model: string;
  provider: string;
  destination: string;
  filesIncluded: Array<{ path: string; reason: string; characters: number; content?: string }>;
  filesExcluded?: Array<{ path: string; reason: string }>;
  totalCharacters: number;
  estimatedTokens: number;
  diagnostics: unknown[];
  git: unknown;
  technology: string[];
  disclosureConfirmed: boolean;
  sourceCodeIncluded: boolean;
}

export interface SessionToolResult {
  ok: boolean;
  tool: string;
  output: unknown;
  message: string;
  permission?: string;
}

export interface SessionRuntimeHandlers {
  executeTool(name: string, input?: Record<string, unknown>): Promise<SessionToolResult>;
  startPreview(): Promise<unknown>;
  restartPreview(): Promise<unknown>;
  previewStatus(): Promise<unknown> | unknown;
  stopPreview(): Promise<unknown>;
}

export interface StartSessionInput {
  workspaceRoot: string;
  session: ProviderSessionSummary;
  project: SessionProject;
  context: SessionContextPayload;
  adapterContext: AdapterContext;
  providerConfig: ProviderRuntimeConfig;
  handlers: SessionRuntimeHandlers;
  autonomy?: string;
  startPreviewForSession?: boolean;
}

interface SessionRun {
  abort: AbortController;
  promise: Promise<void>;
  stopPreview: () => Promise<unknown>;
  ownsPreview: boolean;
}

const activeRuns = new Map<string, SessionRun>();
const listeners = new Map<string, Set<(event: ProviderSessionEvent) => void>>();

function eventPath(root: string, sessionId: string) {
  return path.join(root, ".kforge", "provider-session-events", `${sessionId}.json`);
}

function patchPath(root: string, sessionId: string) {
  return path.join(root, ".kforge", "provider-session-patches", `${sessionId}.json`);
}

async function readJson<T>(target: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(target, "utf8")) as T; } catch { return fallback; }
}

async function writeJson(target: string, value: unknown) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function safeSessionText(value: string, secrets: string[] = []) {
  let result = value;
  for (const secret of secrets.filter((entry) => entry.length >= 8)) result = result.split(secret).join("[REDACTED]");
  return result.slice(0, 32_000);
}

function safeEventData(value: Record<string, unknown> | undefined, secrets: string[] = []) {
  if (!value) return undefined;
  let text = JSON.stringify(value);
  for (const secret of secrets.filter((entry) => entry.length >= 8)) text = text.split(secret).join("[REDACTED]");
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { state: "UNAVAILABLE", reason: "Event data could not be serialized safely." }; }
}

export async function emitSessionEvent(root: string, sessionId: string, type: ProviderSessionEventType, message: string, data?: Record<string, unknown>, secrets: string[] = []) {
  const event: ProviderSessionEvent = {
    id: randomUUID(),
    sessionId,
    type,
    at: new Date().toISOString(),
    message: safeSessionText(message, secrets),
    ...(data ? { data: safeEventData(data, secrets) } : {}),
  };
  const current = await readJson<{ events: ProviderSessionEvent[] }>(eventPath(root, sessionId), { events: [] });
  current.events = [...current.events, event].slice(-600);
  await writeJson(eventPath(root, sessionId), current);
  for (const listener of listeners.get(sessionId) || []) {
    try { listener(event); } catch { /* disconnected listener cleanup belongs to its owner */ }
  }
  return event;
}

export async function sessionEvents(root: string, sessionId: string, since?: string) {
  const events = (await readJson<{ events: ProviderSessionEvent[] }>(eventPath(root, sessionId), { events: [] })).events;
  return since ? events.filter((event) => event.at > since) : events;
}

export function subscribeSession(sessionId: string, listener: (event: ProviderSessionEvent) => void) {
  let set = listeners.get(sessionId);
  if (!set) { set = new Set(); listeners.set(sessionId, set); }
  set.add(listener);
  return () => {
    const current = listeners.get(sessionId);
    current?.delete(listener);
    if (current?.size === 0) listeners.delete(sessionId);
  };
}

export async function sessionPatches(root: string, sessionId: string) {
  return (await readJson<{ patches: ProviderSessionPatch[] }>(patchPath(root, sessionId), { patches: [] })).patches;
}

async function savePatch(root: string, patch: ProviderSessionPatch) {
  const store = await readJson<{ patches: ProviderSessionPatch[] }>(patchPath(root, patch.sessionId), { patches: [] });
  store.patches = [patch, ...store.patches.filter((entry) => entry.id !== patch.id)].slice(0, 200);
  await writeJson(patchPath(root, patch.sessionId), store);
  return patch;
}

async function proposePatch(root: string, sessionId: string, args: Record<string, unknown>): Promise<ProviderSessionPatch> {
  const file = typeof args.file === "string" ? args.file.trim() : "";
  const oldText = typeof args.oldText === "string" ? args.oldText : "";
  const newText = typeof args.newText === "string" ? args.newText : "";
  const reason = typeof args.reason === "string" ? args.reason.trim().slice(0, 2_000) : "AI-proposed project change.";
  const risk = args.risk === "approval" || args.risk === "review" || args.risk === "blocked" ? args.risk : "safe";
  if (!file || path.isAbsolute(file) || file.includes("\0") || file.split(/[\\/]/).includes("..")) throw new Error("Patch file must be a safe project-relative path.");
  if (!oldText || !newText || oldText === newText) throw new Error("Patch must contain distinct non-empty oldText and newText values.");
  if (oldText.length > 80_000 || newText.length > 120_000) throw new Error("Patch exceeds the bounded edit size.");
  const patch: ProviderSessionPatch = { id: randomUUID(), sessionId, file: file.replace(/\\/g, "/"), oldText, newText, reason, risk, state: "PROPOSED", createdAt: new Date().toISOString(), appliedAt: null };
  return savePatch(root, patch);
}

async function ensureCheckpoint(root: string, session: ProviderSessionSummary, projectPath: string) {
  if (session.checkpointId) return session.checkpointId;
  const patches = await sessionPatches(root, session.id);
  const files = [...new Set(patches.filter((patch) => patch.state === "PROPOSED").map((patch) => patch.file))];
  if (!files.length) throw new Error("No proposed project files are available for a checkpoint.");
  const snapshot = await createSnapshot(projectPath, files, `KForge provider session ${session.id} pre-mutation checkpoint`);
  await updateProviderSession(root, session.id, { checkpointId: snapshot.id });
  await emitSessionEvent(root, session.id, "MODEL_MESSAGE", `Checkpoint ${snapshot.id} created before project mutation.`, { checkpointId: snapshot.id, files });
  return snapshot.id;
}

export async function applySessionPatch(root: string, sessionId: string, patchId: string, projectPath: string) {
  const session = await getProviderSession(root, sessionId);
  if (!session) throw new Error("Session not found.");
  const patch = (await sessionPatches(root, sessionId)).find((entry) => entry.id === patchId);
  if (!patch) throw new Error("Session patch not found.");
  if (patch.state !== "PROPOSED") throw new Error(`Patch is already ${patch.state}.`);
  if (patch.risk === "blocked") throw new Error("Blocked patches cannot be applied.");
  await ensureCheckpoint(root, session, projectPath);
  await updateProviderSession(root, sessionId, { status: "APPLYING" });
  const agentPatch: AgentPatch = { id: patch.id, file: patch.file, oldText: patch.oldText, newText: patch.newText, reason: patch.reason, confidence: "medium", risk: patch.risk, verification: ["typecheck", "test", "build", "preview"] };
  const applied = await validateAndApplyPatch(projectPath, agentPatch);
  const next = await savePatch(root, { ...patch, state: "APPLIED", appliedAt: new Date().toISOString() });
  const latest = await getProviderSession(root, sessionId);
  await updateProviderSession(root, sessionId, { status: "RUNNING", telemetry: { ...(latest?.telemetry || session.telemetry), filesChanged: (latest?.telemetry.filesChanged || 0) + 1 } });
  await emitSessionEvent(root, sessionId, "PATCH_APPLIED", `Applied ${patch.file} through the canonical KForge patch quality gate.`, { patchId, file: patch.file, qualityGate: applied.qualityGate });
  return next;
}

export async function rollbackSession(root: string, sessionId: string, projectPath: string) {
  const session = await getProviderSession(root, sessionId);
  if (!session) throw new Error("Session not found.");
  if (!session.checkpointId) throw new Error("No checkpoint exists for this session; rollback cannot be claimed.");
  await restoreSnapshot(projectPath, session.checkpointId);
  const store = await readJson<{ patches: ProviderSessionPatch[] }>(patchPath(root, sessionId), { patches: [] });
  store.patches = store.patches.map((patch) => patch.state === "APPLIED" ? { ...patch, state: "ROLLED_BACK" as const } : patch);
  await writeJson(patchPath(root, sessionId), store);
  const next = await updateProviderSession(root, sessionId, { status: "ROLLED_BACK", error: null, pendingApproval: null });
  await emitSessionEvent(root, sessionId, "MODEL_MESSAGE", `Restored checkpoint ${session.checkpointId}.`, { checkpointId: session.checkpointId });
  return next;
}

function toolSchemas(): AdapterToolDefinition[] {
  return [
    { name: "list_files", description: "List bounded project files in a project-relative directory.", inputSchema: { type: "object", properties: { directory: { type: "string" } }, additionalProperties: false } },
    { name: "read_file", description: "Read one bounded project-relative text file.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } },
    { name: "search_files", description: "Search bounded project files for a literal query.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } },
    { name: "inspect_file", description: "Inspect one project file with bounded metadata and preview.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } },
    { name: "git_status", description: "Read local Git status.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "git_diff", description: "Read local Git diff statistics/evidence.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "typecheck", description: "Run the detected project typecheck command through KForge.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "test", description: "Run the detected project tests through KForge.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "build", description: "Run the detected project build through KForge.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "scan", description: "Run KForge project scanning and diagnostics.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "start_preview", description: "Start the canonical KForge Preview runtime after verification when authorized.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "propose_patch", description: "Propose one exact oldText/newText replacement. This does not directly write. KForge creates a checkpoint and applies only under the active authority policy.", inputSchema: { type: "object", properties: { file: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" }, reason: { type: "string" }, risk: { type: "string", enum: ["safe", "review", "approval", "blocked"] } }, required: ["file", "oldText", "newText", "reason"], additionalProperties: false } },
  ];
}

function autonomyAllowsTool(autonomy: string, tool: string) {
  if (autonomy === "CHAT ONLY") return false;
  if (autonomy === "READ ONLY") return ["list_files", "read_file", "search_files", "inspect_file", "git_status", "git_diff"].includes(tool);
  if (autonomy === "REVIEW") return ["list_files", "read_file", "search_files", "inspect_file", "git_status", "git_diff", "scan"].includes(tool);
  return true;
}

function contextPrompt(context: SessionContextPayload) {
  const boundedFiles = context.filesIncluded.map((file) => ({ path: file.path, reason: file.reason, characters: file.characters, ...(file.content !== undefined ? { content: file.content } : {}) }));
  return JSON.stringify({ project: context.project, task: context.task, model: context.model, provider: context.provider, destination: context.destination, filesIncluded: boundedFiles, filesExcluded: context.filesExcluded || [], estimatedTokens: context.estimatedTokens, diagnostics: context.diagnostics, git: context.git, technology: context.technology });
}

function systemPrompt(autonomy: string) {
  return [
    "You are KNOuX Forge Engineering Agent operating inside a bounded tool-authority system.",
    `Autonomy: ${autonomy}.`,
    "Never claim a file changed, command passed, Preview started, or tool executed unless a KForge tool result proves it.",
    "Use registered tools instead of inventing shell execution.",
    "To modify a file, call propose_patch with exact oldText/newText. Do not output a patch and claim it was applied.",
    "Prefer reading relevant files before proposing changes. Keep iterations bounded and evidence-driven.",
    "If a KForge result reports UNAVAILABLE/BLOCKED/FAILED, preserve that truth and adapt the plan.",
  ].join("\n");
}

function appendToolResult(messages: AdapterMessage[], tool: string, result: unknown) {
  messages.push({ role: "user", content: `KFORGE TOOL RESULT (${tool}):\n${JSON.stringify(result).slice(0, 40_000)}\nContinue from this measured result. Do not claim anything beyond it.` });
}

async function executeToolCall(input: StartSessionInput, toolName: string, args: Record<string, unknown>, secrets: string[]) {
  const { workspaceRoot, session, project, handlers } = input;
  const autonomy = input.autonomy || session.autonomy;
  if (!autonomyAllowsTool(autonomy, toolName)) {
    const result = { ok: false, tool: toolName, output: null, message: `Tool ${toolName} is blocked by autonomy level ${autonomy}.` };
    await emitSessionEvent(workspaceRoot, session.id, "TOOL_FINISHED", result.message, result, secrets);
    return result;
  }
  await emitSessionEvent(workspaceRoot, session.id, "TOOL_REQUEST", `Model requested ${toolName}.`, { tool: toolName, input: args }, secrets);
  await emitSessionEvent(workspaceRoot, session.id, "TOOL_STARTED", `Executing ${toolName} through KForge authority.`, { tool: toolName }, secrets);
  await updateProviderSession(workspaceRoot, session.id, { status: "TOOL_EXECUTING" });

  if (toolName === "propose_patch") {
    const patch = await proposePatch(workspaceRoot, session.id, args);
    await emitSessionEvent(workspaceRoot, session.id, "PATCH_PROPOSED", `Patch proposed for ${patch.file}.`, { patchId: patch.id, file: patch.file, risk: patch.risk, reason: patch.reason }, secrets);
    const autoApply = autonomy === "FULL PROJECT MISSION" && patch.risk === "safe";
    if (autoApply) {
      const applied = await applySessionPatch(workspaceRoot, session.id, patch.id, project.path);
      const result = { ok: true, tool: toolName, output: { patch: applied, autoApplied: true }, message: `Safe patch ${patch.id} applied under FULL PROJECT MISSION authority.` };
      await emitSessionEvent(workspaceRoot, session.id, "TOOL_FINISHED", result.message, result, secrets);
      return result;
    }
    const approval = { id: randomUUID(), kind: "patch", summary: `Apply ${patch.file} (${patch.risk})`, createdAt: new Date().toISOString() };
    await updateProviderSession(workspaceRoot, session.id, { status: "WAITING_FOR_APPROVAL", pendingApproval: approval });
    await emitSessionEvent(workspaceRoot, session.id, "APPROVAL_REQUIRED", `Approval required before applying ${patch.file}.`, { approvalId: approval.id, patchId: patch.id, file: patch.file, risk: patch.risk }, secrets);
    return { ok: true, tool: toolName, output: { patch, approvalRequired: true, approvalId: approval.id }, message: "Patch recorded; execution is waiting for explicit approval." };
  }

  if (toolName === "start_preview") {
    const preview = await handlers.startPreview();
    const latest = (await getProviderSession(workspaceRoot, session.id)) || session;
    await updateProviderSession(workspaceRoot, session.id, { status: "PREVIEWING", previewSessionId: session.id, telemetry: { ...latest.telemetry, previewState: "STARTED", toolCalls: latest.telemetry.toolCalls + 1 } });
    const result = { ok: true, tool: toolName, output: preview, message: "Canonical Preview start requested." };
    await emitSessionEvent(workspaceRoot, session.id, "PREVIEW_STATE", result.message, { preview }, secrets);
    await emitSessionEvent(workspaceRoot, session.id, "TOOL_FINISHED", result.message, result, secrets);
    return result;
  }

  const result = await handlers.executeTool(toolName, args);
  const eventType: ProviderSessionEventType = toolName === "test" ? "TEST_RESULT" : toolName === "build" ? "BUILD_RESULT" : toolName === "read_file" || toolName === "inspect_file" ? "FILE_READ" : "TOOL_FINISHED";
  const latest = (await getProviderSession(workspaceRoot, session.id)) || session;
  const telemetry = { ...latest.telemetry, toolCalls: latest.telemetry.toolCalls + 1 };
  if (toolName === "test") telemetry.testState = result.ok ? "PASS" : "FAIL";
  if (toolName === "build") telemetry.buildState = result.ok ? "PASS" : "FAIL";
  await updateProviderSession(workspaceRoot, session.id, { status: "RUNNING", telemetry });
  await emitSessionEvent(workspaceRoot, session.id, eventType, result.message || `${toolName} completed.`, { tool: toolName, ok: result.ok, output: result.output }, secrets);
  if (eventType !== "TOOL_FINISHED") await emitSessionEvent(workspaceRoot, session.id, "TOOL_FINISHED", `${toolName} finished.`, { tool: toolName, ok: result.ok }, secrets);
  return result;
}

async function verificationPass(input: StartSessionInput, messages: AdapterMessage[], secrets: string[]) {
  const session = (await getProviderSession(input.workspaceRoot, input.session.id)) || input.session;
  const applied = (await sessionPatches(input.workspaceRoot, session.id)).some((patch) => patch.state === "APPLIED");
  if (!applied) return true;
  await updateProviderSession(input.workspaceRoot, session.id, { status: "VERIFYING" });
  let hardFailure = false;
  for (const tool of ["typecheck", "test", "build"]) {
    await emitSessionEvent(input.workspaceRoot, session.id, "COMMAND_STARTED", `Verification: ${tool}.`, { tool }, secrets);
    const result = await input.handlers.executeTool(tool, {});
    const unavailable = !result.ok && /unavailable|not detected|no .* command/i.test(result.message || "");
    if (!result.ok && !unavailable) hardFailure = true;
    const eventType: ProviderSessionEventType = tool === "test" ? "TEST_RESULT" : tool === "build" ? "BUILD_RESULT" : "COMMAND_FINISHED";
    await emitSessionEvent(input.workspaceRoot, session.id, eventType, `Verification ${tool}: ${result.ok ? "PASS" : unavailable ? "UNAVAILABLE" : "FAIL"}.`, { tool, ok: result.ok, unavailable, output: result.output }, secrets);
    appendToolResult(messages, `verification:${tool}`, { ok: result.ok, unavailable, message: result.message, output: result.output });
    const latest = (await getProviderSession(input.workspaceRoot, session.id)) || session;
    const telemetry = { ...latest.telemetry };
    if (tool === "test") telemetry.testState = result.ok ? "PASS" : unavailable ? "UNAVAILABLE" : "FAIL";
    if (tool === "build") telemetry.buildState = result.ok ? "PASS" : unavailable ? "UNAVAILABLE" : "FAIL";
    await updateProviderSession(input.workspaceRoot, session.id, { telemetry });
    if (hardFailure) break;
  }
  return !hardFailure;
}

async function runSession(input: StartSessionInput, abort: AbortController) {
  const { workspaceRoot, session, project, context, adapterContext, providerConfig, handlers } = input;
  const secrets = [adapterContext.credential, ...Object.values(adapterContext.customHeaders || {})].filter(Boolean);
  const autonomy = input.autonomy || session.autonomy;
  try {
    if (project.trust !== "trusted") throw new Error("UNTRUSTED PROJECT: AI engineering execution requires explicit project trust.");
    if (session.cloudDisclosure && !session.disclosureConfirmed) {
      await updateProviderSession(workspaceRoot, session.id, { status: "WAITING_FOR_DISCLOSURE" });
      throw new Error("Cloud disclosure confirmation is required before project context is transmitted.");
    }
    const adapter = getAdapter(providerConfig.kind);
    const validation = await adapter.validateConfiguration(adapterContext);
    if (!validation.ok) throw new Error(validation.reason);
    await updateProviderSession(workspaceRoot, session.id, { status: "CONTEXT_PREPARING", autonomy, error: null });
    await emitSessionEvent(workspaceRoot, session.id, "MODEL_MESSAGE", `Context prepared: ${context.filesIncluded.length} file(s), estimated ${context.estimatedTokens} tokens.`, { fileCount: context.filesIncluded.length, estimatedTokens: context.estimatedTokens, destination: context.destination, sourceCodeIncluded: context.sourceCodeIncluded }, secrets);
    await updateProviderSession(workspaceRoot, session.id, { status: "PLANNING" });

    const messages: AdapterMessage[] = [
      { role: "system", content: systemPrompt(autonomy) },
      { role: "user", content: `Engineering task:\n${session.task}\n\nKForge bounded context:\n${contextPrompt(context)}` },
    ];
    const tools = toolSchemas().filter((tool) => autonomyAllowsTool(autonomy, tool.name));
    let repairLoops = 0;
    let firstTokenAt: number | null = null;
    const startedAt = Date.now();
    const maxIterations = 10;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      if (abort.signal.aborted) throw new DOMException("Session cancelled.", "AbortError");
      await updateProviderSession(workspaceRoot, session.id, { status: "RUNNING" });
      const calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
      let modelText = "";
      let finishReason: string | null = null;
      let requestId: string | null = null;
      for await (const event of adapter.streamResponse(adapterContext, { model: session.modelId, messages, tools, maxOutputTokens: 2_048, signal: abort.signal })) {
        if (abort.signal.aborted) throw new DOMException("Session cancelled.", "AbortError");
        if (event.type === "delta") {
          if (firstTokenAt === null) firstTokenAt = Date.now();
          modelText += event.text;
          await emitSessionEvent(workspaceRoot, session.id, "MODEL_TOKEN", event.text, undefined, secrets);
        } else if (event.type === "tool_call") calls.push(event.toolCall);
        else if (event.type === "usage") {
          const latest = (await getProviderSession(workspaceRoot, session.id)) || session;
          const telemetry = { ...latest.telemetry, inputTokens: event.usage.input, outputTokens: event.usage.output, totalTokens: event.usage.total, reasoningTokens: event.usage.reasoning, cachedTokens: event.usage.cached, costSource: "UNKNOWN" as const };
          await updateProviderSession(workspaceRoot, session.id, { telemetry });
          await emitSessionEvent(workspaceRoot, session.id, "USAGE_UPDATE", "Provider usage evidence updated.", { usage: event.usage }, secrets);
        } else if (event.type === "done") { finishReason = event.finishReason; requestId = event.requestId; }
        else if (event.type === "error") throw new Error(`${event.errorKind}: ${event.detail}`);
      }
      if (modelText.trim()) {
        messages.push({ role: "assistant", content: modelText });
        await emitSessionEvent(workspaceRoot, session.id, "MODEL_MESSAGE", modelText, { iteration }, secrets);
      }
      const latest = (await getProviderSession(workspaceRoot, session.id)) || session;
      await updateProviderSession(workspaceRoot, session.id, { telemetry: { ...latest.telemetry, ttftMs: firstTokenAt === null ? latest.telemetry.ttftMs : firstTokenAt - startedAt, latencyMs: Date.now() - startedAt, providerRequestId: requestId || latest.telemetry.providerRequestId, finishReason: finishReason || latest.telemetry.finishReason } });

      if (!calls.length) {
        const verified = await verificationPass(input, messages, secrets);
        if (!verified && repairLoops < 2) {
          repairLoops += 1;
          const now = (await getProviderSession(workspaceRoot, session.id)) || session;
          await updateProviderSession(workspaceRoot, session.id, { status: "RUNNING", telemetry: { ...now.telemetry, retries: now.telemetry.retries + 1 } });
          messages.push({ role: "user", content: "KForge verification failed. Use the measured verification results above to inspect and propose a bounded correction. Do not repeat an unchanged patch." });
          continue;
        }
        if (!verified) throw new Error("Verification failed after the bounded repair loop.");
        if (input.startPreviewForSession) {
          await updateProviderSession(workspaceRoot, session.id, { status: "PREVIEW_STARTING" });
          const preview = await handlers.startPreview();
          await emitSessionEvent(workspaceRoot, session.id, "PREVIEW_STATE", "Canonical Preview start requested after verification.", { preview }, secrets);
          const previewEvidence = await handlers.previewStatus();
          const now = (await getProviderSession(workspaceRoot, session.id)) || session;
          await updateProviderSession(workspaceRoot, session.id, { status: "PREVIEWING", previewSessionId: session.id, telemetry: { ...now.telemetry, previewState: JSON.stringify(previewEvidence).slice(0, 400) } });
        }
        const final = (await getProviderSession(workspaceRoot, session.id)) || session;
        await updateProviderSession(workspaceRoot, session.id, { status: "COMPLETED", pendingApproval: null, error: null, telemetry: { ...final.telemetry, latencyMs: Date.now() - startedAt } });
        await emitSessionEvent(workspaceRoot, session.id, "SESSION_COMPLETED", "AI engineering session completed with KForge evidence.", { iterations: iteration + 1, repairLoops }, secrets);
        return;
      }

      for (const call of calls) {
        const result = await executeToolCall(input, call.name, call.arguments, secrets);
        appendToolResult(messages, call.name, result);
        const current = await getProviderSession(workspaceRoot, session.id);
        if (current?.status === "WAITING_FOR_APPROVAL") return;
      }
    }
    throw new Error("AI engineering session reached the bounded iteration limit before completion.");
  } catch (error: unknown) {
    const cancelled = abort.signal.aborted || (error instanceof Error && error.name === "AbortError");
    const message = cancelled ? "Session cancelled." : error instanceof Error ? error.message : "Session failed.";
    const current = await getProviderSession(workspaceRoot, session.id);
    if (current?.status !== "WAITING_FOR_APPROVAL") await updateProviderSession(workspaceRoot, session.id, { status: cancelled ? "CANCELLED" : "FAILED", error: message });
    await emitSessionEvent(workspaceRoot, session.id, cancelled ? "MODEL_MESSAGE" : "ERROR", message, undefined, secrets);
  } finally {
    activeRuns.delete(session.id);
  }
}

export async function startSessionRun(input: StartSessionInput) {
  if (activeRuns.has(input.session.id)) throw new Error("Session is already running.");
  if (["COMPLETED", "CANCELLED", "ROLLED_BACK"].includes(input.session.status)) throw new Error(`Session cannot start from ${input.session.status}.`);
  const abort = new AbortController();
  const next = await updateProviderSession(input.workspaceRoot, input.session.id, { status: "CONTEXT_PREPARING", autonomy: input.autonomy || input.session.autonomy, error: null });
  const promise = runSession({ ...input, session: next }, abort);
  activeRuns.set(input.session.id, { abort, promise, stopPreview: input.handlers.stopPreview, ownsPreview: Boolean(input.startPreviewForSession) });
  void promise;
  return next;
}

export async function cancelSessionRun(root: string, sessionId: string, stopOwnedRuntime = false) {
  const session = await getProviderSession(root, sessionId);
  if (!session) throw new Error("Session not found.");
  const run = activeRuns.get(sessionId);
  run?.abort.abort();
  if (stopOwnedRuntime && run?.ownsPreview) await run.stopPreview().catch(() => undefined);
  const next = await updateProviderSession(root, sessionId, { status: "CANCELLED", pendingApproval: null, error: "Cancelled by operator." });
  await emitSessionEvent(root, sessionId, "MODEL_MESSAGE", "Session cancelled by operator.", { stoppedOwnedPreview: stopOwnedRuntime && Boolean(run?.ownsPreview) });
  return next;
}

export async function approveSessionAction(root: string, sessionId: string, approvalId: string, projectPath: string) {
  const session = await getProviderSession(root, sessionId);
  if (!session) throw new Error("Session not found.");
  if (!session.pendingApproval || session.pendingApproval.id !== approvalId) throw new Error("Pending approval does not match this request.");
  if (session.pendingApproval.kind !== "patch") throw new Error("Unsupported approval kind.");
  const patch = (await sessionPatches(root, sessionId)).find((entry) => entry.state === "PROPOSED");
  if (!patch) throw new Error("No proposed patch remains for this approval.");
  await applySessionPatch(root, sessionId, patch.id, projectPath);
  const next = await updateProviderSession(root, sessionId, { status: "READY", pendingApproval: null, error: null });
  await emitSessionEvent(root, sessionId, "MODEL_MESSAGE", `Approval ${approvalId} accepted. Patch ${patch.id} applied; resume the session to continue verification/model work.`, { approvalId, patchId: patch.id });
  return next;
}

export async function rejectSessionAction(root: string, sessionId: string, approvalId: string) {
  const session = await getProviderSession(root, sessionId);
  if (!session) throw new Error("Session not found.");
  if (!session.pendingApproval || session.pendingApproval.id !== approvalId) throw new Error("Pending approval does not match this request.");
  const patch = (await sessionPatches(root, sessionId)).find((entry) => entry.state === "PROPOSED");
  if (patch) await savePatch(root, { ...patch, state: "REJECTED" });
  const next = await updateProviderSession(root, sessionId, { status: "READY", pendingApproval: null, error: null });
  await emitSessionEvent(root, sessionId, "MODEL_MESSAGE", `Approval ${approvalId} rejected. No project mutation occurred.`, { approvalId, patchId: patch?.id || null });
  return next;
}

export async function switchSessionModel(root: string, sessionId: string, providerId: string, modelId: string, disclosureConfirmed: boolean, destination: string) {
  const session = await getProviderSession(root, sessionId);
  if (!session) throw new Error("Session not found.");
  if (activeRuns.has(sessionId)) throw new Error("Cancel or wait for the active model request before switching models.");
  if (!providerId.trim() || !modelId.trim()) throw new Error("Provider and model are required.");
  const boundaryChanged = providerId !== session.providerId || destination !== session.disclosureDestination;
  const destinationIsLocal = /^local\b|127\.0\.0\.1|localhost/i.test(destination);
  if (boundaryChanged && !destinationIsLocal && disclosureConfirmed !== true) throw new Error("Fresh cloud disclosure confirmation is required because the model destination changed.");
  const next = await updateProviderSession(root, sessionId, { providerId, modelId, disclosureDestination: destination, disclosureConfirmed: destinationIsLocal ? true : disclosureConfirmed, cloudDisclosure: !destinationIsLocal, status: "READY", error: null });
  await emitSessionEvent(root, sessionId, "MODEL_MESSAGE", `Model switched from ${session.providerId}/${session.modelId} to ${providerId}/${modelId}.`, { from: { providerId: session.providerId, modelId: session.modelId }, to: { providerId, modelId }, destination, disclosureConfirmed: next.disclosureConfirmed });
  return next;
}

export function isSessionRunning(sessionId: string) {
  return activeRuns.has(sessionId);
}

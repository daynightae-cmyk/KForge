import { Router } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { promises as fs } from "fs";
import {
  createProviderSession,
  deleteProviderKey,
  discoverProviderModels,
  getProviderSession,
  listDiscoveredModels,
  listProviderSessions,
  listProviderSummaries,
  providerAdapterContext,
  providerRuntimeConfig,
  refreshProviderModels,
  replaceProviderKey,
  revealProviderKey,
  testProviderConnection,
  upsertCustomProvider,
} from "../services/providerCommandCenter";
import { createCredentialVault, migrateLegacyPlaintextSecrets } from "../services/credentialVault";
import {
  approveSessionAction,
  cancelSessionRun,
  emitSessionEvent,
  rejectSessionAction,
  rollbackSession,
  sessionEvents,
  sessionPatches,
  applySessionPatch,
  startSessionRun,
  subscribeSession,
  switchSessionModel,
  type SessionContextPayload,
  type SessionRuntimeHandlers,
} from "../services/providerSessions";
import { buildAgentContext } from "../services/agent";
import { executeAgentTool, isAgentToolName, type ProjectToolHandlers } from "../services/agentTools";
import { getPreviewStatus, restartPreview, startPreview, stopPreviewAndWait } from "../services/previewRuntime";
import { analyzeImpact, buildProjectGraph } from "../services/projectGraph";
import { candidateProjectPaths, detectProjectProfile, executeProjectAction, makeProjectSummary, scanProject } from "./workspace";

const execFileAsync = promisify(execFile);
const router = Router();

function getWorkspaceRoot() {
  return path.resolve(process.env.KFORGE_WORKSPACE_ROOT || path.resolve(process.cwd(), ".."));
}

async function resolveProject(id: string) {
  for (const candidate of await candidateProjectPaths(getWorkspaceRoot())) {
    try {
      const project = await makeProjectSummary(candidate);
      if (project.id === id) return project;
    } catch {
      /* inaccessible candidates are ignored exactly as normal workspace discovery does */
    }
  }
  return null;
}

async function fixedGit(projectPath: string, args: string[]) {
  try {
    const result = await execFileAsync("git", args, { cwd: projectPath, shell: false, windowsHide: true, timeout: 15_000, maxBuffer: 1_500_000 });
    return { ok: true, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
  } catch (error: unknown) {
    const detail = error as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: `${detail.stdout || ""}${detail.stderr || detail.message || "Git command failed."}`.trim().slice(0, 200_000) };
  }
}

function unavailable(label: string) {
  return async () => ({ ok: false, state: "UNAVAILABLE", message: `${label} is not registered for autonomous execution in this session.` });
}

function projectToolHandlers(project: Awaited<ReturnType<typeof makeProjectSummary>>): ProjectToolHandlers {
  return {
    typecheck: () => executeProjectAction(project, "typecheck"),
    lint: unavailable("Lint execution"),
    test: () => executeProjectAction(project, "test"),
    build: () => executeProjectAction(project, "build"),
    start: () => executeProjectAction(project, "runtime"),
    health: async () => (await scanProject(project)).health,
    logs: unavailable("General task-log export"),
    gitStatus: () => fixedGit(project.path, ["status", "--porcelain=v1", "--branch"]),
    gitDiff: () => fixedGit(project.path, ["diff", "--stat", "--", "."]),
    scan: () => scanProject(project),
    sonar: unavailable("Sonar execution"),
    graph: () => buildProjectGraph(project.path),
    dependencyAudit: unavailable("Dependency audit"),
  };
}

async function safeSelectedContext(projectPath: string, selectedFiles: string[]) {
  const realRoot = await fs.realpath(projectPath);
  const files: Array<{ path: string; reason: string; characters: number; content: string }> = [];
  for (const requested of selectedFiles.slice(0, 40)) {
    if (!requested || path.isAbsolute(requested) || requested.includes("\0") || requested.split(/[\\/]/).includes("..")) continue;
    const lexical = path.resolve(projectPath, requested);
    const real = await fs.realpath(lexical).catch(() => "");
    if (!real) continue;
    const relative = path.relative(realRoot, real);
    if (!relative || path.isAbsolute(relative) || relative.startsWith("..")) continue;
    const stat = await fs.stat(real).catch(() => null);
    if (!stat?.isFile() || stat.size > 200_000) continue;
    const raw = await fs.readFile(real, "utf8").catch(() => "");
    if (!raw) continue;
    const content = raw.slice(0, 24_000)
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
      .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?)[^"'\s,;}]+/gi, "$1[REDACTED]");
    files.push({ path: relative.split(path.sep).join("/"), reason: "operator-selected", characters: content.length, content });
  }
  return files;
}

async function buildSessionContext(sessionId: string, selectedFiles: string[] = []): Promise<SessionContextPayload> {
  const root = getWorkspaceRoot();
  const session = await getProviderSession(root, sessionId);
  if (!session) throw new Error("Session not found.");
  if (!session.projectId) throw new Error("Session has no project context.");
  const project = await resolveProject(session.projectId);
  if (!project) throw new Error("Project for this session is no longer available.");
  const scan = await scanProject(project);
  const bounded = await buildAgentContext(project, scan);
  const selected = await safeSelectedContext(project.path, selectedFiles);
  const selectedSet = new Set(selected.map((file) => file.path));
  const files = [
    ...selected,
    ...bounded.files.filter((file) => !selectedSet.has(file.path)).map((file) => ({ path: file.path, reason: file.reason, characters: file.content.length, content: file.content })),
  ].slice(0, 40);
  const totalCharacters = files.reduce((total, file) => total + file.content.length, 0);
  return {
    project: { id: project.id, name: project.name, path: project.path, branch: project.branch },
    task: session.task,
    model: session.modelId,
    provider: session.providerId,
    destination: session.disclosureDestination || "local runtime",
    filesIncluded: files,
    filesExcluded: [],
    totalCharacters,
    estimatedTokens: Math.ceil(totalCharacters / 4),
    diagnostics: bounded.diagnostics,
    git: bounded.git,
    technology: bounded.technology,
    disclosureConfirmed: session.disclosureConfirmed,
    sourceCodeIncluded: files.length > 0,
  };
}

function runtimeHandlers(project: Awaited<ReturnType<typeof makeProjectSummary>>, profile: Awaited<ReturnType<typeof detectProjectProfile>>): SessionRuntimeHandlers {
  const toolHandlers = projectToolHandlers(project);
  return {
    async executeTool(name, input = {}) {
      if (!isAgentToolName(name)) return { ok: false, tool: name, output: null, message: `Tool ${name} is not a registered KForge agent tool.` };
      return executeAgentTool(project.path, toolHandlers, name, input);
    },
    startPreview: () => startPreview(project.id, project.path, profile),
    restartPreview: () => restartPreview(project.id, project.path, profile),
    previewStatus: () => getPreviewStatus(project.id),
    stopPreview: () => stopPreviewAndWait(project.id),
  };
}

router.get("/ai/command-center/providers", async (_req, res) => {
  res.json({ providers: await listProviderSummaries(getWorkspaceRoot()) });
});

router.post("/ai/command-center/providers", async (req, res) => {
  const body = (req.body || {}) as Record<string, unknown>;
  try {
    const result = await upsertCustomProvider(getWorkspaceRoot(), {
      name: typeof body.name === "string" ? body.name : "",
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : "",
      apiKey: typeof body.apiKey === "string" ? body.apiKey : "",
      organization: typeof body.organization === "string" ? body.organization : undefined,
      customHeaders: typeof body.customHeaders === "object" && body.customHeaders !== null ? body.customHeaders as Record<string, string> : {},
      timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : 30_000,
      streaming: body.streaming !== false,
      modelsEndpoint: typeof body.modelsEndpoint === "string" ? body.modelsEndpoint : undefined,
      chatEndpoint: typeof body.chatEndpoint === "string" ? body.chatEndpoint : undefined,
    });
    return res.status(201).json(result);
  } catch (error: unknown) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Provider registration failed." });
  }
});

router.post("/ai/command-center/providers/:providerId/key", async (req, res) => {
  try {
    const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey : "";
    return res.json({ provider: await replaceProviderKey(getWorkspaceRoot(), req.params.providerId, apiKey) });
  } catch (error: unknown) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Credential replacement failed." });
  }
});

router.delete("/ai/command-center/providers/:providerId/key", async (req, res) => {
  try {
    return res.json({ provider: await deleteProviderKey(getWorkspaceRoot(), req.params.providerId, req.body?.confirmed === true) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Credential deletion failed.";
    return res.status(message.includes("confirmation") ? 428 : 400).json({ error: message, permission: "ask" });
  }
});

router.post("/ai/command-center/providers/:providerId/reveal", async (req, res) => {
  try {
    return res.json(await revealProviderKey(getWorkspaceRoot(), req.params.providerId, req.body?.confirmed === true));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Reveal failed.";
    return res.status(message.includes("confirmation") ? 428 : 404).json({ error: message, permission: "ask" });
  }
});

router.post("/ai/command-center/providers/:providerId/discover", async (req, res) => {
  try {
    return res.json(await discoverProviderModels(getWorkspaceRoot(), req.params.providerId));
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "Discovery failed.";
    const kind = (error as { errorKind?: string }).errorKind;
    return res.status(detail.startsWith("NOT_CONFIGURED") ? 428 : 502).json({ error: detail, errorKind: kind || "PROVIDER_ERROR" });
  }
});

router.post("/ai/command-center/providers/:providerId/refresh", async (req, res) => {
  try {
    return res.json(await refreshProviderModels(getWorkspaceRoot(), req.params.providerId));
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "Refresh failed.";
    return res.status(detail.startsWith("NOT_CONFIGURED") ? 428 : 502).json({ error: detail });
  }
});

router.get("/ai/command-center/providers/:providerId/models", async (req, res) => {
  res.json({ models: await listDiscoveredModels(getWorkspaceRoot(), req.params.providerId) });
});

router.post("/ai/command-center/providers/:providerId/test", async (req, res) => {
  const kind = typeof req.body?.kind === "string" ? req.body.kind as "connection" | "model" | "stream" | "tools" : "connection";
  const modelId = typeof req.body?.modelId === "string" ? req.body.modelId : null;
  try {
    return res.json(await testProviderConnection(getWorkspaceRoot(), req.params.providerId, kind, modelId));
  } catch (error: unknown) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Provider test failed." });
  }
});

router.get("/ai/command-center/vault", async (_req, res) => {
  const root = getWorkspaceRoot();
  const vault = createCredentialVault(root);
  const migration = await migrateLegacyPlaintextSecrets(root).catch(() => ({ outcome: "MIGRATION_FAILED", migrated: 0, detail: "Migration status unavailable." }));
  res.json({ availability: await vault.availability(), backend: await vault.backend(), migration });
});

router.post("/ai/command-center/vault/migrate", async (_req, res) => {
  const result = await migrateLegacyPlaintextSecrets(getWorkspaceRoot());
  res.status(result.outcome === "MIGRATION_FAILED" ? 500 : result.outcome === "MIGRATION_BLOCKED" ? 409 : 200).json(result);
});

router.get("/ai/command-center/sessions", async (_req, res) => {
  res.json({ sessions: await listProviderSessions(getWorkspaceRoot()) });
});

router.post("/ai/command-center/sessions", async (req, res) => {
  const body = (req.body || {}) as Record<string, unknown>;
  try {
    const session = await createProviderSession(getWorkspaceRoot(), {
      projectId: typeof body.projectId === "string" ? body.projectId : null,
      providerId: typeof body.providerId === "string" ? body.providerId : "",
      modelId: typeof body.modelId === "string" ? body.modelId : "",
      mode: (typeof body.mode === "string" ? body.mode : "ASK") as "ASK" | "PLAN" | "IMPLEMENT" | "REVIEW" | "DEBUG" | "TEST" | "REFACTOR" | "SECURITY_AUDIT" | "FULL_MISSION",
      task: typeof body.task === "string" ? body.task : "",
      contextScope: typeof body.contextScope === "string" ? body.contextScope : "Repository",
      disclosureConfirmed: body.disclosureConfirmed === true,
      autonomy: typeof body.autonomy === "string" ? body.autonomy : undefined,
    });
    return res.status(201).json({ session });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Session creation failed.";
    return res.status(message.includes("disclosure") ? 428 : 400).json({ error: message, permission: message.includes("disclosure") ? "ask" : undefined });
  }
});

router.get("/ai/command-center/sessions/:sessionId", async (req, res) => {
  const session = await getProviderSession(getWorkspaceRoot(), req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Session not found." });
  return res.json({ session });
});

router.get("/ai/command-center/sessions/:sessionId/events", async (req, res) => {
  const root = getWorkspaceRoot();
  const session = await getProviderSession(root, req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Session not found." });
  if (req.headers.accept?.includes("text/event-stream")) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    for (const event of (await sessionEvents(root, session.id)).slice(-50)) res.write(`data: ${JSON.stringify(event)}\n\n`);
    const unsubscribe = subscribeSession(session.id, (event) => {
      try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* close handler owns cleanup */ }
    });
    const heartbeat = setInterval(() => { try { res.write(": keepalive\n\n"); } catch { /* close handler owns cleanup */ } }, 15_000);
    req.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
    return;
  }
  return res.json({ events: await sessionEvents(root, session.id, typeof req.query.since === "string" ? req.query.since : undefined) });
});

router.get("/ai/command-center/sessions/:sessionId/patches", async (req, res) => {
  const session = await getProviderSession(getWorkspaceRoot(), req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Session not found." });
  return res.json({ patches: await sessionPatches(getWorkspaceRoot(), session.id) });
});

router.get("/ai/command-center/sessions/:sessionId/context", async (req, res) => {
  try {
    const selectedFiles = typeof req.query.files === "string" ? req.query.files.split(",").map((value) => value.trim()).filter(Boolean) : [];
    const context = await buildSessionContext(req.params.sessionId, selectedFiles);
    return res.json({ context: { ...context, filesIncluded: context.filesIncluded.map(({ content: _content, ...file }) => file) } });
  } catch (error: unknown) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Context inspection failed." });
  }
});

router.post("/ai/command-center/sessions/:sessionId/start", async (req, res) => {
  const root = getWorkspaceRoot();
  const session = await getProviderSession(root, req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Session not found." });
  if (!session.projectId) return res.status(400).json({ error: "Session has no project context." });
  const project = await resolveProject(session.projectId);
  if (!project) return res.status(404).json({ error: "Project for this session is no longer available." });
  if (project.trust !== "trusted") return res.status(428).json({ error: "UNTRUSTED PROJECT: AI engineering execution requires explicit project trust.", permission: "ask" });
  try {
    const selectedFiles = Array.isArray(req.body?.selectedFiles) ? req.body.selectedFiles.filter((entry: unknown): entry is string => typeof entry === "string").slice(0, 40) : [];
    const [adapter, config, profile, context] = await Promise.all([
      providerAdapterContext(root, session.providerId),
      providerRuntimeConfig(root, session.providerId),
      detectProjectProfile(project),
      buildSessionContext(session.id, selectedFiles),
    ]);
    const started = await startSessionRun({
      workspaceRoot: root,
      session,
      project,
      context,
      adapterContext: adapter.ctx,
      providerConfig: config,
      handlers: runtimeHandlers(project, profile),
      autonomy: typeof req.body?.autonomy === "string" ? req.body.autonomy : session.autonomy,
      startPreviewForSession: req.body?.startPreview === true,
    });
    return res.status(202).json({ session: started });
  } catch (error: unknown) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Session start failed." });
  }
});

router.post("/ai/command-center/sessions/:sessionId/cancel", async (req, res) => {
  try {
    return res.json({ session: await cancelSessionRun(getWorkspaceRoot(), req.params.sessionId, req.body?.stopOwnedRuntime === true) });
  } catch (error: unknown) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Session cancel failed." });
  }
});

router.post("/ai/command-center/sessions/:sessionId/approve", async (req, res) => {
  const root = getWorkspaceRoot();
  const session = await getProviderSession(root, req.params.sessionId);
  if (!session?.projectId) return res.status(404).json({ error: "Session project not found." });
  const project = await resolveProject(session.projectId);
  if (!project) return res.status(404).json({ error: "Project for this session is no longer available." });
  if (project.trust !== "trusted") return res.status(428).json({ error: "UNTRUSTED PROJECT: patch approval requires project trust.", permission: "ask" });
  try {
    const approvalId = typeof req.body?.approvalId === "string" ? req.body.approvalId : "";
    return res.json({ session: await approveSessionAction(root, session.id, approvalId, project.path) });
  } catch (error: unknown) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Approval failed." });
  }
});

router.post("/ai/command-center/sessions/:sessionId/reject", async (req, res) => {
  try {
    const approvalId = typeof req.body?.approvalId === "string" ? req.body.approvalId : "";
    return res.json({ session: await rejectSessionAction(getWorkspaceRoot(), req.params.sessionId, approvalId) });
  } catch (error: unknown) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Rejection failed." });
  }
});

router.post("/ai/command-center/sessions/:sessionId/patches/:patchId/apply", async (req, res) => {
  const root = getWorkspaceRoot();
  const session = await getProviderSession(root, req.params.sessionId);
  if (!session?.projectId) return res.status(404).json({ error: "Session project not found." });
  const project = await resolveProject(session.projectId);
  if (!project) return res.status(404).json({ error: "Project for this session is no longer available." });
  if (project.trust !== "trusted") return res.status(428).json({ error: "UNTRUSTED PROJECT: patch apply requires explicit project trust.", permission: "ask" });
  try {
    return res.json({ patch: await applySessionPatch(root, session.id, req.params.patchId, project.path) });
  } catch (error: unknown) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Patch apply failed." });
  }
});

router.post("/ai/command-center/sessions/:sessionId/rollback", async (req, res) => {
  const root = getWorkspaceRoot();
  const session = await getProviderSession(root, req.params.sessionId);
  if (!session?.projectId) return res.status(404).json({ error: "Session project not found." });
  const project = await resolveProject(session.projectId);
  if (!project) return res.status(404).json({ error: "Project for this session is no longer available." });
  if (req.body?.confirmed !== true) return res.status(428).json({ error: "Rollback restores the session checkpoint and requires explicit confirmation.", permission: "ask" });
  try {
    return res.json({ session: await rollbackSession(root, session.id, project.path) });
  } catch (error: unknown) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Rollback failed." });
  }
});

router.post("/ai/command-center/sessions/:sessionId/switch", async (req, res) => {
  const root = getWorkspaceRoot();
  const providerId = typeof req.body?.providerId === "string" ? req.body.providerId : "";
  const modelId = typeof req.body?.modelId === "string" ? req.body.modelId : "";
  try {
    const config = await providerRuntimeConfig(root, providerId);
    const destination = config.type === "local" ? "local runtime" : config.baseUrl;
    return res.json({ session: await switchSessionModel(root, req.params.sessionId, providerId, modelId, req.body?.disclosureConfirmed === true, destination) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Model switch failed.";
    return res.status(message.includes("disclosure") ? 428 : 400).json({ error: message, permission: message.includes("disclosure") ? "ask" : undefined });
  }
});

router.post("/ai/command-center/sessions/:sessionId/note", async (req, res) => {
  const session = await getProviderSession(getWorkspaceRoot(), req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Session not found." });
  const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 2_000) : "";
  if (!text) return res.status(400).json({ error: "Note text is required." });
  await emitSessionEvent(getWorkspaceRoot(), session.id, "MODEL_MESSAGE", `Operator note: ${text}`, { operator: true });
  return res.status(201).json({ ok: true });
});

export default router;

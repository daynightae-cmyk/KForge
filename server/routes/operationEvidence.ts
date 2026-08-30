import { Router } from "express";
import path from "path";
import { initializeOperationEvidenceStore, listOperationEvidence, recordOperationEvidence } from "../services/operationEvidence";

const router = Router();

function workspaceRoot() {
  return path.resolve(process.env.KFORGE_WORKSPACE_ROOT || path.resolve(process.cwd(), ".."));
}

void initializeOperationEvidenceStore(workspaceRoot());

router.get("/projects/:id/execution-ledger", async (req, res) => {
  const evidence = await listOperationEvidence(workspaceRoot(), req.params.id);
  return res.json({ projectId: req.params.id, ...evidence });
});

router.use((req, res, next) => {
  if (req.method !== "POST") return next();
  const match = req.path.match(/^\/projects\/([^/]+)\/actions$/);
  if (!match) return next();
  const projectId = decodeURIComponent(match[1]);
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (!body || typeof body !== "object" || Array.isArray(body)) return originalJson(body);
    const payload = body as Record<string, unknown>;
    if (typeof payload.action !== "string" || !payload.transparency || typeof payload.transparency !== "object") return originalJson(body);
    void recordOperationEvidence(workspaceRoot(), {
      projectId,
      action: payload.action,
      ok: payload.ok,
      httpStatus: res.statusCode,
      message: payload.message,
      exitCode: payload.exitCode,
      transparency: payload.transparency,
    }).then(() => originalJson(body));
    return res;
  }) as typeof res.json;
  return next();
});

export default router;

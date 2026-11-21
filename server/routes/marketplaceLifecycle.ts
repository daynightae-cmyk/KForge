import { Router } from "express";
import path from "path";
import { z } from "zod";
import {
  healthCheckPackage,
  installPackage,
  runInstalledPackage,
  uninstallPackage,
} from "../services/marketplace";
import { updatePackageSafely } from "../services/marketplaceLifecycleSafe";
import { startTask, type TaskKind } from "../services/tasks";

const router = Router();
const confirmationSchema = z.object({ confirmed: z.literal(true) }).strict();
const lifecycleQueues = new Map<string, Promise<void>>();

function workspaceRoot() {
  return path.resolve(process.env.KFORGE_WORKSPACE_ROOT || path.resolve(process.cwd(), ".."));
}

function withLifecycleLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const key = path.resolve(root);
  const previous = lifecycleQueues.get(key) || Promise.resolve();
  const run = previous.then(operation);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  lifecycleQueues.set(key, tail);
  return run.finally(() => {
    if (lifecycleQueues.get(key) === tail) lifecycleQueues.delete(key);
  });
}

type LifecycleOutcome = { status: number; body: unknown; ok: boolean; message: string };

// Online / Downloads promises "the history of package operations KForge
// actually performed". Every confirmed lifecycle mutation therefore records a
// real persisted task in the canonical ledger. The task executor and the HTTP
// response observe the same single execution inside the lifecycle lock, so
// the recorded outcome is the operation's actual result — never a second run
// and never an invented success. Health is a read-only GET and creates no row.
function performLifecycleTask(kind: TaskKind, root: string, operation: () => Promise<LifecycleOutcome>): Promise<LifecycleOutcome> {
  const execution = withLifecycleLock(root, operation);
  startTask("online", kind, async () => {
    const result = await execution;
    return { ok: result.ok, output: JSON.stringify(result.body, null, 2), message: result.message };
  });
  return execution;
}

function confirmationError() {
  return {
    error: "Explicit confirmation is required for Marketplace mutations and package execution.",
    code: "MARKETPLACE_CONFIRMATION_REQUIRED",
  };
}

function parseItemId(value: string) {
  return value;
}

router.get("/items/:id/health", async (req, res) => {
  try {
    const root = workspaceRoot();
    const itemId = parseItemId(req.params.id);
    const result = await withLifecycleLock(root, () => healthCheckPackage(root, itemId));
    return res.status(result.ok ? 200 : result.installed ? 422 : 404).json(result);
  } catch (error: unknown) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error), code: "MARKETPLACE_HEALTH_FAILED" });
  }
});

router.post("/items/:id/install", async (req, res) => {
  if (!confirmationSchema.safeParse(req.body).success) return res.status(400).json(confirmationError());
  const root = workspaceRoot();
  const itemId = parseItemId(req.params.id);
  const result = await performLifecycleTask("install", root, async () => {
    const install = await installPackage(root, itemId);
    return {
      status: install.stage === "INSTALLED" ? 200 : 409,
      body: install,
      ok: install.stage === "INSTALLED" && !install.error,
      message: install.error ? `Install ${itemId}: ${install.error}` : `Install ${itemId}: ${install.stage}.`,
    };
  });
  return res.status(result.status).json(result.body);
});

router.post("/items/:id/update", async (req, res) => {
  if (!confirmationSchema.safeParse(req.body).success) return res.status(400).json(confirmationError());
  const root = workspaceRoot();
  const itemId = parseItemId(req.params.id);
  const result = await performLifecycleTask("update", root, async () => {
    const update = await updatePackageSafely(root, itemId);
    return {
      status: update.stage === "UPDATED" ? 200 : 409,
      body: update,
      ok: update.stage === "UPDATED" && !update.error,
      message: update.error ? `Update ${itemId}: ${update.error}` : `Update ${itemId}: ${update.stage}.`,
    };
  });
  return res.status(result.status).json(result.body);
});

router.post("/items/:id/uninstall", async (req, res) => {
  if (!confirmationSchema.safeParse(req.body).success) return res.status(400).json(confirmationError());
  const root = workspaceRoot();
  const itemId = parseItemId(req.params.id);
  const result = await performLifecycleTask("uninstall", root, async () => {
    const uninstall = await uninstallPackage(root, itemId);
    return {
      status: uninstall.stage === "UNINSTALLED" && !uninstall.error ? 200 : 409,
      body: uninstall,
      ok: uninstall.stage === "UNINSTALLED" && !uninstall.error,
      message: uninstall.error ? `Uninstall ${itemId}: ${uninstall.error}` : `Uninstall ${itemId}: ${uninstall.stage}.`,
    };
  });
  return res.status(result.status).json(result.body);
});

router.post("/items/:id/run", async (req, res) => {
  if (!confirmationSchema.safeParse(req.body).success) return res.status(400).json(confirmationError());
  const root = workspaceRoot();
  const itemId = parseItemId(req.params.id);
  const result = await performLifecycleTask("package-run", root, async () => {
    const run = await runInstalledPackage(root, itemId);
    return {
      status: run.ok ? 200 : 422,
      body: run,
      ok: run.ok,
      message: run.error ? `Run ${itemId}: ${run.error}` : `Run ${itemId}: package executed with verified trust and integrity.`,
    };
  });
  return res.status(result.status).json(result.body);
});

export default router;

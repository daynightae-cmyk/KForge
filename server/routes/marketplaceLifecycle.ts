import { Router } from "express";
import path from "path";
import { z } from "zod";
import {
  healthCheckPackage,
  installPackage,
  runInstalledPackage,
  uninstallPackage,
  updatePackage,
} from "../services/marketplace";

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
  const result = await withLifecycleLock(root, () => installPackage(root, itemId));
  return res.status(result.stage === "INSTALLED" ? 200 : 409).json(result);
});

router.post("/items/:id/update", async (req, res) => {
  if (!confirmationSchema.safeParse(req.body).success) return res.status(400).json(confirmationError());
  const root = workspaceRoot();
  const itemId = parseItemId(req.params.id);
  const result = await withLifecycleLock(root, () => updatePackage(root, itemId));
  return res.status(result.stage === "UPDATED" ? 200 : 409).json(result);
});

router.post("/items/:id/uninstall", async (req, res) => {
  if (!confirmationSchema.safeParse(req.body).success) return res.status(400).json(confirmationError());
  const root = workspaceRoot();
  const itemId = parseItemId(req.params.id);
  const result = await withLifecycleLock(root, () => uninstallPackage(root, itemId));
  return res.status(result.stage === "UNINSTALLED" && !result.error ? 200 : 409).json(result);
});

router.post("/items/:id/run", async (req, res) => {
  if (!confirmationSchema.safeParse(req.body).success) return res.status(400).json(confirmationError());
  const root = workspaceRoot();
  const itemId = parseItemId(req.params.id);
  const result = await withLifecycleLock(root, () => runInstalledPackage(root, itemId));
  return res.status(result.ok ? 200 : 422).json(result);
});

export default router;

import { Router } from "express";
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
    const result = await healthCheckPackage(process.env.KFORGE_WORKSPACE_ROOT || process.cwd(), parseItemId(req.params.id));
    return res.status(result.ok ? 200 : result.installed ? 422 : 404).json(result);
  } catch (error: unknown) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error), code: "MARKETPLACE_HEALTH_FAILED" });
  }
});

router.post("/items/:id/install", async (req, res) => {
  if (!confirmationSchema.safeParse(req.body).success) return res.status(400).json(confirmationError());
  const result = await installPackage(process.env.KFORGE_WORKSPACE_ROOT || process.cwd(), parseItemId(req.params.id));
  return res.status(result.stage === "INSTALLED" ? 200 : 409).json(result);
});

router.post("/items/:id/update", async (req, res) => {
  if (!confirmationSchema.safeParse(req.body).success) return res.status(400).json(confirmationError());
  const result = await updatePackage(process.env.KFORGE_WORKSPACE_ROOT || process.cwd(), parseItemId(req.params.id));
  return res.status(result.stage === "UPDATED" ? 200 : 409).json(result);
});

router.post("/items/:id/uninstall", async (req, res) => {
  if (!confirmationSchema.safeParse(req.body).success) return res.status(400).json(confirmationError());
  const result = await uninstallPackage(process.env.KFORGE_WORKSPACE_ROOT || process.cwd(), parseItemId(req.params.id));
  return res.status(result.stage === "UNINSTALLED" && !result.error ? 200 : 409).json(result);
});

router.post("/items/:id/run", async (req, res) => {
  if (!confirmationSchema.safeParse(req.body).success) return res.status(400).json(confirmationError());
  const result = await runInstalledPackage(process.env.KFORGE_WORKSPACE_ROOT || process.cwd(), parseItemId(req.params.id));
  return res.status(result.ok ? 200 : 422).json(result);
});

export default router;

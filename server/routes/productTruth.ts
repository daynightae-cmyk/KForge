import { Router } from "express";
import path from "path";
import { candidateProjectPaths, makeProjectSummary, scanProject } from "./workspace";
import { listPersistedProjectHealthSummaries, persistProjectHealthSummary } from "../services/projectHealthEvidence";
import { revokeProjectAuthority } from "../services/projectAuthorityRevocation";

const router = Router();

function getWorkspaceRoot() {
  return path.resolve(process.env.KFORGE_WORKSPACE_ROOT || path.resolve(process.cwd(), ".."));
}

async function resolveRegisteredProject(id: string) {
  const candidates = await candidateProjectPaths();
  for (const candidate of candidates) {
    const project = await makeProjectSummary(candidate);
    if (project.id === id) return project;
  }
  return null;
}

router.get("/projects/health-evidence", async (_req, res) => {
  const summaries = await listPersistedProjectHealthSummaries(getWorkspaceRoot());
  return res.json({
    summaries,
    transparency: {
      execution: "LOCAL",
      network: "NOT_REQUIRED",
      source: ".kforge/project-health.json",
      purpose: "Read persisted Project Health summary evidence without starting a scan.",
    },
  });
});

router.post("/projects/:id/health/scan", async (req, res) => {
  const project = await resolveRegisteredProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  const scan = await scanProject(project);
  const persistedSummary = await persistProjectHealthSummary(getWorkspaceRoot(), project.path, scan.health, scan.scannedAt);
  return res.json({
    projectId: project.id,
    health: scan.health,
    scannedAt: scan.scannedAt,
    issueCount: scan.issues.length,
    coverage: scan.coverage,
    tools: scan.tools,
    persistedSummary,
    transparency: {
      execution: "LOCAL",
      network: "POLICY_DEPENDENT",
      source: "Canonical bounded Project Health scan",
      persistedTo: ".kforge/project-health.json",
      purpose: "Run the explicitly requested Project Health scan and persist its bounded summary evidence.",
    },
  });
});

router.post("/projects/:id/trust/revoke", async (req, res) => {
  const project = await resolveRegisteredProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (req.body?.confirmed !== true) return res.status(428).json({
    error: "Revoking project trust disables bounded local execution and write-capable KForge operations for this project. Explicit confirmation is required.",
    permission: "ask",
  });
  const teardown = await revokeProjectAuthority(getWorkspaceRoot(), project);
  return res.json({
    project: await makeProjectSummary(project.path),
    trust: "untrusted",
    teardown,
    transparency: {
      execution: "LOCAL",
      network: "NOT_REQUIRED",
      source: ".kforge/project-trust.json + canonical local runtime/task registries",
      purpose: "Persist explicit local project trust revocation, stop the active Preview when possible, cancel tasks that have not started, and report already-running work without pretending it was retroactively undone.",
    },
  });
});

export default router;

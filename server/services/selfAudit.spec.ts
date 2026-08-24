import { promises as fs } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "../../shared/workspace";
import { KFORGE_SELF_AUDIT_STAGES } from "../../shared/workspace";
import { createSelfAuditRecord, inspectKForgeIdentity, markSelfAuditWaitingForRestart, readSelfAuditRecord, recordSelfAuditStage, selfAuditEvidencePath } from "./selfAudit";

async function withRoot(run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-self-audit-"));
  try { await run(root); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

function project(root: string): ProjectSummary {
  return {
    id: "kforge-project",
    name: "KForge",
    trust: "trusted",
    path: path.join(root, "KForge"),
    provider: "Local",
    branch: "main",
    lastActivity: new Date().toISOString(),
    projectType: "React + Express",
    modifiedFiles: 0,
    untrackedFiles: 0,
    ahead: 0,
    behind: 0,
    healthScore: null,
    securityStatus: "unknown",
    buildStatus: "unknown",
    testStatus: "unknown",
    syncStatus: "unknown",
    tags: [],
    favorite: false,
    pinned: false,
    archived: false,
    categories: { recent: false, favorite: false, pinned: false, archive: false },
  };
}

describe("KForge Self Audit persistence", () => {
  it("defines the exact ordered product sequence including Project Health and Agent", () => {
    expect(KFORGE_SELF_AUDIT_STAGES.map(([, label]) => label)).toEqual([
      "Discover KForge", "Open KForge", "Project Health", "Project Graph", "Architecture", "KForge Sonar", "Problems", "KForge Agent",
      "Tests", "Build", "Runtime", "Preview", "Release Gate", "Persist Evidence", "Restart", "Reload Evidence",
    ]);
  });

  it("recognizes KForge from its canonical existing architecture instead of its package name", async () => withRoot(async (root) => {
    const selected = project(root);
    expect((await inspectKForgeIdentity(selected.path)).matched).toBe(false);
    for (const relative of ["client/pages/KForgeWorkspace.tsx", "server/routes/workspace.ts", "server/services/platformSettings.ts", "shared/workspace.ts"]) {
      await fs.mkdir(path.dirname(path.join(selected.path, relative)), { recursive: true });
      await fs.writeFile(path.join(selected.path, relative), "// identity evidence\n", "utf8");
    }
    expect(await inspectKForgeIdentity(selected.path)).toMatchObject({ matched: true, missingFiles: [] });
  }));

  it("does not claim restart until a different server instance reloads the atomic evidence", async () => withRoot(async (root) => {
    const selected = project(root);
    const record = createSelfAuditRecord(selected, root, "server-instance-a");
    recordSelfAuditStage(record, "discover", "PASSED", { source: "test" });
    recordSelfAuditStage(record, "persist-evidence", "PASSED", { source: record.evidenceFile });
    await markSelfAuditWaitingForRestart(record);

    const sameInstance = await readSelfAuditRecord(root, selected.id, "server-instance-a");
    expect(sameInstance).toMatchObject({ status: "WAITING_RESTART", reloadedByInstanceId: null });
    expect(sameInstance?.stages.find((stage) => stage.id === "restart")?.state).toBe("WAITING_RESTART");
    expect(sameInstance?.stages.find((stage) => stage.id === "reload-evidence")?.state).toBe("QUEUED");

    const restarted = await readSelfAuditRecord(root, selected.id, "server-instance-b");
    expect(restarted).toMatchObject({ status: "COMPLETE", reloadedByInstanceId: "server-instance-b" });
    expect(restarted?.stages.find((stage) => stage.id === "restart")?.state).toBe("PASSED");
    expect(restarted?.stages.find((stage) => stage.id === "reload-evidence")?.state).toBe("PASSED");
    expect(JSON.parse(await fs.readFile(selfAuditEvidencePath(root, selected.id), "utf8"))).toMatchObject({ status: "COMPLETE", reloadedByInstanceId: "server-instance-b" });
    expect((await fs.readdir(path.dirname(selfAuditEvidencePath(root, selected.id)))).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  }));

  it("rejects malformed or out-of-order persisted evidence instead of inventing a successful reload", async () => withRoot(async (root) => {
    const selected = project(root);
    const evidenceFile = selfAuditEvidencePath(root, selected.id);
    await fs.mkdir(path.dirname(evidenceFile), { recursive: true });
    await fs.writeFile(evidenceFile, JSON.stringify({ schemaVersion: 1, projectId: selected.id, originInstanceId: "old", stages: [{ id: "reload-evidence" }] }), "utf8");
    expect(await readSelfAuditRecord(root, selected.id, "new")).toBeNull();
  }));
});

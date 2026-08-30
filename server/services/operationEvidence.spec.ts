import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeOperationEvidenceStore, listOperationEvidence, recordOperationEvidence } from "./operationEvidence";

const temporaryRoots: string[] = [];

afterEach(async () => {
  while (temporaryRoots.length) await rm(temporaryRoots.pop()!, { recursive: true, force: true });
});

describe("persistent workspace operation evidence", () => {
  it("persists bounded transparency, redacts secrets, and reloads the record after store reinitialization", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "kforge-operation-evidence-"));
    temporaryRoots.push(root);
    const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";

    await initializeOperationEvidenceStore(root);
    const created = await recordOperationEvidence(root, {
      projectId: "fixture-project",
      action: "push",
      ok: false,
      httpStatus: 409,
      message: `Push blocked. token=${token}`,
      exitCode: 1,
      transparency: {
        execution: "HYBRID",
        network: "REQUIRED",
        dataClasses: ["METADATA", "SOURCE_CODE"],
        projectSourceSent: true,
        secretRedaction: true,
        provider: "Git",
        destination: `https://user:${token}@github.com/example/project.git`,
        purpose: "Send explicitly confirmed commits to the configured upstream.",
        confirmation: "CONFIRMED",
        startedAt: "2026-08-30T10:00:00.000Z",
        completedAt: "2026-08-30T10:00:01.000Z",
        durationMs: 1000,
        result: "FAILED",
        reason: `Authorization: Bearer ${token}`,
      },
    });

    expect(created).not.toBeNull();
    expect(created?.persisted).toBe(true);
    expect(created?.transparency.network).toBe("REQUIRED");
    expect(created?.transparency.confirmation).toBe("CONFIRMED");
    expect(created?.message).not.toContain(token);
    expect(created?.transparency.destination).not.toContain(token);
    expect(created?.transparency.reason).not.toContain(token);

    const persistedText = await readFile(path.join(root, ".kforge", "operation-evidence.json"), "utf8");
    expect(persistedText).not.toContain(token);
    expect(persistedText).not.toContain("output");

    const secondRoot = await mkdtemp(path.join(os.tmpdir(), "kforge-operation-evidence-second-"));
    temporaryRoots.push(secondRoot);
    await initializeOperationEvidenceStore(secondRoot);
    await initializeOperationEvidenceStore(root);
    const reloaded = await listOperationEvidence(root, "fixture-project");
    expect(reloaded.store.state).toBe("READY");
    expect(reloaded.records).toHaveLength(1);
    expect(reloaded.records[0]).toMatchObject({ action: "push", persisted: true, httpStatus: 409 });
    expect(reloaded.records[0].transparency).toMatchObject({ execution: "HYBRID", network: "REQUIRED", confirmation: "CONFIRMED", result: "FAILED" });
  });
});

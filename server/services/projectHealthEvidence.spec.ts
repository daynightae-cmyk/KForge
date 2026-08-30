import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectHealth } from "../../shared/workspace";
import { getPersistedProjectHealthSummary, listPersistedProjectHealthSummaries, persistProjectHealthSummary } from "./projectHealthEvidence";

const roots: string[] = [];

function health(score: number | null, releaseState: ProjectHealth["release"]["state"]): ProjectHealth {
  const calculatedAt = new Date().toISOString();
  return {
    score,
    evidenceCoverage: 73,
    calculatedAt,
    metrics: [
      { key: "security", label: "Security", status: "pass", score: 100, weight: 10, evidence: [], findings: [], lastScan: calculatedAt, evidenceSource: "Local", evidenceAgeMs: 0, freshness: "current-scan" },
      { key: "tests", label: "Tests", status: "warning", score: 60, weight: 10, evidence: [], findings: [], lastScan: calculatedAt, evidenceSource: "Task", evidenceAgeMs: 0, freshness: "live-task" },
      { key: "build", label: "Build", status: "fail", score: 20, weight: 10, evidence: [], findings: [], lastScan: calculatedAt, evidenceSource: "Task", evidenceAgeMs: 0, freshness: "live-task" },
    ],
    sources: {} as ProjectHealth["sources"],
    release: { state: releaseState, blockers: [], warnings: [], evidence: [] },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("persisted Project Health evidence", () => {
  it("persists normalized bounded summaries atomically and reloads them without promoting unknown fields", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "kforge-health-store-"));
    roots.push(workspaceRoot);
    const projectPath = path.join(workspaceRoot, "project-a");
    const scannedAt = "2026-08-30T10:00:00.000Z";

    const saved = await persistProjectHealthSummary(workspaceRoot, projectPath, health(81, "READY WITH WARNINGS"), scannedAt);
    expect(saved).toMatchObject({
      path: path.resolve(projectPath),
      scannedAt,
      score: 81,
      evidenceCoverage: 73,
      releaseState: "READY WITH WARNINGS",
      securityStatus: "pass",
      testStatus: "warning",
      buildStatus: "fail",
      source: "persisted-project-health",
    });

    expect(await getPersistedProjectHealthSummary(workspaceRoot, projectPath)).toEqual(saved);
    expect(await listPersistedProjectHealthSummaries(workspaceRoot)).toEqual([saved]);
    const kforgeEntries = await readdir(path.join(workspaceRoot, ".kforge"));
    expect(kforgeEntries).toContain("project-health.json");
    expect(kforgeEntries.some((entry) => entry.includes(".tmp-"))).toBe(false);
  });

  it("serializes concurrent project writes without losing either summary", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "kforge-health-store-concurrent-"));
    roots.push(workspaceRoot);
    await Promise.all([
      persistProjectHealthSummary(workspaceRoot, path.join(workspaceRoot, "alpha"), health(90, "READY"), "2026-08-30T10:01:00.000Z"),
      persistProjectHealthSummary(workspaceRoot, path.join(workspaceRoot, "beta"), health(null, "BLOCKED"), "2026-08-30T10:02:00.000Z"),
    ]);
    const summaries = await listPersistedProjectHealthSummaries(workspaceRoot);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({ score: null, releaseState: "BLOCKED" });
    expect(summaries[1]).toMatchObject({ score: 90, releaseState: "READY" });
  });
});

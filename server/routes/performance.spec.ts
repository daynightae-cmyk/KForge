import { describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { buildProjectGraph } from "../services/projectGraph";
import { clearProjectCache, persistBenchmarkEvidence, projectCacheStatus } from "../services/projectPerformance";
import { makeProjectSummary, scanProject } from "./workspace";

const measurements: Record<string, number> = {};

async function timed<T>(name: string, action: () => Promise<T>) {
  const started = performance.now();
  const result = await action();
  measurements[name] = Number((performance.now() - started).toFixed(2));
  return result;
}

describe("KForge large-project benchmark", () => {
  it("reuses a graph cache only while source fingerprints match and invalidates it after a source edit", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-cache-"));
    try {
      await fs.mkdir(path.join(root, "src"));
      await fs.writeFile(path.join(root, "src", "a.ts"), "export const value = 1;\n", "utf8");
      const [initial, joined] = await Promise.all([buildProjectGraph(root), buildProjectGraph(root)]);
      const reused = await buildProjectGraph(root);
      expect(reused.generatedAt).toBe(initial.generatedAt);
      expect(initial.cache.state).toBe("LIVE");
      expect(joined).toMatchObject({ generatedAt: initial.generatedAt, cache: { state: "IN_FLIGHT_REUSED" } });
      expect(reused.cache.state).toBe("CACHED");
      await new Promise((resolve) => setTimeout(resolve, 12));
      await fs.writeFile(path.join(root, "src", "b.ts"), 'import { value } from "./a"; export const next = value + 1;\n', "utf8");
      const refreshed = await buildProjectGraph(root);
      expect(refreshed.generatedAt).not.toBe(initial.generatedAt);
      expect(refreshed.summary.files).toBe(2);
      expect(projectCacheStatus(root).find((entry) => entry.key === "graph")).toMatchObject({ version: 1, projectPath: root });
    } finally {
      clearProjectCache(root);
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.env.KFORGE_RUN_BENCHMARK !== "1")("measures discovery, bounded graph indexing, scan, cache, and memory on an actual generated multi-package project", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-large-benchmark-"));
    const count = 5_100;
    try {
      await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "benchmark", private: true, workspaces: ["packages/*"], scripts: { test: "node --test", build: "node -e \"process.stdout.write('build')\"" } }, null, 2));
      for (let packageIndex = 0; packageIndex < 5; packageIndex += 1) {
        const packageRoot = path.join(root, "packages", `pkg-${packageIndex}`);
        await fs.mkdir(packageRoot, { recursive: true });
        await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: `pkg-${packageIndex}`, private: true }));
      }
      for (let index = 0; index < count; index += 1) {
        const packageIndex = index % 5;
        const packageName = `pkg-${packageIndex}`;
        const dir = path.join(root, "packages", packageName, "src");
        await fs.mkdir(dir, { recursive: true });
        const previous = index < 5 ? "" : `import { value as prior } from \"./module-${index - 5}\";\n`;
        await fs.writeFile(path.join(dir, `module-${index}.ts`), `${previous}export const value = ${index};\n`);
      }
      await fs.mkdir(path.join(root, "tests"), { recursive: true });
      await fs.writeFile(path.join(root, "tests", "smoke.test.ts"), "export const smoke = true;\n");
      const project = await timed("discoveryMs", () => makeProjectSummary(root));
      const profile = await timed("profileMs", () => import("./workspace").then(({ detectProjectProfile }) => detectProjectProfile(project)));
      const graph = await timed("graphMs", () => buildProjectGraph(root));
      const cachedGraph = await timed("cachedGraphMs", () => buildProjectGraph(root));
      const scan = await timed("scanMs", () => scanProject(project));
      measurements.memoryRssBytes = process.memoryUsage().rss;
      const beforeRepeatedNavigation = process.memoryUsage().rss;
      for (let index = 0; index < 12; index += 1) await buildProjectGraph(root);
      measurements.repeatedNavigationMemoryDeltaBytes = Math.max(0, process.memoryUsage().rss - beforeRepeatedNavigation);
      expect(profile.performance.scale).toBe("large");
      expect(profile.workspaceKind).toBe("monorepo");
      expect(profile.sourceFileCount).toBeGreaterThanOrEqual(count);
      expect(profile.fileDiscovery).toMatchObject({ state: "COMPLETE", scannedCount: expect.any(Number), totalOrUnknown: expect.any(Number), limit: 20_000 });
      expect(graph.summary.files).toBe(2_000);
      expect(graph.coverage).toEqual(expect.objectContaining({ state: "LIMIT_REACHED", scannedCount: 2_000, totalOrUnknown: null, limit: 2_000, reason: expect.stringContaining("excludes additional source files") }));
      expect(graph.summary.imports).toBeGreaterThan(1_500);
      expect(cachedGraph.generatedAt).toBe(graph.generatedAt);
      expect(cachedGraph.cache).toMatchObject({ state: "CACHED", fingerprint: graph.cache.fingerprint, generatedAt: graph.generatedAt });
      expect(projectCacheStatus(root).some((entry) => entry.key === "graph")).toBe(true);
      expect(scan.profile.performance.scale).toBe("large");
      expect(scan.coverage.secretLiterals).toMatchObject({ state: "LIMIT_REACHED", scannedCount: 5_000, totalOrUnknown: null });
      expect(scan.coverage.completeness).toMatchObject({ state: "LIMIT_REACHED", scannedCount: 5_000, totalOrUnknown: null });
      expect(scan.health.metrics.find((entry) => entry.key === "security")).toMatchObject({ status: "unknown", score: null });
      expect(measurements.repeatedNavigationMemoryDeltaBytes).toBeLessThan(64 * 1024 * 1024);
      const report = { id: "large-project-5100", createdAt: new Date().toISOString(), fixture: { files: count, packages: 5, sourceFiles: profile.sourceFileCount }, measurements };
      const evidence = await persistBenchmarkEvidence(root, report);
      const persisted = JSON.parse(await fs.readFile(evidence.path, "utf8"));
      expect(persisted).toMatchObject({ id: "large-project-5100", fixture: { files: count, packages: 5, sourceFiles: profile.sourceFileCount }, measurements });
      if (process.env.KFORGE_BENCHMARK_REPORT_PATH) {
        const reportPath = path.resolve(process.env.KFORGE_BENCHMARK_REPORT_PATH);
        await fs.mkdir(path.dirname(reportPath), { recursive: true });
        await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      }
      console.log(`KFORGE_BENCHMARK ${JSON.stringify({ ...measurements, evidencePath: evidence.path })}`);
    } finally {
      clearProjectCache(root);
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});

import { describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { buildProjectGraph } from "../services/projectGraph";
import { clearProjectCache, projectCacheStatus } from "../services/projectPerformance";
import { makeProjectSummary, scanProject } from "./workspace";

const measurements: Record<string, number> = {};

async function timed<T>(name: string, action: () => Promise<T>) {
  const started = performance.now();
  const result = await action();
  measurements[name] = Number((performance.now() - started).toFixed(2));
  return result;
}

describe("KForge large-project benchmark", () => {
  it.skipIf(process.env.KFORGE_RUN_BENCHMARK !== "1")("measures discovery, bounded graph indexing, scan, cache, and memory on an actual generated multi-package project", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-large-benchmark-"));
    const count = 5_000;
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
      expect(profile.performance.scale).toBe("large");
      expect(profile.workspaceKind).toBe("monorepo");
      expect(profile.sourceFileCount).toBeGreaterThanOrEqual(count);
      expect(graph.summary.files).toBe(2_000);
      expect(graph.summary.imports).toBeGreaterThan(1_500);
      expect(cachedGraph.generatedAt).toBe(graph.generatedAt);
      expect(projectCacheStatus(root).some((entry) => entry.key === "graph")).toBe(true);
      expect(scan.profile.performance.scale).toBe("large");
      console.log(`KFORGE_BENCHMARK ${JSON.stringify(measurements)}`);
    } finally {
      clearProjectCache(root);
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});

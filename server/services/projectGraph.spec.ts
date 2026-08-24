import { promises as fs } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { analyzeImpact, buildProjectGraph } from "./projectGraph";
import { clearProjectCache } from "./projectPerformance";

describe("language-aware project graph", () => {
  it("derives exported symbols, ownership, dependency edges, deep cycles, duplicate names, and transitive impact from TypeScript syntax trees", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-symbol-graph-"));
    try {
      await fs.mkdir(path.join(root, "src"), { recursive: true });
      await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies: { zod: "1.0.0" } }), "utf8");
      await fs.writeFile(path.join(root, "src", "a.ts"), 'import { B } from "./b"; import { z } from "zod"; import { alias } from "app/internal"; export const A = B + String(z) + String(alias);\n', "utf8");
      await fs.writeFile(path.join(root, "src", "b.ts"), 'import { C } from "./c"; export const B = C + 1;\n', "utf8");
      await fs.writeFile(path.join(root, "src", "c.ts"), 'import { A } from "./a"; export const C = A + 1;\n', "utf8");
      await fs.writeFile(path.join(root, "src", "duplicate.ts"), 'export const A = 42;\n', "utf8");
      await fs.writeFile(path.join(root, "src", "a.test.ts"), 'import { A } from "./a"; export const verifiesA = A === 1;\n', "utf8");
      await fs.writeFile(path.join(root, "src", "unsupported.py"), "class PythonOnly:\n    pass\n", "utf8");
      const graph = await buildProjectGraph(root);
      expect(graph.summary).toMatchObject({ files: 6, imports: 5, symbols: 5, exports: 5, dependencies: 1, tests: 1, cycles: 1, duplicatedResponsibilities: 1 });
      expect(graph.coverage).toMatchObject({ state: "COMPLETE", scannedCount: 6, totalOrUnknown: 6, limit: 2_000 });
      expect(graph.cache).toMatchObject({ state: "LIVE", fingerprint: expect.any(String), generatedAt: graph.generatedAt });
      expect(graph.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "symbol:src/a.ts#A", type: "symbol", symbolKind: "variable", exported: true, path: "src/a.ts" }),
        expect.objectContaining({ id: "dependency:zod", type: "dependency" }),
      ]));
      expect(graph.nodes).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "dependency:app" })]));
      expect(graph.edges).toEqual(expect.arrayContaining([
        { from: "file:src/a.ts", to: "symbol:src/a.ts#A", type: "exports" },
        { from: "symbol:src/a.ts#A", to: "symbol:src/b.ts#B", type: "depends-on" },
        { from: "symbol:src/a.ts#A", to: "dependency:zod", type: "depends-on" },
      ]));
      expect(graph.analysis.cycles[0]).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
      expect(graph.analysis.duplicatedResponsibilities[0]).toMatchObject({ symbol: "A", kind: "variable", files: ["src/a.ts", "src/duplicate.ts"] });
      expect(graph.analysis.languageAdapters).toEqual(expect.arrayContaining([
        expect.objectContaining({ language: "TypeScript", state: "AVAILABLE", files: 5 }),
        expect.objectContaining({ language: "Python", state: "UNAVAILABLE", files: 1 }),
      ]));
      const impact = analyzeImpact(graph, "symbol:src/a.ts#A");
      expect(impact).toMatchObject({ targetType: "symbol", risk: "medium" });
      expect(impact.directDependents).toContain("symbol:src/c.ts#C");
      expect(impact.transitiveDependents).toEqual(expect.arrayContaining(["symbol:src/c.ts#C", "symbol:src/b.ts#B"]));
      expect(impact.relatedTests).toContain("src/a.test.ts");
    } finally {
      clearProjectCache(root);
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  it("returns UNAVAILABLE instead of inventing impact for an unknown symbol", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-symbol-graph-"));
    try {
      await fs.writeFile(path.join(root, "main.ts"), "export const value = 1;\n", "utf8");
      const graph = await buildProjectGraph(root);
      expect(analyzeImpact(graph, "symbol:main.ts#missing")).toMatchObject({ targetType: "unavailable", risk: "unknown", evidence: "UNAVAILABLE" });
    } finally {
      clearProjectCache(root);
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

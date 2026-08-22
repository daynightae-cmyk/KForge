import { promises as fs, type Dirent } from "fs";
import path from "path";
import { createHash } from "crypto";
import { readCache, writeCache } from "./projectPerformance";

export type GraphNodeType = "file" | "route" | "api" | "test" | "config";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  path?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: "imports" | "defines" | "calls" | "tests";
}

export interface ProjectGraph {
  generatedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  summary: { files: number; imports: number; routes: number; apis: number; tests: number };
}

const ignored = new Set([".git", ".kforge", "node_modules", "dist", "build", "coverage", ".next", "fixtures"]);
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".java", ".go", ".rs", ".cs", ".php"]);

async function sourceFiles(root: string, limit = 2_000) {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    if (files.length >= limit) return;
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [] as Dirent[]);
    for (const entry of entries) {
      if (files.length >= limit) return;
      if (entry.isDirectory() && ignored.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) await visit(absolute);
      else if (extensions.has(path.extname(relative).toLowerCase())) files.push(relative);
    }
  }
  await visit(root);
  return files;
}

async function sourceFingerprint(root: string, files: string[]) {
  const state = await Promise.all(files.map(async (file) => {
    const stat = await fs.stat(path.join(root, file)).catch(() => undefined);
    return stat ? `${file}:${stat.size}:${Math.round(stat.mtimeMs)}` : file;
  }));
  return createHash("sha1").update(state.join("|"), "utf8").digest("hex");
}

function resolveImport(from: string, target: string, known: Set<string>) {
  if (!target.startsWith(".")) return undefined;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), target));
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`];
  return candidates.find((candidate) => known.has(candidate));
}

export async function buildProjectGraph(projectPath: string): Promise<ProjectGraph> {
  const files = await sourceFiles(projectPath);
  const fingerprint = await sourceFingerprint(projectPath, files);
  const cacheKey = `${projectPath}:graph`;
  const cached = readCache<ProjectGraph>(cacheKey, fingerprint);
  if (cached) return { ...cached, generatedAt: cached.generatedAt };
  const known = new Set(files);
  const nodes: GraphNode[] = files.map((file) => ({ id: `file:${file}`, type: /(?:\.test|\.spec)\./.test(file) ? "test" : /(?:config|\.config\.)/.test(file) ? "config" : "file", label: path.posix.basename(file), path: file }));
  const edges: GraphEdge[] = [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const addNode = (node: GraphNode) => { if (!nodeIds.has(node.id)) { nodeIds.add(node.id); nodes.push(node); } };
  for (const file of files) {
    const source = await fs.readFile(path.join(projectPath, file), "utf8").catch(() => "");
    for (const match of source.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)) {
      const target = resolveImport(file, match[1], known);
      if (target) edges.push({ from: `file:${file}`, to: `file:${target}`, type: "imports" });
    }
    for (const match of source.matchAll(/(?:router|app)\.(?:get|post|put|patch|delete)\(\s*["']([^"']+)["']/g)) {
      const id = `api:${match[1]}`;
      addNode({ id, type: "api", label: match[1], path: file });
      edges.push({ from: `file:${file}`, to: id, type: "defines" });
    }
    for (const match of source.matchAll(/(?:fetch|axios\.(?:get|post|put|patch|delete))\(\s*["']([^"']+)["']/g)) {
      if (!match[1].startsWith("/api/")) continue;
      const id = `api:${match[1]}`;
      addNode({ id, type: "api", label: match[1], path: file });
      edges.push({ from: `file:${file}`, to: id, type: "calls" });
    }
    for (const match of source.matchAll(/<Route[^>]+path=["']([^"']+)["']/g)) {
      const id = `route:${match[1]}`;
      addNode({ id, type: "route", label: match[1], path: file });
      edges.push({ from: `file:${file}`, to: id, type: "defines" });
    }
  }
  return writeCache(cacheKey, fingerprint, { generatedAt: new Date().toISOString(), nodes, edges, summary: { files: files.length, imports: edges.filter((edge) => edge.type === "imports").length, routes: nodes.filter((node) => node.type === "route").length, apis: nodes.filter((node) => node.type === "api").length, tests: nodes.filter((node) => node.type === "test").length } });
}

export function analyzeImpact(graph: ProjectGraph, file: string) {
  const id = `file:${file}`;
  const directDependents = graph.edges.filter((edge) => edge.to === id && edge.type === "imports").map((edge) => edge.from.replace(/^file:/, ""));
  const ownedApis = graph.edges.filter((edge) => edge.from === id && edge.type === "defines" && edge.to.startsWith("api:")).map((edge) => edge.to.replace(/^api:/, ""));
  const tests = graph.nodes.filter((node) => node.type === "test" && node.path?.toLowerCase().includes(path.posix.basename(file).replace(/\.[^.]+$/, "").toLowerCase())).map((node) => node.path || node.label);
  return { file, directDependents, ownedApis, relatedTests: tests, risk: directDependents.length > 5 ? "high" : directDependents.length ? "medium" : "low", message: directDependents.length ? `${directDependents.length} file(s) import this file directly.` : "No direct import dependents were found in the scanned project graph." };
}

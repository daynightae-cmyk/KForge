import { promises as fs, type Dirent } from "fs";
import path from "path";
import { createHash } from "crypto";
import { builtinModules } from "module";
import ts from "typescript";
import { readCache, writeCache } from "./projectPerformance";
import type { BoundedEvidenceCoverage } from "../../shared/workspace";

export type GraphNodeType = "file" | "route" | "api" | "test" | "config" | "symbol" | "dependency";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  path?: string;
  language?: string;
  symbolKind?: string;
  exported?: boolean;
  line?: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: "imports" | "defines" | "exports" | "depends-on" | "calls" | "tests";
}

export interface GraphLanguageAdapter {
  language: string;
  files: number;
  state: "AVAILABLE" | "UNAVAILABLE";
  adapter: string;
  reason: string;
}

export interface ProjectGraph {
  generatedAt: string;
  coverage: BoundedEvidenceCoverage;
  cache: { state: "LIVE" | "CACHED" | "IN_FLIGHT_REUSED"; fingerprint: string; generatedAt: string; servedAt: string };
  nodes: GraphNode[];
  edges: GraphEdge[];
  summary: { files: number; imports: number; exports: number; symbols: number; dependencies: number; routes: number; apis: number; tests: number; cycles: number; duplicatedResponsibilities: number };
  analysis: {
    cycles: string[][];
    duplicatedResponsibilities: Array<{ symbol: string; kind: string; files: string[]; evidence: string }>;
    languageAdapters: GraphLanguageAdapter[];
    limitations: string[];
  };
}

interface ImportBinding {
  local: string;
  imported?: string;
  target: string;
}

interface ParsedSymbol {
  name: string;
  kind: string;
  line: number;
  dependencies: Array<{ target: string; imported?: string }>;
}

interface ParsedTypeScriptFile {
  imports: Array<{ target: string; testRelationship: boolean }>;
  dependencies: Array<{ id: string; label: string }>;
  symbols: ParsedSymbol[];
}

const ignored = new Set([".git", ".kforge", "node_modules", "dist", "build", "coverage", ".next", "fixtures"]);
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".java", ".go", ".rs", ".cs", ".php"]);
const typeScriptExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

async function sourceFiles(root: string, limit = 2_000) {
  const files: string[] = [];
  let limitReached = false;
  async function visit(directory: string): Promise<void> {
    if (limitReached) return;
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [] as Dirent[]);
    for (const entry of entries) {
      if (limitReached) return;
      if (entry.isDirectory() && ignored.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) await visit(absolute);
      else if (extensions.has(path.extname(relative).toLowerCase())) {
        if (files.length < limit) files.push(relative);
        else limitReached = true;
      }
    }
  }
  await visit(root);
  const coverage: BoundedEvidenceCoverage = {
    state: limitReached ? "LIMIT_REACHED" : "COMPLETE",
    scannedCount: files.length,
    totalOrUnknown: limitReached ? null : files.length,
    limit,
    reason: limitReached ? `The ${limit.toLocaleString()}-source-file graph limit was reached; the graph excludes additional source files.` : "All detected source files were indexed within the graph safety limit.",
    source: "Local project graph source traversal",
  };
  return { files, coverage };
}

async function declaredDependencies(root: string) {
  const manifest = await fs.readFile(path.join(root, "package.json"), "utf8").then((value) => JSON.parse(value) as Record<string, unknown>).catch(() => undefined);
  if (!manifest) return new Set<string>();
  const names = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((section) => Object.keys((manifest[section] as Record<string, unknown> | undefined) || {}));
  return new Set(names);
}

async function sourceFingerprint(root: string, files: string[], dependencies: Set<string>) {
  const state = await Promise.all(files.map(async (file) => {
    const stat = await fs.stat(path.join(root, file)).catch(() => undefined);
    return stat ? `${file}:${stat.size}:${Math.round(stat.mtimeMs)}` : file;
  }));
  return `symbols-v1:${createHash("sha1").update([...state, ...[...dependencies].sort().map((name) => `dependency:${name}`)].join("|"), "utf8").digest("hex")}`;
}

function resolveImport(from: string, target: string, known: Set<string>) {
  if (!target.startsWith(".")) return undefined;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), target));
  const candidates = [base, ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].map((extension) => `${base}${extension}`), ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].map((extension) => `${base}/index${extension}`)];
  return candidates.find((candidate) => known.has(candidate));
}

function dependencyName(specifier: string, declared: Set<string>) {
  if (specifier.startsWith("node:")) return specifier;
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("@/") || specifier.startsWith("@shared/") || specifier.startsWith("~/") || specifier.startsWith("#")) return undefined;
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  return declared.has(name) || builtinModules.includes(name) ? name : undefined;
}

function scriptKind(file: string) {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function exported(node: ts.Node) {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function declarationName(node: ts.Node): { name: string; kind: string } | undefined {
  if (ts.isFunctionDeclaration(node) && node.name) return { name: node.name.text, kind: "function" };
  if (ts.isClassDeclaration(node) && node.name) return { name: node.name.text, kind: "class" };
  if (ts.isInterfaceDeclaration(node)) return { name: node.name.text, kind: "interface" };
  if (ts.isTypeAliasDeclaration(node)) return { name: node.name.text, kind: "type" };
  if (ts.isEnumDeclaration(node)) return { name: node.name.text, kind: "enum" };
  return undefined;
}

function parseTypeScriptFile(file: string, source: string, known: Set<string>, declared: Set<string>): ParsedTypeScriptFile {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
  const bindings = new Map<string, ImportBinding>();
  const imports: ParsedTypeScriptFile["imports"] = [];
  const importKeys = new Set<string>();
  const dependencies = new Map<string, { id: string; label: string }>();
  const moduleTarget = (specifier: string) => {
    const resolved = resolveImport(file, specifier, known);
    if (resolved) return `file:${resolved}`;
    const label = dependencyName(specifier, declared);
    if (!label) return undefined;
    const id = `dependency:${label}`;
    dependencies.set(id, { id, label });
    return id;
  };
  const addImport = (target: string) => {
    const testRelationship = /(?:\.test|\.spec)\./.test(file) && target.startsWith("file:");
    const key = `${target}:${testRelationship}`;
    if (!importKeys.has(key)) imports.push({ target, testRelationship });
    importKeys.add(key);
  };
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const target = moduleTarget(specifier);
    if (!target) continue;
    addImport(target);
    const clause = statement.importClause;
    if (clause?.name) bindings.set(clause.name.text, { local: clause.name.text, imported: "default", target });
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) clause.namedBindings.elements.forEach((element) => bindings.set(element.name.text, { local: element.name.text, imported: element.propertyName?.text || element.name.text, target }));
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) bindings.set(clause.namedBindings.name.text, { local: clause.namedBindings.name.text, target });
  }
  const symbols: ParsedSymbol[] = [];
  const collectDependencies = (node: ts.Node) => {
    const found = new Map<string, { target: string; imported?: string }>();
    const visit = (child: ts.Node) => {
      if (ts.isIdentifier(child)) {
        const binding = bindings.get(child.text);
        if (binding) found.set(`${binding.target}#${binding.imported || "*"}`, { target: binding.target, imported: binding.imported });
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
    return [...found.values()];
  };
  const addSymbol = (name: string, kind: string, node: ts.Node, extraDependencies: ParsedSymbol["dependencies"] = []) => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const combined = new Map<string, { target: string; imported?: string }>();
    [...collectDependencies(node), ...extraDependencies].forEach((dependency) => combined.set(`${dependency.target}#${dependency.imported || "*"}`, dependency));
    symbols.push({ name, kind, line, dependencies: [...combined.values()] });
  };
  for (const statement of sourceFile.statements) {
    if (exported(statement)) {
      const named = declarationName(statement);
      if (named) addSymbol(named.name, named.kind, statement);
      if (ts.isVariableStatement(statement)) statement.declarationList.declarations.forEach((declaration) => { if (ts.isIdentifier(declaration.name)) addSymbol(declaration.name.text, "variable", declaration); });
    }
    if (ts.isExportDeclaration(statement)) {
      const target = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? moduleTarget(statement.moduleSpecifier.text) : undefined;
      if (target) addImport(target);
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) statement.exportClause.elements.forEach((element) => addSymbol(element.name.text, "re-export", element, target ? [{ target, imported: element.propertyName?.text || element.name.text }] : []));
    }
  }
  return { imports, dependencies: [...dependencies.values()], symbols };
}

function stronglyConnectedCycles(edges: GraphEdge[]) {
  const adjacency = new Map<string, string[]>();
  edges.filter((edge) => edge.type === "imports" && edge.from.startsWith("file:") && edge.to.startsWith("file:")).forEach((edge) => adjacency.set(edge.from, [...(adjacency.get(edge.from) || []), edge.to]));
  let nextIndex = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const cycles: string[][] = [];
  const visit = (node: string) => {
    index.set(node, nextIndex); low.set(node, nextIndex); nextIndex += 1; stack.push(node); onStack.add(node);
    for (const target of adjacency.get(node) || []) {
      if (!index.has(target)) { visit(target); low.set(node, Math.min(low.get(node)!, low.get(target)!)); }
      else if (onStack.has(target)) low.set(node, Math.min(low.get(node)!, index.get(target)!));
    }
    if (low.get(node) !== index.get(node)) return;
    const component: string[] = [];
    let current = "";
    do { current = stack.pop()!; onStack.delete(current); component.push(current.replace(/^file:/, "")); } while (current !== node);
    if (component.length > 1 || (adjacency.get(node) || []).includes(node)) cycles.push(component.sort());
  };
  [...new Set([...adjacency.keys(), ...[...adjacency.values()].flat()])].forEach((node) => { if (!index.has(node)) visit(node); });
  return cycles.sort((left, right) => right.length - left.length || left[0].localeCompare(right[0]));
}

function languageAdapters(files: string[]): GraphLanguageAdapter[] {
  const definitions = [
    { language: "TypeScript", extensions: new Set([".ts", ".tsx"]), available: true },
    { language: "JavaScript", extensions: new Set([".js", ".jsx", ".mjs", ".cjs"]), available: true },
    { language: "Python", extensions: new Set([".py"]), available: false },
    { language: "Java", extensions: new Set([".java"]), available: false },
    { language: "Go", extensions: new Set([".go"]), available: false },
    { language: "Rust", extensions: new Set([".rs"]), available: false },
    { language: "C#", extensions: new Set([".cs"]), available: false },
    { language: "PHP", extensions: new Set([".php"]), available: false },
  ];
  return definitions.flatMap((definition) => {
    const count = files.filter((file) => definition.extensions.has(path.extname(file).toLowerCase())).length;
    if (!count) return [];
    return [{ language: definition.language, files: count, state: definition.available ? "AVAILABLE" as const : "UNAVAILABLE" as const, adapter: definition.available ? "TypeScript Compiler API syntax tree" : "No safe local parser adapter configured", reason: definition.available ? "Exports, ownership, and imported-symbol dependencies are derived from parsed syntax trees." : "File evidence remains available, but symbol analysis is not fabricated." }];
  });
}

async function buildProjectGraphEvidence(projectPath: string): Promise<ProjectGraph> {
  const discovery = await sourceFiles(projectPath);
  const files = discovery.files;
  const dependencies = await declaredDependencies(projectPath);
  const fingerprint = `${await sourceFingerprint(projectPath, files, dependencies)}:${discovery.coverage.state}:${discovery.coverage.scannedCount}`;
  const cacheKey = `${projectPath}:graph`;
  const cached = readCache<ProjectGraph>(cacheKey, fingerprint);
  if (cached) return { ...cached, cache: { ...cached.cache, state: "CACHED", servedAt: new Date().toISOString() } };
  const known = new Set(files);
  const nodes: GraphNode[] = files.map((file) => ({ id: `file:${file}`, type: /(?:\.test|\.spec)\./.test(file) ? "test" : /(?:config|\.config\.)/.test(file) ? "config" : "file", label: path.posix.basename(file), path: file }));
  const edges: GraphEdge[] = [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const addNode = (node: GraphNode) => { if (!nodeIds.has(node.id)) { nodeIds.add(node.id); nodes.push(node); } };
  const parsedFiles = new Map<string, ParsedTypeScriptFile>();
  for (const file of files) {
    const source = await fs.readFile(path.join(projectPath, file), "utf8").catch(() => "");
    if (typeScriptExtensions.has(path.extname(file).toLowerCase())) {
      const parsed = parseTypeScriptFile(file, source, known, dependencies);
      parsedFiles.set(file, parsed);
      parsed.dependencies.forEach((dependency) => addNode({ id: dependency.id, type: "dependency", label: dependency.label }));
      parsed.imports.forEach((entry) => { edges.push({ from: `file:${file}`, to: entry.target, type: "imports" }); if (entry.testRelationship) edges.push({ from: `file:${file}`, to: entry.target, type: "tests" }); });
      parsed.symbols.forEach((symbol) => {
        const id = `symbol:${file}#${symbol.name}`;
        addNode({ id, type: "symbol", label: symbol.name, path: file, language: [".js", ".jsx", ".mjs", ".cjs"].includes(path.extname(file).toLowerCase()) ? "JavaScript" : "TypeScript", symbolKind: symbol.kind, exported: true, line: symbol.line });
        edges.push({ from: `file:${file}`, to: id, type: "exports" });
      });
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
  for (const [file, parsed] of parsedFiles) {
    for (const symbol of parsed.symbols) {
      const from = `symbol:${file}#${symbol.name}`;
      for (const dependency of symbol.dependencies) {
        let target = dependency.target;
        if (target.startsWith("file:") && dependency.imported) {
          const targetFile = target.replace(/^file:/, "");
          const candidate = `symbol:${targetFile}#${dependency.imported}`;
          if (nodeIds.has(candidate)) target = candidate;
        }
        edges.push({ from, to: target, type: "depends-on" });
      }
    }
  }
  const cycles = stronglyConnectedCycles(edges);
  const symbolGroups = new Map<string, GraphNode[]>();
  nodes.filter((node) => node.type === "symbol" && node.exported && node.label !== "default").forEach((node) => { const key = `${node.symbolKind || "symbol"}:${node.label}`; symbolGroups.set(key, [...(symbolGroups.get(key) || []), node]); });
  const duplicatedResponsibilities = [...symbolGroups.values()].filter((group) => new Set(group.map((node) => node.path)).size > 1).map((group) => ({ symbol: group[0].label, kind: group[0].symbolKind || "symbol", files: [...new Set(group.map((node) => node.path!).filter(Boolean))].sort(), evidence: `The same exported ${group[0].symbolKind || "symbol"} name is owned by ${new Set(group.map((node) => node.path)).size} files; semantic responsibility overlap requires human review.` })).sort((left, right) => right.files.length - left.files.length || left.symbol.localeCompare(right.symbol));
  const adapters = languageAdapters(files);
  const limitations = ["Unresolved relative imports and undeclared path aliases are omitted instead of being guessed as package dependencies.", ...(discovery.coverage.state === "LIMIT_REACHED" ? [discovery.coverage.reason] : []), ...adapters.filter((adapter) => adapter.state === "UNAVAILABLE").map((adapter) => `${adapter.language} symbol analysis is UNAVAILABLE: ${adapter.reason}`)];
  const summary = { files: files.length, imports: edges.filter((edge) => edge.type === "imports").length, exports: edges.filter((edge) => edge.type === "exports").length, symbols: nodes.filter((node) => node.type === "symbol").length, dependencies: nodes.filter((node) => node.type === "dependency").length, routes: nodes.filter((node) => node.type === "route").length, apis: nodes.filter((node) => node.type === "api").length, tests: nodes.filter((node) => node.type === "test").length, cycles: cycles.length, duplicatedResponsibilities: duplicatedResponsibilities.length };
  const generatedAt = new Date().toISOString();
  return writeCache(cacheKey, fingerprint, { generatedAt, coverage: discovery.coverage, cache: { state: "LIVE", fingerprint, generatedAt, servedAt: generatedAt }, nodes, edges, summary, analysis: { cycles, duplicatedResponsibilities, languageAdapters: adapters, limitations } });
}

const activeGraphBuilds = new Map<string, Promise<ProjectGraph>>();

export async function buildProjectGraph(projectPath: string): Promise<ProjectGraph> {
  const active = activeGraphBuilds.get(projectPath);
  if (active) {
    const graph = await active;
    return { ...graph, cache: { ...graph.cache, state: "IN_FLIGHT_REUSED", servedAt: new Date().toISOString() } };
  }
  const build = buildProjectGraphEvidence(projectPath);
  activeGraphBuilds.set(projectPath, build);
  try {
    return await build;
  } finally {
    activeGraphBuilds.delete(projectPath);
  }
}

function reverseReachable(graph: ProjectGraph, start: string, edgeTypes: Set<GraphEdge["type"]>) {
  const direct = graph.edges.filter((edge) => edge.to === start && edgeTypes.has(edge.type)).map((edge) => edge.from);
  const visited = new Set<string>(direct);
  const queue = [...direct];
  while (queue.length) {
    const current = queue.shift()!;
    graph.edges.filter((edge) => edge.to === current && edgeTypes.has(edge.type)).forEach((edge) => { if (edge.from !== start && !visited.has(edge.from)) { visited.add(edge.from); queue.push(edge.from); } });
  }
  return { direct: [...new Set(direct)], transitive: [...visited] };
}

export function analyzeImpact(graph: ProjectGraph, target: string) {
  const requestedId = target.startsWith("file:") || target.startsWith("symbol:") ? target : `file:${target}`;
  const node = graph.nodes.find((entry) => entry.id === requestedId);
  if (!node || (node.type !== "file" && node.type !== "test" && node.type !== "config" && node.type !== "symbol")) return { target, targetType: "unavailable", directDependents: [], transitiveDependents: [], affectedSymbols: [], ownedSymbols: [], ownedApis: [], relatedTests: [], dependencies: [], risk: "unknown", message: "The requested file or symbol is not present in the scanned graph.", evidence: "UNAVAILABLE" };
  const reachability = reverseReachable(graph, node.id, new Set(node.type === "symbol" ? ["depends-on"] : ["imports", "depends-on"]));
  const normalize = (id: string) => id.startsWith("file:") ? id.replace(/^file:/, "") : id;
  const dependentFiles = new Set(reachability.transitive.flatMap((id) => { const dependent = graph.nodes.find((entry) => entry.id === id); return dependent?.path ? [dependent.path] : id.startsWith("file:") ? [id.replace(/^file:/, "")] : []; }));
  const ownedSymbols = graph.edges.filter((edge) => edge.from === node.id && edge.type === "exports").map((edge) => edge.to);
  const affectedSymbols = graph.nodes.filter((entry) => entry.type === "symbol" && entry.path && dependentFiles.has(entry.path)).map((entry) => entry.id);
  const ownedApis = graph.edges.filter((edge) => edge.from === (node.type === "symbol" ? `file:${node.path}` : node.id) && edge.type === "defines" && edge.to.startsWith("api:")).map((edge) => edge.to.replace(/^api:/, ""));
  const relatedTests = graph.nodes.filter((entry) => entry.type === "test" && (entry.path && dependentFiles.has(entry.path) || entry.path?.toLowerCase().includes(path.posix.basename(node.path || "").replace(/\.[^.]+$/, "").toLowerCase()))).map((entry) => entry.path || entry.label);
  const dependencies = graph.edges.filter((edge) => edge.from === node.id && (edge.type === "depends-on" || edge.type === "imports")).map((edge) => edge.to);
  const score = reachability.transitive.length + affectedSymbols.length + relatedTests.length * 2;
  const risk = score > 12 ? "high" : score > 0 ? "medium" : "low";
  return { target: node.id, targetType: node.type, file: node.path || target, directDependents: reachability.direct.map(normalize), transitiveDependents: reachability.transitive.map(normalize), affectedSymbols, ownedSymbols, ownedApis, relatedTests: [...new Set(relatedTests)], dependencies: [...new Set(dependencies)], risk, message: reachability.transitive.length ? `${reachability.direct.length} direct and ${reachability.transitive.length} total dependent graph node(s) were found.` : "No dependent nodes were found in the scanned static graph.", evidence: "Static syntax-tree, import, and ownership evidence; runtime behavior is not inferred." };
}

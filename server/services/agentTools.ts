import { promises as fs, type Dirent } from "fs";
import path from "path";
import { redactProjectText } from "./redaction";

export type AgentToolPermission = "read-only" | "safe" | "safe-write" | "dangerous" | "blocked";
export type AgentToolName = "list_files" | "read_file" | "search_files" | "find_symbol" | "inspect_file" | "typecheck" | "lint" | "test" | "build" | "format" | "start" | "stop" | "health" | "logs" | "git_status" | "git_diff" | "git_branch" | "git_commit" | "scan" | "sonar" | "graph" | "dependency_audit";

export interface AgentToolDefinition {
  name: AgentToolName;
  permission: AgentToolPermission;
  description: string;
  requiresConfirmation?: boolean;
  unavailableReason?: string;
}

export interface AgentToolResult {
  ok: boolean;
  tool: AgentToolName;
  permission: AgentToolPermission;
  output: unknown;
  message: string;
}

export interface ProjectToolHandlers {
  typecheck: () => Promise<unknown>;
  lint: () => Promise<unknown>;
  test: () => Promise<unknown>;
  build: () => Promise<unknown>;
  start: () => Promise<unknown>;
  health: () => Promise<unknown>;
  logs: () => Promise<unknown>;
  gitStatus: () => Promise<unknown>;
  gitDiff: () => Promise<unknown>;
  scan: () => Promise<unknown>;
  sonar: () => Promise<unknown>;
  graph: () => Promise<unknown>;
  dependencyAudit: () => Promise<unknown>;
}

const ignored = new Set([".git", ".kforge", "node_modules", "dist", "build", "coverage", ".next", "fixtures"]);

const definitions: AgentToolDefinition[] = [
  { name: "list_files", permission: "read-only", description: "List project files under a validated relative directory." },
  { name: "read_file", permission: "read-only", description: "Read a validated project-relative text file with a bounded size." },
  { name: "search_files", permission: "read-only", description: "Search bounded project text files for a literal query." },
  { name: "find_symbol", permission: "read-only", description: "Find declarations and exported symbols using a bounded textual search." },
  { name: "inspect_file", permission: "read-only", description: "Return path, size, extension, and a bounded preview for a project file." },
  { name: "typecheck", permission: "safe", description: "Run the detected project typecheck command." },
  { name: "lint", permission: "safe", description: "Run the detected project lint command." },
  { name: "test", permission: "safe", description: "Run the detected project tests." },
  { name: "build", permission: "safe", description: "Run the detected project build." },
  { name: "format", permission: "safe-write", description: "Formatting can modify files and requires explicit review before execution.", requiresConfirmation: true },
  { name: "start", permission: "safe", description: "Run bounded local runtime verification, not a persistent production deployment." },
  { name: "stop", permission: "blocked", description: "Stopping arbitrary user processes is not available to the agent.", unavailableReason: "KForge does not claim to manage processes it did not create." },
  { name: "health", permission: "safe", description: "Perform a local runtime health check." },
  { name: "logs", permission: "read-only", description: "Read the latest KForge task and runtime logs." },
  { name: "git_status", permission: "read-only", description: "Read Git branch and working-tree state." },
  { name: "git_diff", permission: "read-only", description: "Read the current Git diff statistics." },
  { name: "git_branch", permission: "dangerous", description: "Creating or switching branches requires confirmation.", requiresConfirmation: true },
  { name: "git_commit", permission: "dangerous", description: "Creating a commit requires confirmation.", requiresConfirmation: true },
  { name: "scan", permission: "safe", description: "Run the real project scanner." },
  { name: "sonar", permission: "safe", description: "Run deterministic KForge Sonar analysis." },
  { name: "graph", permission: "safe", description: "Build the project dependency graph." },
  { name: "dependency_audit", permission: "safe", description: "Run the supported dependency-audit operation." },
];

function safePath(root: string, relative = ".") {
  const resolved = path.resolve(root, relative);
  const outside = path.relative(root, resolved);
  if (outside.startsWith("..") || path.isAbsolute(outside)) throw new Error("The requested path escapes the project root.");
  return { absolute: resolved, relative: outside.split(path.sep).join("/") || "." };
}

async function collectFiles(root: string, max = 750) {
  const items: string[] = [];
  async function walk(directory: string): Promise<void> {
    if (items.length >= max) return;
    const rows = await fs.readdir(directory, { withFileTypes: true }).catch(() => [] as Dirent[]);
    for (const row of rows) {
      if (items.length >= max) return;
      if (row.isDirectory() && ignored.has(row.name)) continue;
      const full = path.join(directory, row.name);
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (row.isDirectory()) await walk(full);
      else items.push(relative);
    }
  }
  await walk(root);
  return items;
}

async function textFile(root: string, relative: string, limit = 24_000) {
  const target = safePath(root, relative);
  const stat = await fs.stat(target.absolute);
  if (!stat.isFile()) throw new Error("The requested path is not a file.");
  if (stat.size > limit * 4) throw new Error("The requested file exceeds the agent read-size limit.");
  const content = await fs.readFile(target.absolute, "utf8");
  const redacted = redactProjectText(target.relative, content.slice(0, limit));
  return { path: target.relative, content: redacted.content, redacted: redacted.redacted, truncated: content.length > limit, sizeBytes: stat.size };
}

function definition(name: AgentToolName) { return definitions.find((entry) => entry.name === name) as AgentToolDefinition; }

export function listAgentTools() { return definitions; }

export function isAgentToolName(value: unknown): value is AgentToolName {
  return typeof value === "string" && definitions.some((entry) => entry.name === value);
}

export async function executeAgentTool(root: string, handlers: ProjectToolHandlers, name: AgentToolName, input: Record<string, unknown> = {}): Promise<AgentToolResult> {
  const tool = definition(name);
  if (!tool) throw new Error("Unknown KForge agent tool.");
  if (tool.permission === "blocked") return { ok: false, tool: name, permission: tool.permission, output: null, message: tool.unavailableReason || "This tool is blocked." };
  if (tool.permission === "dangerous" || tool.permission === "safe-write") return { ok: false, tool: name, permission: tool.permission, output: null, message: "This tool requires explicit confirmation and is not executed by the autonomous agent." };
  try {
    if (name === "list_files") {
      const directory = typeof input.directory === "string" ? input.directory : ".";
      const location = safePath(root, directory);
      const rows = await fs.readdir(location.absolute, { withFileTypes: true });
      const entries = rows.filter((row) => !ignored.has(row.name)).slice(0, 300).map((row) => ({ name: row.name, path: path.posix.join(location.relative === "." ? "" : location.relative, row.name), kind: row.isDirectory() ? "directory" : "file" }));
      return { ok: true, tool: name, permission: tool.permission, output: entries, message: `${entries.length} entry(s) listed.` };
    }
    if (name === "read_file") {
      const relative = typeof input.path === "string" ? input.path : "";
      if (!relative) throw new Error("read_file requires a project-relative path.");
      const output = await textFile(root, relative);
      return { ok: true, tool: name, permission: tool.permission, output, message: `Read ${output.path}.` };
    }
    if (name === "inspect_file") {
      const relative = typeof input.path === "string" ? input.path : "";
      if (!relative) throw new Error("inspect_file requires a project-relative path.");
      const output = await textFile(root, relative, 4_000);
      return { ok: true, tool: name, permission: tool.permission, output: { ...output, extension: path.extname(output.path), lines: output.content.split(/\r?\n/).length }, message: `Inspected ${output.path}.` };
    }
    if (name === "search_files" || name === "find_symbol") {
      const query = typeof input.query === "string" ? input.query.trim() : "";
      if (!query || query.length > 180) throw new Error(`${name} requires a bounded query.`);
      const files = await collectFiles(root);
      const expression = name === "find_symbol" ? new RegExp(`(?:function|class|interface|type|const|export)\\s+${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i") : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const matches: Array<{ path: string; line: number; text: string }> = [];
      for (const file of files) {
        if (matches.length >= 120) break;
        const content = await fs.readFile(path.join(root, file), "utf8").catch(() => "");
        content.split(/\r?\n/).forEach((line, index) => { if (matches.length < 120 && expression.test(line)) matches.push({ path: file, line: index + 1, text: line.trim().slice(0, 400) }); });
      }
      return { ok: true, tool: name, permission: tool.permission, output: matches, message: `${matches.length} match(es) found.` };
    }
    const handlersByName: Partial<Record<AgentToolName, () => Promise<unknown>>> = { typecheck: handlers.typecheck, lint: handlers.lint, test: handlers.test, build: handlers.build, start: handlers.start, health: handlers.health, logs: handlers.logs, git_status: handlers.gitStatus, git_diff: handlers.gitDiff, scan: handlers.scan, sonar: handlers.sonar, graph: handlers.graph, dependency_audit: handlers.dependencyAudit };
    const handler = handlersByName[name];
    if (!handler) throw new Error(`No safe implementation is registered for ${name}.`);
    const output = await handler();
    const reportedFailure = typeof output === "object" && output !== null && "ok" in output && (output as { ok?: unknown }).ok === false;
    return { ok: !reportedFailure, tool: name, permission: tool.permission, output, message: reportedFailure ? `${name} completed with a failed verification result.` : `${name} completed.` };
  } catch (error: unknown) { return { ok: false, tool: name, permission: tool.permission, output: null, message: error instanceof Error ? error.message : `${name} failed.` }; }
}

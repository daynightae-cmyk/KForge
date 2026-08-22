import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { ProjectScan, ProjectSummary, ScanIssue } from "../../shared/workspace";
import { generateWithLocalAI } from "./aiCenter";

const execFileAsync = promisify(execFile);
const textExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml"]);

export interface AgentContextFile {
  path: string;
  reason: "active-problem" | "import" | "related-test" | "configuration";
  content: string;
  redacted: boolean;
}

export interface AgentContext {
  project: { name: string; root: string; branch: string; projectType: string };
  issue?: Pick<ScanIssue, "id" | "title" | "message" | "description" | "file" | "line" | "severity" | "category" | "source" | "suggestion">;
  technology: string[];
  commands: ProjectScan["profile"]["commands"];
  git: ProjectScan["git"] & { status: string };
  diagnostics: Array<Pick<ScanIssue, "id" | "title" | "severity" | "category" | "file" | "line" | "source">>;
  files: AgentContextFile[];
  totalCharacters: number;
}

export interface AgentPatch {
  id: string;
  file: string;
  oldText: string;
  newText: string;
  reason: string;
  confidence: "high" | "medium" | "low";
  risk: "safe" | "review" | "approval" | "blocked";
  verification: string[];
}

function safeFile(projectPath: string, relative: string) {
  const resolved = path.resolve(projectPath, relative);
  const relativeCheck = path.relative(projectPath, resolved);
  if (!relative || relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) throw new Error("Agent file selection escaped the project root.");
  return { resolved, relative: relativeCheck.split(path.sep).join("/") };
}

function redactText(file: string, text: string) {
  let redacted = false;
  let value = text;
  if (/(^|\/)\.env(?:\.|$)/.test(file)) {
    redacted = true;
    value = text.split(/\r?\n/).map((line) => /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.test(line) ? `${line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)/)?.[1]}=[REDACTED]` : line).join("\n");
  }
  const sensitive = /(api[_-]?key|token|secret|password|private[_-]?key)\s*([:=])\s*([^\s,;]+)/gi;
  if (sensitive.test(value)) {
    sensitive.lastIndex = 0;
    redacted = true;
    value = value.replace(sensitive, "$1$2[REDACTED]");
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) {
    redacted = true;
    value = value.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]");
  }
  return { content: value, redacted };
}

async function readContextFile(projectPath: string, relative: string, reason: AgentContextFile["reason"], limit: number) {
  const safe = safeFile(projectPath, relative);
  if (!textExtensions.has(path.extname(safe.relative).toLowerCase()) && path.basename(safe.relative) !== "package.json") return null;
  const raw = await fs.readFile(safe.resolved, "utf8").catch(() => "");
  if (!raw) return null;
  const normalized = raw.length > limit ? `${raw.slice(0, limit)}\n/* KForge context truncated */` : raw;
  const redacted = redactText(safe.relative, normalized);
  return { path: safe.relative, reason, ...redacted } as AgentContextFile;
}

function importCandidates(activePath: string, content: string) {
  const directory = path.posix.dirname(activePath);
  const candidates = new Set<string>();
  for (const match of content.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)) {
    const target = match[1];
    if (!target.startsWith(".")) continue;
    const base = path.posix.normalize(path.posix.join(directory, target));
    [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.tsx"].forEach((suffix) => candidates.add(`${base}${suffix}`));
  }
  return [...candidates];
}

async function gitStatus(projectPath: string) {
  try {
    const result = await execFileAsync("git", ["status", "--porcelain=v1", "--branch"], { cwd: projectPath, windowsHide: true, timeout: 10_000 });
    return `${result.stdout || ""}${result.stderr || ""}`.trim();
  } catch { return "Git status unavailable."; }
}

export async function buildAgentContext(project: ProjectSummary, scan: ProjectScan, issueId?: string): Promise<AgentContext> {
  const issue = issueId ? scan.issues.find((entry) => entry.id === issueId) : undefined;
  const files: AgentContextFile[] = [];
  const seen = new Set<string>();
  const add = async (relative: string, reason: AgentContextFile["reason"]) => {
    if (seen.has(relative) || files.length >= 10) return;
    const entry = await readContextFile(project.path, relative, reason, 12_000);
    if (entry) { seen.add(entry.path); files.push(entry); }
  };
  if (issue?.file) {
    await add(issue.file, "active-problem");
    const active = files.find((entry) => entry.reason === "active-problem");
    if (active) for (const candidate of importCandidates(active.path, active.content).slice(0, 4)) await add(candidate, "import");
    const basename = path.posix.basename(issue.file).replace(/\.[^.]+$/, "");
    const rootEntries = await fs.readdir(project.path, { recursive: true }).catch(() => [] as string[]);
    for (const entry of rootEntries.filter((value) => /(?:\.test|\.spec)\.[cm]?[jt]sx?$/.test(value) && value.toLowerCase().includes(basename.toLowerCase())).slice(0, 2)) await add(entry.split(path.sep).join("/"), "related-test");
  }
  for (const config of ["package.json", "tsconfig.json", "vite.config.ts", "README.md"]) await add(config, "configuration");
  const status = await gitStatus(project.path);
  const totalCharacters = files.reduce((total, entry) => total + entry.content.length, 0);
  return {
    project: { name: project.name, root: project.path, branch: project.branch, projectType: project.projectType },
    issue: issue && { id: issue.id, title: issue.title, message: issue.message, description: issue.description, file: issue.file, line: issue.line, severity: issue.severity, category: issue.category, source: issue.source, suggestion: issue.suggestion },
    technology: scan.technology,
    commands: scan.profile.commands,
    git: { ...scan.git, status },
    diagnostics: scan.issues.slice(0, 30).map((entry) => ({ id: entry.id, title: entry.title, severity: entry.severity, category: entry.category, file: entry.file, line: entry.line, source: entry.source })),
    files,
    totalCharacters,
  };
}

export function buildRulePlan(context: AgentContext) {
  const issueLabel = context.issue ? `${context.issue.title}${context.issue.file ? ` in ${context.issue.file}` : ""}` : "current project diagnostics";
  return {
    mode: "rules" as const,
    summary: `KForge rule engine assembled an evidence-based plan for ${issueLabel}. No language-model output was used.`,
    steps: [
      "Inspect the selected diagnostic and related source/configuration context.",
      "Classify whether a verified patch rule exists and identify its risk level.",
      "Create a file snapshot before any write operation.",
      "Preview the exact old/new replacement and validate it against current file content.",
      "Apply only after required approval for the patch risk level.",
      "Run detected typecheck, tests, build, and runtime verification when available.",
      "Restore the snapshot automatically if verification fails.",
    ],
    risks: context.issue?.severity === "critical" || context.issue?.severity === "high" ? ["High-priority diagnostic: require preview and verification evidence."] : ["No language-model inference is available; only rule-backed repairs are eligible."],
  };
}

export async function buildLocalAIPlan(workspaceRoot: string, context: AgentContext, mission: string) {
  const system = "You are KForge Engineer. You may plan only. Never claim edits, tests, builds, commits, pushes, deployment, or secrets that did not occur. Return a concise ordered plan with affected files, risk, and exact verification commands.";
  const result = await generateWithLocalAI(workspaceRoot, system, `Mission: ${mission}\n\nRedacted selected project context:\n${JSON.stringify(context)}`);
  return { mode: "local-ai" as const, provider: result.provider.id, model: result.model, plan: result.content };
}

export async function generateVerifiedPatch(project: ProjectSummary, issue: ScanIssue): Promise<AgentPatch | null> {
  if (issue.category !== "typecheck" || !issue.file || !issue.line || !/TS2322|not assignable/i.test(`${issue.title} ${issue.message}`)) return null;
  const safe = safeFile(project.path, issue.file);
  const source = await fs.readFile(safe.resolved, "utf8");
  const lines = source.split(/\r?\n/);
  const line = lines[issue.line - 1] || "";
  const match = line.match(/^(\s*(?:const|let)\s+[A-Za-z_$][\w$]*\s*:\s*)(number|string|boolean)(\s*=\s*)("[^"]*"|'[^']*'|true|false)(\s*;?\s*)$/);
  if (!match) return null;
  const literalType = match[4] === "true" || match[4] === "false" ? "boolean" : match[4].startsWith("\"") || match[4].startsWith("'") ? "string" : "";
  if (!literalType || literalType === match[2]) return null;
  const oldText = line;
  const newText = `${match[1]}${literalType}${match[3]}${match[4]}${match[5]}`;
  return { id: `${issue.id}:literal-type-repair`, file: safe.relative, oldText, newText, reason: `The const initializer is an unambiguous ${literalType} literal, but the declaration says ${match[2]}.`, confidence: "high", risk: "safe", verification: ["typecheck", "test", "build", "runtime"] };
}

export async function validateAndApplyPatch(projectPath: string, patch: AgentPatch) {
  if (patch.risk === "blocked") throw new Error("Blocked patches cannot be applied.");
  const safe = safeFile(projectPath, patch.file);
  const source = await fs.readFile(safe.resolved, "utf8");
  const occurrences = source.split(patch.oldText).length - 1;
  if (occurrences !== 1) throw new Error(`Patch validation requires exactly one matching old-text occurrence; found ${occurrences}.`);
  await fs.writeFile(safe.resolved, source.replace(patch.oldText, patch.newText), "utf8");
  return { file: safe.relative, changed: true };
}

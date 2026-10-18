import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { ProjectScan, ProjectSummary, ScanIssue } from "../../shared/workspace";
import { generateWithCloudAI, generateWithLocalAI, type CloudAIProviderId } from "./aiCenter";
import { redactProjectText } from "./redaction";

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
  contextScan?: {
    complete: boolean;
    truncated: boolean;
    filesScanned: number;
    filesMatched: number;
    maxDepth: number;
    maxFiles: number;
    timeBudgetMs: number;
    elapsedMs: number;
    excludedDirectories: string[];
  };
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

async function realPathContained(projectPath: string, resolved: string) {
  const realRoot = await fs.realpath(projectPath);
  let realTarget = resolved;
  try {
    realTarget = await fs.realpath(resolved);
  } catch {
    let directory = path.dirname(resolved);
    for (;;) {
      try {
        const realDirectory = await fs.realpath(directory);
        realTarget = path.join(realDirectory, path.relative(directory, resolved));
        break;
      } catch {
        const parent = path.dirname(directory);
        if (parent === directory) return true;
        directory = parent;
      }
    }
  }
  const relative = path.relative(realRoot, realTarget);
  if (relative === "") return true;
  if (path.isAbsolute(relative)) return false;
  if (relative.split(path.sep)[0] === ".." || relative.startsWith(`..${path.sep}`)) return false;
  return true;
}

export async function safeFile(projectPath: string, relative: string) {
  if (!relative) throw new Error("Agent file selection escaped the project root.");
  const resolved = path.resolve(projectPath, relative);
  const relativeCheck = path.relative(projectPath, resolved);
  if (!relativeCheck || relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) throw new Error("Agent file selection escaped the project root.");
  const contained = await realPathContained(projectPath, resolved);
  if (!contained) throw new Error("Agent file selection resolved outside the project root.");
  return { resolved, relative: relativeCheck.split(path.sep).join("/") };
}

export async function readContextFile(projectPath: string, relative: string, reason: AgentContextFile["reason"], limit: number) {
  let safe;
  try {
    safe = await safeFile(projectPath, relative);
  } catch {
    return null;
  }
  if (!textExtensions.has(path.extname(safe.relative).toLowerCase()) && path.basename(safe.relative) !== "package.json") return null;
  const raw = await fs.readFile(safe.resolved, "utf8").catch(() => "");
  if (!raw) return null;
  const normalized = raw.length > limit ? `${raw.slice(0, limit)}\\n/* KForge context truncated */` : raw;
  const redacted = redactProjectText(safe.relative, normalized);
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

const CONTEXT_SCAN_EXCLUDED = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", "coverage",
  ".cache", ".turbo", ".vite", "target", "vendor", ".pnpm-store", "release",
]);

export async function collectProjectFiles(projectPath: string, options: { maxFiles: number; maxDepth: number; timeBudgetMs: number }) {
  const start = Date.now();
  const results: string[] = [];
  let filesScanned = 0;
  let complete = true;
  let truncated = false;
  const excluded: string[] = [];

  async function walk(directory: string, depth: number, relativePrefix: string) {
    if (depth > options.maxDepth) { truncated = true; complete = false; return; }
    if (Date.now() - start > options.timeBudgetMs) { truncated = true; complete = false; return; }
    if (results.length >= options.maxFiles) { truncated = true; complete = false; return; }
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean; isSymbolicLink: () => boolean }>;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (Date.now() - start > options.timeBudgetMs) { truncated = true; complete = false; return; }
      if (results.length >= options.maxFiles) { truncated = true; complete = false; return; }
      const name = entry.name;
      const childRelative = relativePrefix ? `${relativePrefix}/${name}` : name;
      if (entry.isSymbolicLink()) {
        // Do not follow links during context enumeration.
        continue;
      }
      if (entry.isDirectory()) {
        if (CONTEXT_SCAN_EXCLUDED.has(name)) {
          if (!excluded.includes(name)) excluded.push(name);
          continue;
        }
        await walk(path.join(directory, name), depth + 1, childRelative);
      } else if (entry.isFile()) {
        filesScanned += 1;
        results.push(childRelative.split(path.sep).join("/"));
      }
    }
  }

  try {
    await walk(projectPath, 0, "");
  } catch {
    complete = false;
    truncated = true;
  }
  if (filesScanned >= options.maxFiles || Date.now() - start > options.timeBudgetMs) {
    truncated = true;
    complete = false;
  }
  return {
    files: results,
    filesScanned,
    complete,
    truncated,
    elapsedMs: Date.now() - start,
    excluded,
  };
}

export async function buildAgentContext(project: ProjectSummary, scan: ProjectScan, issueId?: string): Promise<AgentContext> {
  const issue = issueId ? scan.issues.find((entry) => entry.id === issueId) : undefined;
  const files: AgentContextFile[] = [];
  let scanResult: { files: string[]; filesScanned: number; complete: boolean; truncated: boolean; elapsedMs: number; excluded: string[] } | null = null;
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
    const basename = path.posix.basename(issue.file).replace(/\\.[^.]+$/, "");
    scanResult = await collectProjectFiles(project.path, { maxFiles: 5000, maxDepth: 8, timeBudgetMs: 2000 });
    const rootEntries = scanResult.files;
    for (const entry of rootEntries.filter((value) => /(?:\\.test|\\.spec)\\.[cm]?[jt]sx?$/.test(value) && value.toLowerCase().includes(basename.toLowerCase())).slice(0, 2)) await add(entry.split(path.sep).join("/"), "related-test");
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
    contextScan: {
      complete: scanResult ? scanResult.complete : true,
      truncated: scanResult ? scanResult.truncated : false,
      filesScanned: scanResult ? scanResult.filesScanned : 0,
      filesMatched: scanResult ? scanResult.files.length : 0,
      maxDepth: 8,
      maxFiles: 5000,
      timeBudgetMs: 2000,
      elapsedMs: scanResult ? scanResult.elapsedMs : 0,
      excludedDirectories: scanResult ? scanResult.excluded : [],
    },
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

export function buildRedactedCloudPlanInput(context: AgentContext, mission: string) {
  const redactedMission = redactProjectText("agent-mission.txt", mission);
  const serializedContext = redactProjectText("agent-context.json", JSON.stringify(context));
  const sourceCodeIncluded = context.files.some((file) => file.reason !== "configuration" || /\.(?:[cm]?[jt]sx?|py|go|rs|java|cs|php|vue)$/i.test(file.path));
  return {
    prompt: `Mission: ${redactedMission.content}\n\nRedacted selected project context:\n${serializedContext.content}`,
    redactionApplied: redactedMission.redacted || serializedContext.redacted || context.files.some((file) => file.redacted),
    sourceCodeIncluded,
    dataClasses: ["METADATA", "PROJECT_CONTEXT", ...(sourceCodeIncluded ? ["SOURCE_CODE"] : [])] as Array<"METADATA" | "PROJECT_CONTEXT" | "SOURCE_CODE">,
  };
}

export async function buildCloudAIPlan(provider: CloudAIProviderId, context: AgentContext, mission: string) {
  const system = "You are KForge Engineer. You may plan only. Never claim edits, tests, builds, commits, pushes, deployment, or secrets that did not occur. Return a concise ordered plan with affected files, risk, and exact verification commands.";
  const outbound = buildRedactedCloudPlanInput(context, mission);
  const result = await generateWithCloudAI(provider, system, outbound.prompt);
  return { mode: "cloud-ai" as const, provider: result.provider.id, model: result.provider.model!, plan: result.content, outbound };
}

export async function generateVerifiedPatch(project: ProjectSummary, issue: ScanIssue): Promise<AgentPatch | null> {
  if (issue.category !== "typecheck" || !issue.file || !issue.line || !/TS2322|not assignable/i.test(`${issue.title} ${issue.message}`)) return null;
  const safe = await safeFile(project.path, issue.file);
  const source = await fs.readFile(safe.resolved, "utf8");
  const lines = source.split(/\r?\n/);
  const line = lines[issue.line - 1] || "";
  const match = line.match(/^(\s*(?:(?:export\s+)?(?:const|let))\s+[A-Za-z_$][\w$]*\s*:\s*)(number|string|boolean)(\s*=\s*)("[^"]*"|'[^']*'|true|false)(\s*;?\s*)$/);
  if (!match) return null;
  const literalType = match[4] === "true" || match[4] === "false" ? "boolean" : match[4].startsWith("\"") || match[4].startsWith("'") ? "string" : "";
  if (!literalType || literalType === match[2]) return null;
  const oldText = line;
  const newText = `${match[1]}${literalType}${match[3]}${match[4]}${match[5]}`;
  return { id: `${issue.id}:literal-type-repair`, file: safe.relative, oldText, newText, reason: `The const initializer is an unambiguous ${literalType} literal, but the declaration says ${match[2]}.`, confidence: "high", risk: "safe", verification: ["typecheck", "test", "build", "runtime"] };
}

export interface PatchQualityGate {
  ok: boolean;
  file: string;
  occurrences: number;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
}

export async function evaluatePatchQuality(projectPath: string, patch: AgentPatch): Promise<PatchQualityGate> {
  const safe = await safeFile(projectPath, patch.file);
  const source = await fs.readFile(safe.resolved, "utf8");
  const occurrences = source.split(patch.oldText).length - 1;
  const secretPattern = /(?:api[_-]?key|token|secret|password|private[_-]?key)\s*[:=]\s*(?!\[REDACTED\]|process\.env\.)[^\s,;]+/i;
  const checks = [
    { name: "file-exists", ok: true, detail: safe.relative },
    { name: "exact-old-text", ok: occurrences === 1, detail: `Expected one old-text occurrence; found ${occurrences}.` },
    { name: "no-accidental-deletion", ok: patch.newText.trim().length > 0 && patch.newText.length >= Math.min(1, patch.oldText.length), detail: "Patch replacement must retain non-empty source text." },
    { name: "no-secret-exposure", ok: !secretPattern.test(patch.newText), detail: "Patch output must not introduce an inline credential value." },
    { name: "single-file-scope", ok: Boolean(patch.file) && !patch.file.includes(".."), detail: "Patch is scoped to one validated project-relative file." },
  ];
  return { ok: checks.every((entry) => entry.ok), file: safe.relative, occurrences, checks };
}

function isInsideRealPath(realRoot: string, realTarget: string): boolean {
  const relative = path.relative(realRoot, realTarget);
  if (relative === "") return true;
  if (path.isAbsolute(relative)) return false;
  return !relative.split(path.sep)[0].startsWith("..");
}

/**
 * A patch write must stay inside the project even when a path component is a
 * symlink or junction, so the real target of the file (or of its nearest
 * existing parent) is compared against the real project root.
 */
async function assertRealPathContained(projectPath: string, resolved: string) {
  const realRoot = await fs.realpath(projectPath);
  let realTarget = resolved;
  try {
    realTarget = await fs.realpath(resolved);
  } catch {
    let directory = path.dirname(resolved);
    for (;;) {
      try {
        const realDirectory = await fs.realpath(directory);
        realTarget = path.join(realDirectory, path.relative(directory, resolved));
        break;
      } catch {
        const parent = path.dirname(directory);
        if (parent === directory) throw new Error("Agent file selection resolved outside the project root.");
        directory = parent;
      }
    }
  }
  if (!isInsideRealPath(realRoot, realTarget)) throw new Error("Agent file selection resolved outside the project root.");
}

export async function validateAndApplyPatch(projectPath: string, patch: AgentPatch) {
  if (patch.risk === "blocked") throw new Error("Blocked patches cannot be applied.");
  const gate = await evaluatePatchQuality(projectPath, patch);
  if (!gate.ok) throw new Error(`Patch Quality Gate rejected the patch: ${gate.checks.filter((entry) => !entry.ok).map((entry) => entry.name).join(", ")}.`);
  const safe = await safeFile(projectPath, patch.file);
  await assertRealPathContained(projectPath, safe.resolved);
  const source = await fs.readFile(safe.resolved, "utf8");
  await fs.writeFile(safe.resolved, source.replace(patch.oldText, patch.newText), "utf8");
  return { file: safe.relative, changed: true, qualityGate: gate };
}

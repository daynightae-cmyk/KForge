import { Router } from "express";
import { promises as fs, type Dirent } from "fs";
import path from "path";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import type {
  CommandResult,
  DiagnosticCategory,
  DiagnosticSeverity,
  HealthMetric,
  ProjectDetailResponse,
  ProjectHealth,
  ProjectProfile,
  ProjectScan,
  ProjectSummary,
  ScanIssue,
  ToolAvailability,
  WorkspaceAction,
  WorkspaceActivity,
  WorkspaceResponse,
  WorkspaceStatus,
} from "../../shared/workspace";
import { isWorkspaceAction } from "../../shared/workspace";
import { detectLocalAIProvider, requestLocalPlan } from "../services/localAI";
import { createSnapshot, listSnapshots, restoreSnapshot } from "../services/snapshots";
import { cancelTask, getTask, listTasks, retryTask, startTask, type TaskKind } from "../services/tasks";

const execFileAsync = promisify(execFile);
const router = Router();
const activities = new Map<string, WorkspaceActivity[]>();
const openedPaths = new Set<string>();
const latestActions = new Map<string, Partial<Record<WorkspaceAction, CommandResult>>>();
const commandTimeoutMs = 120_000;
const ignoredDirectories = new Set([".git", ".kforge", "node_modules", "dist", "build", "coverage", ".next", ".venv", "venv", "target", "vendor", "bin", "obj"]);
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".java", ".go", ".rs", ".cs", ".php", ".vue", ".html", ".css", ".scss"]);

interface CommandExecution {
  ok: boolean;
  code: number;
  output: string;
}

type JsonRecord = Record<string, unknown>;

function getWorkspaceRoot() {
  return path.resolve(process.env.KFORGE_WORKSPACE_ROOT || path.resolve(process.cwd(), ".."));
}

function projectId(projectPath: string) {
  return Buffer.from(projectPath).toString("base64url");
}

function errorDetails(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const data = error as { message?: unknown; stdout?: unknown; stderr?: unknown; code?: unknown };
    return {
      message: typeof data.message === "string" ? data.message : "Command failed",
      stdout: typeof data.stdout === "string" ? data.stdout : "",
      stderr: typeof data.stderr === "string" ? data.stderr : "",
      code: typeof data.code === "number" ? data.code : 1,
    };
  }
  return { message: String(error), stdout: "", stderr: "", code: 1 };
}

async function run(command: string, args: string[], cwd: string, timeout = 15_000): Promise<CommandExecution> {
  const executable = process.platform === "win32" && ["npm", "pnpm", "yarn"].includes(command) ? `${command}.cmd` : command;
  try {
    const result = await execFileAsync(executable, args, {
      cwd,
      timeout,
      shell: process.platform === "win32" && executable.endsWith(".cmd"),
      windowsHide: true,
      maxBuffer: 2_500_000,
    });
    return { ok: true, code: 0, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
  } catch (error: unknown) {
    const details = errorDetails(error);
    return { ok: false, code: details.code, output: `${details.stdout}${details.stderr || details.message}`.trim() };
  }
}

async function pathExists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson(target: string): Promise<JsonRecord | null> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(target, "utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
  } catch {
    return null;
  }
}

function recordOf(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringRecord(value: unknown) {
  return Object.fromEntries(Object.entries(recordOf(value)).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

async function findFiles(root: string, predicate: (relativePath: string, entry: Dirent) => boolean, limit = 5_000) {
  const found: string[] = [];
  async function visit(current: string) {
    if (found.length >= limit) return;
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= limit) break;
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (predicate(relative, entry)) {
        found.push(relative);
      }
    }
  }
  await visit(root);
  return found;
}

async function fileContains(target: string, expression: RegExp) {
  try {
    return expression.test(await fs.readFile(target, "utf8"));
  } catch {
    return false;
  }
}

async function gitInfo(projectPath: string) {
  const insideGit = await run("git", ["rev-parse", "--is-inside-work-tree"], projectPath);
  if (!insideGit.ok || insideGit.output !== "true") {
    return { isGit: false, branch: "—", remoteUrl: undefined as string | undefined, modifiedFiles: 0, untrackedFiles: 0, ahead: 0, behind: 0, lastActivity: "Not a Git repository" };
  }
  const [branch, status, remote, lastCommit] = await Promise.all([
    run("git", ["branch", "--show-current"], projectPath),
    run("git", ["status", "--porcelain=v1", "--branch"], projectPath),
    run("git", ["remote", "get-url", "origin"], projectPath),
    run("git", ["log", "-1", "--format=%cI"], projectPath),
  ]);
  const lines = status.output.split(/\r?\n/).filter(Boolean);
  const head = lines[0] || "";
  const changes = lines.slice(1);
  return {
    isGit: true,
    branch: branch.ok && branch.output ? branch.output : "detached",
    remoteUrl: remote.ok && remote.output ? remote.output : undefined,
    modifiedFiles: changes.filter((line) => !line.startsWith("??")).length,
    untrackedFiles: changes.filter((line) => line.startsWith("??")).length,
    ahead: Number(head.match(/ahead (\d+)/)?.[1] || 0),
    behind: Number(head.match(/behind (\d+)/)?.[1] || 0),
    lastActivity: lastCommit.ok && lastCommit.output ? lastCommit.output : "No commits",
  };
}

async function packageManager(projectPath: string) {
  if (await pathExists(path.join(projectPath, "pnpm-lock.yaml"))) return "pnpm";
  if (await pathExists(path.join(projectPath, "yarn.lock"))) return "yarn";
  if (await pathExists(path.join(projectPath, "package-lock.json"))) return "npm";
  if (await pathExists(path.join(projectPath, "bun.lockb")) || await pathExists(path.join(projectPath, "bun.lock"))) return "bun";
  return null;
}

function commandFor(manager: string | null, script: string) {
  if (manager === "pnpm") return { command: "pnpm", args: ["run", script] };
  if (manager === "yarn") return { command: "yarn", args: [script] };
  if (manager === "bun") return { command: "bun", args: ["run", script] };
  return { command: "npm", args: ["run", script] };
}

export async function detectProjectProfile(project: ProjectSummary): Promise<ProjectProfile> {
  const root = project.path;
  const packageJson = await readJson(path.join(root, "package.json"));
  const dependencies = { ...stringRecord(packageJson?.dependencies), ...stringRecord(packageJson?.devDependencies) };
  const scripts = stringRecord(packageJson?.scripts);
  const manifestText = packageJson ? JSON.stringify(packageJson) : "";
  const rootNames = new Set((await fs.readdir(root, { withFileTypes: true }).catch(() => [] as Dirent[])).map((entry) => entry.name));
  const frameworks: string[] = [];
  const languages: string[] = [];
  const manager = await packageManager(root);
  const has = (name: string) => Boolean(dependencies[name]);
  if (has("react") || rootNames.has("src") && await pathExists(path.join(root, "src", "App.tsx"))) frameworks.push("React");
  if (has("vite") || rootNames.has("vite.config.ts") || rootNames.has("vite.config.js")) frameworks.push("Vite");
  if (has("next") || rootNames.has("next.config.js") || rootNames.has("next.config.mjs")) frameworks.push("Next.js");
  if (has("vue") || has("@vue/cli-service")) frameworks.push("Vue");
  if (has("@angular/core")) frameworks.push("Angular");
  if (packageJson) frameworks.push("Node.js");
  if (rootNames.has("pyproject.toml") || rootNames.has("requirements.txt") || rootNames.has("setup.py")) {
    languages.push("Python");
    const pythonManifest = await Promise.all(["pyproject.toml", "requirements.txt", "setup.py"].map((name) => fs.readFile(path.join(root, name), "utf8").catch(() => "")));
    const content = pythonManifest.join("\n");
    if (/fastapi/i.test(content)) frameworks.push("FastAPI");
    if (/django/i.test(content)) frameworks.push("Django");
  }
  if (rootNames.has("pom.xml") || rootNames.has("build.gradle") || rootNames.has("build.gradle.kts")) {
    languages.push("Java");
    const javaFiles = await findFiles(root, (relative) => relative.endsWith(".java"), 20);
    if (javaFiles.length && await fileContains(path.join(root, rootNames.has("pom.xml") ? "pom.xml" : rootNames.has("build.gradle") ? "build.gradle" : "build.gradle.kts"), /spring/i)) frameworks.push("Spring");
  }
  if (rootNames.has("go.mod")) { languages.push("Go"); frameworks.push("Go"); }
  if (rootNames.has("Cargo.toml")) { languages.push("Rust"); frameworks.push("Rust"); }
  if ([...rootNames].some((name) => name.endsWith(".sln") || name.endsWith(".csproj"))) { languages.push("C#"); frameworks.push(".NET"); }
  if (rootNames.has("composer.json")) { languages.push("PHP"); frameworks.push("PHP"); }
  if (has("typescript") || rootNames.has("tsconfig.json")) languages.push("TypeScript");
  if (packageJson) languages.push("JavaScript");

  const allFiles = await findFiles(root, () => true, 20_000);
  const sourceFiles = allFiles.filter((relative) => sourceExtensions.has(path.extname(relative).toLowerCase()));
  const sourceRoots = [...new Set(sourceFiles.map((relative) => relative.split("/")[0]).filter((name) => ["src", "app", "client", "server", "api", "lib", "cmd"].includes(name)))];
  const envFiles = allFiles.filter((relative) => /(^|\/)\.env(?:\.[^/]+)?$/.test(relative));
  const ci = allFiles.filter((relative) => relative.startsWith(".github/workflows/") || /(^|\/)(\.gitlab-ci\.yml|azure-pipelines\.yml|\.circleci\/config\.yml)$/.test(relative));
  const docker = allFiles.filter((relative) => /(^|\/)(Dockerfile|docker-compose(?:\.[\w-]+)?\.ya?ml)$/.test(relative));
  const deployment = allFiles.filter((relative) => /(^|\/)(vercel\.json|netlify\.toml|fly\.toml|render\.yaml|app\.yaml)$/.test(relative));
  let projectSizeBytes = 0;
  for (const relative of allFiles.slice(0, 20_000)) {
    try { projectSizeBytes += (await fs.stat(path.join(root, relative))).size; } catch { /* unreadable file is excluded from size evidence */ }
  }
  const commandNames = { typecheck: "typecheck", test: "test", build: "build", dev: "dev", production: scripts.start ? "start" : "" };
  return {
    projectId: project.id,
    rootPath: root,
    framework: [...new Set(frameworks)],
    languages: [...new Set(languages)],
    packageManager: manager,
    dependencies: [
      ...Object.entries(stringRecord(packageJson?.dependencies)).map(([name, version]) => ({ name, version, kind: "production" as const })),
      ...Object.entries(stringRecord(packageJson?.devDependencies)).map(([name, version]) => ({ name, version, kind: "development" as const })),
    ].sort((left, right) => left.name.localeCompare(right.name)),
    scripts,
    commands: Object.fromEntries(Object.entries(commandNames).filter(([, script]) => script && scripts[script]).map(([key, script]) => [key, `${manager || "npm"} run ${script}`])),
    envFiles,
    ci,
    docker,
    deployment,
    sourceFileCount: sourceFiles.length,
    totalFileCount: allFiles.length,
    projectSizeBytes,
    sourceRoots,
    detectedAt: new Date().toISOString(),
  };
}

export async function makeProjectSummary(projectPath: string): Promise<ProjectSummary> {
  const [git, profile] = await Promise.all([
    gitInfo(projectPath),
    detectProjectProfile({ id: projectId(projectPath), name: path.basename(projectPath), path: projectPath, provider: "Local", branch: "", lastActivity: "", projectType: "", modifiedFiles: 0, untrackedFiles: 0, ahead: 0, behind: 0, healthScore: null, securityStatus: "unknown", buildStatus: "unknown", testStatus: "unknown", syncStatus: "unknown" }),
  ]);
  const stats = await fs.stat(projectPath);
  const provider = git.remoteUrl?.includes("github.com") ? "GitHub" : git.isGit ? "Git" : "Local";
  return {
    id: projectId(projectPath), name: path.basename(projectPath), path: projectPath, provider, remoteUrl: git.remoteUrl, branch: git.branch,
    lastActivity: git.lastActivity === "No commits" ? stats.mtime.toISOString() : git.lastActivity,
    projectType: [...profile.framework, ...profile.languages.filter((language) => !profile.framework.includes(language))].join(" + ") || "Local project",
    modifiedFiles: git.modifiedFiles, untrackedFiles: git.untrackedFiles, ahead: git.ahead, behind: git.behind,
    healthScore: null, securityStatus: "unknown", buildStatus: "unknown", testStatus: "unknown", syncStatus: !git.isGit ? "unknown" : git.behind > 0 ? "warning" : "pass",
  };
}

async function candidateProjectPaths(root = getWorkspaceRoot()) {
  const candidates = new Set<string>([...openedPaths]);
  if (await pathExists(path.join(root, "package.json"))) candidates.add(root);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [] as Dirent[]);
  for (const entry of entries.filter((item) => item.isDirectory() && !item.name.startsWith(".")).slice(0, 100)) {
    const candidate = path.join(root, entry.name);
    const markers = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "composer.json"];
    if ((await Promise.all(markers.map((marker) => pathExists(path.join(candidate, marker))))).some(Boolean)) candidates.add(candidate);
  }
  return [...candidates];
}

async function allProjects() {
  const projects = await Promise.all((await candidateProjectPaths()).map(makeProjectSummary));
  return projects.sort((left, right) => right.lastActivity.localeCompare(left.lastActivity));
}

async function resolveProject(id: string) {
  return (await allProjects()).find((project) => project.id === id);
}

function issue(projectId: string, seed: string, severity: DiagnosticSeverity, category: DiagnosticCategory, title: string, message: string, options: Partial<Pick<ScanIssue, "file" | "line" | "description" | "confidence" | "fixability" | "source" | "suggestion">> = {}): ScanIssue {
  return {
    id: `${projectId}:${seed}`,
    severity,
    category,
    title,
    message,
    description: options.description || message,
    confidence: options.confidence || "high",
    fixability: options.fixability || "manual",
    source: options.source || "KForge",
    status: "open",
    file: options.file,
    line: options.line,
    suggestion: options.suggestion,
  };
}

async function toolAvailability(project: ProjectSummary, profile: ProjectProfile): Promise<ToolAvailability[]> {
  const typescriptAvailable = Boolean(profile.scripts.typecheck) || (await pathExists(path.join(project.path, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc")));
  const eslintAvailable = Boolean(profile.scripts.lint) || (await pathExists(path.join(project.path, "node_modules", ".bin", process.platform === "win32" ? "eslint.cmd" : "eslint")));
  const auditAvailable = profile.packageManager === "npm" && await pathExists(path.join(project.path, "package-lock.json"));
  const probe = async (name: ToolAvailability["name"], command: string, args: string[]): Promise<ToolAvailability> => {
    const result = await run(command, args, project.path, 5_000);
    return result.ok ? { name, available: true, version: result.output.split(/\r?\n/)[0] } : { name, available: false, reason: "Not available in the local environment." };
  };
  const [gitleaks, semgrep, sonar] = await Promise.all([probe("gitleaks", "gitleaks", ["version"]), probe("semgrep", "semgrep", ["--version"]), probe("sonar", "sonar-scanner", ["--version"])]);
  return [
    { name: "typescript", available: typescriptAvailable, reason: typescriptAvailable ? undefined : "No TypeScript compiler or typecheck script detected." },
    { name: "eslint", available: eslintAvailable, reason: eslintAvailable ? undefined : "No ESLint command or lint script detected." },
    { name: "npm-audit", available: auditAvailable, reason: auditAvailable ? undefined : "npm audit requires a package-lock.json file." },
    gitleaks, semgrep, sonar,
  ];
}

function parseTypecheckDiagnostics(projectId: string, output: string) {
  return output.split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(/^(.+?)\((\d+),(\d+)\): error TS(\d+): (.+)$/);
    if (!match) return [];
    return [issue(projectId, `typecheck-${match[1]}-${match[2]}-${match[4]}-${index}`, "high", "typecheck", `TypeScript TS${match[4]}`, match[5], { file: match[1].split(path.sep).join("/"), line: Number(match[2]), source: "TypeScript", fixability: "guided", suggestion: "Review the compiler diagnostic and the inferred types at the reported location." })];
  });
}

async function npmAuditIssues(project: ProjectSummary, profile: ProjectProfile) {
  if (profile.packageManager !== "npm" || !(await pathExists(path.join(project.path, "package-lock.json")))) return [] as ScanIssue[];
  const audit = await run("npm", ["audit", "--json", "--omit=dev", "--package-lock-only"], project.path, 60_000);
  let parsed: JsonRecord | null = null;
  try { const value: unknown = JSON.parse(audit.output); parsed = typeof value === "object" && value !== null ? value as JsonRecord : null; } catch { return [] as ScanIssue[]; }
  const vulnerabilities = recordOf(parsed?.vulnerabilities);
  return Object.entries(vulnerabilities).map(([name, raw]) => {
    const detail = recordOf(raw);
    const severityRaw = asString(detail.severity);
    const severity: DiagnosticSeverity = severityRaw === "critical" || severityRaw === "high" || severityRaw === "low" ? severityRaw : severityRaw === "moderate" ? "medium" : "info";
    const via = Array.isArray(detail.via) ? detail.via.map((entry) => typeof entry === "string" ? entry : asString(recordOf(entry).title)).filter(Boolean).join("; ") : "Reported by npm audit.";
    return issue(project.id, `npm-audit-${name}`, severity, "dependency", `${name}: ${severityRaw || "reported"} dependency finding`, via, { source: "npm audit", fixability: detail.fixAvailable ? "guided" : "manual", suggestion: detail.fixAvailable ? "Review and apply the offered dependency remediation." : "Review the advisory and update strategy." });
  });
}

async function trackedSensitiveFiles(project: ProjectSummary) {
  const result = await run("git", ["ls-files", ".env", ".env.*", "*.pem", "*.key", "id_rsa"], project.path);
  if (!result.ok) return [] as string[];
  return result.output.split(/\r?\n/).filter(Boolean);
}

async function completenessIssues(project: ProjectSummary, profile: ProjectProfile) {
  const markers = await findFiles(project.path, (relative) => sourceExtensions.has(path.extname(relative).toLowerCase()), 5_000);
  const issues: ScanIssue[] = [];
  for (const relative of markers) {
    try {
      const lines = (await fs.readFile(path.join(project.path, relative), "utf8")).split(/\r?\n/);
      lines.forEach((line, index) => {
        if (/\bTODO\b|\bFIXME\b/.test(line)) issues.push(issue(project.id, `marker-${relative}-${index + 1}`, "low", "completeness", "Implementation marker found", line.trim(), { file: relative, line: index + 1, source: "KForge completeness", confidence: "high", fixability: "guided", suggestion: "Classify the marker and create an implementation task before release." }));
      });
    } catch { /* unreadable source file is not a diagnostic */ }
  }
  if (!(await pathExists(path.join(project.path, "README.md")))) issues.push(issue(project.id, "missing-readme", "low", "completeness", "README is missing", "The project root has no README.md.", { source: "KForge completeness", fixability: "guided", suggestion: "Add concise local-development, test, build, and production instructions." }));
  if (profile.envFiles.length > 0 && !(await pathExists(path.join(project.path, ".env.example")))) issues.push(issue(project.id, "missing-env-example", "low", "completeness", "Environment example is missing", "Environment files were detected without a .env.example template.", { source: "KForge completeness", fixability: "guided", suggestion: "Provide non-secret variable names and safe example values in .env.example." }));
  return issues;
}

function statusForIssues(issues: ScanIssue[], categories: DiagnosticCategory[]) {
  const relevant = issues.filter((entry) => categories.includes(entry.category));
  if (relevant.some((entry) => entry.severity === "critical" || entry.severity === "high")) return "fail" as const;
  if (relevant.some((entry) => entry.severity === "medium" || entry.severity === "low")) return "warning" as const;
  return "pass" as const;
}

function metric(key: HealthMetric["key"], label: string, weight: number, status: WorkspaceStatus, score: number | null, evidence: string[], findings: string[]): HealthMetric {
  return { key, label, status, score, weight, evidence, findings, lastScan: new Date().toISOString() };
}

async function calculateHealth(project: ProjectSummary, profile: ProjectProfile, diagnostics: ScanIssue[], actionState: Partial<Record<WorkspaceAction, CommandResult>>, typecheckStatus: WorkspaceStatus): Promise<ProjectHealth> {
  const has = (category: DiagnosticCategory) => diagnostics.filter((entry) => entry.category === category);
  const security = has("security");
  const dependencies = has("dependency");
  const completeness = has("completeness");
  const typecheck = has("typecheck");
  const gitScore = !project.remoteUrl ? 60 : project.behind > 0 ? 70 : project.modifiedFiles + project.untrackedFiles > 0 ? 82 : 100;
  const checks = (result: CommandResult | undefined) => result ? (result.ok ? 100 : 0) : null;
  const deduction = (entries: ScanIssue[]) => entries.reduce((total, entry) => total + ({ critical: 45, high: 25, medium: 12, low: 5, info: 0 }[entry.severity]), 0);
  const statusFromScore = (score: number | null): WorkspaceStatus => score === null ? "unknown" : score >= 85 ? "pass" : score >= 60 ? "warning" : "fail";
  const metrics = [
    metric("codeQuality", "Code quality", 12, statusFromScore(typecheckStatus === "unknown" ? null : Math.max(0, 100 - deduction(typecheck))), typecheckStatus === "unknown" ? null : Math.max(0, 100 - deduction(typecheck)), [typecheckStatus === "unknown" ? "No TypeScript check was detected." : "TypeScript compiler result was collected."], typecheck.map((entry) => entry.title)),
    metric("security", "Security", 14, statusFromScore(Math.max(0, 100 - deduction(security))), Math.max(0, 100 - deduction(security)), ["Tracked secret-file check and available package security scan."], security.map((entry) => entry.title)),
    metric("dependencies", "Dependencies", 10, statusFromScore(Math.max(0, 100 - deduction(dependencies))), Math.max(0, 100 - deduction(dependencies)), [`${profile.dependencies.length} declared dependencies detected.`], dependencies.map((entry) => entry.title)),
    metric("tests", "Tests", 12, actionState.test ? (actionState.test.ok ? "pass" : "fail") : "unknown", checks(actionState.test), [actionState.test ? actionState.test.message : "Tests have not been run by KForge in this server session."], actionState.test?.ok ? [] : actionState.test ? [actionState.test.message] : []),
    metric("build", "Build", 12, actionState.build ? (actionState.build.ok ? "pass" : "fail") : "unknown", checks(actionState.build), [actionState.build ? actionState.build.message : "Build has not been run by KForge in this server session."], actionState.build?.ok ? [] : actionState.build ? [actionState.build.message] : []),
    metric("runtime", "Runtime", 10, actionState.runtime ? (actionState.runtime.ok ? "pass" : "fail") : "unknown", checks(actionState.runtime), [actionState.runtime ? actionState.runtime.message : "Runtime has not been verified by KForge in this server session."], actionState.runtime?.ok ? [] : actionState.runtime ? [actionState.runtime.message] : []),
    metric("git", "Git", 8, statusFromScore(gitScore), gitScore, [`Branch ${project.branch}; ${project.modifiedFiles} modified, ${project.untrackedFiles} untracked, ${project.behind} behind.`], project.behind ? ["Remote commits are available."] : []),
    metric("documentation", "Documentation", 6, statusFromScore((awaitableScore(profile.totalFileCount > 0 && profile.sourceFileCount > 0, 100))), awaitableScore(profile.totalFileCount > 0 && profile.sourceFileCount > 0, 100), [await pathExists(path.join(project.path, "README.md")) ? "README.md detected." : "README.md not detected."], diagnostics.filter((entry) => entry.id.includes("missing-readme")).map((entry) => entry.title)),
    metric("architecture", "Architecture", 8, statusFromScore(profile.sourceRoots.length ? 90 : profile.sourceFileCount ? 65 : 0), profile.sourceRoots.length ? 90 : profile.sourceFileCount ? 65 : 0, [profile.sourceRoots.length ? `Source roots: ${profile.sourceRoots.join(", ")}.` : "No conventional source root detected."], []),
    metric("completeness", "Project completeness", 8, statusFromScore(Math.max(0, 100 - deduction(completeness))), Math.max(0, 100 - deduction(completeness)), ["TODO/FIXME markers, README, and environment-template evidence were inspected."], completeness.map((entry) => entry.title)),
  ];
  const measured = metrics.filter((entry) => entry.score !== null);
  const totalWeight = measured.reduce((total, entry) => total + entry.weight, 0);
  return { score: totalWeight ? Math.round(measured.reduce((total, entry) => total + (entry.score || 0) * entry.weight, 0) / totalWeight) : null, evidenceCoverage: Math.round((measured.length / metrics.length) * 100), metrics, calculatedAt: new Date().toISOString() };
}

function awaitableScore(condition: boolean, score: number) {
  return condition ? score : 40;
}

export async function scanProject(project: ProjectSummary): Promise<ProjectScan> {
  const profile = await detectProjectProfile(project);
  const tools = await toolAvailability(project, profile);
  const diagnostics: ScanIssue[] = [];
  const actionState = latestActions.get(project.id) || {};
  const typecheckTool = tools.find((tool) => tool.name === "typescript");
  let typecheckStatus: WorkspaceStatus = "unknown";
  if (typecheckTool?.available) {
    const script = profile.scripts.typecheck ? "typecheck" : "";
    const execution = script ? await run(commandFor(profile.packageManager, script).command, commandFor(profile.packageManager, script).args, project.path, commandTimeoutMs) : await run(path.join(project.path, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc"), ["--noEmit"], project.path, commandTimeoutMs);
    typecheckStatus = execution.ok ? "pass" : "fail";
    if (!execution.ok) diagnostics.push(...parseTypecheckDiagnostics(project.id, execution.output));
    if (!execution.ok && !diagnostics.length) diagnostics.push(issue(project.id, "typecheck-command", "high", "typecheck", "Typecheck command failed", execution.output || "The TypeScript command exited with a non-zero status.", { source: "TypeScript", fixability: "guided", suggestion: "Inspect the TypeScript output and correct the project types before continuing." }));
  }
  const [sensitiveFiles, dependencyIssues, completeness] = await Promise.all([trackedSensitiveFiles(project), npmAuditIssues(project, profile), completenessIssues(project, profile)]);
  sensitiveFiles.forEach((file) => diagnostics.push(issue(project.id, `tracked-sensitive-${file}`, "high", "security", "Potentially sensitive file is tracked by Git", `${file} is version-controlled and requires review.`, { file, source: "Git", fixability: "guided", suggestion: "Move secrets to an ignored local file and rotate any exposed credentials." })));
  diagnostics.push(...dependencyIssues, ...completeness);
  if (project.modifiedFiles + project.untrackedFiles > 0) diagnostics.push(issue(project.id, "working-tree-changed", "info", "git", "Local changes are present", `${project.modifiedFiles} modified and ${project.untrackedFiles} untracked file(s) are present.`, { source: "Git", fixability: "manual", suggestion: "Review the diff before pulling, pushing, or creating a release." }));
  if (project.behind > 0) diagnostics.push(issue(project.id, "remote-behind", "medium", "git", "Remote updates are available", `The current branch is ${project.behind} commit(s) behind its upstream branch.`, { source: "Git", fixability: "guided", suggestion: "Pull and resolve conflicts before dependent work." }));
  const health = await calculateHealth(project, profile, diagnostics, actionState, typecheckStatus);
  return {
    projectId: project.id, scannedAt: new Date().toISOString(), profile, health, technology: [...profile.framework, ...profile.languages],
    git: { branch: project.branch, remoteUrl: project.remoteUrl, modifiedFiles: project.modifiedFiles, untrackedFiles: project.untrackedFiles, ahead: project.ahead, behind: project.behind },
    issues: diagnostics,
    summaries: { security: statusForIssues(diagnostics, ["security"]), dependencies: statusForIssues(diagnostics, ["dependency"]), tests: actionState.test ? (actionState.test.ok ? "pass" : "fail") : "unknown", build: actionState.build ? (actionState.build.ok ? "pass" : "fail") : "unknown", typecheck: typecheckStatus },
    tools,
  };
}

function addActivity(projectId: string, activity: Omit<WorkspaceActivity, "id" | "at">) {
  const entry: WorkspaceActivity = { id: randomUUID(), at: new Date().toISOString(), ...activity };
  activities.set(projectId, [entry, ...(activities.get(projectId) || [])].slice(0, 50));
}

async function runtimeCheck(project: ProjectSummary, profile: ProjectProfile): Promise<CommandResult> {
  const startedAt = new Date().toISOString();
  if (!profile.scripts.start) return { action: "runtime", projectId: project.id, ok: false, startedAt, completedAt: new Date().toISOString(), output: "", message: "No production start script was detected." };
  const port = 32100 + Math.floor(Math.random() * 500);
  const selected = commandFor(profile.packageManager, "start");
  const executable = process.platform === "win32" && ["npm", "pnpm", "yarn"].includes(selected.command) ? `${selected.command}.cmd` : selected.command;
  const child = spawn(executable, selected.args, { cwd: project.path, shell: process.platform === "win32" && executable.endsWith(".cmd"), windowsHide: true, env: { ...process.env, PORT: String(port) } });
  let output = "";
  child.stdout.on("data", (data: Buffer) => { output += data.toString(); });
  child.stderr.on("data", (data: Buffer) => { output += data.toString(); });
  const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  await wait(3_500);
  let ok = false;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(4_000) });
    ok = response.ok;
    output += `\nHTTP ${response.status} ${response.statusText}`;
  } catch (error: unknown) {
    output += `\n${error instanceof Error ? error.message : String(error)}`;
  }
  child.kill();
  return { action: "runtime", projectId: project.id, ok, startedAt, completedAt: new Date().toISOString(), exitCode: ok ? 0 : 1, output: output.trim(), message: ok ? "Runtime start and main-route HTTP check completed successfully." : "Runtime verification could not obtain a successful main-route response." };
}

export async function executeProjectAction(project: ProjectSummary, action: WorkspaceAction): Promise<CommandResult> {
  const startedAt = new Date().toISOString();
  const profile = await detectProjectProfile(project);
  if (action === "scan") {
    const scan = await scanProject(project);
    const highPriority = scan.issues.filter((entry) => entry.severity === "critical" || entry.severity === "high").length;
    const result: CommandResult = { action, projectId: project.id, ok: true, startedAt, completedAt: new Date().toISOString(), output: JSON.stringify(scan, null, 2), message: `Project scan completed with ${scan.issues.length} finding(s), ${highPriority} high-priority.` };
    latestActions.set(project.id, { ...(latestActions.get(project.id) || {}), [action]: result });
    addActivity(project.id, { kind: "scan", title: "Project scan completed", detail: result.message });
    return result;
  }
  if (action === "runtime") {
    const result = await runtimeCheck(project, profile);
    latestActions.set(project.id, { ...(latestActions.get(project.id) || {}), [action]: result });
    addActivity(project.id, { kind: "runtime", title: result.ok ? "Runtime verification passed" : "Runtime verification failed", detail: result.message });
    return result;
  }
  if ((action === "pull" || action === "push") && project.modifiedFiles + project.untrackedFiles > 0) return { action, projectId: project.id, ok: false, startedAt, completedAt: new Date().toISOString(), output: "", message: "Git operation blocked because the working tree contains local changes. Review or commit them first." };
  const scriptName = action === "typecheck" ? "typecheck" : action;
  const command = action === "test" || action === "build" || action === "typecheck" ? profile.scripts[scriptName] ? commandFor(profile.packageManager, scriptName) : null : { command: "git", args: [action] };
  if (!command) return { action, projectId: project.id, ok: false, startedAt, completedAt: new Date().toISOString(), output: "", message: `No ${action} script was detected in this project.` };
  const execution = await run(command.command, command.args, project.path, commandTimeoutMs);
  const result: CommandResult = { action, projectId: project.id, ok: execution.ok, startedAt, completedAt: new Date().toISOString(), exitCode: execution.code, output: execution.output, message: execution.ok ? `${action[0].toUpperCase()}${action.slice(1)} completed successfully.` : `${action[0].toUpperCase()}${action.slice(1)} failed.` };
  latestActions.set(project.id, { ...(latestActions.get(project.id) || {}), [action]: result });
  const kind = action === "test" || action === "build" || action === "typecheck" ? action : "git";
  addActivity(project.id, { kind, title: result.ok ? `${action} completed` : `${action} failed`, detail: result.message });
  return result;
}

router.get("/tasks", (req, res) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  res.json({ tasks: listTasks(projectId) });
});

router.get("/tasks/:taskId", (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found." });
  return res.json({ task });
});

router.post("/tasks/:taskId/cancel", (req, res) => {
  const result = cancelTask(req.params.taskId);
  if (!result.task) return res.status(404).json({ error: "Task not found." });
  if (!result.cancellable) return res.status(409).json({ error: "Only queued tasks can be cancelled. Running command processes are not falsely reported as cancelled.", task: result.task });
  return res.json({ task: result.task });
});

router.post("/tasks/:taskId/retry", (req, res) => {
  const task = retryTask(req.params.taskId);
  if (!task) return res.status(409).json({ error: "This task is not eligible for retry." });
  return res.status(202).json({ task });
});

async function gitCenter(project: ProjectSummary) {
  const [status, diffStat, branches, history, stash] = await Promise.all([
    run("git", ["status", "--porcelain=v1", "--branch"], project.path),
    run("git", ["diff", "--stat"], project.path),
    run("git", ["branch", "--format=%(refname:short)"], project.path),
    run("git", ["log", "-20", "--pretty=format:%H%x09%h%x09%s%x09%cI"], project.path),
    run("git", ["stash", "list"], project.path),
  ]);
  return {
    status: status.output,
    diffStat: diffStat.output,
    branches: branches.output.split(/\r?\n/).filter(Boolean),
    commits: history.output.split(/\r?\n/).filter(Boolean).map((line) => { const [sha, shortSha, subject, committedAt] = line.split("\t"); return { sha, shortSha, subject, committedAt }; }),
    stashes: stash.output.split(/\r?\n/).filter(Boolean),
  };
}

function githubSlug(remoteUrl?: string) {
  const match = remoteUrl?.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

router.get("/projects/:id/git", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  const git = await gitCenter(project);
  return res.json({ projectId: project.id, branch: project.branch, remoteUrl: project.remoteUrl, ...git });
});

router.post("/projects/:id/git/branches", async (req, res) => {
  const project = await resolveProject(req.params.id);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const confirmed = req.body?.confirmed === true;
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (!confirmed) return res.status(428).json({ error: "Creating a branch requires explicit confirmation.", permission: "ask" });
  if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.startsWith("-") || name.includes("..")) return res.status(400).json({ error: "Provide a safe branch name." });
  const result = await run("git", ["switch", "-c", name], project.path);
  return res.status(result.ok ? 201 : 422).json({ ok: result.ok, output: result.output, message: result.ok ? `Branch ${name} created.` : "Branch creation failed." });
});

router.get("/projects/:id/github", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  const slug = githubSlug(project.remoteUrl);
  if (!slug) return res.status(422).json({ error: "This project has no GitHub origin remote." });
  const [repository, issues, pullRequests, actions] = await Promise.all([
    run("gh", ["api", `repos/${slug}`], project.path, 20_000),
    run("gh", ["api", `repos/${slug}/issues?state=open&per_page=20`], project.path, 20_000),
    run("gh", ["api", `repos/${slug}/pulls?state=open&per_page=20`], project.path, 20_000),
    run("gh", ["api", `repos/${slug}/actions/runs?per_page=10`], project.path, 20_000),
  ]);
  const parse = (execution: CommandExecution) => { try { return execution.ok ? JSON.parse(execution.output) : { error: execution.output }; } catch { return { error: execution.output || "GitHub returned invalid JSON." }; } };
  return res.json({ slug, repository: parse(repository), issues: parse(issues), pullRequests: parse(pullRequests), actions: parse(actions) });
});

async function environmentExamplePreview(project: ProjectSummary, problem: ScanIssue) {
  if (!problem.id.endsWith(":missing-env-example")) return null;
  const profile = await detectProjectProfile(project);
  const source = profile.envFiles.find((file) => file === ".env") || profile.envFiles[0];
  if (!source) return null;
  const raw = await fs.readFile(path.join(project.path, source), "utf8");
  const keys = raw.split(/\r?\n/).map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=/)?.[1]).filter((key): key is string => Boolean(key));
  const content = keys.map((key) => `${key}=`).join("\n") + (keys.length ? "\n" : "");
  return { operation: "create", file: ".env.example", content, explanation: `Create a non-secret environment template from ${source} variable names. Existing values are never copied.` };
}

router.post("/projects/:id/problems/:problemId/preview", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  const scan = await scanProject(project);
  const problem = scan.issues.find((entry) => entry.id === req.params.problemId);
  if (!problem) return res.status(404).json({ error: "Problem not found in the latest real scan." });
  const preview = await environmentExamplePreview(project, problem);
  if (!preview) return res.status(422).json({ error: "This diagnostic has no verified automatic patch. Use its explanation and guided verification steps instead.", problem });
  return res.json({ problem, preview, permission: "edit-files: allow" });
});

router.post("/projects/:id/problems/:problemId/apply", async (req, res) => {
  const project = await resolveProject(req.params.id);
  const verify = req.body?.verify === true;
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  const scan = await scanProject(project);
  const problem = scan.issues.find((entry) => entry.id === req.params.problemId);
  if (!problem) return res.status(404).json({ error: "Problem not found in the latest real scan." });
  const preview = await environmentExamplePreview(project, problem);
  if (!preview) return res.status(422).json({ error: "This diagnostic has no verified automatic patch." });
  const snapshot = await createSnapshot(project.path, [preview.file], `Before applying ${problem.id}`);
  try {
    await fs.writeFile(path.join(project.path, preview.file), preview.content, "utf8");
    const verification: CommandResult[] = [];
    if (verify) {
      const profile = await detectProjectProfile(project);
      if (profile.scripts.typecheck) verification.push(await executeProjectAction(project, "typecheck"));
      if (profile.scripts.test) verification.push(await executeProjectAction(project, "test"));
      if (profile.scripts.build) verification.push(await executeProjectAction(project, "build"));
      if (verification.some((result) => !result.ok)) {
        await restoreSnapshot(project.path, snapshot.id);
        return res.status(422).json({ ok: false, rolledBack: true, snapshot, verification, error: "Verification failed; KForge restored the snapshot." });
      }
    }
    addActivity(project.id, { kind: "system", title: "Solution applied", detail: `${preview.file} created from variable names only.` });
    return res.json({ ok: true, snapshot, preview, verification, rolledBack: false });
  } catch (error: unknown) {
    await restoreSnapshot(project.path, snapshot.id).catch(() => undefined);
    return res.status(500).json({ ok: false, rolledBack: true, snapshot, error: error instanceof Error ? error.message : "KForge restored the snapshot after an apply error." });
  }
});

router.post("/projects/:id/pre-push-gate", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  const typecheck = await executeProjectAction(project, "typecheck");
  const tests = await executeProjectAction(project, "test");
  const build = await executeProjectAction(project, "build");
  const scan = await scanProject(await makeProjectSummary(project.path));
  const git = await gitCenter(await makeProjectSummary(project.path));
  const secrets = scan.issues.filter((entry) => entry.category === "security" && (entry.severity === "critical" || entry.severity === "high"));
  const ok = typecheck.ok && tests.ok && build.ok && secrets.length === 0;
  return res.status(ok ? 200 : 422).json({ ok, checks: { typecheck: typecheck.ok, tests: tests.ok, build: build.ok, security: secrets.length === 0, secrets: secrets.length === 0, gitDiff: git.diffStat || "clean" }, scan, git });
});

router.get("/ai/local", async (_req, res) => {
  res.json(await detectLocalAIProvider());
});

router.get("/projects/:id/snapshots", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  return res.json({ projectId: project.id, snapshots: await listSnapshots(project.path) });
});

router.post("/projects/:id/snapshots", async (req, res) => {
  const project = await resolveProject(req.params.id);
  const files = Array.isArray(req.body?.files) ? req.body.files.filter((file: unknown): file is string => typeof file === "string") : [];
  const reason = typeof req.body?.reason === "string" ? req.body.reason : "KForge manual snapshot";
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  try {
    const snapshot = await createSnapshot(project.path, files, reason);
    addActivity(project.id, { kind: "system", title: "Snapshot created", detail: `${snapshot.files.length} file(s) captured before modification.` });
    return res.status(201).json({ snapshot });
  } catch (error: unknown) {
    return res.status(422).json({ error: error instanceof Error ? error.message : "Snapshot could not be created." });
  }
});

router.post("/projects/:id/snapshots/:snapshotId/restore", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  try {
    const snapshot = await restoreSnapshot(project.path, req.params.snapshotId);
    addActivity(project.id, { kind: "system", title: "Snapshot restored", detail: `${snapshot.files.length} file(s) restored.` });
    return res.json({ snapshot });
  } catch (error: unknown) {
    return res.status(422).json({ error: error instanceof Error ? error.message : "Snapshot could not be restored." });
  }
});

router.post("/projects/:id/agent/plan", async (req, res) => {
  const project = await resolveProject(req.params.id);
  const mission = typeof req.body?.mission === "string" ? req.body.mission.trim() : "Review project diagnostics and propose a safe fix plan.";
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  const scan = await scanProject(project);
  const context = JSON.stringify({ project: { name: project.name, path: project.path, branch: project.branch }, profile: scan.profile, health: scan.health, diagnostics: scan.issues }, null, 2);
  try {
    const plan = await requestLocalPlan("You are KForge Engineer. You may read and plan only. Do not claim edits, test results, commits, pushes, or secret values. Return a concise ordered plan that names evidence and verification commands.", `Mission: ${mission}\n\nProject context:\n${context}`);
    addActivity(project.id, { kind: "system", title: "KForge Engineer generated a plan", detail: `Local provider: ${plan.provider.provider}.` });
    return res.json({ mission, provider: plan.provider, plan: plan.content, permissions: { readFiles: "allow", editFiles: "allow", runTests: "allow", runBuild: "allow", installPackage: "ask", deleteFile: "ask", gitCommit: "ask", gitPush: "ask", deploy: "ask", forcePush: "block", exposeSecret: "block" } });
  } catch (error: unknown) {
    const provider = await detectLocalAIProvider();
    return res.status(503).json({ error: error instanceof Error ? error.message : "Local AI is unavailable.", provider, permissions: { readFiles: "allow", editFiles: "allow", runTests: "allow", runBuild: "allow", installPackage: "ask", deleteFile: "ask", gitCommit: "ask", gitPush: "ask", deploy: "ask", forcePush: "block", exposeSecret: "block" } });
  }
});

router.post("/projects/open", async (req, res) => {
  const requestedPath = typeof req.body?.path === "string" ? path.resolve(req.body.path) : "";
  if (!requestedPath || !(await pathExists(requestedPath))) return res.status(400).json({ error: "Provide an existing local project directory." });
  try {
    if (!(await fs.stat(requestedPath)).isDirectory()) return res.status(400).json({ error: "The selected path is not a directory." });
    openedPaths.add(requestedPath);
    return res.json({ project: await makeProjectSummary(requestedPath) });
  } catch { return res.status(400).json({ error: "KForge could not read the selected project directory." }); }
});

router.post("/projects/clone", async (req, res) => {
  const remoteUrl = typeof req.body?.remoteUrl === "string" ? req.body.remoteUrl.trim() : "";
  const targetName = typeof req.body?.targetName === "string" ? req.body.targetName.trim() : "";
  if (!/^https:\/\/(github\.com|gitlab\.com)\/.+/.test(remoteUrl) || !/^[A-Za-z0-9._-]+$/.test(targetName)) return res.status(400).json({ error: "Provide a supported HTTPS repository URL and a safe target folder name." });
  const targetPath = path.join(getWorkspaceRoot(), targetName);
  if (await pathExists(targetPath)) return res.status(409).json({ error: "That target folder already exists." });
  const result = await run("git", ["clone", remoteUrl, targetPath], getWorkspaceRoot(), commandTimeoutMs);
  if (!result.ok) return res.status(422).json({ error: "Clone failed.", output: result.output });
  openedPaths.add(targetPath);
  const project = await makeProjectSummary(targetPath);
  addActivity(project.id, { kind: "git", title: "Repository cloned", detail: remoteUrl });
  return res.status(201).json({ project, output: result.output });
});

router.get("/projects", async (_req, res) => {
  const response: WorkspaceResponse = { root: getWorkspaceRoot(), projects: await allProjects(), generatedAt: new Date().toISOString() };
  res.json(response);
});

router.get("/projects/:id", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  const response: ProjectDetailResponse = { project, activities: activities.get(project.id) || [] };
  res.json(response);
});

router.get("/projects/:id/profile", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  res.json({ profile: await detectProjectProfile(project) });
});

router.get("/projects/:id/problems", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  const scan = await scanProject(project);
  res.json({ projectId: project.id, scannedAt: scan.scannedAt, problems: scan.issues, health: scan.health });
});

router.post("/projects/:id/tasks", async (req, res) => {
  const project = await resolveProject(req.params.id);
  const action = req.body?.action;
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (!isWorkspaceAction(action)) return res.status(400).json({ error: "Unsupported KForge action." });
  const kind: TaskKind = action === "pull" || action === "push" ? "git" : action;
  const task = startTask(project.id, kind, () => executeProjectAction(project, action));
  return res.status(202).json({ task });
});

router.post("/projects/:id/actions", async (req, res) => {
  const project = await resolveProject(req.params.id);
  const action = req.body?.action;
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (!isWorkspaceAction(action)) return res.status(400).json({ error: "Unsupported KForge action." });
  try {
    const result = await executeProjectAction(project, action);
    return res.status(result.ok ? 200 : 422).json(result);
  } catch (error: unknown) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "KForge could not complete the action." });
  }
});

export default router;

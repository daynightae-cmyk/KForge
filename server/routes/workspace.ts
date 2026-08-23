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
import { checkForModelUpdates, deleteOllamaModel, generateWithLocalAI, getModelCenter, getModelChangelog, getModelCompatibility, getOllamaRuntimeStatus, installModelUpdate, installOllamaModel, listAIProviders, setActiveModel, testAIConnection, verifyModelUpdate, type AIProviderId } from "../services/aiCenter";
import { createSnapshot, listSnapshots, restoreSnapshot } from "../services/snapshots";
import { buildAgentContext, buildLocalAIPlan, buildRulePlan, evaluatePatchQuality, generateVerifiedPatch, validateAndApplyPatch } from "../services/agent";
import { analyzeImpact, buildProjectGraph } from "../services/projectGraph";
import { executeAgentTool, isAgentToolName, listAgentTools, type ProjectToolHandlers } from "../services/agentTools";
import { appendTaskLog, attachMission, cancelTask, completeMission, getTask, initializeTaskStore, listTasks, retryTask, startTask, updateMissionStep, type KForgeMission, type KForgeTask, type TaskKind, type MissionType } from "../services/tasks";
import { createMissionFromStrategy, supportedMissionTypes } from "../services/missionStrategies";
import { executeMissionDag, type MissionStepExecution } from "../services/missionOrchestrator";
import { getLocalPlatformStatus, isOptionalOnlineFeatureEnabled, setLocalPlatformMode } from "../services/localPlatform";
import { getProjectTrust, setProjectTrust } from "../services/projectTrust";
import { applyDocumentationFix, auditDocumentation, previewDocumentationFix } from "../services/documentationAudit";
import { chooseProjectPerformance, clearProjectCache, projectCacheStatus } from "../services/projectPerformance";
import { detectSecurityTools, isSecurityToolId, runSecurityTool } from "../services/securityTools";
import { getMarketplace, previewMarketplaceInstall } from "../services/marketplace";
import { checkPreviewHealth, getPreviewStatus, restartPreview, startPreview, stopPreview } from "../services/previewRuntime";
import { collectionCategories, getProjectCollectionEntry, listProjectCollectionEntries, recordProjectOpened, recordProjectScanned, recordProjectTask, updateProjectCollection } from "../services/projectCollections";
import { readPlatformSettings, resetPlatformSettings, updatePlatformSettings } from "../services/platformSettings";

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

void initializeTaskStore(getWorkspaceRoot());

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

function commandResultFromTask(task: KForgeTask): CommandResult | undefined {
  if (!(["typecheck", "test", "build", "runtime"] as const).includes(task.kind as "typecheck" | "test" | "build" | "runtime")) return undefined;
  if ((task.status !== "succeeded" && task.status !== "failed") || !task.finishedAt) return undefined;
  const action = task.kind as CommandResult["action"];
  return {
    action,
    projectId: task.projectId,
    ok: task.status === "succeeded",
    startedAt: task.startedAt,
    completedAt: task.finishedAt,
    exitCode: task.exitCode,
    output: task.output || "",
    message: task.error || task.logs.at(-1)?.message || `${action} completed from persisted task evidence.`,
    evidenceSource: "persisted",
  };
}

export function actionEvidenceFromTasks(tasks: KForgeTask[], inMemory: Partial<Record<WorkspaceAction, CommandResult>> = {}): Partial<Record<WorkspaceAction, CommandResult>> {
  const persisted: Partial<Record<WorkspaceAction, CommandResult>> = {};
  const newestFirst = [...tasks].sort((left, right) => (right.finishedAt || right.startedAt).localeCompare(left.finishedAt || left.startedAt));
  for (const task of newestFirst) {
    const result = commandResultFromTask(task);
    if (result && !persisted[result.action]) persisted[result.action] = result;
  }
  return { ...persisted, ...inMemory };
}

function actionEvidence(projectId: string): Partial<Record<WorkspaceAction, CommandResult>> {
  return actionEvidenceFromTasks(listTasks(projectId), latestActions.get(projectId) || {});
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

async function detectedProjectCommand(project: ProjectSummary, profile: ProjectProfile, action: "test" | "build" | "typecheck") {
  const scriptName = action === "typecheck" ? "typecheck" : action;
  if (profile.scripts[scriptName]) return commandFor(profile.packageManager, scriptName);
  const root = project.path;
  if (await pathExists(path.join(root, "go.mod"))) return action === "test" ? { command: "go", args: ["test", "./..."] } : action === "build" ? { command: "go", args: ["build", "./..."] } : null;
  if (await pathExists(path.join(root, "Cargo.toml"))) return action === "test" ? { command: "cargo", args: ["test"] } : action === "build" ? { command: "cargo", args: ["build", "--release"] } : null;
  if (await pathExists(path.join(root, "pom.xml"))) return action === "test" ? { command: "mvn", args: ["test"] } : action === "build" ? { command: "mvn", args: ["package", "-DskipTests"] } : null;
  const gradle = await pathExists(path.join(root, process.platform === "win32" ? "gradlew.bat" : "gradlew"));
  if (gradle) return action === "test" ? { command: process.platform === "win32" ? "gradlew.bat" : "./gradlew", args: ["test"] } : action === "build" ? { command: process.platform === "win32" ? "gradlew.bat" : "./gradlew", args: ["build", "-x", "test"] } : null;
  const hasCsproj = (await fs.readdir(root, { withFileTypes: true }).catch(() => [] as Dirent[])).some((entry) => entry.name.endsWith(".csproj") || entry.name.endsWith(".sln"));
  if (hasCsproj) return action === "test" ? { command: "dotnet", args: ["test"] } : action === "build" ? { command: "dotnet", args: ["build", "--configuration", "Release"] } : null;
  const pythonManifest = ["pyproject.toml", "requirements.txt", "setup.py"].map((name) => path.join(root, name));
  if ((await Promise.all(pythonManifest.map(pathExists))).some(Boolean)) {
    const manifest = (await Promise.all(pythonManifest.map((file) => fs.readFile(file, "utf8").catch(() => "")))).join("\n");
    if (action === "test" && /(?:pytest|\[tool\.pytest)/i.test(manifest)) return { command: "python", args: ["-m", "pytest"] };
  }
  return null;
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
  if (has("express")) frameworks.push("Express");
  if (has("@nestjs/core")) frameworks.push("NestJS");
  if (has("electron")) frameworks.push("Electron");
  if (rootNames.has("src-tauri") || has("@tauri-apps/api")) frameworks.push("Tauri");
  if (rootNames.has("pyproject.toml") || rootNames.has("requirements.txt") || rootNames.has("setup.py")) {
    languages.push("Python");
    const pythonManifest = await Promise.all(["pyproject.toml", "requirements.txt", "setup.py"].map((name) => fs.readFile(path.join(root, name), "utf8").catch(() => "")));
    const content = pythonManifest.join("\n");
    if (/fastapi/i.test(content)) frameworks.push("FastAPI");
    if (/django/i.test(content)) frameworks.push("Django");
    if (/flask/i.test(content)) frameworks.push("Flask");
    if (/(?:pytest|\[tool\.pytest)/i.test(content) || rootNames.has("pytest.ini")) frameworks.push("pytest");
  }
  if (rootNames.has("pom.xml") || rootNames.has("build.gradle") || rootNames.has("build.gradle.kts")) {
    languages.push("Java");
    const javaFiles = await findFiles(root, (relative) => relative.endsWith(".java"), 20);
    if (rootNames.has("pom.xml")) frameworks.push("Maven");
    if (rootNames.has("build.gradle") || rootNames.has("build.gradle.kts")) frameworks.push("Gradle");
    if (javaFiles.length && await fileContains(path.join(root, rootNames.has("pom.xml") ? "pom.xml" : rootNames.has("build.gradle") ? "build.gradle" : "build.gradle.kts"), /spring(?:\s*-?boot)?/i)) frameworks.push("Spring Boot");
  }
  if (rootNames.has("go.mod")) { languages.push("Go"); frameworks.push("Go"); }
  if (rootNames.has("Cargo.toml")) { languages.push("Rust"); frameworks.push("Rust"); }
  if ([...rootNames].some((name) => name.endsWith(".sln") || name.endsWith(".csproj"))) { languages.push("C#"); frameworks.push(".NET"); }
  if (rootNames.has("composer.json")) {
    languages.push("PHP"); frameworks.push("PHP", "Composer");
    const composer = await readJson(path.join(root, "composer.json"));
    const composerDependencies = { ...stringRecord(composer?.require), ...stringRecord(composer?.["require-dev"]) };
    if (composerDependencies["laravel/framework"] || rootNames.has("artisan")) frameworks.push("Laravel");
  }
  if (has("typescript") || rootNames.has("tsconfig.json")) languages.push("TypeScript");
  if (packageJson) languages.push("JavaScript");

  const allFiles = await findFiles(root, () => true, 20_000);
  const sourceFiles = allFiles.filter((relative) => sourceExtensions.has(path.extname(relative).toLowerCase()));
  const sourceRoots = [...new Set(sourceFiles.map((relative) => relative.split("/")[0]).filter((name) => ["src", "app", "client", "server", "api", "lib", "cmd"].includes(name)))];
  const envFiles = allFiles.filter((relative) => !relative.startsWith("fixtures/") && /(^|\/)\.env(?:\.[^/]+)?$/.test(relative));
  const ci = allFiles.filter((relative) => relative.startsWith(".github/workflows/") || /(^|\/)(\.gitlab-ci\.yml|azure-pipelines\.yml|\.circleci\/config\.yml)$/.test(relative));
  const docker = allFiles.filter((relative) => /(^|\/)(Dockerfile|docker-compose(?:\.[\w-]+)?\.ya?ml)$/.test(relative));
  const deployment = allFiles.filter((relative) => /(^|\/)(vercel\.json|netlify\.toml|fly\.toml|render\.yaml|app\.yaml)$/.test(relative));
  const manifests = ["package.json", "pyproject.toml", "requirements.txt", "pytest.ini", "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "composer.json", "Makefile", "Dockerfile", "*.csproj"].filter((name) => rootNames.has(name) || [...rootNames].some((entry) => name === "*.csproj" && entry.endsWith(".csproj")));
  const lockfiles = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "poetry.lock", "Cargo.lock", "composer.lock", "gradle.lockfile"].filter((name) => rootNames.has(name));
  const testRoots = [...new Set(allFiles.map((relative) => relative.split("/")[0]).filter((name) => /^(test|tests|__tests__|spec|specs)$/i.test(name)))];
  const childManifests = allFiles.filter((relative) => /(^|\/)(package\.json|pyproject\.toml|go\.mod|Cargo\.toml|pom\.xml|composer\.json)$/.test(relative) && relative.includes("/"));
  const workspaceMarker = Boolean(packageJson?.workspaces) || ["pnpm-workspace.yaml", "lerna.json", "nx.json", "turbo.json", "settings.gradle", "settings.gradle.kts"].some((name) => rootNames.has(name));
  const workspaceKind = childManifests.length > 1 ? "monorepo" as const : workspaceMarker ? "workspace" as const : "single" as const;
  let projectSizeBytes = 0;
  for (const relative of allFiles.slice(0, 20_000)) {
    try { projectSizeBytes += (await fs.stat(path.join(root, relative))).size; } catch { /* unreadable file is excluded from size evidence */ }
  }
  const commands: Record<string, string> = {};
  const commandEvidence: Array<{ kind: "typecheck" | "test" | "build" | "dev" | "production" | "runtime"; command?: string; source: string; known: boolean; detail: string }> = [];
  const register = (kind: "typecheck" | "test" | "build" | "dev" | "production" | "runtime", command: string | undefined, source: string, detail: string) => {
    if (command) commands[kind] = command;
    const existing = commandEvidence.findIndex((entry) => entry.kind === kind);
    const evidence = { kind, command, source, known: Boolean(command), detail };
    if (existing >= 0 && (command || !commandEvidence[existing].known)) commandEvidence[existing] = evidence;
    else if (existing < 0) commandEvidence.push(evidence);
  };
  const scriptCommand = (name: string) => scripts[name] ? `${manager || "npm"} run ${name}` : undefined;
  register("typecheck", scriptCommand("typecheck"), "package.json", scripts.typecheck ? "Explicit package script." : "UNKNOWN: no explicit typecheck metadata.");
  register("test", scriptCommand("test"), "package.json", scripts.test ? "Explicit package script." : "UNKNOWN: no explicit package test script.");
  register("build", scriptCommand("build"), "package.json", scripts.build ? "Explicit package script." : "UNKNOWN: no explicit package build script.");
  register("dev", scriptCommand("dev"), "package.json", scripts.dev ? "Explicit package script." : "UNKNOWN: no explicit package development script.");
  register("production", scriptCommand("start"), "package.json", scripts.start ? "Explicit package production script." : "UNKNOWN: no explicit package production script.");
  register("runtime", scriptCommand("start"), "package.json", scripts.start ? "Runtime entrypoint is the explicit start script." : "UNKNOWN: no explicit runtime entrypoint.");
  const hasCommand = (kind: string) => Boolean(commands[kind]);
  if (rootNames.has("go.mod")) { if (!hasCommand("test")) register("test", "go test ./...", "go.mod", "Go module convention."); if (!hasCommand("build")) register("build", "go build ./...", "go.mod", "Go module convention."); }
  if (rootNames.has("Cargo.toml")) { if (!hasCommand("test")) register("test", "cargo test", "Cargo.toml", "Cargo manifest convention."); if (!hasCommand("build")) register("build", "cargo build --release", "Cargo.toml", "Cargo manifest convention."); }
  if (rootNames.has("pom.xml")) { if (!hasCommand("test")) register("test", "mvn test", "pom.xml", "Maven lifecycle metadata."); if (!hasCommand("build")) register("build", "mvn package -DskipTests", "pom.xml", "Maven lifecycle metadata."); }
  if (rootNames.has("build.gradle") || rootNames.has("build.gradle.kts")) { const wrapper = rootNames.has(process.platform === "win32" ? "gradlew.bat" : "gradlew") ? (process.platform === "win32" ? "gradlew.bat" : "./gradlew") : undefined; if (!hasCommand("test")) register("test", wrapper ? `${wrapper} test` : undefined, "Gradle wrapper", wrapper ? "Explicit project wrapper." : "UNKNOWN: Gradle wrapper not present."); if (!hasCommand("build")) register("build", wrapper ? `${wrapper} build -x test` : undefined, "Gradle wrapper", wrapper ? "Explicit project wrapper." : "UNKNOWN: Gradle wrapper not present."); }
  if ([...rootNames].some((name) => name.endsWith(".csproj") || name.endsWith(".sln"))) { if (!hasCommand("test")) register("test", "dotnet test", "*.csproj", ".NET project metadata."); if (!hasCommand("build")) register("build", "dotnet build --configuration Release", "*.csproj", ".NET project metadata."); }
  const pythonMetadata = ["pyproject.toml", "requirements.txt", "pytest.ini"].map((name) => path.join(root, name));
  const pythonText = (await Promise.all(pythonMetadata.map((file) => fs.readFile(file, "utf8").catch(() => "")))).join("\n");
  if (/(?:pytest|\[tool\.pytest)/i.test(pythonText) && !hasCommand("test")) register("test", "python -m pytest", "pyproject.toml/pytest.ini", "pytest metadata detected.");
  if (rootNames.has("composer.json")) { const composer = await readJson(path.join(root, "composer.json")); const composerScripts = stringRecord(composer?.scripts); if (composerScripts.test && !hasCommand("test")) register("test", "composer test", "composer.json", "Explicit Composer test script."); if (composerScripts.build && !hasCommand("build")) register("build", "composer build", "composer.json", "Explicit Composer build script."); }
  const runtimeEntrypoint = scripts.start ? "package.json#scripts.start" : rootNames.has("main.go") ? "main.go" : rootNames.has("Cargo.toml") ? "src/main.rs" : rootNames.has("artisan") ? "artisan" : undefined;
  const performance = chooseProjectPerformance(allFiles.length, projectSizeBytes);
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
    commands,
    commandEvidence,
    manifests,
    lockfiles,
    workspaceKind,
    testRoots,
    runtimeEntrypoint,
    performance,
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
  const [git, profile, trust] = await Promise.all([
    gitInfo(projectPath),
    detectProjectProfile({ id: projectId(projectPath), name: path.basename(projectPath), trust: "untrusted", path: projectPath, provider: "Local", branch: "", lastActivity: "", projectType: "", modifiedFiles: 0, untrackedFiles: 0, ahead: 0, behind: 0, healthScore: null, securityStatus: "unknown", buildStatus: "unknown", testStatus: "unknown", syncStatus: "unknown", tags: [], favorite: false, pinned: false, archived: false, categories: { recent: false, favorite: false, pinned: false, archive: false } }),
    getProjectTrust(getWorkspaceRoot(), projectPath),
  ]);
  const stats = await fs.stat(projectPath);
  const collection = await getProjectCollectionEntry(getWorkspaceRoot(), projectPath);
  const provider = git.remoteUrl?.includes("github.com") ? "GitHub" : git.isGit ? "Git" : "Local";
  return {
    id: projectId(projectPath), name: path.basename(projectPath), trust, path: projectPath, provider, remoteUrl: git.remoteUrl, branch: git.branch,
    lastActivity: git.lastActivity === "No commits" ? stats.mtime.toISOString() : git.lastActivity,
    projectType: [...profile.framework, ...profile.languages.filter((language) => !profile.framework.includes(language))].join(" + ") || "Local project",
    modifiedFiles: git.modifiedFiles, untrackedFiles: git.untrackedFiles, ahead: git.ahead, behind: git.behind,
    healthScore: null, securityStatus: "unknown", buildStatus: "unknown", testStatus: "unknown", syncStatus: !git.isGit ? "unknown" : git.behind > 0 ? "warning" : "pass",
    lastOpenedAt: collection.lastOpenedAt, lastScannedAt: collection.lastScannedAt, lastTaskAt: collection.lastTaskAt, tags: collection.tags, favorite: collection.favorite, pinned: collection.pinned, archived: collection.archived, categories: collectionCategories(collection),
  };
}

export async function candidateProjectPaths(root = getWorkspaceRoot()) {
  const candidates = new Set<string>();
  const knownPaths = [...openedPaths, ...(await listProjectCollectionEntries(root)).map((entry) => entry.path)];
  for (const candidate of knownPaths) {
    const stat = await fs.stat(candidate).catch(() => undefined);
    if (stat?.isDirectory()) candidates.add(candidate);
  }
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

function untrustedProjectError(action: string) {
  return { error: `UNTRUSTED PROJECT: ${action} is disabled until you explicitly approve execution for this local project. Read-only inspection remains available.`, permission: "ask", trust: "untrusted" as const };
}

function issue(projectId: string, seed: string, severity: DiagnosticSeverity, category: DiagnosticCategory, title: string, message: string, options: Partial<Pick<ScanIssue, "file" | "line" | "description" | "confidence" | "fixability" | "source" | "suggestion" | "rule" | "risk">> = {}): ScanIssue {
  const priority = severity === "critical" ? "P0" : severity === "high" ? "P1" : severity === "medium" ? "P2" : "P3";
  return {
    id: `${projectId}:${seed}`,
    severity,
    priority,
    category,
    title,
    message,
    description: options.description || message,
    confidence: options.confidence || "high",
    fixability: options.fixability || "manual",
    source: options.source || "KForge",
    status: "open",
    rule: options.rule,
    risk: options.risk || (options.fixability === "automatic" ? "safe" : options.fixability === "guided" ? "review" : options.fixability === "manual" ? "approval" : "blocked"),
    file: options.file,
    line: options.line,
    suggestion: options.suggestion,
  };
}

async function toolAvailability(project: ProjectSummary, profile: ProjectProfile, onlineOptional: boolean): Promise<ToolAvailability[]> {
  const trusted = project.trust === "trusted";
  const typescriptAvailable = trusted && (Boolean(profile.scripts.typecheck) || (await pathExists(path.join(project.path, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc"))));
  const eslintAvailable = trusted && (Boolean(profile.scripts.lint) || (await pathExists(path.join(project.path, "node_modules", ".bin", process.platform === "win32" ? "eslint.cmd" : "eslint"))));
  const auditAvailable = trusted && onlineOptional && profile.packageManager === "npm" && await pathExists(path.join(project.path, "package-lock.json"));
  const security = await detectSecurityTools(project.path, trusted);
  const external = (name: "gitleaks" | "semgrep" | "sonar") => {
    const tool = security.find((entry) => entry.id === name)!;
    return { name, available: tool.state === "AVAILABLE", version: tool.version, reason: tool.detail };
  };
  const blocked = "Execution is blocked in Untrusted Project Mode; read-only analysis remains available.";
  return [
    { name: "typescript", available: typescriptAvailable, reason: typescriptAvailable ? undefined : trusted ? "No TypeScript compiler or typecheck script detected." : blocked },
    { name: "eslint", available: eslintAvailable, reason: eslintAvailable ? undefined : trusted ? "No ESLint command or lint script detected." : blocked },
    { name: "npm-audit", available: auditAvailable, reason: auditAvailable ? undefined : !trusted ? blocked : !onlineOptional ? "Offline Mode blocks network-based npm audit; enable Online Optional and run an explicit audit to request registry data." : "npm audit requires a package-lock.json file." },
    external("gitleaks"), external("semgrep"), external("sonar"),
  ];
}

function parseTypecheckDiagnostics(projectId: string, output: string) {
  return output.split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(/^(.+?)\((\d+),(\d+)\): error TS(\d+): (.+)$/);
    if (!match) return [];
    return [issue(projectId, `typecheck-${match[1]}-${match[2]}-${match[4]}-${index}`, "high", "typecheck", `TypeScript TS${match[4]}`, match[5], { file: match[1].split(path.sep).join("/"), line: Number(match[2]), source: "TypeScript", fixability: "guided", suggestion: "Review the compiler diagnostic and the inferred types at the reported location." })];
  });
}

async function npmAuditIssues(project: ProjectSummary, profile: ProjectProfile, onlineOptional: boolean) {
  if (!onlineOptional || profile.packageManager !== "npm" || !(await pathExists(path.join(project.path, "package-lock.json")))) return [] as ScanIssue[];
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
  const markers = await findFiles(project.path, (relative) => sourceExtensions.has(path.extname(relative).toLowerCase()) && !relative.startsWith("fixtures/") && !/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(relative), 5_000);
  const issues: ScanIssue[] = [];
  for (const relative of markers) {
    try {
      const lines = (await fs.readFile(path.join(project.path, relative), "utf8")).split(/\r?\n/);
      lines.forEach((line, index) => {
        if (/^\s*(?:\/\/|\/\*|#)\s*(?:TODO|FIXME)\b/i.test(line)) issues.push(issue(project.id, `marker-${relative}-${index + 1}`, "low", "completeness", "Implementation marker found", line.trim(), { file: relative, line: index + 1, source: "KForge completeness", confidence: "high", fixability: "guided", suggestion: "Classify the marker and create an implementation task before release." }));
      });
    } catch { /* unreadable source file is not a diagnostic */ }
  }
  if (!(await pathExists(path.join(project.path, "README.md")))) issues.push(issue(project.id, "missing-readme", "low", "completeness", "README is missing", "The project root has no README.md.", { source: "KForge completeness", fixability: "guided", suggestion: "Add concise local-development, test, build, and production instructions." }));
  if (profile.envFiles.length > 0 && !(await pathExists(path.join(project.path, ".env.example")))) issues.push(issue(project.id, "missing-env-example", "low", "completeness", "Environment example is missing", "Environment files were detected without a .env.example template.", { source: "KForge completeness", fixability: "guided", suggestion: "Provide non-secret variable names and safe example values in .env.example." }));
  return issues;
}

async function advancedCompletionIssues(project: ProjectSummary) {
  const files = await findFiles(project.path, (relative) => sourceExtensions.has(path.extname(relative).toLowerCase()) && !relative.startsWith("fixtures/") && !/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(relative) && relative !== "server/routes/workspace.ts", 5_000);
  const findings: ScanIssue[] = [];
  for (const relative of files) {
    try {
      const lines = (await fs.readFile(path.join(project.path, relative), "utf8")).split(/\r?\n/);
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        const context = lines.slice(Math.max(0, index - 3), Math.min(lines.length, index + 4)).join("\n");
        if (/\b(?:TODO|FIXME)\b/i.test(trimmed) && /(?:mock|placeholder|not implemented|fake|stub)/i.test(context)) {
          findings.push(issue(project.id, `placeholder-marker-${relative}-${index + 1}`, "medium", "mock", "Placeholder implementation marker", trimmed, { file: relative, line: index + 1, source: "KForge completion", rule: "kforge/placeholder-marker", confidence: "high", fixability: "guided", risk: "review", suggestion: "Replace the placeholder with a verified implementation and add a focused test." }));
        }
        if (/\b(alert\(\s*["'](?:done|success|saved|completed)[^"']*["']\s*\)|console\.log\(\s*["'](?:saving|loading|done|success)[^"']*["']\s*\))/i.test(trimmed)) {
          findings.push(issue(project.id, `mock-feedback-${relative}-${index + 1}`, "low", "mock", "Suspicious mock feedback", trimmed, { file: relative, line: index + 1, source: "KForge completion", rule: "kforge/mock-feedback", confidence: "medium", fixability: "guided", risk: "review", suggestion: "Verify that a real persistence/network operation occurs before showing completion feedback." }));
        }
        if (/^(?:export\s+)?(?:async\s+)?function\s+\w+[^\{]*\{\s*\}$|=>\s*\{\s*\}\s*;?$/.test(trimmed)) {
          findings.push(issue(project.id, `empty-handler-${relative}-${index + 1}`, "low", "completeness", "Empty handler or function body", trimmed, { file: relative, line: index + 1, source: "KForge completion", rule: "kforge/empty-handler", confidence: "medium", fixability: "guided", risk: "review", suggestion: "Confirm whether this handler is intentionally empty; otherwise implement behavior and error handling." }));
        }
        if (/return\s+(?:\[\]|\{\})\s*;?\s*$/.test(trimmed) && /(?:TODO|FIXME|mock|placeholder|not implemented|fake|stub)/i.test(context)) {
          findings.push(issue(project.id, `empty-response-${relative}-${index + 1}`, "medium", "mock", "Suspicious empty response", trimmed, { file: relative, line: index + 1, source: "KForge completion", rule: "kforge/suspicious-empty-response", confidence: "medium", fixability: "guided", risk: "review", suggestion: "Verify whether the empty response is a safe domain result or an unfinished service implementation." }));
        }
      });
    } catch { /* unreadable source file is omitted from advanced completion evidence */ }
  }
  return findings;
}

async function lintIssues(project: ProjectSummary, profile: ProjectProfile, tools: ToolAvailability[]) {
  if (!profile.scripts.lint || !tools.find((entry) => entry.name === "eslint")?.available) return [] as ScanIssue[];
  const command = commandFor(profile.packageManager, "lint");
  const result = await run(command.command, command.args, project.path, commandTimeoutMs);
  if (result.ok) return [] as ScanIssue[];
  const parsed = result.output.split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(/^(.+?):(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}(\S+))?$/i);
    if (!match) return [];
    return [issue(project.id, `eslint-${match[1]}-${match[2]}-${index}`, match[4].toLowerCase() === "error" ? "medium" : "low", "quality", `ESLint ${match[4].toLowerCase()}`, match[5], { file: match[1].split(path.sep).join("/"), line: Number(match[2]), source: "ESLint", rule: match[6], confidence: "high", fixability: "guided", risk: "review", suggestion: "Review the ESLint rule and use the project formatter/fix command only after previewing the change." })];
  });
  return parsed.length ? parsed : [issue(project.id, "eslint-command", "medium", "quality", "ESLint command failed", result.output || "The lint command exited unsuccessfully.", { source: "ESLint", rule: "eslint/command", confidence: "high", fixability: "guided", risk: "review", suggestion: "Inspect lint output before applying fixes." })];
}

async function externalScannerIssues(_project: ProjectSummary, _tools: ToolAvailability[]) {
  // External security scanners are intentionally explicit. Automatic scan flows only report availability;
  // the dedicated Security Tool Manager captures an approved tool run and normalized evidence.
  return [] as ScanIssue[];
}

async function secretLiteralIssues(project: ProjectSummary) {
  const candidates = await findFiles(project.path, (relative) => /(?:\.(?:[cm]?[jt]sx?|py|java|go|rs|cs|php|env)|(?:^|\/)\.env(?:\.|$))$/i.test(relative) && !relative.startsWith("node_modules/") && !relative.startsWith(".git/"), 5_000);
  const patterns: Array<{ rule: string; expression: RegExp; title: string; severity: DiagnosticSeverity }> = [
    { rule: "kforge/private-key", expression: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, title: "Private key material detected", severity: "critical" },
    { rule: "kforge/github-token", expression: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/, title: "GitHub token pattern detected", severity: "high" },
    { rule: "kforge/aws-access-key", expression: /\bAKIA[0-9A-Z]{16}\b/, title: "AWS access-key pattern detected", severity: "high" },
    { rule: "kforge/hardcoded-secret", expression: /(?:api[_-]?key|token|secret|password|private[_-]?key)\s*[:=]\s*["'][^"'\s]{12,}["']/i, title: "Hardcoded credential pattern detected", severity: "high" },
  ];
  const findings: ScanIssue[] = [];
  for (const relative of candidates) {
    const content = await fs.readFile(path.join(project.path, relative), "utf8").catch(() => "");
    content.split(/\r?\n/).forEach((line, index) => {
      for (const pattern of patterns) {
        if (!pattern.expression.test(line)) continue;
        findings.push(issue(project.id, `secret-${pattern.rule}-${relative}-${index + 1}`, pattern.severity, "security", pattern.title, `${pattern.title} at ${relative}:${index + 1}. Sensitive value content is not retained in KForge diagnostics.`, { file: relative, line: index + 1, source: "KForge secret scanner", rule: pattern.rule, confidence: "medium", fixability: "guided", risk: "approval", suggestion: "Remove the secret from source control, rotate it if real, and keep only a safe environment-variable reference." }));
        break;
      }
    });
  }
  return findings;
}

function statusForIssues(issues: ScanIssue[], categories: DiagnosticCategory[]) {
  const relevant = issues.filter((entry) => categories.includes(entry.category));
  if (relevant.some((entry) => entry.severity === "critical" || entry.severity === "high")) return "fail" as const;
  if (relevant.some((entry) => entry.severity === "medium" || entry.severity === "low")) return "warning" as const;
  return "pass" as const;
}

function metric(key: HealthMetric["key"], label: string, weight: number, status: WorkspaceStatus, score: number | null, evidence: string[], findings: string[], details: Partial<Pick<HealthMetric, "lastScan" | "evidenceSource" | "evidenceAgeMs" | "freshness">> = {}): HealthMetric {
  const lastScan = details.lastScan || new Date().toISOString();
  return { key, label, status, score, weight, evidence, findings, lastScan, evidenceSource: details.evidenceSource || "KForge current scan", evidenceAgeMs: details.evidenceAgeMs ?? Math.max(0, Date.now() - new Date(lastScan).getTime()), freshness: details.freshness || "current-scan" };
}

export const STALE_TASK_EVIDENCE_MS = 24 * 60 * 60 * 1_000;

export function taskEvidenceDetails(result: CommandResult | undefined): Partial<Pick<HealthMetric, "lastScan" | "evidenceSource" | "evidenceAgeMs" | "freshness">> {
  if (!result) return { evidenceSource: "No KForge task evidence", evidenceAgeMs: 0, freshness: "unknown" };
  const persisted = result.evidenceSource === "persisted";
  const evidenceAgeMs = Math.max(0, Date.now() - new Date(result.completedAt).getTime());
  const stale = persisted && evidenceAgeMs > STALE_TASK_EVIDENCE_MS;
  return { lastScan: result.completedAt, evidenceSource: stale ? "KForge persisted task evidence (stale)" : persisted ? "KForge persisted task evidence" : "KForge live task evidence", evidenceAgeMs, freshness: stale ? "stale-task" : persisted ? "persisted-task" : "live-task" };
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
    metric("tests", "Tests", 12, actionState.test ? (actionState.test.ok ? "pass" : "fail") : "unknown", checks(actionState.test), [actionState.test ? actionState.test.message : "Tests have not been run by KForge."], actionState.test?.ok ? [] : actionState.test ? [actionState.test.message] : [], taskEvidenceDetails(actionState.test)),
    metric("build", "Build", 12, actionState.build ? (actionState.build.ok ? "pass" : "fail") : "unknown", checks(actionState.build), [actionState.build ? actionState.build.message : "Build has not been run by KForge."], actionState.build?.ok ? [] : actionState.build ? [actionState.build.message] : [], taskEvidenceDetails(actionState.build)),
    metric("runtime", "Runtime", 10, actionState.runtime ? (actionState.runtime.ok ? "pass" : "fail") : "unknown", checks(actionState.runtime), [actionState.runtime ? actionState.runtime.message : "Runtime has not been verified by KForge."], actionState.runtime?.ok ? [] : actionState.runtime ? [actionState.runtime.message] : [], taskEvidenceDetails(actionState.runtime)),
    metric("git", "Git", 8, statusFromScore(gitScore), gitScore, [`Branch ${project.branch}; ${project.modifiedFiles} modified, ${project.untrackedFiles} untracked, ${project.behind} behind.`], project.behind ? ["Remote commits are available."] : []),
    metric("documentation", "Documentation", 6, statusFromScore((awaitableScore(profile.totalFileCount > 0 && profile.sourceFileCount > 0, 100))), awaitableScore(profile.totalFileCount > 0 && profile.sourceFileCount > 0, 100), [await pathExists(path.join(project.path, "README.md")) ? "README.md detected." : "README.md not detected."], diagnostics.filter((entry) => entry.id.includes("missing-readme")).map((entry) => entry.title)),
    metric("architecture", "Architecture", 8, statusFromScore(profile.sourceRoots.length ? 90 : profile.sourceFileCount ? 65 : 0), profile.sourceRoots.length ? 90 : profile.sourceFileCount ? 65 : 0, [profile.sourceRoots.length ? `Source roots: ${profile.sourceRoots.join(", ")}.` : "No conventional source root detected."], []),
    metric("completeness", "Project completeness", 8, statusFromScore(Math.max(0, 100 - deduction(completeness))), Math.max(0, 100 - deduction(completeness)), ["TODO/FIXME markers, README, and environment-template evidence were inspected."], completeness.map((entry) => entry.title)),
  ];
  const measured = metrics.filter((entry) => entry.score !== null);
  const totalWeight = measured.reduce((total, entry) => total + entry.weight, 0);
  const toDecisionEntry = (entry: ScanIssue) => ({ title: entry.title, source: entry.source, file: entry.file, issueId: entry.id });
  const blockingIssues = diagnostics.filter((entry) => entry.severity === "critical" || entry.severity === "high");
  const warningIssues = diagnostics.filter((entry) => entry.severity === "medium" || entry.severity === "low");
  const failedMetrics = metrics.filter((entry) => entry.status === "fail");
  const unknownVerification = metrics.filter((entry) => ["tests", "build", "runtime"].includes(entry.key) && entry.status === "unknown");
  const staleVerification = metrics.filter((entry) => ["tests", "build", "runtime"].includes(entry.key) && entry.freshness === "stale-task");
  const blockers = [...blockingIssues.map(toDecisionEntry), ...failedMetrics.map((entry) => ({ title: `${entry.label} failed`, source: "KForge health" }))];
  const warnings = [...warningIssues.map(toDecisionEntry), ...unknownVerification.map((entry) => ({ title: `${entry.label} has not been verified`, source: "KForge health" })), ...staleVerification.map((entry) => ({ title: `${entry.label} evidence is stale`, source: "KForge health" }))];
  const releaseState: ProjectHealth["release"]["state"] = blockers.length ? "BLOCKED" : warnings.length ? "READY WITH WARNINGS" : "READY";
  const release = { state: releaseState, blockers, warnings, evidence: metrics.flatMap((entry) => entry.evidence) };
  return { score: totalWeight ? Math.round(measured.reduce((total, entry) => total + (entry.score || 0) * entry.weight, 0) / totalWeight) : null, evidenceCoverage: Math.round((measured.length / metrics.length) * 100), metrics, release, calculatedAt: new Date().toISOString() };
}

function awaitableScore(condition: boolean, score: number) {
  return condition ? score : 40;
}

export async function scanProject(project: ProjectSummary): Promise<ProjectScan> {
  const profile = await detectProjectProfile(project);
  const onlineOptional = await isOptionalOnlineFeatureEnabled(getWorkspaceRoot());
  const tools = await toolAvailability(project, profile, onlineOptional);
  const diagnostics: ScanIssue[] = [];
  const actionState = actionEvidence(project.id);
  const typecheckTool = tools.find((tool) => tool.name === "typescript");
  let typecheckStatus: WorkspaceStatus = "unknown";
  if (typecheckTool?.available) {
    const script = profile.scripts.typecheck ? "typecheck" : "";
    const execution = script ? await run(commandFor(profile.packageManager, script).command, commandFor(profile.packageManager, script).args, project.path, commandTimeoutMs) : await run(path.join(project.path, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc"), ["--noEmit"], project.path, commandTimeoutMs);
    typecheckStatus = execution.ok ? "pass" : "fail";
    if (!execution.ok) diagnostics.push(...parseTypecheckDiagnostics(project.id, execution.output));
    if (!execution.ok && !diagnostics.length) diagnostics.push(issue(project.id, "typecheck-command", "high", "typecheck", "Typecheck command failed", execution.output || "The TypeScript command exited with a non-zero status.", { source: "TypeScript", fixability: "guided", suggestion: "Inspect the TypeScript output and correct the project types before continuing." }));
  }
  const safeReadOnly = project.trust !== "trusted";
  const [sensitiveFiles, secretLiterals, dependencyIssues, completeness, advancedCompletion, eslintFindings, externalFindings] = await Promise.all([trackedSensitiveFiles(project), secretLiteralIssues(project), safeReadOnly || !onlineOptional ? Promise.resolve([] as ScanIssue[]) : npmAuditIssues(project, profile, onlineOptional), completenessIssues(project, profile), advancedCompletionIssues(project), safeReadOnly ? Promise.resolve([] as ScanIssue[]) : lintIssues(project, profile, tools), externalScannerIssues(project, tools)]);
  sensitiveFiles.forEach((file) => diagnostics.push(issue(project.id, `tracked-sensitive-${file}`, "high", "security", "Potentially sensitive file is tracked by Git", `${file} is version-controlled and requires review.`, { file, source: "Git", rule: "git/tracked-sensitive-file", fixability: "guided", risk: "approval", suggestion: "Move secrets to an ignored local file and rotate any exposed credentials." })));
  diagnostics.push(...secretLiterals, ...dependencyIssues, ...completeness, ...advancedCompletion, ...eslintFindings, ...externalFindings);
  if (project.modifiedFiles + project.untrackedFiles > 0) diagnostics.push(issue(project.id, "working-tree-changed", "info", "git", "Local changes are present", `${project.modifiedFiles} modified and ${project.untrackedFiles} untracked file(s) are present.`, { source: "Git", fixability: "manual", suggestion: "Review the diff before pulling, pushing, or creating a release." }));
  if (project.behind > 0) diagnostics.push(issue(project.id, "remote-behind", "medium", "git", "Remote updates are available", `The current branch is ${project.behind} commit(s) behind its upstream branch.`, { source: "Git", fixability: "guided", suggestion: "Pull and resolve conflicts before dependent work." }));
  const health = await calculateHealth(project, profile, diagnostics, actionState, typecheckStatus);
  const scannedAt = new Date().toISOString();
  await recordProjectScanned(getWorkspaceRoot(), project.path);
  return {
    projectId: project.id, scannedAt, profile, health, technology: [...profile.framework, ...profile.languages],
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
  await recordProjectTask(getWorkspaceRoot(), project.path);
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
  if ((action === "pull" || action === "push") && !(await isOptionalOnlineFeatureEnabled(getWorkspaceRoot()))) return { action, projectId: project.id, ok: false, startedAt, completedAt: new Date().toISOString(), output: "", message: "Remote Git sync is disabled in Offline Mode. Switch KForge to Online Optional only when you explicitly want to contact a remote." };
  if ((action === "pull" || action === "push") && project.modifiedFiles + project.untrackedFiles > 0) return { action, projectId: project.id, ok: false, startedAt, completedAt: new Date().toISOString(), output: "", message: "Git operation blocked because the working tree contains local changes. Review or commit them first." };
  const command = action === "test" || action === "build" || action === "typecheck" ? await detectedProjectCommand(project, profile, action) : { command: "git", args: [action] };
  if (!command) return { action, projectId: project.id, ok: false, startedAt, completedAt: new Date().toISOString(), output: "", message: `No verified ${action} command was detected from the project manifests.` };
  const execution = await run(command.command, command.args, project.path, commandTimeoutMs);
  const result: CommandResult = { action, projectId: project.id, ok: execution.ok, startedAt, completedAt: new Date().toISOString(), exitCode: execution.code, output: execution.output, message: execution.ok ? `${action[0].toUpperCase()}${action.slice(1)} completed successfully.` : `${action[0].toUpperCase()}${action.slice(1)} failed.` };
  latestActions.set(project.id, { ...(latestActions.get(project.id) || {}), [action]: result });
  const kind = action === "test" || action === "build" || action === "typecheck" ? action : "git";
  addActivity(project.id, { kind, title: result.ok ? `${action} completed` : `${action} failed`, detail: result.message });
  return result;
}

router.get("/projects/:id/security/tools", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  const tools = await detectSecurityTools(project.path, project.trust === "trusted");
  return res.json({ projectId: project.id, trust: project.trust, tools });
});

router.post("/projects/:id/security/tools/:tool/run", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (!isSecurityToolId(req.params.tool)) return res.status(400).json({ error: "Unknown security tool." });
  if (project.trust !== "trusted") return res.status(428).json(untrustedProjectError("Security tool execution"));
  const result = await runSecurityTool(project.path, true, await isOptionalOnlineFeatureEnabled(getWorkspaceRoot()), req.params.tool);
  const status = result.state === "PASSED" || result.state === "AVAILABLE" || result.state === "CONFIGURED" ? 200 : result.state === "BLOCKED" ? 409 : 422;
  return res.status(status).json({ projectId: project.id, tool: result });
});

router.get("/marketplace", async (_req, res) => {
  const workspaceRoot = getWorkspaceRoot();
  return res.json(await getMarketplace(workspaceRoot, await isOptionalOnlineFeatureEnabled(workspaceRoot)));
});

router.get("/marketplace/items/:id/install-preview", async (req, res) => {
  const workspaceRoot = getWorkspaceRoot();
  try {
    const preview = await previewMarketplaceInstall(workspaceRoot, await isOptionalOnlineFeatureEnabled(workspaceRoot), req.params.id);
    return res.json(preview);
  } catch (error: unknown) {
    return res.status(404).json({ error: error instanceof Error ? error.message : "Marketplace item was not found." });
  }
});

router.get("/platform", async (_req, res) => {
  res.json(await getLocalPlatformStatus(getWorkspaceRoot()));
});

router.post("/platform/mode", async (req, res) => {
  const mode = req.body?.mode;
  if (mode !== "offline" && mode !== "online-optional") return res.status(400).json({ error: "Choose offline or online-optional mode." });
  res.json(await setLocalPlatformMode(getWorkspaceRoot(), mode));
});

router.get("/settings", async (_req, res) => {
  res.json({ settings: await readPlatformSettings(getWorkspaceRoot()) });
});

router.patch("/settings", async (req, res) => {
  res.json({ settings: await updatePlatformSettings(getWorkspaceRoot(), req.body) });
});

router.post("/settings/reset", async (req, res) => {
  if (req.body?.confirmed !== true) return res.status(428).json({ error: "Resetting platform settings requires explicit confirmation." });
  res.json({ settings: await resetPlatformSettings(getWorkspaceRoot()) });
});

router.get("/ai/providers", async (_req, res) => {
  res.json({ providers: await listAIProviders() });
});

router.get("/ai/models", async (_req, res) => {
  res.json(await getModelCenter(getWorkspaceRoot()));
});

router.get("/ai/ollama/status", async (_req, res) => {
  res.json(await getOllamaRuntimeStatus());
});

router.get("/ai/models/:model/update", async (req, res) => {
  try { return res.json(await checkForModelUpdates(getWorkspaceRoot(), req.params.model)); }
  catch (error: unknown) { return res.status(400).json({ error: error instanceof Error ? error.message : "Model update check failed." }); }
});

router.get("/ai/models/:model/changelog", async (req, res) => {
  try { return res.json(await getModelChangelog(getWorkspaceRoot(), req.params.model)); }
  catch (error: unknown) { return res.status(400).json({ error: error instanceof Error ? error.message : "Model changelog lookup failed." }); }
});

router.get("/ai/models/:model/compatibility", async (req, res) => {
  try { return res.json(await getModelCompatibility(getWorkspaceRoot(), req.params.model)); }
  catch (error: unknown) { return res.status(400).json({ error: error instanceof Error ? error.message : "Model compatibility check failed." }); }
});

router.post("/ai/models/:model/update/install", async (req, res) => {
  try { return res.status(409).json(await installModelUpdate(getWorkspaceRoot(), req.params.model)); }
  catch (error: unknown) { return res.status(400).json({ error: error instanceof Error ? error.message : "Model update install preparation failed." }); }
});

router.post("/ai/models/:model/update/verify", async (req, res) => {
  try { return res.json(await verifyModelUpdate(getWorkspaceRoot(), req.params.model)); }
  catch (error: unknown) { return res.status(400).json({ error: error instanceof Error ? error.message : "Model update verification failed." }); }
});

router.post("/ai/models/active", async (req, res) => {
  const provider = typeof req.body?.provider === "string" ? req.body.provider as AIProviderId : undefined;
  const model = typeof req.body?.model === "string" ? req.body.model : "";
  if (!provider || !model) return res.status(400).json({ error: "Choose a provider and an installed model." });
  try {
    const fallback = req.body?.fallback === true;
    const selection = await setActiveModel(getWorkspaceRoot(), provider, model, fallback);
    return res.json(selection);
  } catch (error: unknown) {
    return res.status(422).json({ error: error instanceof Error ? error.message : "The active model could not be changed." });
  }
});

router.post("/ai/models/install", async (req, res) => {
  const provider = typeof req.body?.provider === "string" ? req.body.provider : "";
  const model = typeof req.body?.model === "string" ? req.body.model : "";
  const confirmed = req.body?.confirmed === true;
  if (provider !== "ollama" || !model) return res.status(400).json({ error: "KForge currently supports confirmed installation through Ollama only." });
  if (!(await isOptionalOnlineFeatureEnabled(getWorkspaceRoot()))) return res.status(409).json({ error: "Model downloads are disabled in Offline Mode. Existing local models remain usable; choose Online Optional only after you decide to download." });
  if (!confirmed) return res.status(428).json({ error: "Model download requires explicit confirmation because it can consume substantial disk, RAM, and network resources.", permission: "ask" });
  const task = startTask("ai-center", "agent", async () => installOllamaModel(model));
  return res.status(202).json({ task });
});

router.delete("/ai/models/:model", async (req, res) => {
  const provider = typeof req.body?.provider === "string" ? req.body.provider : "";
  const confirmed = req.body?.confirmed === true;
  if (provider !== "ollama") return res.status(400).json({ error: "KForge can remove local models through Ollama only." });
  if (!confirmed) return res.status(428).json({ error: "Removing a local model is destructive and requires explicit confirmation.", permission: "ask" });
  try {
    const result = await deleteOllamaModel(req.params.model);
    return res.status(result.ok ? 200 : 422).json(result);
  } catch (error: unknown) {
    return res.status(422).json({ error: error instanceof Error ? error.message : "The model could not be removed." });
  }
});

router.post("/ai/test", async (req, res) => {
  const provider = typeof req.body?.provider === "string" ? req.body.provider as AIProviderId : undefined;
  const model = typeof req.body?.model === "string" ? req.body.model : undefined;
  if (provider && !["ollama", "lm-studio", "llama-cpp"].includes(provider)) return res.status(403).json({ ok: false, error: "Cloud AI is not a core KForge capability and is never contacted by this local workspace route." });
  try {
    const result = await testAIConnection(getWorkspaceRoot(), provider, model);
    return res.json(result);
  } catch (error: unknown) {
    return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "AI connection test failed." });
  }
});

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

router.post("/tasks/:taskId/retry", async (req, res) => {
  const original = getTask(req.params.taskId);
  if (!original) return res.status(404).json({ error: "Task not found." });
  const inSession = retryTask(req.params.taskId);
  if (inSession) return res.status(202).json({ task: inSession });
  const action = original.recovery?.strategy === "replay-action" ? original.recovery.action : undefined;
  if (!action || !isWorkspaceAction(action)) return res.status(409).json({ error: "This interrupted task requires inspection or snapshot rollback; KForge will not replay an unsupported operation automatically.", task: original });
  const project = await resolveProject(original.projectId);
  if (!project) return res.status(404).json({ error: "Project for the interrupted task is no longer available." });
  if (project.trust !== "trusted") return res.status(428).json(untrustedProjectError("Interrupted task replay"));
  const task = startTask(project.id, original.kind, () => executeProjectAction(project, action), original.id, original.recovery);
  appendTaskLog(task.id, `Recovered from interrupted task ${original.id}; replaying explicit ${action} action after current trust validation.`, 5);
  return res.status(202).json({ task, recoveredFrom: original.id });
});

router.post("/tasks/:taskId/mission/resume", async (req, res) => {
  const original = getTask(req.params.taskId);
  const mission = original?.mission;
  if (!original || !mission) return res.status(404).json({ error: "Mission task not found." });
  if (!mission.recovery.resume || mission.recovery.recoveryRequired) return res.status(409).json({ error: "This mission cannot be resumed automatically because it contains interrupted write-capable work. Inspect or roll back the snapshot explicitly.", task: original });
  if (mission.state !== "interrupted") return res.status(409).json({ error: "Only an interrupted read-only mission can be resumed. Blocked and failed mission evidence must be inspected and retried through a new mission when appropriate.", task: original });
  const project = await resolveProject(original.projectId);
  if (!project) return res.status(404).json({ error: "Project for the persisted mission is no longer available." });
  if (project.trust !== "trusted") return res.status(428).json(untrustedProjectError("Mission resume"));
  let resumedTaskId = "";
  const resumed = startTask(project.id, "agent", async () => {
    const context: MissionExecutionContext = {};
    const execution = await executeMissionDag(resumedTaskId, (missionStep) => executeMissionStrategyStep(project, mission.type, missionStep, context));
    return { ok: execution.ok, blocked: execution.state === "blocked", message: `Resumed mission ${execution.state}.`, output: JSON.stringify({ mission: getTask(resumedTaskId)?.mission, execution, resumedFrom: original.id }, null, 2) };
  }, original.id);
  resumedTaskId = resumed.id;
  const cloned = JSON.parse(JSON.stringify(mission)) as KForgeMission;
  cloned.state = "recovering";
  cloned.status = "recovering";
  cloned.finishedAt = undefined;
  cloned.recovery = { ...cloned.recovery, resume: true, recoveryRequired: false, detail: `Resumed from interrupted mission task ${original.id}; only unfinished read-only steps are eligible for replay.` };
  for (const missionStep of cloned.steps) {
    if (missionStep.status === "blocked" && /Interrupted by a previous KForge session/i.test(missionStep.error || "")) { missionStep.status = "queued"; missionStep.error = undefined; missionStep.finishedAt = undefined; missionStep.logs.push("Queued for explicit safe replay after interruption."); }
  }
  attachMission(resumedTaskId, cloned);
  appendTaskLog(resumedTaskId, `Explicitly resumed read-only mission evidence from ${original.id}.`, 0);
  return res.status(202).json({ task: getTask(resumedTaskId) || resumed, resumedFrom: original.id });
});

router.post("/tasks/:taskId/mission/rollback", async (req, res) => {
  const task = getTask(req.params.taskId);
  const mission = task?.mission;
  if (!task || !mission) return res.status(404).json({ error: "Mission task not found." });
  if (!mission.snapshotId) return res.status(409).json({ error: "No snapshot is available for this mission; rollback cannot be claimed." });
  if (req.body?.confirmed !== true) return res.status(428).json({ error: "Rollback requires explicit confirmation.", snapshotId: mission.snapshotId });
  const project = await resolveProject(task.projectId);
  if (!project) return res.status(404).json({ error: "Project for the mission is no longer available." });
  if (project.trust !== "trusted") return res.status(428).json(untrustedProjectError("Mission rollback"));
  const restored = await restoreSnapshot(project.path, mission.snapshotId);
  mission.recovery = { ...mission.recovery, resume: false, rollback: false, recoveryRequired: false, detail: `Snapshot ${mission.snapshotId} restored explicitly at ${new Date().toISOString()}.` };
  mission.finalResult = { summary: "Snapshot rollback completed after explicit confirmation.", state: "blocked", recordedAt: new Date().toISOString() };
  appendTaskLog(task.id, `Explicit rollback restored snapshot ${mission.snapshotId}.`, 100);
  return res.json({ task, restored });
});

async function gitCenter(project: ProjectSummary) {
  const [status, diffStat, branches, history, stash, tags] = await Promise.all([
    run("git", ["status", "--porcelain=v1", "--branch"], project.path),
    run("git", ["diff", "--stat"], project.path),
    run("git", ["branch", "--format=%(refname:short)"], project.path),
    run("git", ["log", "-20", "--pretty=format:%H%x09%h%x09%s%x09%cI"], project.path),
    run("git", ["stash", "list"], project.path),
    run("git", ["tag", "--sort=-creatordate"], project.path),
  ]);
  return {
    status: status.output,
    diffStat: diffStat.output,
    branches: branches.output.split(/\r?\n/).filter(Boolean),
    commits: history.output.split(/\r?\n/).filter(Boolean).map((line) => { const [sha, shortSha, subject, committedAt] = line.split("\t"); return { sha, shortSha, subject, committedAt }; }),
    stashes: stash.output.split(/\r?\n/).filter(Boolean),
    tags: tags.output.split(/\r?\n/).filter(Boolean),
  };
}

async function smartCommitPreview(project: ProjectSummary) {
  const [status, diffStat] = await Promise.all([
    run("git", ["status", "--porcelain=v1"], project.path),
    run("git", ["diff", "--stat", "HEAD"], project.path),
  ]);
  const changes = status.output.split(/\r?\n/).filter(Boolean).map((line) => ({ status: line.slice(0, 2).trim() || "?", file: line.slice(3).trim() })).filter((entry) => entry.file);
  const areas = [...new Set(changes.map((entry) => entry.file.split(/[\\/]/)[0] || "root"))];
  const scope = areas.length === 1 ? areas[0].replace(/[^A-Za-z0-9_-]/g, "") || "workspace" : "workspace";
  const title = changes.length ? `chore(${scope}): update ${changes.length} file${changes.length === 1 ? "" : "s"}` : "chore: no working tree changes";
  const validations = Object.values(actionEvidence(project.id)).filter((entry): entry is CommandResult => Boolean(entry)).map((entry) => ({ action: entry.action, ok: entry.ok, completedAt: entry.completedAt, message: entry.message }));
  return { title, description: changes.length ? `Evidence-backed proposal generated from the current local Git status. Review the listed files and validation evidence before committing.` : "No local changes were detected; KForge will not propose an empty commit.", changedFiles: changes, diffStat: diffStat.output || "No tracked diff statistics are available.", validations, generatedAt: new Date().toISOString() };
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
  if (!(await isOptionalOnlineFeatureEnabled(getWorkspaceRoot()))) return res.status(428).json({ error: "GitHub metadata is disabled in Offline Mode. Enable Online Optional after reviewing purpose, data, and destination.", permission: "online-optional" });
  const slug = githubSlug(project.remoteUrl);
  if (!slug) return res.status(422).json({ error: "This project has no GitHub origin remote." });
  const [repository, issues, pullRequests, actions, releases] = await Promise.all([
    run("gh", ["api", `repos/${slug}`], project.path, 20_000),
    run("gh", ["api", `repos/${slug}/issues?state=open&per_page=20`], project.path, 20_000),
    run("gh", ["api", `repos/${slug}/pulls?state=open&per_page=20`], project.path, 20_000),
    run("gh", ["api", `repos/${slug}/actions/runs?per_page=10`], project.path, 20_000),
    run("gh", ["api", `repos/${slug}/releases?per_page=10`], project.path, 20_000),
  ]);
  const parse = (execution: CommandExecution) => { try { return execution.ok ? JSON.parse(execution.output) : { error: execution.output }; } catch { return { error: execution.output || "GitHub returned invalid JSON." }; } };
  return res.json({ slug, repository: parse(repository), issues: parse(issues), pullRequests: parse(pullRequests), actions: parse(actions), releases: parse(releases) });
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
  if (project.trust !== "trusted") return res.status(428).json(untrustedProjectError("Solution apply"));
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

async function releasePreparation(project: ProjectSummary) {
  const git = await gitCenter(project);
  const baseline = git.tags[0];
  const history = await run("git", baseline ? ["log", `${baseline}..HEAD`, "--pretty=format:%h%x09%s%x09%cI", "--max-count=80"] : ["log", "-20", "--pretty=format:%h%x09%s%x09%cI"], project.path);
  const commits = history.output.split(/\r?\n/).filter(Boolean).map((line) => { const [shortSha, subject, committedAt] = line.split("\t"); return { shortSha, subject, committedAt }; });
  const profile = await detectProjectProfile(project);
  let version: string | undefined;
  const packageManifest = profile.manifests.find((manifest) => manifest.endsWith("package.json"));
  if (packageManifest) { try { const raw = JSON.parse(await fs.readFile(path.join(project.path, packageManifest), "utf8")); version = typeof raw.version === "string" ? raw.version : undefined; } catch { /* Manifest is reported through profile discovery; malformed JSON is not invented as a version. */ } }
  const artifactNames = ["dist", "build", "out", "target", "release", "artifacts"];
  const artifacts = (await Promise.all(artifactNames.map(async (name) => { const absolute = path.join(project.path, name); try { const stat = await fs.stat(absolute); return stat.isDirectory() ? name : undefined; } catch { return undefined; } }))).filter((entry): entry is string => Boolean(entry));
  return { generatedAt: new Date().toISOString(), baselineTag: baseline || null, version: version || null, commits, artifacts, notes: commits.length ? commits.map((commit) => `- ${commit.subject} (${commit.shortSha})`).join("\n") : "No commits are available for a release note proposal.", notice: "This is a local preparation preview. It does not create a tag, commit, GitHub release, or remote request." };
}

router.post("/projects/:id/release-gate", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (project.trust !== "trusted") return res.status(428).json(untrustedProjectError("Release Gate execution"));
  const profile = await detectProjectProfile(project);
  const verification: CommandResult[] = [];
  if (profile.scripts.typecheck) verification.push(await executeProjectAction(project, "typecheck"));
  if (profile.scripts.test) verification.push(await executeProjectAction(project, "test"));
  if (profile.scripts.build) verification.push(await executeProjectAction(project, "build"));
  if (profile.scripts.start) verification.push(await executeProjectAction(project, "runtime"));
  const freshProject = await makeProjectSummary(project.path);
  const scan = await scanProject(freshProject);
  const failedVerification = verification.filter((entry) => !entry.ok);
  const blockers = scan.issues.filter((entry) => (entry.severity === "critical" || entry.severity === "high") && entry.status !== "ignored");
  const warnings = scan.issues.filter((entry) => entry.severity === "medium" || entry.severity === "low");
  const missingChecks = ["typecheck", "test", "build", "runtime"].filter((action) => !verification.some((entry) => entry.action === action));
  const readiness = blockers.length || failedVerification.length ? "BLOCKED" : warnings.length || missingChecks.length ? "READY WITH WARNINGS" : "READY";
  const preview = getPreviewStatus(project.id);
  return res.status(readiness === "BLOCKED" ? 422 : 200).json({ readiness, checks: verification.map((entry) => ({ action: entry.action, ok: entry.ok, message: entry.message })), missingChecks, preview: { state: preview.state, url: preview.url, health: preview.health, checkedAt: preview.checkedAt }, security: scan.issues.filter((entry) => entry.category === "security"), dependencies: scan.issues.filter((entry) => entry.category === "dependency"), completeness: scan.issues.filter((entry) => entry.category === "completeness" || entry.category === "mock"), blockers, warnings, scan });
});

router.get("/projects/:id/release/preparation", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  return res.json({ projectId: project.id, preparation: await releasePreparation(project) });
});

router.get("/projects/:id/commit-preview", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  return res.json({ projectId: project.id, proposal: await smartCommitPreview(project) });
});

router.post("/projects/:id/pre-push-gate", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (project.trust !== "trusted") return res.status(428).json(untrustedProjectError("Pre-push verification"));
  const typecheck = await executeProjectAction(project, "typecheck");
  const tests = await executeProjectAction(project, "test");
  const build = await executeProjectAction(project, "build");
  const runtime = await executeProjectAction(project, "runtime");
  const scan = await scanProject(await makeProjectSummary(project.path));
  const git = await gitCenter(await makeProjectSummary(project.path));
  const secrets = scan.issues.filter((entry) => entry.category === "security" && (entry.severity === "critical" || entry.severity === "high"));
  const releaseGate = scan.health.release.state === "READY";
  const ok = typecheck.ok && tests.ok && build.ok && runtime.ok && secrets.length === 0 && releaseGate;
  return res.status(ok ? 200 : 422).json({ ok, checks: { typecheck: typecheck.ok, tests: tests.ok, build: build.ok, runtime: runtime.ok, security: secrets.length === 0, secrets: secrets.length === 0, releaseGate, gitDiff: git.diffStat || "clean" }, scan, git });
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
  if (project.trust !== "trusted") return res.status(428).json(untrustedProjectError("Snapshot creation"));
  if (req.body?.confirmed !== true) return res.status(428).json({ error: "Snapshot creation requires explicit confirmation.", permission: "ask" });
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
  if (project.trust !== "trusted") return res.status(428).json(untrustedProjectError("Snapshot restore"));
  if (req.body?.confirmed !== true) return res.status(428).json({ error: "Snapshot restore requires explicit confirmation.", snapshotId: req.params.snapshotId });
  try {
    const snapshot = await restoreSnapshot(project.path, req.params.snapshotId);
    addActivity(project.id, { kind: "system", title: "Snapshot restored", detail: `${snapshot.files.length} file(s) restored.` });
    return res.json({ snapshot });
  } catch (error: unknown) {
    return res.status(422).json({ error: error instanceof Error ? error.message : "Snapshot could not be restored." });
  }
});

const agentPermissions = { readFiles: "allow", editFiles: "allow", runTests: "allow", runBuild: "allow", installPackage: "ask", deleteFile: "ask", gitCommit: "ask", gitPush: "ask", deploy: "ask", forcePush: "block", exposeSecret: "block" } as const;


function projectToolHandlers(project: ProjectSummary): ProjectToolHandlers {
  const action = (kind: WorkspaceAction) => async () => executeProjectAction(project, kind);
  return {
    typecheck: action("typecheck"),
    lint: async () => {
      const profile = await detectProjectProfile(project);
      if (!profile.scripts.lint) throw new Error("No lint script is detected for this project.");
      const command = commandFor(profile.packageManager, "lint");
      return run(command.command, command.args, project.path, commandTimeoutMs);
    },
    test: action("test"),
    build: action("build"),
    start: action("runtime"),
    health: action("runtime"),
    logs: async () => ({ activities: activities.get(project.id) || [], tasks: listTasks(project.id).slice(0, 25) }),
    gitStatus: async () => gitCenter(project),
    gitDiff: async () => ({ diffStat: (await gitCenter(project)).diffStat }),
    scan: async () => scanProject(project),
    sonar: async () => { const scan = await scanProject(project); return { issues: scan.issues, tools: scan.tools, health: scan.health }; },
    graph: async () => buildProjectGraph(project.path),
    dependencyAudit: async () => { const scan = await scanProject(project); return scan.issues.filter((entry) => entry.category === "dependency"); },
  };
}

interface MissionExecutionContext { scan?: ProjectScan; graph?: Awaited<ReturnType<typeof buildProjectGraph>>; patch?: Awaited<ReturnType<typeof generateVerifiedPatch>>; snapshotId?: string; documentation?: Awaited<ReturnType<typeof auditDocumentation>>; }

async function executeMissionStrategyStep(project: ProjectSummary, mission: MissionType, step: { id: string; tool: string; name: string }, context: MissionExecutionContext): Promise<MissionStepExecution> {
  const ensureScan = async () => context.scan ||= await scanProject(project);
  const command = async (action: WorkspaceAction) => { const result = await executeProjectAction(project, action); return { ok: result.ok, output: result, message: result.ok ? `${action} completed with local evidence.` : `${action} failed; evidence was recorded.` }; };
  switch (step.tool) {
    case "scan": { const scan = await ensureScan(); return { ok: true, output: { scannedAt: scan.scannedAt, issues: scan.issues.length, profile: scan.profile }, message: "Project scan completed." }; }
    case "prioritize_findings": { const scan = await ensureScan(); const findings = scan.issues.filter((issue) => ["critical", "high"].includes(issue.severity)); return { ok: true, output: { count: findings.length, findings }, message: `${findings.length} critical or high finding(s) prioritized from current scan evidence.` }; }
    case "build_context": { const scan = await ensureScan(); const bounded = await buildAgentContext(project, scan); return { ok: true, output: { files: bounded.files.map((file) => file.path), totalCharacters: bounded.totalCharacters }, message: "Bounded local context recorded without claiming an AI analysis." }; }
    case "analyze": { const scan = await ensureScan(); const finding = scan.issues.find((issue) => ["critical", "high"].includes(issue.severity)); return { ok: true, output: finding || { state: "NO_CRITICAL_OR_HIGH_FINDING" }, message: finding ? "Target finding analysis recorded from current scan evidence." : "No critical or high finding exists to analyze." }; }
    case "discovery_timing": { const started = performance.now(); const files = await findFiles(project.path, () => true, 5_000); const durationMs = Number((performance.now() - started).toFixed(2)); return { ok: true, output: { filesDiscovered: files.length, durationMs, limit: 5_000 }, message: `Local file discovery measured in ${durationMs}ms.` }; }
    case "search_timing": { const started = performance.now(); const candidates = await findFiles(project.path, (relative) => sourceExtensions.has(path.extname(relative).toLowerCase()), 5_000); const matches: string[] = []; for (const relative of candidates) { if (await fileContains(path.join(project.path, relative), /TODO|FIXME/i)) matches.push(relative); } const durationMs = Number((performance.now() - started).toFixed(2)); return { ok: true, output: { filesSearched: candidates.length, todoOrFixmeMatches: matches.length, durationMs, limit: 5_000 }, message: `Local source search measured in ${durationMs}ms.` }; }
    case "graph": { const graph = context.graph ||= await buildProjectGraph(project.path); return { ok: true, output: graph.summary, message: "Dependency graph completed." }; }
    case "sonar": { const result = await executeAgentTool(project.path, projectToolHandlers(project), "sonar"); return { ok: result.ok, output: result.output, message: result.ok ? "KForge Sonar evidence completed." : result.message }; }
    case "health": { const scan = await ensureScan(); return { ok: true, output: scan.health, message: "Project health evidence recorded." }; }
    case "dependency_audit": { const result = await executeAgentTool(project.path, projectToolHandlers(project), "dependency_audit"); return { ok: result.ok, output: result.output, message: result.ok ? "Dependency audit completed." : result.message }; }
    case "documentation_audit": { const scan = await ensureScan(); const documentation = context.documentation ||= await auditDocumentation(project.path, scan.profile); return { ok: true, output: documentation, message: "Documentation evidence completed." }; }
    case "git_status": { const git = await gitCenter(project); return { ok: true, output: git, message: "Local Git evidence completed." }; }
    case "git_diff": { const git = await gitCenter(project); return { ok: true, output: git.diffStat, message: "Local Git diff evidence completed." }; }
    case "typecheck": return command("typecheck");
    case "test": return command("test");
    case "build": return command("build");
    case "runtime": return command("runtime");
    case "secret_detection": { const scan = await ensureScan(); return { ok: true, output: scan.issues.filter((issue) => issue.category === "security"), message: "Secret-detection evidence recorded from KForge Sonar." }; }
    case "security_tools": return { ok: true, output: await detectSecurityTools(project.path, project.trust === "trusted"), message: "Local security-tool availability recorded; unavailable tools are not treated as pass." };
    case "permission_review": return { ok: true, output: agentPermissions, message: "Agent permission policy recorded." };
    case "test_framework": { const scan = await ensureScan(); return { ok: true, output: { packageManager: scan.profile.packageManager, testScript: scan.profile.scripts.test }, message: "Test framework evidence recorded." }; }
    case "test_inventory": { const scan = await ensureScan(); return { ok: true, output: { sourceFiles: scan.profile.sourceFileCount, testScript: scan.profile.scripts.test }, message: "Test inventory evidence recorded." }; }
    case "test_analysis": { const scan = await ensureScan(); return { ok: true, output: scan.issues.filter((issue) => issue.category === "test"), message: "Weak-area evidence recorded; no coverage improvement was inferred." }; }
    case "impact_analysis": { const graph = context.graph ||= await buildProjectGraph(project.path); return { ok: true, output: graph.summary, message: "Impact evidence recorded from the project graph." }; }
    case "architecture": { const scan = await ensureScan(); return { ok: true, output: scan.profile, message: "Architecture evidence recorded from local profile and scan." }; }
    case "candidate_files": { const scan = await ensureScan(); const bounded = await buildAgentContext(project, scan); return { ok: true, output: { files: bounded.files.map((file) => file.path) }, message: "Bounded candidate-file context recorded." }; }
    case "plan": { const scan = await ensureScan(); const contextForPlan = await buildAgentContext(project, scan); return { ok: true, output: buildRulePlan(contextForPlan), message: "Deterministic evidence-based plan recorded; no local AI claim was made." }; }
    case "patch_eligibility": { const scan = await ensureScan(); const target = mission === "improve-security" ? scan.issues.find((issue) => issue.category === "security" && ["critical", "high"].includes(issue.severity)) : scan.issues.find((issue) => ["critical", "high"].includes(issue.severity)); context.patch = target ? await generateVerifiedPatch(project, target) : undefined; return context.patch && context.patch.risk === "safe" ? { ok: true, output: { issue: target, patch: context.patch }, message: "A safe patch rule is eligible for explicit preview and confirmation." } : { ok: false, blocked: true, output: { issue: target }, message: "BLOCKED_MANUAL_REVIEW: no verified safe patch is available." }; }
    case "snapshot": { if (!context.patch) return { ok: false, blocked: true, message: "Snapshot is blocked because no verified patch is eligible." }; const snapshot = await createSnapshot(project.path, [context.patch.file], `Before V3 mission ${mission}: ${context.patch.id}`); context.snapshotId = snapshot.id; return { ok: true, output: snapshot, snapshotId: snapshot.id, message: "Snapshot created before any write-capable step." }; }
    case "patch_preview": return context.patch ? { ok: true, output: context.patch, message: "Safe patch preview recorded; no file was changed." } : { ok: false, blocked: true, message: "Patch preview is blocked because no safe patch is available." };
    case "confirmation": return { ok: false, blocked: true, output: { required: true, snapshotId: context.snapshotId }, message: "CONFIRMATION_REQUIRED: no write is executed until an explicit approved continuation is implemented and invoked." };
    case "patch_apply": {
      if (!context.patch || !context.snapshotId) return { ok: false, blocked: true, message: "Patch apply is blocked because a verified patch and snapshot are both required." };
      const quality = await evaluatePatchQuality(project.path, context.patch);
      if (!quality.ok || context.patch.risk !== "safe") return { ok: false, blocked: true, output: quality, message: "Patch Quality Gate blocked the write; no file was changed." };
      const applied = await validateAndApplyPatch(project.path, context.patch);
      return { ok: true, output: { applied, snapshotId: context.snapshotId }, changedFiles: [context.patch.file], snapshotId: context.snapshotId, message: "Verified patch applied only after snapshot and Quality Gate validation." };
    }
    case "cache_status": return { ok: true, output: projectCacheStatus(project.path), message: "Local cache status recorded." };
    case "memory_status": { const scan = await ensureScan(); return { ok: true, output: scan.profile.performance, message: "Detected performance budget recorded; no synthetic memory benchmark was reported." }; }
    case "summary": return { ok: true, output: { mission, step: step.id }, message: "Mission summary step completed from recorded evidence." };
    case "commit_preview": return { ok: true, output: { notice: "Preview only. KForge did not create a commit." }, message: "Commit preview recorded without a Git mutation." };
    case "test_evidence": return { ok: true, output: listTasks(project.id).filter((task) => task.kind === "test").slice(0, 5), message: "Persisted test evidence inspected." };
    case "build_evidence": return { ok: true, output: listTasks(project.id).filter((task) => task.kind === "build").slice(0, 5), message: "Persisted build evidence inspected." };
    case "release_evidence": { const scan = await ensureScan(); return { ok: true, output: scan.health.release, message: "Release evidence inspected." }; }
    case "github_checks": return { ok: true, output: { state: "LOCAL_ONLY", detail: "No remote GitHub mutation or fabricated remote-check result was attempted." }, message: "GitHub preview retained local-only evidence." };
    case "github_preview": return { ok: true, output: { state: "PREVIEW_ONLY", detail: "No pull request or release was created." }, message: "GitHub preview completed without remote mutation." };
    case "version": { const scan = await ensureScan(); return { ok: true, output: { packageManager: scan.profile.packageManager }, message: "Local version metadata evidence recorded." }; }
    case "artifacts": return { ok: true, output: { state: "NOT_CREATED", detail: "No release artifact is created by preparation missions." }, message: "Artifact preview recorded without creating output." };
    case "release_gate": { const scan = await ensureScan(); return { ok: scan.health.release.state === "READY", output: scan.health.release, message: scan.health.release.state === "READY" ? "Release gate is ready from current evidence." : "Release gate is not ready from current evidence." }; }
    default: return { ok: false, blocked: true, message: `No verified executor is registered for strategy tool '${step.tool}'.` };
  }
}

router.get("/projects/:id/agent/tools", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  return res.json({ projectId: project.id, tools: listAgentTools(), permissions: agentPermissions });
});

router.post("/projects/:id/agent/tools/:tool", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (!isAgentToolName(req.params.tool)) return res.status(400).json({ error: "Unknown or unregistered agent tool." });
  const readOnlyTools = new Set(["list_files", "read_file", "search_files", "find_symbol", "inspect_file"]);
  if (project.trust !== "trusted" && !readOnlyTools.has(req.params.tool)) return res.status(428).json(untrustedProjectError(`Agent tool ${req.params.tool}`));
  const input = typeof req.body === "object" && req.body !== null && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
  const result = await executeAgentTool(project.path, projectToolHandlers(project), req.params.tool, input);
  return res.status(result.ok ? 200 : result.permission === "dangerous" || result.permission === "safe-write" ? 428 : result.permission === "blocked" ? 403 : 422).json(result);
});

router.post("/projects/:id/agent/runs", async (req, res) => {
  const project = await resolveProject(req.params.id);
  const goal = typeof req.body?.goal === "string" ? req.body.goal.trim().slice(0, 800) : "Audit this project and report verified engineering findings.";
  const issueId = typeof req.body?.issueId === "string" ? req.body.issueId : undefined;
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (project.trust !== "trusted") return res.status(428).json(untrustedProjectError("Agent execution"));
  let taskId = "";
  const task = startTask(project.id, "agent", async () => {
    const log = (message: string, progress: number) => appendTaskLog(taskId, message, progress);
    const records: unknown[] = [];
    log("Analyzing project and collecting deterministic evidence.", 10);
    const scanResult = await executeAgentTool(project.path, projectToolHandlers(project), "scan");
    records.push(scanResult);
    if (!scanResult.ok) return { ok: false, message: "Agent scan failed; task is blocked.", output: JSON.stringify({ goal, records }, null, 2) };
    const scan = scanResult.output as ProjectScan;
    const context = await buildAgentContext(project, scan, issueId);
    log(`Selected ${context.files.length} redacted context file(s), ${context.totalCharacters} characters.`, 24);
    let plan: unknown;
    try { plan = await buildLocalAIPlan(getWorkspaceRoot(), context, goal); log("Local AI plan generated from the active model.", 36); }
    catch { plan = buildRulePlan(context); log("No active local model; using deterministic evidence plan.", 36); }
    const lowerGoal = goal.toLowerCase();
    const wants = (pattern: RegExp) => pattern.test(lowerGoal);
    const wantsTest = wants(/\btests?\b/);
    const wantsBuild = wants(/\bbuild\b/);
    const wantsRuntime = wants(/\b(runtime|start|health)\b/);
    const wantsRelease = wants(/\b(release|production)\b/);
    const wantsCommitSummary = wants(/\b(commit|diff)\b/);
    const requestedChecks: Array<"sonar" | "graph" | "typecheck" | "test" | "build" | "health" | "git_diff"> = ["sonar", "graph", "typecheck"];
    if (wantsRelease || wantsTest) requestedChecks.push("test");
    if (wantsRelease || wantsBuild) requestedChecks.push("build");
    if ((wantsRelease || wantsRuntime) && scan.profile.scripts.start) requestedChecks.push("health");
    if (wantsCommitSummary) requestedChecks.push("git_diff");
    for (let index = 0; index < requestedChecks.length; index += 1) {
      const tool = requestedChecks[index];
      log(`Running typed tool: ${tool}.`, 42 + Math.round((index / requestedChecks.length) * 35));
      const result = await executeAgentTool(project.path, projectToolHandlers(project), tool);
      records.push(result);
      if (!result.ok && ["typecheck", "test", "build", "health"].includes(tool)) log(`${tool} did not pass; agent keeps evidence and avoids unsupported repair claims.`, 80);
    }
    const wantsFix = /\b(fix|repair|resolve|correct)\b/i.test(goal);
    const targetIssue = issueId ? scan.issues.find((entry) => entry.id === issueId) : scan.issues.find((entry) => entry.severity === "critical" || entry.severity === "high");
    if (wantsFix && targetIssue) {
      log(`Evaluating safe patch rules for ${targetIssue.title}.`, 82);
      const patch = await generateVerifiedPatch(project, targetIssue);
      if (!patch) return { ok: false, message: "Agent stopped: the selected issue has no verified safe patch rule and requires review.", output: JSON.stringify({ goal, context, plan, records, targetIssue, status: "BLOCKED_MANUAL_REVIEW" }, null, 2) };
      const quality = await evaluatePatchQuality(project.path, patch);
      if (!quality.ok || patch.risk !== "safe") return { ok: false, message: "Agent stopped: Patch Quality Gate requires manual review.", output: JSON.stringify({ goal, context, plan, records, patch, quality, status: "BLOCKED_PATCH_QUALITY" }, null, 2) };
      log(`Creating snapshot for ${patch.file}.`, 87);
      const snapshot = await createSnapshot(project.path, [patch.file], `Before agent run ${taskId}: ${patch.id}`);
      try {
        log(`Applying verified patch to ${patch.file}.`, 91);
        const applied = await validateAndApplyPatch(project.path, patch);
        const verification: unknown[] = [];
        const profile = await detectProjectProfile(project);
        const verificationTools: Array<"typecheck" | "test" | "build" | "health"> = ["typecheck", "test", "build", ...(profile.scripts.start ? ["health" as const] : [])];
        for (const tool of verificationTools) {
          log(`Verifying with typed tool: ${tool}.`, 93);
          const result = await executeAgentTool(project.path, projectToolHandlers(project), tool);
          verification.push(result);
          if (!result.ok) {
            await restoreSnapshot(project.path, snapshot.id);
            return { ok: false, message: "Verification failed; agent restored the snapshot.", output: JSON.stringify({ goal, context, plan, records, patch, quality, snapshot, applied, verification, rolledBack: true }, null, 2) };
          }
        }
        return { ok: true, message: "Agent run completed with a verified safe patch.", output: JSON.stringify({ goal, context, plan, records, patch, quality, snapshot, applied, verification, rolledBack: false }, null, 2) };
      } catch (error: unknown) {
        await restoreSnapshot(project.path, snapshot.id).catch(() => undefined);
        return { ok: false, message: "Agent patch failed; snapshot restored.", output: error instanceof Error ? (error as Error).message : "Unknown patch error." };
      }
    }
    const commitSummary = wantsCommitSummary ? {
      title: "KForge verification summary (no commit created)",
      body: "The registered git_diff tool captured the current local diff. KForge did not create a Git commit or perform a remote operation.",
      changedFiles: "Use the attached git_diff tool evidence; no file list is inferred.",
      validation: requestedChecks.filter((tool) => tool !== "git_diff"),
    } : undefined;
    return { ok: true, message: "Agent run completed with evidence and typed-tool results.", output: JSON.stringify({ goal, context, plan, records, commitSummary, status: "COMPLETED_NO_AUTOFIX" }, null, 2) };
  });
  taskId = task.id;
  return res.status(202).json({ task, goal, permissions: agentPermissions });
});

router.get("/projects/:id/agent/context", async (req, res) => {
  const project = await resolveProject(req.params.id);
  const issueId = typeof req.query.issueId === "string" ? req.query.issueId : undefined;
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  const scan = await scanProject(project);
  return res.json({ context: await buildAgentContext(project, scan, issueId), permissions: agentPermissions });
});

router.post("/projects/:id/problems/:problemId/explain", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  const scan = await scanProject(project);
  const problem = scan.issues.find((entry) => entry.id === req.params.problemId);
  if (!problem) return res.status(404).json({ error: "Problem not found in the latest real scan." });
  const context = await buildAgentContext(project, scan, problem.id);
  try {
    const generated = await generateWithLocalAI(getWorkspaceRoot(), "You explain a deterministic KForge Sonar diagnostic. Do not invent diagnostics, edits, test results, or secret values. Explain impact, risk, and a safe verification path using only the supplied evidence.", JSON.stringify({ diagnostic: problem, context }));
    return res.json({ mode: "local-ai", provider: generated.provider.id, model: generated.model, explanation: generated.content, diagnostic: problem, contextFiles: context.files.map((entry) => entry.path) });
  } catch {
    const explanation = { mode: "evidence-based", finding: problem.title, severity: problem.severity, source: problem.source, rule: problem.rule, file: problem.file, line: problem.line, impact: problem.description, risk: problem.risk, proposedAction: problem.suggestion || "Review the diagnostic evidence and run the relevant project check.", verification: problem.category === "typecheck" ? ["typecheck", "test", "build"] : problem.category === "security" ? ["review scanner evidence", "scan", "test"] : ["scan", "test", "build"] };
    return res.json({ mode: "rules", provider: "none", explanation, diagnostic: problem, contextFiles: context.files.map((entry) => entry.path), notice: "No active local model is available. This is deterministic diagnostic evidence, not AI-generated explanation." });
  }
});

router.post("/projects/:id/ask", async (req, res) => {
  const project = await resolveProject(req.params.id);
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (!question) return res.status(400).json({ error: "Ask a project-specific question." });
  const scan = await scanProject(project);
  const context = await buildAgentContext(project, scan);
  try {
    const generated = await generateWithLocalAI(getWorkspaceRoot(), "You are Ask KForge. Answer only from the redacted project context. Cite specific diagnostic titles, files, or verification evidence. Do not invent results or expose secrets.", `Question: ${question}\n\nContext:\n${JSON.stringify(context)}`);
    return res.json({ mode: "local-ai", provider: generated.provider.id, model: generated.model, answer: generated.content, contextFiles: context.files.map((entry) => entry.path) });
  } catch {
    const top = [...scan.issues].sort((left, right) => ({ critical: 4, high: 3, medium: 2, low: 1, info: 0 }[right.severity] - { critical: 4, high: 3, medium: 2, low: 1, info: 0 }[left.severity])).slice(0, 5);
    const answer = { notice: "No active local model is available; this is a deterministic answer from the current scan and project graph context, not generated AI.", question, project: project.name, health: scan.health.score, topRisks: top.map((entry) => ({ title: entry.title, severity: entry.severity, file: entry.file, source: entry.source, suggestion: entry.suggestion })), verification: scan.health.metrics.filter((entry) => entry.status !== "unknown").map((entry) => ({ check: entry.label, status: entry.status, evidence: entry.evidence })) };
    return res.json({ mode: "rules", provider: "none", answer, contextFiles: context.files.map((entry) => entry.path) });
  }
});

router.post("/projects/:id/agent/missions", async (req, res) => {
  const project = await resolveProject(req.params.id);
  const mission = typeof req.body?.mission === "string" ? req.body.mission : "audit";
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (project.trust !== "trusted") return res.status(428).json(untrustedProjectError("Agent mission"));
  if (!supportedMissionTypes.includes(mission as MissionType)) return res.status(400).json({ error: `Unsupported mission. Choose one of: ${supportedMissionTypes.join(", ")}.` });
  let taskId = "";
  const task = startTask(project.id, "agent", async () => {
    const log = (message: string, progress: number) => appendTaskLog(taskId, message, progress);
    const step = (id: string, status: "queued" | "running" | "waiting-confirmation" | "succeeded" | "failed" | "blocked" | "skipped", output?: unknown, error?: string) => updateMissionStep(taskId, id, { status, logs: [`${status}: ${error || (output === undefined ? "" : "evidence recorded")}`], output: output === undefined ? undefined : JSON.stringify(output, null, 2).slice(0, 12_000), error });
    const executionContext: MissionExecutionContext = {};
    const orchestrated = await executeMissionDag(taskId, (missionStep) => executeMissionStrategyStep(project, mission as MissionType, missionStep, executionContext));
    return { ok: orchestrated.ok, blocked: orchestrated.state === "blocked", message: `Mission ${mission} ${orchestrated.state} with ${orchestrated.completed.length} completed, ${orchestrated.failed.length} failed, and ${orchestrated.blocked.length} blocked step(s).`, output: JSON.stringify({ mission: getTask(taskId)?.mission, execution: orchestrated }, null, 2) };
    step("scan", "running");
    log("Reading project profile and Git state.", 12);
    const scan = await scanProject(project);
    step("scan", "succeeded", { issueCount: scan.issues.length, scannedAt: scan.scannedAt });
    log(`Scan found ${scan.issues.length} issue(s).`, 30);
    const plan = {
      missionId: taskId,
      mission,
      state: "running",
      tasks: [{ id: "scan", state: "completed", dependencies: [] as string[] }],
      changedFiles: [] as string[],
      snapshot: undefined as string | undefined,
      recovery: { retry: "Explicit retry only; KForge never replays a mission automatically after interruption.", inspect: `Use task ${taskId} to inspect persisted logs and output.` },
    };
    if (mission === "audit") {
      step("graph", "running");
      const graph = await buildProjectGraph(project.path);
      step("graph", "succeeded", graph.summary);
      step("sonar", "running");
      const sonar = await executeAgentTool(project.path, projectToolHandlers(project), "sonar");
      step("sonar", sonar.ok ? "succeeded" : "failed", sonar.output, sonar.ok ? undefined : sonar.message);
      if (!sonar.ok) return { ok: false, message: "Audit mission stopped because KForge Sonar evidence failed.", output: JSON.stringify({ ...plan, state: "failed", result: { scan, graph, sonar } }, null, 2) };
      step("health", "running");
      step("health", "succeeded", scan.health);
      completeMission(taskId, "succeeded");
      return { ok: true, message: "Audit mission completed with scan, graph, Sonar, and health evidence.", output: JSON.stringify({ ...plan, state: "succeeded", result: { scan, graph, sonar, health: scan.health } }, null, 2) };
    }
    if (mission === "documentation") {
      log("Auditing documentation claims against detected project scripts and files.", 55);
      const documentation = await auditDocumentation(project.path, scan.profile);
      return { ok: true, message: "Documentation mission completed with evidence-backed findings.", output: JSON.stringify({ ...plan, state: "succeeded", tasks: [...plan.tasks, { id: "documentation-audit", state: "completed", dependencies: ["scan"] }], result: { documentation } }, null, 2) };
    }
    if (mission === "improve-tests") {
      const verification: CommandResult[] = [];
      if (scan.profile.scripts.typecheck) { log("Running typecheck evidence.", 52); verification.push(await executeProjectAction(project, "typecheck")); }
      if (scan.profile.scripts.test) { log("Running test evidence.", 75); verification.push(await executeProjectAction(project, "test")); }
      const ok = verification.length > 0 && verification.every((entry) => entry.ok);
      return { ok, message: ok ? "Test improvement mission completed with current verification evidence." : "Test improvement mission found failed or unavailable verification; no change was marked fixed.", output: JSON.stringify({ ...plan, state: ok ? "succeeded" : "failed", tasks: [...plan.tasks, { id: "verification", state: ok ? "completed" : "failed", dependencies: ["scan"] }], result: { verification, scan } }, null, 2) };
    }
    if (mission === "documentation" || mission === "improve-tests") throw new Error("Mission branch should have returned.");
    if (mission === "refactor") {
      const context = await buildAgentContext(project, scan);
      return { ok: true, message: "Refactor mission produced a read-only, evidence-backed plan; no source was changed without an explicit safe patch.", output: JSON.stringify({ ...plan, state: "succeeded", tasks: [...plan.tasks, { id: "refactor-plan", state: "completed", dependencies: ["scan"] }], result: { context, recommendation: "Review the plan, preview a verified patch, snapshot, and then apply only after the required trust and confirmation gates." } }, null, 2) };
    }
    if (mission === "performance") return { ok: true, message: "Performance mission completed with the detected local strategy; no estimated benchmark was reported.", output: JSON.stringify({ ...plan, state: "succeeded", tasks: [...plan.tasks, { id: "performance-profile", state: "completed", dependencies: ["scan"] }], result: { performance: scan.profile.performance, sourceFiles: scan.profile.sourceFileCount, totalFiles: scan.profile.totalFileCount } }, null, 2) };
    if (mission === "prepare-github") {
      const git = await gitCenter(project);
      return { ok: true, message: "GitHub preparation mission completed with local Git evidence only; no remote mutation was attempted.", output: JSON.stringify({ ...plan, state: "succeeded", tasks: [...plan.tasks, { id: "git-inspection", state: "completed", dependencies: ["scan"] }], result: { git } }, null, 2) };
    }
    if (mission === "prepare-release") {
      const profile = scan.profile;
      const verification: CommandResult[] = [];
      const chain: Array<{ action: WorkspaceAction; label: string; progress: number; enabled: boolean }> = [
        { action: "typecheck", label: "typecheck", progress: 45, enabled: Boolean(profile.scripts.typecheck) },
        { action: "test", label: "tests", progress: 60, enabled: Boolean(profile.scripts.test) },
        { action: "build", label: "production build", progress: 75, enabled: Boolean(profile.scripts.build) },
        { action: "runtime", label: "runtime verification", progress: 88, enabled: Boolean(profile.scripts.start) },
      ];
      for (const step of chain.filter((entry) => entry.enabled)) {
        log(`Running ${step.label}.`, step.progress);
        const result = await executeProjectAction(project, step.action);
        verification.push(result);
        if (!result.ok) {
          const skipped = chain.filter((entry) => entry.enabled && entry.progress > step.progress).map((entry) => entry.action);
          log(`${step.label} failed. Dependent steps are blocked: ${skipped.join(", ") || "none"}.`, step.progress + 1);
          return { ok: false, message: `Release preparation stopped after ${step.label} failed; dependent steps were not executed.`, output: JSON.stringify({ mission, verification, blocked: skipped, scan }, null, 2) };
        }
      }
      return { ok: true, message: "Release preparation completed through all detected verification steps.", output: JSON.stringify({ mission, verification, blocked: [], scan }, null, 2) };
    }
    const target = mission === "improve-security"
      ? scan.issues.find((entry) => entry.category === "security" && (entry.severity === "critical" || entry.severity === "high"))
      : scan.issues.find((entry) => entry.severity === "critical" || entry.severity === "high");
    if (!target) return { ok: true, message: mission === "improve-security" ? "No critical or high security issue is available for deterministic safe repair." : "No critical or high issue is available for deterministic safe repair.", output: JSON.stringify({ ...plan, state: "succeeded", result: { scan } }, null, 2) };
    log(`Generating verified patch for ${target.title}.`, 48);
    const patch = await generateVerifiedPatch(project, target);
    if (!patch || patch.risk !== "safe") return { ok: false, message: "No safe deterministic patch is available for the highest-priority issue.", output: JSON.stringify({ mission, target, patch }, null, 2) };
    log(`Creating snapshot for ${patch.file}.`, 58);
    const snapshot = await createSnapshot(project.path, [patch.file], `Before mission ${mission}: ${patch.id}`);
    try {
      log(`Applying verified patch to ${patch.file}.`, 68);
      await validateAndApplyPatch(project.path, patch);
      const verification: CommandResult[] = [];
      const profile = await detectProjectProfile(project);
      if (profile.scripts.typecheck) { log("Verifying typecheck.", 78); verification.push(await executeProjectAction(project, "typecheck")); }
      if (profile.scripts.test) { log("Verifying tests.", 86); verification.push(await executeProjectAction(project, "test")); }
      if (verification.some((entry) => !entry.ok)) { await restoreSnapshot(project.path, snapshot.id); return { ok: false, message: "Mission verification failed; snapshot restored.", output: JSON.stringify({ mission, target, patch, snapshot, verification, rolledBack: true }, null, 2) }; }
      return { ok: true, message: "Safe critical-issue repair completed and verified.", output: JSON.stringify({ mission, target, patch, snapshot, verification, rolledBack: false }, null, 2) };
    } catch (error: unknown) {
      await restoreSnapshot(project.path, snapshot.id).catch(() => undefined);
      return { ok: false, message: "Mission patch failed; snapshot restored.", output: error instanceof Error ? (error as Error).message : "Unknown patch error." };
    }
  });
  taskId = task.id;
  attachMission(taskId, createMissionFromStrategy(project.id, taskId, mission as MissionType));
  return res.status(202).json({ task: getTask(taskId) || task, mission, permissions: agentPermissions });
});

router.post("/projects/:id/agent/plan", async (req, res) => {
  const project = await resolveProject(req.params.id);
  const mission = typeof req.body?.mission === "string" ? req.body.mission.trim() : "Review project diagnostics and propose a safe fix plan.";
  const issueId = typeof req.body?.issueId === "string" ? req.body.issueId : undefined;
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  const scan = await scanProject(project);
  const context = await buildAgentContext(project, scan, issueId);
  try {
    const aiPlan = await buildLocalAIPlan(getWorkspaceRoot(), context, mission);
    addActivity(project.id, { kind: "system", title: "KForge Engineer generated local-AI plan", detail: `Model: ${aiPlan.model}.` });
    return res.json({ mission, context, plan: aiPlan.plan, mode: aiPlan.mode, provider: aiPlan.provider, model: aiPlan.model, permissions: agentPermissions });
  } catch {
    const plan = buildRulePlan(context);
    addActivity(project.id, { kind: "system", title: "KForge Engineer generated rule-backed plan", detail: "No active local AI model was available." });
    return res.json({ mission, context, plan, mode: plan.mode, provider: "none", permissions: agentPermissions, notice: "No active local model is available. This is a deterministic, evidence-based rules plan — not generated AI." });
  }
});

router.post("/projects/:id/agent/patches", async (req, res) => {
  const project = await resolveProject(req.params.id);
  const issueId = typeof req.body?.issueId === "string" ? req.body.issueId : "";
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  const scan = await scanProject(project);
  const issue = scan.issues.find((entry) => entry.id === issueId);
  if (!issue) return res.status(404).json({ error: "Problem not found in the latest real scan." });
  const patch = await generateVerifiedPatch(project, issue);
  if (!patch) return res.status(422).json({ error: "No verified deterministic patch exists for this diagnostic. Use the context and plan for guided repair.", issue });
  return res.json({ issue, patch, permissions: agentPermissions });
});

router.post("/projects/:id/agent/patches/apply", async (req, res) => {
  const project = await resolveProject(req.params.id);
  const issueId = typeof req.body?.issueId === "string" ? req.body.issueId : "";
  const confirmed = req.body?.confirmed === true;
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (project.trust !== "trusted") return res.status(428).json(untrustedProjectError("Patch application"));
  const scan = await scanProject(project);
  const issue = scan.issues.find((entry) => entry.id === issueId);
  if (!issue) return res.status(404).json({ error: "Problem not found in the latest real scan." });
  const patch = await generateVerifiedPatch(project, issue);
  if (!patch) return res.status(422).json({ error: "No verified deterministic patch exists for this diagnostic." });
  if (patch.risk !== "safe" && !confirmed) return res.status(428).json({ error: "This patch requires explicit approval.", permission: "ask", patch });
  const snapshot = await createSnapshot(project.path, [patch.file], `Before KForge Engineer patch ${patch.id}`);
  try {
    await validateAndApplyPatch(project.path, patch);
    const profile = await detectProjectProfile(project);
    const verification: CommandResult[] = [];
    if (profile.scripts.typecheck) verification.push(await executeProjectAction(project, "typecheck"));
    if (profile.scripts.test) verification.push(await executeProjectAction(project, "test"));
    if (profile.scripts.build) verification.push(await executeProjectAction(project, "build"));
    if (profile.scripts.start) verification.push(await executeProjectAction(project, "runtime"));
    if (verification.some((entry) => !entry.ok)) {
      await restoreSnapshot(project.path, snapshot.id);
      return res.status(422).json({ ok: false, rolledBack: true, snapshot, patch, verification, error: "Verification failed; KForge restored the snapshot." });
    }
    addActivity(project.id, { kind: "system", title: "KForge Engineer patch verified", detail: `${patch.file} changed after snapshot and verification.` });
    return res.json({ ok: true, rolledBack: false, snapshot, patch, verification });
  } catch (error: unknown) {
    await restoreSnapshot(project.path, snapshot.id).catch(() => undefined);
    return res.status(500).json({ ok: false, rolledBack: true, snapshot, patch, error: error instanceof Error ? error.message : "Patch failed and KForge restored the snapshot." });
  }
});

router.post("/projects/:id/trust", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (req.body?.confirmed !== true) return res.status(428).json({ error: "Trusting a project enables local commands and write-capable agent operations. Explicit confirmation is required.", permission: "ask" });
  await setProjectTrust(getWorkspaceRoot(), project.path, "trusted");
  return res.json({ project: await makeProjectSummary(project.path), trust: "trusted" });
});

router.post("/projects/:id/collection", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  const allowed = ["favorite", "pinned", "archived"] as const;
  const patch: { favorite?: boolean; pinned?: boolean; archived?: boolean; tags?: string[] } = {};
  for (const key of allowed) if (typeof req.body?.[key] === "boolean") patch[key] = req.body[key];
  if (Array.isArray(req.body?.tags) && req.body.tags.every((tag: unknown) => typeof tag === "string")) patch.tags = req.body.tags;
  if (!Object.keys(patch).length) return res.status(400).json({ error: "Provide one or more collection fields: favorite, pinned, archived, or tags." });
  const collection = await updateProjectCollection(getWorkspaceRoot(), project.path, patch);
  return res.json({ project: await makeProjectSummary(project.path), collection });
});

router.post("/projects/open", async (req, res) => {
  const requestedPath = typeof req.body?.path === "string" ? path.resolve(req.body.path) : "";
  if (!requestedPath || !(await pathExists(requestedPath))) return res.status(400).json({ error: "Provide an existing local project directory." });
  try {
    if (!(await fs.stat(requestedPath)).isDirectory()) return res.status(400).json({ error: "The selected path is not a directory." });
    openedPaths.add(requestedPath);
    await recordProjectOpened(getWorkspaceRoot(), requestedPath);
    return res.json({ project: await makeProjectSummary(requestedPath) });
  } catch { return res.status(400).json({ error: "KForge could not read the selected project directory." }); }
});

router.post("/projects/clone", async (req, res) => {
  if (!(await isOptionalOnlineFeatureEnabled(getWorkspaceRoot()))) return res.status(409).json({ error: "Remote cloning is disabled in Offline Mode. Open an existing local project instead, or explicitly switch to Online Optional." });
  const remoteUrl = typeof req.body?.remoteUrl === "string" ? req.body.remoteUrl.trim() : "";
  const targetName = typeof req.body?.targetName === "string" ? req.body.targetName.trim() : "";
  if (!/^https:\/\/(github\.com|gitlab\.com)\/.+/.test(remoteUrl) || !/^[A-Za-z0-9._-]+$/.test(targetName)) return res.status(400).json({ error: "Provide a supported HTTPS repository URL and a safe target folder name." });
  const targetPath = path.join(getWorkspaceRoot(), targetName);
  if (await pathExists(targetPath)) return res.status(409).json({ error: "That target folder already exists." });
  const result = await run("git", ["clone", remoteUrl, targetPath], getWorkspaceRoot(), commandTimeoutMs);
  if (!result.ok) return res.status(422).json({ error: "Clone failed.", output: result.output });
  openedPaths.add(targetPath);
  await recordProjectOpened(getWorkspaceRoot(), targetPath);
  const project = await makeProjectSummary(targetPath);
  addActivity(project.id, { kind: "git", title: "Repository cloned", detail: remoteUrl });
  return res.status(201).json({ project, output: result.output });
});

router.get("/projects", async (_req, res) => {
  const root = getWorkspaceRoot();
  const response: WorkspaceResponse = { root, projects: await allProjects(), generatedAt: new Date().toISOString(), localPlatform: await getLocalPlatformStatus(root) };
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

router.get("/projects/:id/health", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  const scan = await scanProject(project);
  return res.json({ projectId: project.id, health: scan.health, scannedAt: scan.scannedAt, issueCount: scan.issues.length, tools: scan.tools });
});

router.get("/projects/:id/documentation", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  const profile = await detectProjectProfile(project);
  return res.json({ audit: await auditDocumentation(project.path, profile), profile: { manifests: profile.manifests, commands: profile.commands } });
});

router.post("/projects/:id/documentation/:findingId/preview", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  const profile = await detectProjectProfile(project);
  const audit = await auditDocumentation(project.path, profile);
  return res.json(await previewDocumentationFix(project.path, audit, req.params.findingId));
});

router.post("/projects/:id/documentation/:findingId/apply", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (project.trust !== "trusted") return res.status(428).json(untrustedProjectError("Documentation fix"));
  if (req.body?.confirmed !== true) return res.status(428).json({ error: "Documentation edits require explicit confirmation after preview.", permission: "ask" });
  const profile = await detectProjectProfile(project);
  const audit = await auditDocumentation(project.path, profile);
  const result = await applyDocumentationFix(project.path, profile, audit, req.params.findingId);
  return res.status(result.applied && result.verified ? 200 : 422).json(result);
});

router.get("/search", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase().slice(0, 120) : "";
  if (!query) return res.json({ results: [] });
  const results: Array<{ kind: string; title: string; detail: string; projectId: string; score: number }> = [];
  for (const project of (await allProjects()).slice(0, 25)) {
    const add = (kind: string, title: string, detail: string) => {
      const haystack = `${title} ${detail}`.toLowerCase();
      const exact = title.toLowerCase() === query ? 100 : title.toLowerCase().startsWith(query) ? 80 : haystack.includes(query) ? 50 : 0;
      if (exact) results.push({ kind, title, detail, projectId: project.id, score: exact });
    };
    add("project", project.name, `${project.projectType} · ${project.tags.length ? `labels: ${project.tags.join(", ")}` : "no labels"} · ${project.favorite ? "favorite" : ""} ${project.pinned ? "pinned" : ""} ${project.archived ? "archived" : ""}`);
    project.tags.forEach((tag) => add("project-label", tag, project.name));
    add("git", `${project.branch} · ${project.name}`, `${project.remoteUrl || "local repository"} · ${project.ahead} ahead · ${project.behind} behind · ${project.modifiedFiles + project.untrackedFiles} local change(s)`);
    if (project.remoteUrl) add("github", project.name, project.remoteUrl);
    if (await pathExists(path.join(project.path, "README.md"))) add("documentation", "README.md", project.name);
    add("release", `${project.name} release status`, `${project.testStatus} tests · ${project.buildStatus} build · ${project.securityStatus} security`);
    const profile = await detectProjectProfile(project);
    profile.dependencies.forEach((entry) => add("dependency", entry.name, `${entry.version} · ${project.name}`));
    profile.framework.forEach((entry) => add("technology", entry, project.name));
    const graph = await buildProjectGraph(project.path);
    graph.nodes.forEach((entry) => add(entry.type, entry.label, `${entry.path || ""} · ${project.name}`));
    listTasks(project.id).forEach((task) => add("task", `${task.kind} · ${task.status}`, task.error || task.logs.at(-1)?.message || project.name));
  }
  return res.json({ results: results.sort((left, right) => right.score - left.score || left.title.localeCompare(right.title)).slice(0, 100) });
});

router.get("/projects/:id/cache", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  return res.json({ entries: projectCacheStatus(project.path) });
});

router.post("/projects/:id/cache/clear", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (project.trust !== "trusted") return res.status(428).json(untrustedProjectError("Clear cache"));
  if (req.body?.confirmed !== true) return res.status(428).json({ error: "Clearing local project cache requires explicit confirmation.", permission: "ask" });
  return res.json(clearProjectCache(project.path));
});

router.get("/projects/:id/graph", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  res.json({ projectId: project.id, graph: await buildProjectGraph(project.path) });
});

router.get("/projects/:id/graph/impact", async (req, res) => {
  const project = await resolveProject(req.params.id);
  const file = typeof req.query.file === "string" ? req.query.file : "";
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (!file) return res.status(400).json({ error: "Provide a project-relative file path." });
  const graph = await buildProjectGraph(project.path);
  return res.json({ projectId: project.id, impact: analyzeImpact(graph, file) });
});

router.get("/projects/:id/architecture", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  const graph = await buildProjectGraph(project.path);
  const fileNodes = graph.nodes.filter((node) => node.type === "file" || node.type === "test");
  const moduleCounts = new Map<string, number>();
  fileNodes.forEach((node) => { const area = node.path?.split("/")[0] || "root"; moduleCounts.set(area, (moduleCounts.get(area) || 0) + 1); });
  const modules = [...moduleCounts.entries()].map(([name, files]) => ({ name, files })).sort((left, right) => right.files - left.files);
  const imports = graph.edges.filter((edge) => edge.type === "imports");
  const importPairs = new Set(imports.map((edge) => `${edge.from}|${edge.to}`));
  const directCycles = imports.filter((edge) => importPairs.has(`${edge.to}|${edge.from}`)).map((edge) => [edge.from.replace(/^file:/, ""), edge.to.replace(/^file:/, "")]).filter(([from, to], index, entries) => from < to && entries.findIndex(([candidateFrom, candidateTo]) => candidateFrom === from && candidateTo === to) === index);
  const incoming = new Map<string, number>();
  imports.forEach((edge) => incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1));
  const highCoupling = [...incoming.entries()].filter(([, count]) => count >= 5).map(([id, dependents]) => ({ file: id.replace(/^file:/, ""), dependents })).sort((left, right) => right.dependents - left.dependents);
  const apiBoundaries = graph.nodes.filter((node) => node.type === "api").map((node) => ({ path: node.label, owner: node.path }));
  const routeBoundaries = graph.nodes.filter((node) => node.type === "route").map((node) => ({ path: node.label, owner: node.path }));
  return res.json({ projectId: project.id, generatedAt: graph.generatedAt, modules, apiBoundaries, routeBoundaries, directCycles, highCoupling, limitations: ["Architecture evidence is static and import-based.", "Symbol-level ownership, transitive dependency cycles, and duplicated responsibility detection require language-aware analysis not yet available in this local engine."] });
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
  if (project.trust !== "trusted") return res.status(428).json(untrustedProjectError("Task execution"));
  const kind: TaskKind = action === "pull" || action === "push" ? "git" : action;
  const task = startTask(project.id, kind, () => executeProjectAction(project, action), undefined, { strategy: "replay-action", action, detail: `Replays the explicit ${action} action only after retry and current project trust checks.` });
  return res.status(202).json({ task });
});

router.post("/projects/:id/actions", async (req, res) => {
  const project = await resolveProject(req.params.id);
  const action = req.body?.action;
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (!isWorkspaceAction(action)) return res.status(400).json({ error: "Unsupported KForge action." });
  if (project.trust !== "trusted") return res.status(428).json(untrustedProjectError("Project command"));
  try {
    const result = await executeProjectAction(project, action);
    return res.status(result.ok ? 200 : 422).json(result);
  } catch (error: unknown) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "KForge could not complete the action." });
  }
});

router.get("/projects/:id/preview", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  return res.json({ projectId: project.id, trust: project.trust, preview: getPreviewStatus(project.id) });
});

router.post("/projects/:id/preview/start", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (project.trust !== "trusted") return res.status(428).json(untrustedProjectError("Preview start"));
  const profile = await detectProjectProfile(project);
  try {
    const preview = await startPreview(project.id, project.path, profile);
    return res.status(preview.state === "unavailable" ? 422 : 202).json({ projectId: project.id, preview });
  } catch (error: unknown) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Preview could not start." });
  }
});

router.post("/projects/:id/preview/health", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  return res.json({ projectId: project.id, preview: await checkPreviewHealth(project.id) });
});

router.post("/projects/:id/preview/stop", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (project.trust !== "trusted") return res.status(428).json(untrustedProjectError("Preview stop"));
  return res.json({ projectId: project.id, preview: stopPreview(project.id) });
});

router.post("/projects/:id/preview/restart", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (project.trust !== "trusted") return res.status(428).json(untrustedProjectError("Preview restart"));
  const profile = await detectProjectProfile(project);
  try {
    return res.status(202).json({ projectId: project.id, preview: await restartPreview(project.id, project.path, profile) });
  } catch (error: unknown) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Preview could not restart." });
  }
});

export default router;

import { Router } from "express";
import { promises as fs, type Dirent } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type {
  CommandResult,
  ProjectDetailResponse,
  ProjectScan,
  ProjectSummary,
  ScanIssue,
  WorkspaceAction,
  WorkspaceActivity,
  WorkspaceResponse,
} from "../../shared/workspace";
import { isWorkspaceAction } from "../../shared/workspace";

const execFileAsync = promisify(execFile);
const router = Router();
const activities = new Map<string, WorkspaceActivity[]>();
const openedPaths = new Set<string>();
const commandTimeoutMs = 120_000;

function getWorkspaceRoot() {
  return path.resolve(process.env.KFORGE_WORKSPACE_ROOT || path.resolve(process.cwd(), ".."));
}

function projectId(projectPath: string) {
  return Buffer.from(projectPath).toString("base64url");
}

function statusFromCode(code: number | null | undefined): "pass" | "fail" | "unknown" {
  if (typeof code !== "number") return "unknown";
  return code === 0 ? "pass" : "fail";
}

async function run(command: string, args: string[], cwd: string, timeout = 15_000) {
  const executable = process.platform === "win32" && ["npm", "pnpm", "yarn"].includes(command) ? `${command}.cmd` : command;
  try {
    const result = await execFileAsync(executable, args, {
      cwd,
      timeout,
      shell: process.platform === "win32" && executable.endsWith(".cmd"),
      windowsHide: true,
      maxBuffer: 1_500_000,
    });
    return { ok: true, code: 0, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
  } catch (error: any) {
    return {
      ok: false,
      code: typeof error?.code === "number" ? error.code : 1,
      output: `${error?.stdout || ""}${error?.stderr || error?.message || "Command failed"}`.trim(),
    };
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

async function readJson(target: string): Promise<Record<string, any> | null> {
  try {
    return JSON.parse(await fs.readFile(target, "utf8"));
  } catch {
    return null;
  }
}

async function detectProjectType(projectPath: string) {
  const packageJson = await readJson(path.join(projectPath, "package.json"));
  if (packageJson) {
    const dependencies = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
    const labels = ["Node.js"];
    if (dependencies.react) labels.push("React");
    if (dependencies.typescript || (await pathExists(path.join(projectPath, "tsconfig.json")))) labels.push("TypeScript");
    if (dependencies.vite) labels.push("Vite");
    return labels.join(" + ");
  }
  if (await pathExists(path.join(projectPath, "pyproject.toml"))) return "Python";
  if (await pathExists(path.join(projectPath, "Cargo.toml"))) return "Rust";
  if (await pathExists(path.join(projectPath, "go.mod"))) return "Go";
  if (await pathExists(path.join(projectPath, ".git"))) return "Git repository";
  return "Local project";
}

async function gitInfo(projectPath: string) {
  const insideGit = await run("git", ["rev-parse", "--is-inside-work-tree"], projectPath);
  if (!insideGit.ok || insideGit.output !== "true") {
    return {
      isGit: false,
      branch: "—",
      remoteUrl: undefined as string | undefined,
      modifiedFiles: 0,
      untrackedFiles: 0,
      ahead: 0,
      behind: 0,
      lastActivity: "Not a Git repository",
    };
  }

  const [branch, status, remote, lastCommit] = await Promise.all([
    run("git", ["branch", "--show-current"], projectPath),
    run("git", ["status", "--porcelain=v1", "--branch"], projectPath),
    run("git", ["remote", "get-url", "origin"], projectPath),
    run("git", ["log", "-1", "--format=%cI"], projectPath),
  ]);
  const lines = status.output.split(/\r?\n/).filter(Boolean);
  const head = lines[0] || "";
  const count = lines.slice(1);
  const ahead = Number(head.match(/ahead (\d+)/)?.[1] || 0);
  const behind = Number(head.match(/behind (\d+)/)?.[1] || 0);
  const modifiedFiles = count.filter((line) => !line.startsWith("??")).length;
  const untrackedFiles = count.filter((line) => line.startsWith("??")).length;

  return {
    isGit: true,
    branch: branch.ok && branch.output ? branch.output : "detached",
    remoteUrl: remote.ok && remote.output ? remote.output : undefined,
    modifiedFiles,
    untrackedFiles,
    ahead,
    behind,
    lastActivity: lastCommit.ok && lastCommit.output ? lastCommit.output : "No commits",
  };
}

function sortNewestFirst(entries: Dirent[]) {
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));
}

async function candidateProjectPaths(root = getWorkspaceRoot()) {
  const candidates = new Set<string>([...openedPaths]);
  if (await pathExists(path.join(root, "package.json"))) candidates.add(root);
  try {
    const entries = sortNewestFirst(await fs.readdir(root, { withFileTypes: true }));
    for (const entry of entries.slice(0, 80)) {
      const candidate = path.join(root, entry.name);
      if (
        (await pathExists(path.join(candidate, ".git"))) ||
        (await pathExists(path.join(candidate, "package.json"))) ||
        (await pathExists(path.join(candidate, "pyproject.toml"))) ||
        (await pathExists(path.join(candidate, "Cargo.toml"))) ||
        (await pathExists(path.join(candidate, "go.mod")))
      ) {
        candidates.add(candidate);
      }
    }
  } catch {
    // The workspace may be unavailable; the response will correctly contain no projects.
  }
  return [...candidates];
}

async function makeProjectSummary(projectPath: string): Promise<ProjectSummary> {
  const [git, projectType, stats] = await Promise.all([
    gitInfo(projectPath),
    detectProjectType(projectPath),
    fs.stat(projectPath),
  ]);
  const provider = git.remoteUrl?.includes("github.com") ? "GitHub" : git.isGit ? "Git" : "Local";
  const syncStatus = !git.isGit ? "unknown" : git.behind > 0 ? "warning" : "pass";
  return {
    id: projectId(projectPath),
    name: path.basename(projectPath),
    path: projectPath,
    provider,
    remoteUrl: git.remoteUrl,
    branch: git.branch,
    lastActivity: git.lastActivity === "No commits" ? stats.mtime.toISOString() : git.lastActivity,
    projectType,
    modifiedFiles: git.modifiedFiles,
    untrackedFiles: git.untrackedFiles,
    ahead: git.ahead,
    behind: git.behind,
    healthScore: null,
    securityStatus: "unknown",
    buildStatus: "unknown",
    testStatus: "unknown",
    syncStatus,
  };
}

async function allProjects() {
  const paths = await candidateProjectPaths();
  const projects = await Promise.all(paths.map(makeProjectSummary));
  return projects.sort((left, right) => right.lastActivity.localeCompare(left.lastActivity));
}

async function resolveProject(id: string) {
  const projects = await allProjects();
  return projects.find((project) => project.id === id);
}

async function trackedSensitiveFiles(projectPath: string) {
  const result = await run("git", ["ls-files", ".env", ".env.*", "*.pem", "*.key", "id_rsa"], projectPath);
  if (!result.ok) return [];
  return result.output.split(/\r?\n/).filter(Boolean);
}

async function npmAuditIssues(projectPath: string): Promise<ScanIssue[]> {
  const packageJson = await readJson(path.join(projectPath, "package.json"));
  if (!packageJson) return [];
  const manager = (await pathExists(path.join(projectPath, "pnpm-lock.yaml"))) ? "pnpm" : (await pathExists(path.join(projectPath, "yarn.lock"))) ? "yarn" : "npm";
  if (manager !== "npm" || !(await pathExists(path.join(projectPath, "package-lock.json")))) return [];

  const audit = await run("npm", ["audit", "--json", "--omit=dev", "--package-lock-only"], projectPath, 60_000);
  const parsed = (() => {
    try {
      return JSON.parse(audit.output);
    } catch {
      return null;
    }
  })();
  if (!parsed?.vulnerabilities) return [];
  return Object.entries(parsed.vulnerabilities).map(([name, detail]: [string, any]) => ({
    id: `npm-${name}`,
    severity: ["critical", "high", "moderate", "low"].includes(detail.severity) ? (detail.severity === "moderate" ? "medium" : detail.severity) : "info",
    category: "dependency",
    title: `${name}: ${detail.severity || "reported"} dependency finding`,
    message: detail.via?.map((item: any) => typeof item === "string" ? item : item.title).filter(Boolean).join("; ") || "Reported by npm audit.",
    suggestion: detail.fixAvailable ? "Review and apply the available dependency fix." : "Review the dependency advisory and update strategy.",
  }));
}

export async function scanProject(project: ProjectSummary): Promise<ProjectScan> {
  const issues: ScanIssue[] = [];
  const [git, sensitiveFiles, auditIssues] = await Promise.all([
    gitInfo(project.path),
    trackedSensitiveFiles(project.path),
    npmAuditIssues(project.path),
  ]);
  sensitiveFiles.forEach((file) => {
    issues.push({
      id: `tracked-secret-${file}`,
      severity: "high",
      category: "security",
      title: "Potentially sensitive file is tracked by Git",
      message: `${file} is version-controlled and should be reviewed before sharing the repository.`,
      file,
      suggestion: "Move secrets to an untracked local file and rotate any exposed credentials.",
    });
  });
  issues.push(...auditIssues);
  if (git.modifiedFiles + git.untrackedFiles > 0) {
    issues.push({
      id: "working-tree-changed",
      severity: "info",
      category: "configuration",
      title: "Local changes are present",
      message: `${git.modifiedFiles} modified and ${git.untrackedFiles} untracked file(s) are present in the working tree.`,
      suggestion: "Review the diff before pulling, pushing, or creating a release.",
    });
  }
  if (git.behind > 0) {
    issues.push({
      id: "remote-behind",
      severity: "medium",
      category: "configuration",
      title: "Remote updates are available",
      message: `The current branch is ${git.behind} commit(s) behind its upstream branch.`,
      suggestion: "Pull and resolve any conflicts before starting dependent work.",
    });
  }

  const weightedPenalty = issues.reduce((sum, issue) => sum + ({ critical: 32, high: 18, medium: 8, low: 3, info: 0 }[issue.severity] || 0), 0);
  const healthScore = Math.max(0, 100 - weightedPenalty);
  const securityIssues = issues.filter((issue) => issue.category === "security" || issue.category === "dependency");
  const status = securityIssues.some((issue) => issue.severity === "critical" || issue.severity === "high") ? "fail" : securityIssues.length ? "warning" : "pass";
  return {
    projectId: project.id,
    scannedAt: new Date().toISOString(),
    healthScore,
    technology: project.projectType.split(" + "),
    git: {
      branch: git.branch,
      modifiedFiles: git.modifiedFiles,
      untrackedFiles: git.untrackedFiles,
      ahead: git.ahead,
      behind: git.behind,
    },
    issues,
    summaries: { security: status, dependencies: auditIssues.length ? "warning" : "pass", tests: "unknown", build: "unknown" },
  };
}

function addActivity(projectId: string, activity: Omit<WorkspaceActivity, "id" | "at">) {
  const record: WorkspaceActivity = { id: crypto.randomUUID(), at: new Date().toISOString(), ...activity };
  const existing = activities.get(projectId) || [];
  activities.set(projectId, [record, ...existing].slice(0, 30));
}

async function packageCommand(projectPath: string, action: "test" | "build") {
  const packageJson = await readJson(path.join(projectPath, "package.json"));
  if (!packageJson?.scripts?.[action]) return null;
  const manager = (await pathExists(path.join(projectPath, "pnpm-lock.yaml"))) ? "pnpm" : (await pathExists(path.join(projectPath, "yarn.lock"))) ? "yarn" : "npm";
  if (manager === "pnpm") return { command: "pnpm", args: ["run", action] };
  if (manager === "yarn") return { command: "yarn", args: [action] };
  return { command: "npm", args: ["run", action] };
}

export async function executeProjectAction(project: ProjectSummary, action: WorkspaceAction): Promise<CommandResult> {
  const startedAt = new Date().toISOString();
  if (action === "scan") {
    const scan = await scanProject(project);
    const critical = scan.issues.filter((issue) => issue.severity === "critical" || issue.severity === "high").length;
    addActivity(project.id, { kind: "scan", title: "Project scan completed", detail: `${scan.issues.length} finding(s), ${critical} high-priority.` });
    return { action, projectId: project.id, ok: true, startedAt, completedAt: new Date().toISOString(), output: JSON.stringify(scan, null, 2), message: "Project scan completed." };
  }

  if ((action === "pull" || action === "push") && project.modifiedFiles + project.untrackedFiles > 0) {
    return { action, projectId: project.id, ok: false, startedAt, completedAt: new Date().toISOString(), output: "", message: "Git operation blocked because the working tree contains local changes. Review or commit them first." };
  }

  const command = action === "test" || action === "build" ? await packageCommand(project.path, action) : { command: "git", args: [action] };
  if (!command) {
    return { action, projectId: project.id, ok: false, startedAt, completedAt: new Date().toISOString(), output: "", message: `No ${action} script was found in package.json.` };
  }
  const result = await run(command.command, command.args, project.path, commandTimeoutMs);
  const kind = action === "test" || action === "build" ? action : "git";
  addActivity(project.id, {
    kind,
    title: `${action[0].toUpperCase()}${action.slice(1)} ${result.ok ? "completed" : "failed"}`,
    detail: result.ok ? `${command.command} ${command.args.join(" ")} exited successfully.` : result.output.slice(0, 240),
  });
  return {
    action,
    projectId: project.id,
    ok: result.ok,
    startedAt,
    completedAt: new Date().toISOString(),
    exitCode: result.code,
    output: result.output,
    message: result.ok ? `${action[0].toUpperCase()}${action.slice(1)} completed successfully.` : `${action[0].toUpperCase()}${action.slice(1)} failed.`,
  };
}

router.post("/projects/open", async (req, res) => {
  const requestedPath = typeof req.body?.path === "string" ? path.resolve(req.body.path) : "";
  if (!requestedPath || !(await pathExists(requestedPath))) {
    return res.status(400).json({ error: "Provide an existing local project directory." });
  }
  try {
    const info = await fs.stat(requestedPath);
    if (!info.isDirectory()) return res.status(400).json({ error: "The selected path is not a directory." });
    openedPaths.add(requestedPath);
    res.json({ project: await makeProjectSummary(requestedPath) });
  } catch {
    res.status(400).json({ error: "KForge could not read the selected project directory." });
  }
});

router.post("/projects/clone", async (req, res) => {
  const remoteUrl = typeof req.body?.remoteUrl === "string" ? req.body.remoteUrl.trim() : "";
  const targetName = typeof req.body?.targetName === "string" ? req.body.targetName.trim() : "";
  if (!/^https:\/\/(github\.com|gitlab\.com)\/.+/.test(remoteUrl) || !/^[A-Za-z0-9._-]+$/.test(targetName)) {
    return res.status(400).json({ error: "Provide a supported HTTPS repository URL and a safe target folder name." });
  }
  const targetPath = path.join(getWorkspaceRoot(), targetName);
  if (await pathExists(targetPath)) return res.status(409).json({ error: "That target folder already exists." });
  const result = await run("git", ["clone", remoteUrl, targetPath], getWorkspaceRoot(), commandTimeoutMs);
  if (!result.ok) return res.status(422).json({ error: "Clone failed.", output: result.output });
  openedPaths.add(targetPath);
  const project = await makeProjectSummary(targetPath);
  addActivity(project.id, { kind: "git", title: "Repository cloned", detail: remoteUrl });
  res.status(201).json({ project, output: result.output });
});

router.get("/projects", async (_req, res) => {
  const projects = await allProjects();
  const response: WorkspaceResponse = { root: getWorkspaceRoot(), projects, generatedAt: new Date().toISOString() };
  res.json(response);
});

router.get("/projects/:id", async (req, res) => {
  const project = await resolveProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  const response: ProjectDetailResponse = { project, activities: activities.get(project.id) || [] };
  res.json(response);
});

router.post("/projects/:id/actions", async (req, res) => {
  const project = await resolveProject(req.params.id);
  const action = req.body?.action;
  if (!project) return res.status(404).json({ error: "Project not found in the configured KForge workspace." });
  if (!isWorkspaceAction(action)) return res.status(400).json({ error: "Unsupported KForge action." });
  try {
    const result = await executeProjectAction(project, action);
    res.status(result.ok ? 200 : 422).json(result);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "KForge could not complete the action." });
  }
});

export default router;

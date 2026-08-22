import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type SecurityToolId = "gitleaks" | "semgrep" | "sonar";
export type SecurityToolState = "AVAILABLE" | "UNAVAILABLE" | "CONFIGURED" | "FAILED" | "PASSED" | "BLOCKED";

export interface SecurityToolFinding {
  id: string;
  source: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  rule?: string;
  file?: string;
  line?: number;
  message: string;
  confidence: "high" | "medium" | "low";
  risk: "review" | "approval" | "blocked";
  status: "open";
  toolAvailability: SecurityToolState;
}

export interface SecurityToolStatus {
  id: SecurityToolId;
  label: string;
  state: SecurityToolState;
  executable?: string;
  version?: string;
  detail: string;
  lastRun?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  findings?: SecurityToolFinding[];
}

const definitions: Record<SecurityToolId, { label: string; command: string; env: string }> = {
  gitleaks: { label: "Gitleaks", command: "gitleaks", env: "KFORGE_GITLEAKS_PATH" },
  semgrep: { label: "Semgrep", command: "semgrep", env: "KFORGE_SEMGREP_PATH" },
  sonar: { label: "SonarScanner", command: "sonar-scanner", env: "KFORGE_SONAR_PATH" },
};

const maxCapturedOutput = 80_000;

function candidateNames(command: string) {
  if (process.platform !== "win32") return [command];
  const extensions = (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean);
  return [command, ...extensions.map((extension) => `${command}${extension.toLowerCase()}`), ...extensions.map((extension) => `${command}${extension.toUpperCase()}`)];
}

async function isFile(target: string) {
  try { return (await fs.stat(target)).isFile(); } catch { return false; }
}

async function locateExecutable(id: SecurityToolId) {
  const definition = definitions[id];
  const configured = process.env[definition.env]?.trim();
  if (configured && await isFile(configured)) return configured;
  const directories = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const directory of directories) {
    for (const name of candidateNames(definition.command)) {
      const candidate = path.join(directory, name);
      if (await isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

async function execute(executable: string, args: string[], cwd?: string, timeout = 90_000) {
  try {
    const result = await execFileAsync(executable, args, { cwd, timeout, windowsHide: true, maxBuffer: 2_500_000, shell: false });
    return { ok: true, code: 0, stdout: String(result.stdout || "").slice(-maxCapturedOutput), stderr: String(result.stderr || "").slice(-maxCapturedOutput) };
  } catch (cause: unknown) {
    const error = cause as { code?: number; stdout?: string; stderr?: string; message?: string };
    return { ok: false, code: typeof error.code === "number" ? error.code : 1, stdout: String(error.stdout || "").slice(-maxCapturedOutput), stderr: String(error.stderr || error.message || "").slice(-maxCapturedOutput) };
  }
}

async function localSemgrepConfig(projectPath: string) {
  const direct = [".semgrep.yml", ".semgrep.yaml", "semgrep.yml", "semgrep.yaml"];
  for (const candidate of direct) if (await isFile(path.join(projectPath, candidate))) return candidate;
  try {
    const entries = await fs.readdir(path.join(projectPath, ".semgrep"));
    const rule = entries.find((entry) => /\.ya?ml$/i.test(entry));
    return rule ? path.posix.join(".semgrep", rule) : undefined;
  } catch { return undefined; }
}

function normalizeGitleaks(value: unknown): SecurityToolFinding[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 1_000).map((entry, index) => {
    const row = typeof entry === "object" && entry !== null ? entry as Record<string, unknown> : {};
    const file = typeof row.File === "string" ? row.File : typeof row.file === "string" ? row.file : undefined;
    const line = typeof row.StartLine === "number" ? row.StartLine : typeof row.line === "number" ? row.line : undefined;
    const rule = typeof row.RuleID === "string" ? row.RuleID : typeof row.rule === "string" ? row.rule : undefined;
    const message = typeof row.Description === "string" ? row.Description : "Gitleaks reported a potential secret.";
    return { id: `gitleaks:${rule || index}:${file || "unknown"}:${line || 0}`, source: "Gitleaks", severity: "high", rule, file, line, message, confidence: "medium", risk: "approval", status: "open", toolAvailability: "FAILED" };
  });
}

function normalizeSemgrep(value: unknown): SecurityToolFinding[] {
  const parsed = typeof value === "object" && value !== null ? value as { results?: unknown[] } : {};
  return (Array.isArray(parsed.results) ? parsed.results : []).slice(0, 1_000).map((entry, index) => {
    const row = typeof entry === "object" && entry !== null ? entry as Record<string, unknown> : {};
    const extra = typeof row.extra === "object" && row.extra !== null ? row.extra as Record<string, unknown> : {};
    const start = typeof row.start === "object" && row.start !== null ? row.start as Record<string, unknown> : {};
    const rawSeverity = typeof extra.severity === "string" ? extra.severity.toLowerCase() : "warning";
    const severity: SecurityToolFinding["severity"] = rawSeverity === "error" ? "high" : rawSeverity === "warning" ? "medium" : "low";
    return { id: `semgrep:${String(row.check_id || index)}:${String(row.path || "unknown")}:${String(start.line || 0)}`, source: "Semgrep", severity, rule: typeof row.check_id === "string" ? row.check_id : undefined, file: typeof row.path === "string" ? row.path : undefined, line: typeof start.line === "number" ? start.line : undefined, message: typeof extra.message === "string" ? extra.message : "Semgrep reported a finding.", confidence: "high", risk: "review", status: "open", toolAvailability: "FAILED" };
  });
}

export async function detectSecurityTools(projectPath: string, trusted: boolean): Promise<SecurityToolStatus[]> {
  return Promise.all((Object.keys(definitions) as SecurityToolId[]).map(async (id) => {
    const definition = definitions[id];
    const executable = await locateExecutable(id);
    if (!executable) return { id, label: definition.label, state: "UNAVAILABLE", detail: `${definition.label} was not found on PATH. Set ${definition.env} to an explicit local executable path or install it yourself; KForge will never download it automatically.` };
    if (!trusted) return { id, label: definition.label, state: "BLOCKED", executable, detail: "Executable was located, but version probing and project scanning are blocked in Untrusted Project Mode." };
    const version = await execute(executable, ["--version"], undefined, 5_000);
    if (!version.ok) return { id, label: definition.label, state: "FAILED", executable, exitCode: version.code, stdout: version.stdout, stderr: version.stderr, detail: "Executable was found but could not report its version." };
    if (id === "semgrep" && !(await localSemgrepConfig(projectPath))) return { id, label: definition.label, state: "CONFIGURED", executable, version: version.stdout.split(/\r?\n/)[0], detail: "Executable is available. Add a local .semgrep.yml/.yaml rule file before running; KForge will not fetch remote rules automatically." };
    if (id === "sonar" && !(await isFile(path.join(projectPath, "sonar-project.properties")))) return { id, label: definition.label, state: "CONFIGURED", executable, version: version.stdout.split(/\r?\n/)[0], detail: "Executable is available. Add sonar-project.properties and explicitly enable Online Optional before a server-connected scan." };
    return { id, label: definition.label, state: "AVAILABLE", executable, version: version.stdout.split(/\r?\n/)[0], detail: "Local executable and required local configuration were detected. Run is explicit and evidence is captured." };
  }));
}

export async function runSecurityTool(projectPath: string, trusted: boolean, onlineOptional: boolean, id: SecurityToolId): Promise<SecurityToolStatus> {
  const current = (await detectSecurityTools(projectPath, trusted)).find((entry) => entry.id === id)!;
  if (!trusted || current.state === "BLOCKED") return { ...current, state: "BLOCKED", detail: "Security tool execution is blocked until the project is explicitly trusted." };
  if (current.state === "UNAVAILABLE" || current.state === "FAILED") return current;
  if (id === "sonar" && !onlineOptional) return { ...current, state: "BLOCKED", detail: "SonarScanner can contact a server and is blocked in Offline Mode. Enable Online Optional explicitly before running it." };
  if (!current.executable) return { ...current, state: "FAILED", detail: "Executable path is unavailable." };
  const args = id === "gitleaks" ? ["detect", "--no-git", "--report-format", "json", "--report-path", "-"] : id === "semgrep" ? ["--json", "--config", await localSemgrepConfig(projectPath) || ".semgrep.yml", "--quiet"] : [];
  const result = await execute(current.executable, args, projectPath, id === "sonar" ? 120_000 : 90_000);
  const output = `${result.stdout}\n${result.stderr}`.trim();
  let findings: SecurityToolFinding[] = [];
  try { findings = id === "gitleaks" ? normalizeGitleaks(JSON.parse(result.stdout || result.stderr || "[]")) : id === "semgrep" ? normalizeSemgrep(JSON.parse(result.stdout || result.stderr || "{}")) : []; } catch { /* Raw output remains evidence when a tool cannot emit machine-readable findings. */ }
  const passed = (id === "gitleaks" && (result.code === 0 || (result.code === 1 && findings.length === 0))) || (id === "semgrep" && result.code === 0) || (id === "sonar" && result.code === 0);
  return { ...current, state: passed ? "PASSED" : "FAILED", detail: passed ? `${current.label} completed without normalized findings.` : `${current.label} completed with a non-zero exit or normalized findings. Review captured evidence.`, lastRun: new Date().toISOString(), exitCode: result.code, stdout: result.stdout, stderr: result.stderr, findings };
}

export function isSecurityToolId(value: string): value is SecurityToolId {
  return value === "gitleaks" || value === "semgrep" || value === "sonar";
}

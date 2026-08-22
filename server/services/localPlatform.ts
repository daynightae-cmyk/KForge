import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { LocalCapability, LocalPlatformStatus } from "../../shared/workspace";

const execFileAsync = promisify(execFile);

type LocalPlatformMode = LocalPlatformStatus["mode"];

interface LocalPlatformSettings {
  mode?: LocalPlatformMode;
}

function settingsPath(workspaceRoot: string) {
  return path.join(workspaceRoot, ".kforge", "local-platform.json");
}

async function readSettings(workspaceRoot: string): Promise<LocalPlatformSettings> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(settingsPath(workspaceRoot), "utf8"));
    return typeof raw === "object" && raw !== null ? raw as LocalPlatformSettings : {};
  } catch {
    return {};
  }
}

async function commandAvailable(command: string, args: string[]) {
  const executable = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
  try {
    await execFileAsync(executable, args, { windowsHide: true, timeout: 4_000, shell: process.platform === "win32" && executable.endsWith(".cmd") });
    return true;
  } catch {
    return false;
  }
}

function capability(id: LocalCapability["id"], label: string, state: LocalCapability["state"], detail: string): LocalCapability {
  return { id, label, state, detail };
}

export async function getLocalPlatformStatus(workspaceRoot: string): Promise<LocalPlatformStatus> {
  const [settings, gitAvailable, npmAvailable, ollamaAvailable] = await Promise.all([
    readSettings(workspaceRoot),
    commandAvailable("git", ["--version"]),
    commandAvailable("npm", ["--version"]),
    commandAvailable(process.platform === "win32" ? "ollama.exe" : "ollama", ["--version"]),
  ]);
  const mode: LocalPlatformMode = settings.mode === "online-optional" ? "online-optional" : "offline";
  const capabilities: LocalCapability[] = [
    capability("projects", "Projects & repositories", "ready", "Open and inspect local folders without an external service."),
    capability("git", "Git status, branches & diffs", gitAvailable ? "ready" : "unavailable", gitAvailable ? "Uses the locally installed Git executable; remote sync is separate." : "Git was not found on PATH; local file features remain available."),
    capability("file-inspection", "Search & file inspection", "ready", "Uses KForge's local filesystem scanner and redaction layer."),
    capability("project-graph", "Project graph & architecture", "ready", "Builds static evidence locally from project files and imports."),
    capability("quality", "Sonar & quality checks", npmAvailable ? "available" : "limited", npmAvailable ? "Runs installed local analyzers and deterministic checks without a cloud API." : "Deterministic file checks remain available; npm-based checks require a local npm installation."),
    capability("problems", "Problems & solutions", "ready", "Normalizes locally collected diagnostics and offers explicitly reviewed repairs."),
    capability("tests-build", "Tests, build & terminal", npmAvailable ? "available" : "limited", npmAvailable ? "Executes scripts from the selected local project using its local toolchain." : "Available only for projects whose local build toolchain is installed."),
    capability("release-gate", "Release Gate", "ready", "Aggregates local typecheck, test, build, runtime and security evidence."),
    capability("agents", "Engineering agents", "ready", "Uses local scans, bounded tools, snapshots and deterministic plans; a model is optional."),
    capability("local-ai", "Local models", ollamaAvailable ? "available" : "limited", ollamaAvailable ? "A local Ollama runtime was detected; installed models are checked separately." : "No local model runtime detected. KForge continues with transparent deterministic assistance."),
    capability("artifacts", "Logs, snapshots & caches", "ready", "Stores task evidence and snapshots under the local KForge workspace."),
  ];
  const coreReady = capabilities.filter((entry) => entry.id !== "local-ai").every((entry) => entry.state !== "unavailable");
  const onlineEnabled = mode === "online-optional";
  return {
    mode,
    coreReady,
    networkRequiredForCore: false,
    storagePath: path.join(workspaceRoot, ".kforge"),
    checkedAt: new Date().toISOString(),
    capabilities,
    optionalOnlineFeatures: [
      { id: "clone", label: "Clone remote repository", enabled: onlineEnabled, detail: onlineEnabled ? "Enabled only as an explicit remote Git action." : "Disabled in Offline Mode; opening an existing local repository remains available." },
      { id: "git-sync", label: "Git pull & push", enabled: onlineEnabled, detail: onlineEnabled ? "Available only when the user explicitly requests remote sync." : "Disabled in Offline Mode; status, branches, diffs and commits remain local." },
      { id: "model-download", label: "Download a local model", enabled: onlineEnabled, detail: onlineEnabled ? "Requires an explicit user confirmation before any model download." : "Disabled in Offline Mode; existing local models can still be used." },
      { id: "cloud-ai", label: "Cloud AI provider", enabled: false, detail: "Never selected automatically. KForge core functions do not require a cloud provider or API key." },
    ],
  };
}

export async function setLocalPlatformMode(workspaceRoot: string, mode: LocalPlatformMode) {
  await fs.mkdir(path.dirname(settingsPath(workspaceRoot)), { recursive: true });
  await fs.writeFile(settingsPath(workspaceRoot), JSON.stringify({ mode }, null, 2), "utf8");
  return getLocalPlatformStatus(workspaceRoot);
}

export async function isOptionalOnlineFeatureEnabled(workspaceRoot: string) {
  const settings = await readSettings(workspaceRoot);
  return settings.mode === "online-optional";
}

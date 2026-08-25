import { randomUUID } from "crypto";
import { existsSync, promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { LocalCapability, LocalPlatformMode, LocalPlatformNetworkPolicy, LocalPlatformStatus } from "../../shared/workspace";
import { listCloudAIProviders } from "./aiCenter";

const execFileAsync = promisify(execFile);

interface LocalPlatformSettings {
  mode?: LocalPlatformMode;
}

const modes = new Set<LocalPlatformMode>(["offline", "local-first", "online-optional", "online"]);

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

export function localPlatformPolicy(mode: LocalPlatformMode): LocalPlatformNetworkPolicy {
  return {
    externalMetadataReads: mode !== "offline",
    remoteTransfers: mode === "online-optional" || mode === "online",
    providerRefresh: mode === "online",
    remoteWritesRequireConfirmation: true,
    openingRemoteSurfaceContactsNetwork: false,
  };
}

async function writeSettingsAtomic(workspaceRoot: string, settings: LocalPlatformSettings) {
  const destination = settingsPath(workspaceRoot);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function commandAvailable(command: string, args: string[]) {
  const options = { windowsHide: true, timeout: 4_000, shell: false } as const;
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const executable = process.platform === "win32" && command === "npm" ? process.execPath : command;
  const commandArgs = process.platform === "win32" && command === "npm" ? (existsSync(npmCli) ? [npmCli, ...args] : []) : args;
  if (commandArgs.length === 0) return false;
  try {
    await execFileAsync(executable, commandArgs, options);
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
  const mode: LocalPlatformMode = settings.mode && modes.has(settings.mode) ? settings.mode : "offline";
  const policy = localPlatformPolicy(mode);
  const configuredCloudProviders = listCloudAIProviders().filter((provider) => provider.configured);
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
  return {
    mode,
    policy,
    coreReady,
    networkRequiredForCore: false,
    storagePath: path.join(workspaceRoot, ".kforge"),
    checkedAt: new Date().toISOString(),
    capabilities,
    optionalOnlineFeatures: [
      { id: "clone", label: "Clone remote repository", enabled: policy.remoteTransfers, detail: policy.remoteTransfers ? "Enabled only as an explicit confirmed remote transfer." : `${mode} mode blocks remote transfers; opening an existing local repository remains available.` },
      { id: "git-sync", label: "Git pull & push", enabled: policy.remoteTransfers, detail: policy.remoteTransfers ? "Available only when the user explicitly requests remote sync; writes still require confirmation." : `${mode} mode keeps remote transfer operations blocked; status, branches, diffs and commits remain local.` },
      { id: "model-download", label: "Download a local model", enabled: policy.remoteTransfers, detail: policy.remoteTransfers ? "Requires an explicit user confirmation before any model download." : `${mode} mode blocks downloads; existing local models remain usable.` },
      {
        id: "cloud-ai",
        label: "Cloud AI provider",
        enabled: policy.providerRefresh && configuredCloudProviders.length > 0,
        detail: configuredCloudProviders.length === 0
          ? "NOT_CONFIGURED. KForge core functions do not require a cloud provider or API key."
          : policy.providerRefresh
            ? `${configuredCloudProviders.map((provider) => provider.name).join(", ")} configured server-side; never selected automatically and every request requires disclosure confirmation.`
            : `${configuredCloudProviders.map((provider) => provider.name).join(", ")} configured server-side, but ${mode} mode blocks provider requests.`,
      },
    ],
  };
}

export async function setLocalPlatformMode(workspaceRoot: string, mode: LocalPlatformMode) {
  if (!modes.has(mode)) throw new Error("Unsupported local platform mode.");
  await writeSettingsAtomic(workspaceRoot, { mode });
  return getLocalPlatformStatus(workspaceRoot);
}

export async function isOptionalOnlineFeatureEnabled(workspaceRoot: string) {
  const settings = await readSettings(workspaceRoot);
  const mode = settings.mode && modes.has(settings.mode) ? settings.mode : "offline";
  return localPlatformPolicy(mode).externalMetadataReads;
}

export async function isRemoteTransferEnabled(workspaceRoot: string) {
  const settings = await readSettings(workspaceRoot);
  const mode = settings.mode && modes.has(settings.mode) ? settings.mode : "offline";
  return localPlatformPolicy(mode).remoteTransfers;
}

export async function isProviderRefreshEnabled(workspaceRoot: string) {
  const settings = await readSettings(workspaceRoot);
  const mode = settings.mode && modes.has(settings.mode) ? settings.mode : "offline";
  return localPlatformPolicy(mode).providerRefresh;
}

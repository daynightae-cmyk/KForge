import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import {
  KFORGE_STARTUP_CAPABILITIES,
  KFORGE_ACTIVITIES,
  KFORGE_ONLINE_VIEWS,
  type KForgePlatformSettings,
  type KForgeStartupCapability,
} from "../../shared/workspace";

const startupCapabilities = new Set<string>(KFORGE_STARTUP_CAPABILITIES);
const activities = new Set<string>(KFORGE_ACTIVITIES);
const onlineViews = new Set<string>(KFORGE_ONLINE_VIEWS);
const healthIntervals = new Set<number>([3_000, 5_000, 10_000, 30_000]);

const settingsUpdateSchema = z.object({
  version: z.literal(3).optional(),
  general: z.object({
    startupCapability: z.string().refine((value) => startupCapabilities.has(value), "Unknown startup capability.").optional(),
    startupActivity: z.string().refine((value) => activities.has(value), "Unknown startup activity.").optional(),
    startupOnlineView: z.string().refine((value) => onlineViews.has(value), "Unknown Online view.").optional(),
  }).strict().optional(),
  appearance: z.object({ density: z.enum(["compact", "comfortable"]), reducedMotion: z.boolean(), theme: z.enum(["light", "dark", "system"]) }).partial().strict().optional(),
  preview: z.object({ autoHealthCheck: z.boolean(), healthIntervalMs: z.number().int().refine((value) => healthIntervals.has(value), "Unsupported health interval.") }).partial().strict().optional(),
  privacy: z.object({ secretRedaction: z.boolean().optional(), remoteContextPolicy: z.enum(["blocked", "ask"]).optional() }).strict().optional(),
  git: z.object({ confirmRemoteWrites: z.boolean().optional() }).strict().optional(),
  updatedAt: z.string().datetime().optional(),
}).strict();

export class SettingsValidationError extends Error {
  readonly issues: string[];

  constructor(error: z.ZodError) {
    const issues = error.issues.map((issue) => `${issue.path.join(".") || "settings"}: ${issue.message}`);
    super(`Invalid platform settings: ${issues.join("; ")}`);
    this.name = "SettingsValidationError";
    this.issues = issues;
  }
}

function settingsPath(workspaceRoot: string) {
  return path.join(workspaceRoot, ".kforge", "platform-settings.json");
}

export function defaultPlatformSettings(now = new Date().toISOString()): KForgePlatformSettings {
  return {
    version: 3,
    general: { startupCapability: "Workspace", startupActivity: "projects", startupOnlineView: "discover" },
    appearance: { density: "comfortable", reducedMotion: false, theme: "system" },
    preview: { autoHealthCheck: true, healthIntervalMs: 5_000 },
    privacy: { secretRedaction: true, remoteContextPolicy: "ask" },
    git: { confirmRemoteWrites: true },
    updatedAt: now,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: unknown, fallback: string) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

function normalizeSettings(value: unknown, now = new Date().toISOString(), fallback = defaultPlatformSettings(now)): KForgePlatformSettings {
  if (!isRecord(value)) return fallback;
  const general = isRecord(value.general) ? value.general : {};
  const appearance = isRecord(value.appearance) ? value.appearance : {};
  const preview = isRecord(value.preview) ? value.preview : {};
  const privacy = isRecord(value.privacy) ? value.privacy : {};
  const rawStartup = typeof general.startupCapability === "string" ? general.startupCapability : fallback.general.startupCapability;
  const legacyOnline: Record<string, KForgePlatformSettings["general"]["startupOnlineView"]> = {
    Discover: "discover", Marketplace: "marketplace", Extensions: "extensions", "Model Hub": "models", "Agent Marketplace": "agents", "Tool Marketplace": "tools", Integrations: "integrations", Installed: "installed", Updates: "updates", Providers: "providers", "Remote Sources": "remote-sources", "Security Center": "security", Downloads: "downloads", Activity: "activity",
  };
  const startup = startupCapabilities.has(rawStartup)
    ? rawStartup as KForgeStartupCapability
    : legacyOnline[rawStartup]
      ? "Discover"
      : fallback.general.startupCapability;
  const legacyActivity: KForgePlatformSettings["general"]["startupActivity"] = legacyOnline[rawStartup]
    ? "online"
    : rawStartup === "Agents"
      ? "ai"
      : rawStartup === "Preview"
        ? "developer-tools"
        : "projects";
  const startupActivity = typeof general.startupActivity === "string" && activities.has(general.startupActivity)
    ? general.startupActivity as KForgePlatformSettings["general"]["startupActivity"]
    : legacyActivity;
  const startupOnlineView = typeof general.startupOnlineView === "string" && onlineViews.has(general.startupOnlineView)
    ? general.startupOnlineView as KForgePlatformSettings["general"]["startupOnlineView"]
    : legacyOnline[rawStartup] || fallback.general.startupOnlineView;
  const interval = typeof preview.healthIntervalMs === "number" && healthIntervals.has(preview.healthIntervalMs)
    ? preview.healthIntervalMs as KForgePlatformSettings["preview"]["healthIntervalMs"]
    : fallback.preview.healthIntervalMs;
  return {
    version: 3,
    general: { startupCapability: startup, startupActivity, startupOnlineView },
    appearance: {
      density: appearance.density === "compact" || appearance.density === "comfortable" ? appearance.density : fallback.appearance.density,
      reducedMotion: typeof appearance.reducedMotion === "boolean" ? appearance.reducedMotion : fallback.appearance.reducedMotion,
      theme: appearance.theme === "light" || appearance.theme === "dark" || appearance.theme === "system" ? appearance.theme : fallback.appearance.theme,
    },
    preview: {
      autoHealthCheck: typeof preview.autoHealthCheck === "boolean" ? preview.autoHealthCheck : fallback.preview.autoHealthCheck,
      healthIntervalMs: interval,
    },
    privacy: {
      secretRedaction: true,
      remoteContextPolicy: privacy.remoteContextPolicy === "blocked" || privacy.remoteContextPolicy === "ask" ? privacy.remoteContextPolicy : fallback.privacy.remoteContextPolicy,
    },
    git: { confirmRemoteWrites: true },
    updatedAt: validDate(value.updatedAt, now),
  };
}

async function writeSettingsAtomic(workspaceRoot: string, settings: KForgePlatformSettings) {
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

export async function readPlatformSettings(workspaceRoot: string): Promise<KForgePlatformSettings> {
  try {
    const parsed = JSON.parse(await fs.readFile(settingsPath(workspaceRoot), "utf8")) as unknown;
    const normalized = normalizeSettings(parsed);
    if (!isRecord(parsed) || parsed.version !== 3 || JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await writeSettingsAtomic(workspaceRoot, normalized);
    }
    return normalized;
  } catch {
    return defaultPlatformSettings();
  }
}

export async function updatePlatformSettings(workspaceRoot: string, patch: unknown): Promise<KForgePlatformSettings> {
  const parsed = settingsUpdateSchema.safeParse(patch);
  if (!parsed.success) throw new SettingsValidationError(parsed.error);
  const current = await readPlatformSettings(workspaceRoot);
  const update = parsed.data;
  const now = new Date().toISOString();
  const merged = normalizeSettings({
    ...current,
    general: { ...current.general, ...update.general },
    appearance: { ...current.appearance, ...update.appearance },
    preview: { ...current.preview, ...update.preview },
    privacy: { ...current.privacy, ...update.privacy, secretRedaction: true },
    git: { ...current.git, ...update.git, confirmRemoteWrites: true },
    updatedAt: now,
  }, now, current);
  await writeSettingsAtomic(workspaceRoot, merged);
  return merged;
}

export async function resetPlatformSettings(workspaceRoot: string): Promise<KForgePlatformSettings> {
  const defaults = defaultPlatformSettings();
  await writeSettingsAtomic(workspaceRoot, defaults);
  return defaults;
}

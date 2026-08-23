import { promises as fs } from "fs";
import path from "path";
import {
  KFORGE_STARTUP_CAPABILITIES,
  type KForgePlatformSettings,
  type KForgeStartupCapability,
} from "../../shared/workspace";

const healthIntervals = new Set<KForgePlatformSettings["preview"]["healthIntervalMs"]>([3_000, 5_000, 10_000, 30_000]);

function settingsPath(workspaceRoot: string) {
  return path.join(workspaceRoot, ".kforge", "platform-settings.json");
}

export function defaultPlatformSettings(now = new Date().toISOString()): KForgePlatformSettings {
  return {
    version: 1,
    general: { startupCapability: "Workspace" },
    appearance: { density: "comfortable", reducedMotion: false },
    preview: { autoHealthCheck: true, healthIntervalMs: 5_000 },
    privacy: { secretRedaction: true, remoteContextPolicy: "ask" },
    git: { confirmRemoteWrites: true },
    updatedAt: now,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSettings(value: unknown, now = new Date().toISOString(), fallback = defaultPlatformSettings(now)): KForgePlatformSettings {
  if (!isRecord(value)) return fallback;
  const general = isRecord(value.general) ? value.general : {};
  const appearance = isRecord(value.appearance) ? value.appearance : {};
  const preview = isRecord(value.preview) ? value.preview : {};
  const privacy = isRecord(value.privacy) ? value.privacy : {};
  const startup = typeof general.startupCapability === "string" && (KFORGE_STARTUP_CAPABILITIES as readonly string[]).includes(general.startupCapability)
    ? general.startupCapability as KForgeStartupCapability
    : fallback.general.startupCapability;
  const interval = typeof preview.healthIntervalMs === "number" && healthIntervals.has(preview.healthIntervalMs as KForgePlatformSettings["preview"]["healthIntervalMs"])
    ? preview.healthIntervalMs as KForgePlatformSettings["preview"]["healthIntervalMs"]
    : fallback.preview.healthIntervalMs;
  return {
    version: 1,
    general: { startupCapability: startup },
    appearance: {
      density: appearance.density === "compact" || appearance.density === "comfortable" ? appearance.density : fallback.appearance.density,
      reducedMotion: typeof appearance.reducedMotion === "boolean" ? appearance.reducedMotion : fallback.appearance.reducedMotion,
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
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
  };
}

export async function readPlatformSettings(workspaceRoot: string): Promise<KForgePlatformSettings> {
  try {
    return normalizeSettings(JSON.parse(await fs.readFile(settingsPath(workspaceRoot), "utf8")));
  } catch {
    return defaultPlatformSettings();
  }
}

export async function updatePlatformSettings(workspaceRoot: string, patch: unknown): Promise<KForgePlatformSettings> {
  const current = await readPlatformSettings(workspaceRoot);
  const update = isRecord(patch) ? patch : {};
  const now = new Date().toISOString();
  const merged = normalizeSettings({
    ...current,
    ...update,
    general: { ...current.general, ...(isRecord(update.general) ? update.general : {}) },
    appearance: { ...current.appearance, ...(isRecord(update.appearance) ? update.appearance : {}) },
    preview: { ...current.preview, ...(isRecord(update.preview) ? update.preview : {}) },
    privacy: { ...current.privacy, ...(isRecord(update.privacy) ? update.privacy : {}) },
    git: current.git,
    updatedAt: now,
  }, now, current);
  await fs.mkdir(path.dirname(settingsPath(workspaceRoot)), { recursive: true });
  await fs.writeFile(settingsPath(workspaceRoot), `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return merged;
}

export async function resetPlatformSettings(workspaceRoot: string): Promise<KForgePlatformSettings> {
  const defaults = defaultPlatformSettings();
  await fs.mkdir(path.dirname(settingsPath(workspaceRoot)), { recursive: true });
  await fs.writeFile(settingsPath(workspaceRoot), `${JSON.stringify(defaults, null, 2)}\n`, "utf8");
  return defaults;
}

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import {
  KFORGE_STARTUP_CAPABILITIES,
  type KForgePlatformSettings,
  type KForgeStartupCapability,
} from "../../shared/workspace";

const startupCapabilities = new Set<string>(KFORGE_STARTUP_CAPABILITIES);
const healthIntervals = new Set<number>([3_000, 5_000, 10_000, 30_000]);

const settingsUpdateSchema = z.object({
  version: z.literal(2).optional(),
  general: z.object({ startupCapability: z.string().refine((value) => startupCapabilities.has(value), "Unknown startup capability.") }).strict().optional(),
  appearance: z.object({ density: z.enum(["compact", "comfortable"]), reducedMotion: z.boolean() }).partial().strict().optional(),
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
    version: 2,
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

function validDate(value: unknown, fallback: string) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

function normalizeSettings(value: unknown, now = new Date().toISOString(), fallback = defaultPlatformSettings(now)): KForgePlatformSettings {
  if (!isRecord(value)) return fallback;
  const general = isRecord(value.general) ? value.general : {};
  const appearance = isRecord(value.appearance) ? value.appearance : {};
  const preview = isRecord(value.preview) ? value.preview : {};
  const privacy = isRecord(value.privacy) ? value.privacy : {};
  const startup = typeof general.startupCapability === "string" && startupCapabilities.has(general.startupCapability)
    ? general.startupCapability as KForgeStartupCapability
    : fallback.general.startupCapability;
  const interval = typeof preview.healthIntervalMs === "number" && healthIntervals.has(preview.healthIntervalMs)
    ? preview.healthIntervalMs as KForgePlatformSettings["preview"]["healthIntervalMs"]
    : fallback.preview.healthIntervalMs;
  return {
    version: 2,
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
    if (isRecord(parsed) && parsed.version === 1) await writeSettingsAtomic(workspaceRoot, normalized);
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

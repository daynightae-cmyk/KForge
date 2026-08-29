import { promises as fs } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { readPlatformSettings, resetPlatformSettings, SettingsValidationError, updatePlatformSettings } from "./platformSettings";

async function withRoot(run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-platform-settings-"));
  try {
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("platform settings persistence", () => {
  it("returns safe v3 hierarchical defaults when the settings file is missing", async () => withRoot(async (root) => {
    expect(await readPlatformSettings(root)).toMatchObject({
      version: 3,
      general: { startupCapability: "Workspace", startupActivity: "projects", startupOnlineView: "discover" },
      appearance: { density: "comfortable", reducedMotion: false, theme: "system" },
      privacy: { secretRedaction: true, remoteContextPolicy: "ask" },
      git: { confirmRemoteWrites: true },
    });
  }));

  it("atomically persists every EDITABLE_REAL setting and enforces security invariants", async () => withRoot(async (root) => {
    const updated = await updatePlatformSettings(root, {
      general: { startupCapability: "Preview", startupActivity: "developer-tools", startupOnlineView: "updates" },
      appearance: { density: "compact", reducedMotion: true, theme: "dark" },
      preview: { autoHealthCheck: false, healthIntervalMs: 10_000 },
      privacy: { secretRedaction: false, remoteContextPolicy: "blocked" },
      git: { confirmRemoteWrites: false },
    });
    expect(updated).toMatchObject({
      version: 3,
      general: { startupCapability: "Preview", startupActivity: "developer-tools", startupOnlineView: "updates" },
      appearance: { density: "compact", reducedMotion: true, theme: "dark" },
      preview: { autoHealthCheck: false, healthIntervalMs: 10_000 },
      privacy: { secretRedaction: true, remoteContextPolicy: "blocked" },
      git: { confirmRemoteWrites: true },
    });
    expect(await readPlatformSettings(root)).toEqual(updated);
    expect((await fs.readdir(path.join(root, ".kforge"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  }));

  it("rejects invalid values and unknown fields without replacing the last valid file", async () => withRoot(async (root) => {
    const valid = await updatePlatformSettings(root, { general: { startupCapability: "Preview", startupActivity: "developer-tools" }, preview: { healthIntervalMs: 10_000 } });
    await expect(updatePlatformSettings(root, { general: { startupCapability: "Fake panel" } })).rejects.toBeInstanceOf(SettingsValidationError);
    await expect(updatePlatformSettings(root, { general: { startupActivity: "fake" } })).rejects.toBeInstanceOf(SettingsValidationError);
    await expect(updatePlatformSettings(root, { preview: { healthIntervalMs: 123 } })).rejects.toBeInstanceOf(SettingsValidationError);
    await expect(updatePlatformSettings(root, { decorativeDomain: { enabled: true } })).rejects.toBeInstanceOf(SettingsValidationError);
    expect(await readPlatformSettings(root)).toEqual(valid);
  }));

  it("migrates v1 settings to canonical v3 while preserving supported values and security invariants", async () => withRoot(async (root) => {
    const settingsFile = path.join(root, ".kforge", "platform-settings.json");
    await fs.mkdir(path.dirname(settingsFile), { recursive: true });
    await fs.writeFile(settingsFile, JSON.stringify({
      version: 1,
      general: { startupCapability: "Agents" },
      appearance: { density: "compact", reducedMotion: true },
      preview: { autoHealthCheck: false, healthIntervalMs: 30_000 },
      privacy: { secretRedaction: false, remoteContextPolicy: "blocked" },
      git: { confirmRemoteWrites: false },
      updatedAt: "2026-08-23T00:00:00.000Z",
    }), "utf8");
    const migrated = await readPlatformSettings(root);
    expect(migrated).toMatchObject({
      version: 3,
      general: { startupCapability: "Agents", startupActivity: "ai", startupOnlineView: "discover" },
      appearance: { density: "compact", reducedMotion: true, theme: "system" },
      preview: { autoHealthCheck: false, healthIntervalMs: 30_000 },
      privacy: { secretRedaction: true, remoteContextPolicy: "blocked" },
      git: { confirmRemoteWrites: true },
    });
    expect(JSON.parse(await fs.readFile(settingsFile, "utf8"))).toEqual(migrated);
  }));

  it("migrates legacy v2 flat Online destinations into Online activity plus scoped view", async () => withRoot(async (root) => {
    const settingsFile = path.join(root, ".kforge", "platform-settings.json");
    await fs.mkdir(path.dirname(settingsFile), { recursive: true });
    await fs.writeFile(settingsFile, JSON.stringify({
      version: 2,
      general: { startupCapability: "Model Hub" },
      appearance: { density: "comfortable", reducedMotion: false },
      preview: { autoHealthCheck: true, healthIntervalMs: 5_000 },
      privacy: { secretRedaction: true, remoteContextPolicy: "ask" },
      git: { confirmRemoteWrites: true },
      updatedAt: "2026-08-24T00:00:00.000Z",
    }), "utf8");
    const migrated = await readPlatformSettings(root);
    expect(migrated).toMatchObject({
      version: 3,
      general: { startupCapability: "Discover", startupActivity: "online", startupOnlineView: "models" },
    });
    expect(JSON.parse(await fs.readFile(settingsFile, "utf8"))).toEqual(migrated);
  }));

  it("normalizes partial v3 files while leaving malformed interrupted-write evidence recoverable", async () => withRoot(async (root) => {
    const settingsFile = path.join(root, ".kforge", "platform-settings.json");
    await fs.mkdir(path.dirname(settingsFile), { recursive: true });
    await fs.writeFile(settingsFile, JSON.stringify({ version: 3, appearance: { density: "compact" }, unknown: true, updatedAt: "2026-08-24T00:00:00.000Z" }), "utf8");
    const normalized = await readPlatformSettings(root);
    expect(normalized).toMatchObject({ version: 3, general: { startupActivity: "projects", startupOnlineView: "discover" }, appearance: { density: "compact", reducedMotion: false, theme: "system" }, privacy: { secretRedaction: true }, git: { confirmRemoteWrites: true } });
    expect(JSON.parse(await fs.readFile(settingsFile, "utf8"))).toEqual(normalized);

    const valid = await updatePlatformSettings(root, { general: { startupCapability: "Project health" } });
    await fs.writeFile(`${settingsFile}.interrupted.tmp`, "{\"version\":3", "utf8");
    expect(await readPlatformSettings(root)).toEqual(valid);

    await fs.writeFile(settingsFile, "{ malformed", "utf8");
    expect(await readPlatformSettings(root)).toMatchObject({ version: 3, general: { startupCapability: "Workspace", startupActivity: "projects" }, privacy: { secretRedaction: true }, git: { confirmRemoteWrites: true } });
    expect(await fs.readFile(settingsFile, "utf8")).toBe("{ malformed");
  }));

  it("resets only platform settings to safe local defaults", async () => withRoot(async (root) => {
    await updatePlatformSettings(root, { appearance: { density: "compact", theme: "dark" } });
    const reset = await resetPlatformSettings(root);
    expect(reset.appearance).toMatchObject({ density: "comfortable", theme: "system" });
    expect(reset.general).toMatchObject({ startupActivity: "projects", startupOnlineView: "discover" });
  }));
});

import { promises as fs } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { readPlatformSettings, resetPlatformSettings, updatePlatformSettings } from "./platformSettings";

describe("platform settings persistence", () => {
  it("persists supported settings and rejects unsafe or unknown values", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-platform-settings-"));
    try {
      const updated = await updatePlatformSettings(root, {
        general: { startupCapability: "Preview" },
        appearance: { density: "compact", reducedMotion: true },
        preview: { autoHealthCheck: false, healthIntervalMs: 10_000 },
        privacy: { secretRedaction: false, remoteContextPolicy: "blocked" },
        git: { confirmRemoteWrites: false },
      });
      expect(updated).toMatchObject({
        general: { startupCapability: "Preview" },
        appearance: { density: "compact", reducedMotion: true },
        preview: { autoHealthCheck: false, healthIntervalMs: 10_000 },
        privacy: { secretRedaction: true, remoteContextPolicy: "blocked" },
        git: { confirmRemoteWrites: true },
      });
      expect(await readPlatformSettings(root)).toEqual(updated);
      const normalized = await updatePlatformSettings(root, { general: { startupCapability: "Fake panel" }, preview: { healthIntervalMs: 123 } });
      expect(normalized.general.startupCapability).toBe("Preview");
      expect(normalized.preview.healthIntervalMs).toBe(10_000);
      expect((await resetPlatformSettings(root)).appearance.density).toBe("comfortable");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { DEFAULT_WINDOW_STATE, createWindowStateStore, ensureVisibleBounds, sanitizeWindowState } = require("./windowState.cjs") as {
  DEFAULT_WINDOW_STATE: { width: number; height: number; x: number | null; y: number | null; maximized: boolean };
  createWindowStateStore: (file: string) => { load: () => typeof DEFAULT_WINDOW_STATE; save: (state: Record<string, unknown>) => boolean };
  ensureVisibleBounds: (state: Record<string, unknown>, displays: unknown[], primary?: unknown) => typeof DEFAULT_WINDOW_STATE;
  sanitizeWindowState: (state: unknown) => typeof DEFAULT_WINDOW_STATE;
};

const primary = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
const secondary = { id: 2, workArea: { x: 1920, y: 0, width: 1920, height: 1080 } };

describe("desktop window state", () => {
  it("falls back to the default window for malformed state", () => {
    expect(sanitizeWindowState(null)).toEqual(DEFAULT_WINDOW_STATE);
    expect(sanitizeWindowState({ width: "wide", height: NaN, x: "left", y: Infinity, maximized: "yes" })).toEqual(DEFAULT_WINDOW_STATE);
  });

  it("clamps dimensions into the supported desktop range", () => {
    expect(sanitizeWindowState({ width: 640, height: 480 })).toMatchObject({ width: 1024, height: 720 });
    expect(sanitizeWindowState({ width: 999_999, height: 999_999 })).toMatchObject({ width: 16384, height: 16384 });
  });

  it("keeps a position that is still visible on an attached display", () => {
    const state = { width: 1480, height: 920, x: 2200, y: 40, maximized: false };
    expect(ensureVisibleBounds(state, [primary, secondary], primary)).toEqual(state);
  });

  it("recenters a stale off-screen position on the primary display", () => {
    const state = { width: 1480, height: 920, x: 9000, y: 9000, maximized: false };
    const result = ensureVisibleBounds(state, [primary, secondary], primary);
    expect(result.x).toBe(220);
    expect(result.y).toBe(80);
    expect(result.width).toBe(1480);
    expect(result.height).toBe(920);
  });

  it("centers a first window without saved coordinates", () => {
    const result = ensureVisibleBounds({ width: 1400, height: 900 }, [primary], primary);
    expect(result.x).toBe(260);
    expect(result.y).toBe(90);
  });

  it("round-trips state and degrades to defaults for corrupt files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-window-state-"));
    const file = path.join(root, "state", "window-state.json");
    try {
      const store = createWindowStateStore(file);
      expect(store.load()).toEqual(DEFAULT_WINDOW_STATE);
      expect(store.save({ width: 1600, height: 1000, x: 120, y: 80, maximized: true })).toBe(true);
      expect(store.load()).toEqual({ width: 1600, height: 1000, x: 120, y: 80, maximized: true });

      await fs.writeFile(file, "{not json", "utf8");
      expect(store.load()).toEqual(DEFAULT_WINDOW_STATE);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("reports a failed save instead of breaking shutdown", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-window-state-"));
    const file = path.join(root, "unwritable");
    try {
      await fs.mkdir(file);
      expect(createWindowStateStore(file).save({ width: 1480, height: 920 })).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

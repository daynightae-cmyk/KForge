import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createBoundedLogWriter } = require("./logFile.cjs") as {
  createBoundedLogWriter: (target: string, options?: { maxBytes?: number }) => { write: (value: string) => void; maxBytes: number };
};

describe("bounded desktop diagnostic log", () => {
  it("rotates one backup at the byte ceiling and keeps accepting new lines", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-desktop-log-"));
    const target = path.join(root, "logs", "desktop.log");
    try {
      const writer = createBoundedLogWriter(target, { maxBytes: 100 });
      expect(writer.maxBytes).toBe(100);
      writer.write(`${"a".repeat(60)}\n`);
      writer.write(`${"b".repeat(60)}\n`);

      const current = await fs.readFile(target, "utf8");
      const rotated = await fs.readFile(`${target}.1`, "utf8");
      expect(current.startsWith("b")).toBe(true);
      expect(rotated.startsWith("a")).toBe(true);

      writer.write(`${"c".repeat(10)}\n`);
      expect(await fs.readFile(target, "utf8")).toContain("c".repeat(10));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("writes an oversized first line instead of losing diagnostics", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kforge-desktop-log-"));
    const target = path.join(root, "desktop.log");
    try {
      const writer = createBoundedLogWriter(target, { maxBytes: 20 });
      writer.write(`${"x".repeat(80)}\n`);
      expect((await fs.readFile(target, "utf8")).startsWith("x")).toBe(true);
      await expect(fs.stat(`${target}.1`)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

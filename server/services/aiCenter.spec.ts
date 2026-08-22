import { promises as fs } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { getModelCenter } from "./aiCenter";

describe("KForge Model Center", () => {
  it("exposes local model families while marking unavailable remote update data as UNKNOWN", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-model-center-"));
    try {
      const center = await getModelCenter(workspaceRoot);
      const qwenFamily = center.families.find((family) => family.family === "Qwen2.5-Coder");
      expect(qwenFamily?.variants.map((variant) => variant.variant)).toEqual(expect.arrayContaining(["1.5B", "3B", "7B"]));
      expect(qwenFamily?.updateSource).toBe("DATA_UNAVAILABLE");
      expect(center.recommendations.every((model) => model.update.state === "UNKNOWN" && model.update.latestKnownVersion === "UNKNOWN" && model.quantization === "UNSPECIFIED")).toBe(true);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 10_000);
});

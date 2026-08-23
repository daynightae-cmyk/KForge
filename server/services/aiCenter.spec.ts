import { promises as fs } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { checkForModelUpdates, getModelCenter, getModelChangelog, getModelCompatibility, installModelUpdate, verifyModelUpdate } from "./aiCenter";

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

  it("exposes a truthful blocked update workflow when no remote registry adapter is configured", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-model-updates-"));
    try {
      const update = await checkForModelUpdates(workspaceRoot, "qwen2.5-coder:3b");
      const changelog = await getModelChangelog(workspaceRoot, "qwen2.5-coder:3b");
      const compatibility = await getModelCompatibility(workspaceRoot, "qwen2.5-coder:3b");
      const installation = await installModelUpdate(workspaceRoot, "qwen2.5-coder:3b");
      const verification = await verifyModelUpdate(workspaceRoot, "qwen2.5-coder:3b");
      expect(update).toMatchObject({ state: "MODEL_NOT_INSTALLED", latestKnownVersion: "UNKNOWN", changelog: "REMOTE_REGISTRY_NOT_CONFIGURED", source: { configured: false } });
      expect(changelog.entries).toEqual([]);
      expect(compatibility.state).toBe("AVAILABLE");
      expect(installation).toMatchObject({ allowed: false, action: "BLOCKED", state: "MODEL_NOT_INSTALLED" });
      expect(verification.verification).toBe("MODEL_NOT_INSTALLED");
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 10_000);
});

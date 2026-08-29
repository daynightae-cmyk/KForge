import { describe, expect, it } from "vitest";
import type { ProjectProfile } from "../../shared/workspace";
import { evaluatePreviewEmbedding, getPreviewStatus, inspectPreviewCapability, startPreview } from "./previewRuntime";

const profileWithoutPreview = { packageManager: "npm", scripts: {} } as ProjectProfile;

describe("local Preview runtime", () => {
  it("reports an explicit idle state before a project Preview starts", () => {
    const preview = getPreviewStatus("missing-preview");
    expect(preview).toMatchObject({ projectId: "missing-preview", state: "idle", health: { ok: false } });
    expect(preview.health?.detail).toContain("No Preview process");
    expect(preview.telemetry).toMatchObject({ console: "process-stdout-stderr", network: "loopback-health-probe-only", browserConsoleCaptured: false });
  });

  it("refuses to fabricate a Preview when no detected preview, dev, or start script exists", async () => {
    const preview = await startPreview("missing-command-preview", process.cwd(), profileWithoutPreview);
    expect(preview).toMatchObject({ state: "unavailable", error: "PREVIEW_COMMAND_UNAVAILABLE", health: { ok: false } });
  });

  it("describes detected Preview eligibility without allocating a fake fixed port", () => {
    const capability = inspectPreviewCapability({
      packageManager: "npm",
      scripts: { dev: "vite" },
    } as unknown as ProjectProfile);
    expect(capability).toMatchObject({
      available: true,
      source: "package.json#scripts.dev",
      command: "npm run dev -- --port <allocated>",
    });
    expect(inspectPreviewCapability(profileWithoutPreview)).toMatchObject({ available: false, reason: expect.stringContaining("UNAVAILABLE") });
  });

  it("keeps iframe eligibility conservative for response framing policies", () => {
    expect(evaluatePreviewEmbedding(new Headers())).toMatchObject({ state: "ALLOWED" });
    expect(evaluatePreviewEmbedding(new Headers({ "x-frame-options": "DENY" }))).toMatchObject({ state: "BLOCKED" });
    expect(evaluatePreviewEmbedding(new Headers({ "x-frame-options": "SAMEORIGIN" }))).toMatchObject({ state: "BLOCKED" });
    expect(evaluatePreviewEmbedding(new Headers({ "content-security-policy": "default-src 'self'; frame-ancestors 'none'" }))).toMatchObject({ state: "BLOCKED" });
    expect(evaluatePreviewEmbedding(new Headers({ "content-security-policy": "frame-ancestors http://127.0.0.1:*" }))).toMatchObject({ state: "ALLOWED" });
    const explicitAllowlist = evaluatePreviewEmbedding(new Headers({ "content-security-policy": "frame-ancestors https://example.com" }));
    expect(explicitAllowlist).toMatchObject({ state: "UNKNOWN" });
    expect(explicitAllowlist.reason).toContain("cannot prove");
  });
});

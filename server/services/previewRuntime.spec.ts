import { describe, expect, it } from "vitest";
import type { ProjectProfile } from "../../shared/workspace";
import { getPreviewStatus, startPreview } from "./previewRuntime";

const profileWithoutPreview = { packageManager: "npm", scripts: {} } as ProjectProfile;

describe("local Preview runtime", () => {
  it("reports an explicit idle state before a project Preview starts", () => {
    const preview = getPreviewStatus("missing-preview");
    expect(preview).toMatchObject({ projectId: "missing-preview", state: "idle", health: { ok: false } });
    expect(preview.health?.detail).toContain("No Preview process");
  });

  it("refuses to fabricate a Preview when no detected preview, dev, or start script exists", async () => {
    const preview = await startPreview("missing-command-preview", process.cwd(), profileWithoutPreview);
    expect(preview).toMatchObject({ state: "unavailable", error: "PREVIEW_COMMAND_UNAVAILABLE", health: { ok: false } });
  });
});

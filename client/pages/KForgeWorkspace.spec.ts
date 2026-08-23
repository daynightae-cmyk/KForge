import { describe, expect, it } from "vitest";
import { CAPABILITY_RENDERER_IDS, missingCapabilityRenderers, navHoverInfo, visibleNavigationLabels } from "./KForgeWorkspace";

describe("KForge Workspace capability coverage", () => {
  it("assigns every visible sidebar item to an explicit capability renderer", () => {
    const labels = visibleNavigationLabels();
    expect(labels.length).toBeGreaterThan(40);
    expect(new Set(labels).size).toBe(labels.length);
    expect(missingCapabilityRenderers()).toEqual([]);
    labels.forEach((label) => expect(CAPABILITY_RENDERER_IDS[label]).toMatch(/Panel|Center|WorkspaceProjectList|Onboarding/));
  });

  it("provides accessible Hover and Focus card content for every visible sidebar item", () => {
    visibleNavigationLabels().forEach((label) => {
      const info = navHoverInfo(label, "Workspace");
      expect(info.description.length).toBeGreaterThan(20);
      expect(info.capability.length).toBeGreaterThan(3);
    });
  });
});

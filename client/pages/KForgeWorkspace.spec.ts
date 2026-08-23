import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAPABILITY_RENDERER_IDS, missingCapabilityRenderers, navHoverInfo, ONLINE_NAVIGATION_LABELS, visibleNavigationLabels } from "./KForgeWorkspace";

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

  it("labels each Problems filter for assistive technology", () => {
    const source = readFileSync(new URL("./KForgeWorkspace.tsx", import.meta.url), "utf8");
    expect(source).toContain('aria-label="Filter problems by severity"');
    expect(source).toContain('aria-label="Filter problems by source"');
    expect(source).toContain('aria-label="Filter problems by category"');
  });

  it("routes every Online destination into one dedicated Online Hub renderer", () => {
    expect(ONLINE_NAVIGATION_LABELS.length).toBeGreaterThanOrEqual(10);
    ONLINE_NAVIGATION_LABELS.forEach((label) => expect(CAPABILITY_RENDERER_IDS[label]).toBe("OnlineHubPanel"));
  });

  it("renders Projects and non-Workspace capabilities as mutually exclusive surfaces", () => {
    const source = readFileSync(new URL("./KForgeWorkspace.tsx", import.meta.url), "utf8");
    expect(source).toContain('activeNav === "Workspace" && <><section className="kf-workspace-panel"');
    expect(source).toContain('activeNav !== "Workspace" && <section className={`kf-active-surface');
    expect(source).not.toContain('activeProject && activeNav !== "Workspace" && <CapabilitySurface');
  });
});

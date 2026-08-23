import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAPABILITY_RENDERER_IDS, missingCapabilityRenderers, navHoverInfo, ONLINE_NAVIGATION_LABELS, PREVIEW_CONTEXT_NAVIGATION_LABELS, visibleNavigationLabels } from "./KForgeWorkspace";

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
    expect(ONLINE_NAVIGATION_LABELS).toEqual([
      "Discover", "Marketplace", "Extensions", "Model Hub", "Agent Marketplace", "Tool Marketplace", "Integrations",
      "Providers", "Installed", "Updates", "Security Center", "Remote Sources", "Downloads", "Activity",
    ]);
    ONLINE_NAVIGATION_LABELS.forEach((label) => expect(CAPABILITY_RENDERER_IDS[label]).toBe("OnlineHubPanel"));
  });

  it("renders the no-contact Online Control Center and operation transparency evidence", () => {
    const source = readFileSync(new URL("./KForgeWorkspace.tsx", import.meta.url), "utf8");
    expect(source).toContain('/online/control-center');
    expect(source).toContain('Online Control Center');
    expect(source).toContain('NO REMOTE CONTACT');
    expect(source).toContain('Opening disclosure');
    expect(source).toContain('Execution and data disclosure');
    expect(source).toContain('SOURCE_CODE');
  });

  it("renders the complete Marketplace taxonomy, evidence details, and permission review", () => {
    const source = readFileSync(new URL("./KForgeWorkspace.tsx", import.meta.url), "utf8");
    expect(source).toContain('Marketplace product taxonomy');
    expect(source).toContain('Integrity / checksum');
    expect(source).toContain('Release History');
    expect(source).toContain('Review all capability classes before installation or enablement.');
    expect(source).toContain('NOT_AVAILABLE · no feature metadata was supplied.');
    expect(source).toContain('Agent → Marketplace project evidence');
    expect(source).toContain('Complete Lifecycle');
    expect(source).toContain('Project-Aware Agent Flow');
    expect(source).toContain('/projects/${project.id}/marketplace');
  });

  it("renders language-aware graph and transitive impact evidence without hiding unavailable boundaries", () => {
    const source = readFileSync(new URL("./KForgeWorkspace.tsx", import.meta.url), "utf8");
    expect(source).toContain("Exported symbols");
    expect(source).toContain("Transitive dependents");
    expect(source).toContain("Language parser boundaries");
    expect(source).toContain("Duplicated responsibility evidence");
    expect(source).toContain("symbol node id");
    expect(source).toContain("unsupported-language impact remain explicitly unavailable");
  });

  it("renders Projects and non-Workspace capabilities as mutually exclusive surfaces", () => {
    const source = readFileSync(new URL("./KForgeWorkspace.tsx", import.meta.url), "utf8");
    expect(source).toContain('activeNav === "Workspace" && <><section className="kf-workspace-panel"');
    expect(source).toContain('activeNav !== "Workspace" && <section className={`kf-active-surface');
    expect(source).not.toContain('activeProject && activeNav !== "Workspace" && <CapabilitySurface');
  });

  it("keeps legacy demo and mock editor surfaces outside the production router", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const server = readFileSync(new URL("../../server/index.ts", import.meta.url), "utf8");
    expect(app).not.toContain('path="/editor"');
    expect(app).not.toContain("KnouxVideoEditor");
    expect(server).not.toContain('/api/demo');
    expect(server).not.toContain('/api/ai-models');
  });

  it("connects Settings and Preview V2 to persisted platform behavior", () => {
    const source = readFileSync(new URL("./KForgeWorkspace.tsx", import.meta.url), "utf8");
    expect(CAPABILITY_RENDERER_IDS.Settings).toBe("SettingsCenter");
    expect(source).toContain('<SettingsCenter settings={settings}');
    expect(source).toContain('KNOuX Forge Preview Engine');
    expect(source).toContain('Automatic health checks');
    expect(source).toContain('Browser console capture: NOT AVAILABLE');
    expect(source).toContain('/preview/fix-verify');
    expect(source).toContain('Preview → Fix → Verify');
    expect(source).toContain('Local · GitHub · CI · Preview');
  });

  it("references the single Preview session from every requested engineering context", () => {
    expect(PREVIEW_CONTEXT_NAVIGATION_LABELS).toEqual([
      "Project health", "Agents", "Tasks", "KForge Sonar", "Problems", "Solutions", "Project graph", "Architecture",
      "Tests", "Build", "Runtime", "Git", "GitHub", "Pull requests", "Issues", "Actions", "Releases", "Marketplace", "Models",
    ]);
    const source = readFileSync(new URL("./KForgeWorkspace.tsx", import.meta.url), "utf8");
    expect(source).toContain('source="Project"');
    expect(source).toContain("Current Preview context");
    expect(source).toContain("same project Preview session and evidence");
    expect(source).toContain('onNavigate("Preview")');
    expect(source).toContain('/preview`');
  });

  it("renders real GitHub Checks and per-source availability evidence as read-only remote data", () => {
    const source = readFileSync(new URL("./KForgeWorkspace.tsx", import.meta.url), "utf8");
    expect(source).toContain("Real GitHub Checks");
    expect(source).toContain("GitHub source availability");
    expect(source).toContain("checkRuns");
    expect(source).toContain("combinedStatus");
    expect(source).toContain("Branches and recent commits");
    expect(source).toContain("Remote writes remain separate and unavailable");
  });
});

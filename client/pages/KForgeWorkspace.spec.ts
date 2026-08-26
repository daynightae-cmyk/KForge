import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KFORGE_ACTIVITY_IDS, ONLINE_EXPLORER_VIEWS } from "./KForgeWorkbench";

describe("KForge contextual workbench architecture", () => {
  it("publishes only the nine high-level Activity Bar domains", () => {
    expect(KFORGE_ACTIVITY_IDS).toEqual([
      "projects", "ai", "online", "intelligence", "quality", "developer-tools", "remote", "release", "system",
    ]);
    expect(new Set(KFORGE_ACTIVITY_IDS).size).toBe(9);
  });

  it("keeps every Online child inside one scoped Online Explorer", () => {
    expect(ONLINE_EXPLORER_VIEWS).toEqual([
      "discover", "marketplace", "extensions", "models", "agents", "tools", "integrations",
      "installed", "updates", "downloads", "providers", "remote-sources", "security", "activity",
    ]);
  });

  it("renders a persistent Activity Bar, contextual Explorer, one Workbench owner, Inspector, and developer bottom panel", () => {
    const source = readFileSync(new URL("./KForgeWorkbench.tsx", import.meta.url), "utf8");
    expect(source).toContain('className="kw-activity-bar"');
    expect(source).toContain('aria-label={`${currentActivity.label} Explorer`}');
    expect(source).toContain('className="kw-workbench"');
    expect(source).toContain('className="kw-inspector"');
    expect(source).toContain('className="kw-bottom-panel"');
    expect(source.match(/<WorkbenchSurface /g)).toHaveLength(1);
  });

  it("keeps Online global and explicitly reports projectless compatibility as NOT_EVALUATED", () => {
    const source = readFileSync(new URL("./KForgeWorkbench.tsx", import.meta.url), "utf8");
    expect(source).toContain('"/api/workspace/online/control-center"');
    expect(source).toContain('"/api/workspace/marketplace"');
    expect(source).toContain('"NOT_EVALUATED"');
    expect(source).toContain('No project selected');
    expect(source).toContain('Opening this surface performs no remote catalog refresh.');
  });

  it("uses explicit authority/runtime/install evidence instead of metadata-only local claims", () => {
    const source = readFileSync(new URL("./KForgeWorkbench.tsx", import.meta.url), "utf8");
    expect(source).toContain("item.authority?.kind");
    expect(source).toContain("item.runtimeEvidence?.state");
    expect(source).toContain("item.availability");
    expect(source).toContain('item.installAction === "NOT_AVAILABLE"');
    expect(source).toContain("No required permission was declared by verified metadata.");
  });

  it("keeps Downloads distinct from broader Online Activity", () => {
    const source = readFileSync(new URL("./KForgeWorkbench.tsx", import.meta.url), "utf8");
    expect(source).toContain("const downloadTasks = tasks.filter");
    expect(source).toContain("const onlineTasks = tasks.filter");
    expect(source).toContain("Downloads contains transfer, staging and installation-transfer tasks only");
  });

  it("implements a safe KForge terminal rather than unrestricted shell input", () => {
    const source = readFileSync(new URL("./KForgeWorkbench.tsx", import.meta.url), "utf8");
    expect(source).toContain("KForge Command Terminal");
    expect(source).toContain("Only registered KForge actions are executable. There is no unrestricted shell input.");
    expect(source).toContain("/actions");
    expect(source).toContain("descriptor.enabled");
  });

  it("keeps artifacts structured and raw evidence secondary", () => {
    const source = readFileSync(new URL("./KForgeWorkbench.tsx", import.meta.url), "utf8");
    expect(source).toContain("<th>Artifact</th>");
    expect(source).toContain("<th>SHA-256</th>");
    expect(source).toContain("<th>Signature</th>");
    expect(source).toContain("Advanced · Raw release evidence");
  });

  it("uses Settings v3 hierarchical startup navigation and enforced security invariants", () => {
    const source = readFileSync(new URL("./KForgeWorkbench.tsx", import.meta.url), "utf8");
    expect(source).toContain("startupActivity");
    expect(source).toContain("startupOnlineView");
    expect(source).toContain("version: 3");
    expect(source).toContain("secretRedaction = true · confirmRemoteWrites = true");
  });

  it("routes production /workspace to the contextual workbench rather than the legacy flat mega-component", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    expect(app).toContain('import KForgeWorkbench from "./pages/KForgeWorkbench"');
    expect(app).toContain('<Route path="/workspace" element={<KForgeWorkbench />} />');
    expect(app).not.toContain('import KForgeWorkspace from "./pages/KForgeWorkspace"');
  });

  it("uses one inherited KNOuX theme for shell and Online surfaces", () => {
    const css = readFileSync(new URL("./KForgeWorkbench.css", import.meta.url), "utf8");
    expect(css).toContain("hsl(var(--background))");
    expect(css).toContain("hsl(var(--card))");
    expect(css).toContain("hsl(var(--foreground))");
    expect(css).not.toContain("--kf-online-bg");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});

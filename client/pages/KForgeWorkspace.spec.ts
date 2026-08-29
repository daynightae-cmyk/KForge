import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KFORGE_ACTIVITY_IDS, ONLINE_EXPLORER_VIEWS } from "./KForgeWorkbench";

const workbenchSource = () => readFileSync(new URL("../workbench/KForgeWorkbench.tsx", import.meta.url), "utf8");
const surfacesSource = () => readFileSync(new URL("../workbench/surfaces.tsx", import.meta.url), "utf8");
const contractsSource = () => readFileSync(new URL("../workbench/surfaceContracts.ts", import.meta.url), "utf8");
const surfaceAuditSource = () => readFileSync(new URL("../workbench/surfaceAudit.ts", import.meta.url), "utf8");
const surfaceTypesSource = () => readFileSync(new URL("../workbench/surfaceTypes.ts", import.meta.url), "utf8");
const sharedHelperSource = () => readFileSync(new URL("../workbench/surfaceShared.tsx", import.meta.url), "utf8");
const uiSource = () => readFileSync(new URL("../workbench/ui.tsx", import.meta.url), "utf8");
const navigationSource = () => readFileSync(new URL("../workbench/navigation.ts", import.meta.url), "utf8");
const onlineSurfaceSource = () => readFileSync(new URL("../workbench/onlineSurface.tsx", import.meta.url), "utf8");
const developerSurfaceSource = () => readFileSync(new URL("../workbench/developerSurface.tsx", import.meta.url), "utf8");
const releaseSurfaceSource = () => readFileSync(new URL("../workbench/releaseSurface.tsx", import.meta.url), "utf8");
const systemSurfaceSource = () => readFileSync(new URL("../workbench/systemSurface.tsx", import.meta.url), "utf8");
const projectsSurfaceSource = () => readFileSync(new URL("../workbench/projectsSurface.tsx", import.meta.url), "utf8");
const aiSurfaceSource = () => readFileSync(new URL("../workbench/aiSurface.tsx", import.meta.url), "utf8");
const qualitySurfaceSource = () => readFileSync(new URL("../workbench/qualitySurface.tsx", import.meta.url), "utf8");
const intelligenceSurfaceSource = () => readFileSync(new URL("../workbench/intelligenceSurface.tsx", import.meta.url), "utf8");
const remoteSurfaceSource = () => readFileSync(new URL("../workbench/remoteSurface.tsx", import.meta.url), "utf8");

function namedFunctionDeclarations(source: string): string[] {
  return Array.from(source.matchAll(/(?:^|\n)\s*function\s+([A-Z][A-Za-z0-9]+)\s*\(/g)).map((m) => m[1]);
}

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

  it("renders the shell with one canonical Workbench dispatcher, one Inspector, and one bottom panel", () => {
    const shell = workbenchSource();
    expect(shell).toContain('className="kw-activity-bar"');
    expect(shell).toContain('aria-label={`${current.label} Explorer`}');
    expect(shell).toContain('className="kw-workbench"');
    expect(shell).toContain('className="kw-bottom-panel"');
    expect(shell).toContain("<WorkbenchSurface ");
    expect(shell).toContain("<CanonicalInspector ");
  });

  it("routes Activity/View dispatch through the modular WorkbenchSurface", () => {
    const shell = workbenchSource();
    expect(shell).toMatch(/import\s*\{[^}]*WorkbenchSurface[^}]*\}\s*from\s*"\.\/surfaces"/);
    expect(shell).toMatch(/import\s*\{[^}]*CanonicalInspector[^}]*\}\s*from\s*"\.\/surfaces"/);
  });

  it("prevents the shell from redefining domain Surface implementations", () => {
    const shell = workbenchSource();
    const declarations = namedFunctionDeclarations(shell);
    for (const name of ["ProjectsSurface", "OnlineSurface", "AISurface", "QualitySurface", "DeveloperSurface", "RemoteSurface", "ReleaseSurface", "SystemSurface", "IntelligenceSurface", "SimpleFetchSurface"]) {
      expect(declarations, `shell should not declare ${name}`).not.toContain(name);
    }
  });

  it("prevents the shell from duplicating canonical UI primitives", () => {
    const shell = workbenchSource();
    for (const primitive of ["EvidenceRows", "EvidenceCards", "TaskTable", "EvidenceTable", "AdvancedEvidence"]) {
      expect(shell, `shell should not re-implement ${primitive}`).not.toMatch(new RegExp(`function\\s+${primitive}\\s*\\(`));
    }
  });

  it("prevents the shell from redeclaring the canonical contracts", () => {
    const shell = workbenchSource();
    expect(shell).not.toMatch(/^type\s+SurfaceProps\s*=/m);
    expect(shell).not.toMatch(/^type\s+ExecutionSnapshot\s*=/m);
    expect(shell).not.toMatch(/^type\s+InspectorContext\s*=/m);
    expect(shell).not.toMatch(/^type\s+MarketplaceData\s*=/m);
  });

  it("owns a single Inspector with no mounted Online inspector fallback", () => {
    const shell = workbenchSource();
    const surfaces = surfacesSource();
    expect(shell).not.toContain("kw-online-inspector");
    expect(surfaces).not.toContain("kw-online-inspector");
    const canonicalInspectorCount = (surfaces.match(/<aside className="kw-inspector"/g) || []).length;
    expect(canonicalInspectorCount).toBeGreaterThanOrEqual(1);
    expect(shell).not.toMatch(/<aside\s+className="kw-inspector"/);
  });

  it("uses surfaceContracts as the canonical owner of every shared workbench contract", () => {
    const contracts = contractsSource();
    for (const t of ["SurfaceProps", "ExecutionSnapshot", "RecordRow", "TaskRow", "MarketplaceItem", "MarketplaceData", "InspectorContext", "InspectorAction", "CanonicalInspectorProps"]) {
      expect(contracts, `surfaceContracts.ts must export ${t}`).toMatch(new RegExp(`export\\s+(type\\s+)?${t}\\b`));
    }
    const ui = uiSource();
    expect(ui).toMatch(/import\s+type\s*\{[^}]*RecordRow[^}]*\}\s+from\s+"\.\/surfaceContracts"/);
  });

  it("uses surfaceShared as the canonical owner of SimpleFetchSurface without forcing specialized workbenches through it", () => {
    const shared = sharedHelperSource();
    expect(shared).toMatch(/export\s+function\s+SimpleFetchSurface\b/);
    const developer = developerSurfaceSource();
    expect(developer).toMatch(/import\s*\{[^}]*SimpleFetchSurface[^}]*\}\s*from\s*"\.\/surfaceShared"/);
    const remote = remoteSurfaceSource();
    expect(remote).not.toMatch(/function\s+SimpleFetchSurface\b/);
    expect(remote).toMatch(/import\s+GitHubRemoteWorkbench\s+from\s+"\.\/GitHubRemoteWorkbench"/);
    expect(remote).toContain('"pull-requests", "issues", "actions", "releases"');
    const shell = workbenchSource();
    expect(shell).not.toMatch(/function\s+SimpleFetchSurface\b/);
  });

  it("routes Online selection through onInspectorContext and CanonicalInspector", () => {
    const online = onlineSurfaceSource();
    expect(online).toMatch(/onInspectorContext\?/);
    expect(online).toMatch(/onInspectorContext\?\.\(\{ kind: "online-item"/);
    const surfaces = surfacesSource();
    expect(surfaces).toMatch(/context\?\.kind\s*===\s*"online-item"/);
    expect(surfaces).toMatch(/className="kw-inspector"/);
  });

  it("preserves the Online global / projectless NOT_EVALUATED contract in the Online surface", () => {
    const online = onlineSurfaceSource();
    expect(online).toContain('"/api/workspace/online/control-center"');
    expect(online).toContain('"/api/workspace/marketplace"');
    expect(online).toContain('"NOT_EVALUATED"');
    expect(online).toContain("Opening this surface performs no remote catalog refresh.");
  });

  it("uses explicit authority/runtime/install evidence across Online surface and Canonical Inspector", () => {
    const online = onlineSurfaceSource();
    expect(online).toContain("item.authority?.kind");
    expect(online).toContain("item.availability");
    expect(online).toContain("permission.required");
    const surfaces = surfacesSource();
    expect(surfaces).toContain("item.authority?.kind");
    expect(surfaces).toContain("item.runtimeEvidence?.state");
    expect(surfaces).toContain("item.runtimeEvidence?.sources");
    expect(surfaces).toContain("p.required");
  });

  it("keeps Online Downloads distinct from broader Online Activity", () => {
    const online = onlineSurfaceSource();
    expect(online).toContain('view === "downloads"');
    expect(online).toContain("download|pull|install|update");
    expect(online).toContain("online|marketplace|download|install|update|provider");
    expect(ONLINE_EXPLORER_VIEWS).toContain("downloads");
    expect(ONLINE_EXPLORER_VIEWS).toContain("activity");
  });

  it("implements a safe KForge terminal in the Developer surface, not the shell", () => {
    const developer = developerSurfaceSource();
    expect(developer).toContain("KForge Command Terminal");
    expect(developer).toContain("Only registered KForge actions are executable. There is no unrestricted shell input.");
    expect(developer).toContain("/actions");
    expect(developer).toContain("descriptor.enabled");
  });

  it("keeps release artifacts structured with explicit verification columns in the Release surface", () => {
    const release = releaseSurfaceSource();
    expect(release).toContain("<th>Artifact</th>");
    expect(release).toContain("<th>SHA-256</th>");
    expect(release).toContain("<th>Signature</th>");
    expect(release).toContain("<th>Verification</th>");
    expect(release).toContain("Raw JSON is not treated as a verified artifact.");
  });

  it("uses Settings v3 hierarchical startup navigation in the System surface", () => {
    const system = systemSurfaceSource();
    expect(system).toContain("startupActivity");
    expect(system).toContain("startupOnlineView");
    expect(system).toContain("version: 3");
    expect(system).toContain("secretRedaction = true");
  });

  it("navigation and the surface audit matrix are exactly aligned", () => {
    const navigation = navigationSource();
    const audit = surfaceTypesSource();
    const activityRe = /\{\s*id:\s*"(projects|ai|online|intelligence|quality|developer-tools|remote|release|system)"[\s\S]*?views:\s*\[([\s\S]*?)\]\s*\}/g;
    const navViewIds = new Set<string>();
    const navActivityIds = new Set<string>();
    for (const m of navigation.matchAll(activityRe)) {
      navActivityIds.add(m[1]);
      for (const v of m[2].matchAll(/\{\s*id:\s*"([^"]+)"/g)) navViewIds.add(v[1]);
    }
    expect(navActivityIds.size).toBe(9);
    expect(navViewIds.size).toBeGreaterThan(0);
    expect(audit).toContain("export const SURFACE_AUDIT_MATRIX");
    const auditViewIds = new Set<string>();
    for (const m of audit.matchAll(/(?<![\w-])([a-z][a-z0-9-]*|"[a-z][a-z0-9-]*"):\s*"(SPECIALIZED|INTENTIONALLY_SHARED|UNAVAILABLE_WITH_REASON)"/g)) {
      const id = m[1].replace(/^"|"$/g, "");
      auditViewIds.add(id);
    }
    for (const id of navViewIds) expect(auditViewIds, `navigation view "${id}" missing from audit matrix`).toContain(id);
    for (const id of auditViewIds) expect(navViewIds, `audit view "${id}" not present in navigation`).toContain(id);
  });

  it("routes production /workspace to the contextual workbench rather than the legacy flat mega-component", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    expect(app).toContain('import KForgeWorkbench from "./pages/KForgeWorkbench"');
    expect(app).toContain('<Route path="/workspace" element={<KForgeWorkbench />} />');
    expect(app).not.toContain('import KForgeWorkspace from "./pages/KForgeWorkspace"');
  });

  it("uses one inherited KNOuX theme for shell and Online surfaces", () => {
    const css = readFileSync(new URL("../workbench/workbench.css", import.meta.url), "utf8");
    const inheritedCss = readFileSync(new URL("./KForgeWorkbench.css", import.meta.url), "utf8");
    expect(css).toContain('@import "../pages/KForgeWorkbench.css"');
    expect(inheritedCss).toContain("hsl(var(--background))");
    expect(inheritedCss).toContain("hsl(var(--card))");
    expect(inheritedCss).toContain("hsl(var(--foreground))");
    expect(inheritedCss).not.toContain("--kf-online-bg");
    expect(inheritedCss).toContain("@media (prefers-reduced-motion: reduce)");
  });
});

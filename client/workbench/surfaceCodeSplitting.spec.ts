import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () => readFileSync(new URL("./surfaces.tsx", import.meta.url), "utf8");

const activityModules = [
  "projectsSurface",
  "onlineSurface",
  "aiSurface",
  "intelligenceSurface",
  "qualitySurface",
  "developerSurface",
  "remoteSurface",
  "releaseSurface",
  "systemSurface",
] as const;

describe("Workbench surface code splitting", () => {
  it("keeps every high-level Activity surface behind a lazy import boundary", () => {
    const text = source();
    for (const moduleName of activityModules) {
      expect(text, `${moduleName} must be dynamically imported`).toContain(`import("./${moduleName}")`);
      expect(text, `${moduleName} must not return to an eager default import`).not.toMatch(new RegExp(`import\\s+\\w+\\s+from\\s+["']\\./${moduleName}["']`));
    }
    expect(text).toContain("<Suspense fallback={<SurfaceLoading");
  });

  it("also defers specialized project, developer and system workbenches", () => {
    const text = source();
    for (const moduleName of [
      "ProjectHealthWorkbench",
      "ProjectCollectionsWorkbench",
      "DeveloperExecutionLedger",
      "DeveloperObservabilityWorkbench",
      "DeveloperTestsWorkbench",
      "DeveloperBuildWorkbench",
      "DeveloperRuntimeWorkbench",
      "DeveloperLintWorkbench",
      "PreviewStudioWorkbench",
      "SystemTrustCenter",
      "SystemPermissionsCenter",
      "SystemControlCenter",
    ]) {
      expect(text, `${moduleName} must stay deferred`).toContain(`import("./${moduleName}")`);
    }
  });
});

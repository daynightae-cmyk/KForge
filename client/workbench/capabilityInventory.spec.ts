import { describe, expect, it } from "vitest";
import { ACTIVITIES } from "./navigation";
import { WORKBENCH_SERVICES } from "./serviceDirectory";
import {
  CAPABILITY_ENTRIES,
  filterCapabilities,
  summarizeCapabilities,
} from "./capabilityInventory";

describe("KForge capability inventory", () => {
  it("projects every canonical workbench destination exactly once", () => {
    expect(CAPABILITY_ENTRIES.map((entry) => entry.target)).toEqual(
      WORKBENCH_SERVICES.map((service) => service.target),
    );
    expect(new Set(CAPABILITY_ENTRIES.map((entry) => entry.target)).size).toBe(CAPABILITY_ENTRIES.length);
  });

  it("keeps the contract fields inspectable for every destination", () => {
    for (const entry of CAPABILITY_ENTRIES) {
      expect(entry.description.length, entry.target).toBeGreaterThan(20);
      expect(entry.capability.length, entry.target).toBeGreaterThan(10);
      expect(entry.primaryAction.length, entry.target).toBeGreaterThan(2);
      expect(entry.handler.length, entry.target).toBeGreaterThan(2);
      expect(entry.api, entry.target).toMatch(/^(GET|POST|PUT|PATCH|DELETE) \//);
      expect(entry.domainPurpose.length, entry.target).toBeGreaterThan(30);
      expect(entry.group, entry.target).toBeTruthy();
      expect(entry.icon, entry.target).toBeTruthy();
    }
  });

  it("summarises domains and context without claiming runtime readiness", () => {
    const summary = summarizeCapabilities(CAPABILITY_ENTRIES);
    expect(summary.destinations).toBe(WORKBENCH_SERVICES.length);
    expect(summary.domains).toBe(ACTIVITIES.length);
    expect(summary.projectScoped + summary.global + summary.optional).toBe(summary.destinations);
    expect(summary.projectScoped).toBeGreaterThan(0);
    expect(summary.projectScopedDomains).toBeLessThanOrEqual(summary.domains);
  });

  it("filters by domain, context and intent", () => {
    const quality = filterCapabilities(CAPABILITY_ENTRIES, { activity: "quality" });
    expect(quality.length).toBeGreaterThan(0);
    expect(quality.every((entry) => entry.activity === "quality")).toBe(true);

    const projectScoped = filterCapabilities(CAPABILITY_ENTRIES, { context: "project" });
    expect(projectScoped.length).toBeGreaterThan(0);
    expect(projectScoped.every((entry) => entry.context === "project")).toBe(true);

    const restored = filterCapabilities(CAPABILITY_ENTRIES, { query: "snapshot restore" });
    expect(restored.map((entry) => entry.target)).toContain("quality:snapshots");

    expect(filterCapabilities(CAPABILITY_ENTRIES, { query: "zzzz-no-such-capability" })).toEqual([]);
    expect(filterCapabilities(CAPABILITY_ENTRIES, { query: "   " })).toHaveLength(CAPABILITY_ENTRIES.length);
  });

  it("searches the visible label, API contract and handler, not only keywords", () => {
    expect(filterCapabilities(CAPABILITY_ENTRIES, { query: "api/workspace/projects/:id/preview" }).map((entry) => entry.target))
      .toContain("developer-tools:preview");
    expect(filterCapabilities(CAPABILITY_ENTRIES, { query: "ReleaseDistributionWorkbench" }).map((entry) => entry.target))
      .toContain("release:release-preparation");
    expect(filterCapabilities(CAPABILITY_ENTRIES, { query: "Brand & Identity" }).map((entry) => entry.target))
      .toContain("system:brand");
  });
});

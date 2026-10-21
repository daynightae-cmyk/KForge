import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ProjectSummary, WorkspaceActionDescriptor } from "@shared/workspace";
import { ACTIVITIES } from "./navigation";
import {
  ACTIVITY_PURPOSE,
  PROJECT_SERVICE_GROUPS,
  WORKBENCH_SERVICES,
  browseWorkbenchDomains,
  resolveWorkbenchTarget,
  searchWorkbenchServices,
  serviceByTarget,
  serviceDefinition,
} from "./serviceDirectory";
import { resolveServiceState, type AvailabilityEvidence } from "./serviceAvailability";

const trustedProject: ProjectSummary = {
  id: "p1",
  name: "Demo",
  trust: "trusted",
  path: "C:\\demo",
  provider: "Git",
  branch: "main",
  lastActivity: "2026-10-21T00:00:00.000Z",
  projectType: "node",
  modifiedFiles: 0,
  untrackedFiles: 0,
  ahead: 0,
  behind: 0,
  healthScore: 82,
  securityStatus: "pass",
  buildStatus: "pass",
  testStatus: "pass",
  syncStatus: "pass",
  tags: [],
  favorite: false,
  pinned: false,
  archived: false,
  categories: { recent: true, favorite: false, pinned: false, archive: false },
};

const action = (overrides: Partial<WorkspaceActionDescriptor> = {}): WorkspaceActionDescriptor => ({
  id: "test",
  label: "Test",
  enabled: true,
  state: "AVAILABLE",
  requiresConfirmation: false,
  requiresTrust: false,
  requiresNetwork: false,
  requiredPermission: "process-execution",
  source: "registry",
  ...overrides,
});

const evidence = (overrides: Partial<AvailabilityEvidence> = {}): AvailabilityEvidence => ({
  platformMode: "local-first",
  project: trustedProject,
  actions: [action()],
  providers: [{ id: "openai", configured: true, connected: false }],
  agentToolCount: 3,
  agentBlockedCount: 0,
  ...overrides,
});

describe("KForge canonical service directory", () => {
  it("describes every navigable destination exactly once", () => {
    const navigationViews = ACTIVITIES.flatMap((activity) => activity.views.map((view) => `${activity.id}:${view.id}`));
    expect(WORKBENCH_SERVICES.map((service) => service.target).sort()).toEqual(navigationViews.sort());
    expect(new Set(WORKBENCH_SERVICES.map((service) => service.target)).size).toBe(WORKBENCH_SERVICES.length);
  });

  it("gives every service a complete, non-empty product contract", () => {
    for (const service of WORKBENCH_SERVICES) {
      expect(service.description.length, `${service.target} description`).toBeGreaterThan(20);
      expect(service.capability.length, `${service.target} capability`).toBeGreaterThan(10);
      expect(service.primaryAction.length, `${service.target} primary action`).toBeGreaterThan(2);
      expect(service.handler.length, `${service.target} handler`).toBeGreaterThan(2);
      expect(service.api, `${service.target} api`).toMatch(/^(GET|POST|PUT|PATCH|DELETE) /);
      expect(["global", "project", "optional"]).toContain(service.context);
      expect(service.group, `${service.target} section`).toBeTruthy();
    }
  });

  it("keeps one purpose per domain and one home per service", () => {
    expect(Object.keys(ACTIVITY_PURPOSE).sort()).toEqual(ACTIVITIES.map((activity) => activity.id).sort());
    for (const activity of ACTIVITIES) {
      expect(ACTIVITY_PURPOSE[activity.id].length).toBeGreaterThan(30);
    }
    expect(serviceDefinition("projects", "workspace")?.target).toBe("projects:workspace");
    expect(serviceDefinition("projects", "does-not-exist")).toBeUndefined();
  });

  it("resolves established contextual targets to their owning service", () => {
    expect(resolveWorkbenchTarget("Project commands")?.target).toBe("developer-tools:terminal");
    expect(resolveWorkbenchTarget("Workspace")?.target).toBe("projects:workspace");
    expect(resolveWorkbenchTarget("Online Documentation")?.target).toBe("online:documentation");
    expect(resolveWorkbenchTarget("quality:solutions")?.target).toBe("quality:solutions");
    expect(resolveWorkbenchTarget("Not a KForge service")).toBeUndefined();
    expect(resolveWorkbenchTarget("")).toBeUndefined();
  });

  it("finds services by label, intent and domain without flooding the palette", () => {
    expect(searchWorkbenchServices("")).toEqual([]);
    expect(searchWorkbenchServices("preview").map((service) => service.target)).toContain("developer-tools:preview");
    expect(searchWorkbenchServices("release gate").map((service) => service.target)).toContain("release:release-gate");
    expect(searchWorkbenchServices("npm registry").map((service) => service.target)).toContain("online:remote-sources");
    expect(searchWorkbenchServices("zzzz-not-a-service")).toEqual([]);
  });

  it("browses the nine product domains with a purpose and a first destination", () => {
    const domains = browseWorkbenchDomains();
    expect(domains).toHaveLength(9);
    for (const domain of domains) {
      expect(domain.purpose.length).toBeGreaterThan(30);
      expect(domain.serviceCount).toBeGreaterThan(0);
      expect(serviceByTarget(`${domain.id}:${domain.firstView}`)).toBeDefined();
    }
  });

  it("keeps the project shortcut set pointing at services that already own a home", () => {
    for (const group of PROJECT_SERVICE_GROUPS) {
      for (const target of group.targets) {
        expect(serviceByTarget(target), `${target} must exist in the canonical directory`).toBeDefined();
      }
    }
  });
});

const ROUTE_MOUNTS: Record<string, string> = {
  "marketplaceLifecycle.ts": "/api/workspace/marketplace",
  "productTruth.ts": "/api/workspace",
  "operationEvidence.ts": "/api/workspace",
  "providerCommandRouter.ts": "/api/workspace",
  "remoteSources.ts": "/api/workspace",
  "workspace.ts": "/api/workspace",
};

function registeredRoutes(): Set<string> {
  const routes = new Set<string>();
  const routesDirectory = path.resolve(process.cwd(), "server", "routes");
  for (const file of readdirSync(routesDirectory).filter((name) => name.endsWith(".ts") && !name.endsWith(".spec.ts"))) {
    const mount = ROUTE_MOUNTS[file];
    if (!mount) continue;
    const source = readFileSync(path.join(routesDirectory, file), "utf8");
    for (const match of source.matchAll(/router\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) {
      routes.add(`${match[1].toUpperCase()} ${mount}${match[2]}`);
    }
  }
  const server = readFileSync(path.resolve(process.cwd(), "server", "index.ts"), "utf8");
  for (const match of server.matchAll(/app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) {
    routes.add(`${match[1].toUpperCase()} ${match[2]}`);
  }
  return routes;
}

describe("KForge service directory API truth", () => {
  it("only declares API contracts the server actually registers", () => {
    const routes = registeredRoutes();
    expect(routes.size).toBeGreaterThan(50);
    for (const service of WORKBENCH_SERVICES) {
      expect(routes, `${service.target} declares ${service.api}`).toContain(service.api);
    }
  });
});

describe("KForge service availability truth", () => {
  const service = (target: string) => {
    const found = serviceByTarget(target);
    if (!found) throw new Error(`missing service ${target}`);
    return found;
  };

  it("requires a project for project-scoped services", () => {
    const state = resolveServiceState(service("developer-tools:tests"), evidence({ project: undefined }));
    expect(state.state).toBe("REQUIRES_PROJECT");
    expect(state.prerequisite).toBeTruthy();
  });

  it("reports offline mode for services that need a remote contact", () => {
    const state = resolveServiceState(service("online:remote-sources"), evidence({ platformMode: "offline" }));
    expect(state.state).toBe("OFFLINE");
  });

  it("requires trust before a project may execute", () => {
    const state = resolveServiceState(service("developer-tools:tests"), evidence({ project: { ...trustedProject, trust: "untrusted" } }));
    expect(state.state).toBe("REQUIRES_PERMISSION");
  });

  it("requires a configured provider before an agent mission can start", () => {
    const state = resolveServiceState(service("ai:agents"), evidence({ providers: [] }));
    expect(state.state).toBe("NEEDS_SETUP");
  });

  it("keeps an unavailable registered command unavailable", () => {
    const state = resolveServiceState(service("developer-tools:build"), evidence({
      actions: [action({ id: "build", enabled: false, state: "UNAVAILABLE", unavailableReason: "No build script is declared." })],
    }));
    expect(state.state).toBe("UNAVAILABLE");
    expect(state.detail).toContain("No build script is declared.");
  });

  it("reports a running Preview from the real Preview evidence", () => {
    const state = resolveServiceState(service("developer-tools:preview"), evidence({ previewState: "RUNNING" }));
    expect(state.state).toBe("RUNNING");
  });

  it("never claims an agent mission is ready when every tool is blocked", () => {
    const state = resolveServiceState(service("ai:agents"), evidence({ agentToolCount: 4, agentBlockedCount: 4 }));
    expect(state.state).toBe("REQUIRES_PERMISSION");
  });
});

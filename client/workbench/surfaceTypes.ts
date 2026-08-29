import type { KForgeActivity } from "@shared/workspace";

export type ProductSurfaceClass = "SPECIALIZED" | "INTENTIONALLY_SHARED" | "UNAVAILABLE_WITH_REASON";
export const CANONICAL_INSPECTOR_OWNER = "WORKBENCH" as const;
export const ONLINE_INSPECTOR_POLICY = "SINGLE_CANONICAL_INSPECTOR" as const;

export const SURFACE_AUDIT_MATRIX: Record<KForgeActivity, Record<string, ProductSurfaceClass>> = {
  projects: { workspace: "SPECIALIZED", health: "INTENTIONALLY_SHARED", recent: "INTENTIONALLY_SHARED", favorites: "INTENTIONALLY_SHARED", pinned: "INTENTIONALLY_SHARED", archive: "INTENTIONALLY_SHARED", "open-project": "SPECIALIZED", "import-project": "SPECIALIZED" },
  ai: { providers: "SPECIALIZED", models: "SPECIALIZED", agents: "SPECIALIZED", tasks: "SPECIALIZED" },
  online: { discover: "SPECIALIZED", marketplace: "SPECIALIZED", extensions: "SPECIALIZED", models: "SPECIALIZED", agents: "SPECIALIZED", tools: "SPECIALIZED", integrations: "SPECIALIZED", providers: "SPECIALIZED", installed: "SPECIALIZED", updates: "SPECIALIZED", downloads: "SPECIALIZED", "remote-sources": "SPECIALIZED", security: "SPECIALIZED", activity: "SPECIALIZED" },
  intelligence: { "project-graph": "SPECIALIZED", dependencies: "SPECIALIZED", "impact-analysis": "SPECIALIZED", "code-understanding": "SPECIALIZED", "ask-kforge": "SPECIALIZED", architecture: "SPECIALIZED" },
  quality: { sonar: "SPECIALIZED", problems: "SPECIALIZED", solutions: "SPECIALIZED", security: "SPECIALIZED", performance: "SPECIALIZED", "technical-debt": "SPECIALIZED", documentation: "SPECIALIZED", snapshots: "SPECIALIZED" },
  release: { "release-gate": "SPECIALIZED", "release-preparation": "SPECIALIZED", artifacts: "SPECIALIZED", versioning: "SPECIALIZED" },
  "developer-tools": { terminal: "SPECIALIZED", tests: "SPECIALIZED", build: "SPECIALIZED", runtime: "INTENTIONALLY_SHARED", lint: "INTENTIONALLY_SHARED", logs: "SPECIALIZED", diagnostics: "SPECIALIZED", preview: "INTENTIONALLY_SHARED" },
  remote: { git: "SPECIALIZED", branches: "SPECIALIZED", commits: "SPECIALIZED", github: "SPECIALIZED", "pull-requests": "SPECIALIZED", issues: "SPECIALIZED", actions: "SPECIALIZED", releases: "SPECIALIZED" },
  system: { settings: "SPECIALIZED", trust: "INTENTIONALLY_SHARED", permissions: "SPECIALIZED", storage: "SPECIALIZED", "online-offline": "INTENTIONALLY_SHARED", "self-audit": "INTENTIONALLY_SHARED", "system-diagnostics": "INTENTIONALLY_SHARED" },
} as const;
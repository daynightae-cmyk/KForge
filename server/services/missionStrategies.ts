import type { KForgeMission, MissionStep, MissionType } from "./tasks";

export interface MissionStrategyStep {
  id: string;
  name: string;
  kind: string;
  tool: string;
  dependencies: string[];
  requiresConfirmation?: boolean;
}

export interface MissionStrategyDefinition {
  type: MissionType;
  label: string;
  description: string;
  steps: MissionStrategyStep[];
}

const linear = (entries: Array<[string, string, string]>) => entries.map(([id, name, tool], index) => ({ id, name, kind: id, tool, dependencies: index ? [entries[index - 1][0]] : [] }));

export const missionStrategies: Record<MissionType, MissionStrategyDefinition> = {
  audit: {
    type: "audit", label: "Audit project", description: "Collects local engineering evidence without changing project files.",
    steps: [
      { id: "scan", name: "Scan project", kind: "discovery", tool: "scan", dependencies: [] },
      { id: "graph", name: "Build dependency graph", kind: "analysis", tool: "graph", dependencies: ["scan"] },
      { id: "sonar", name: "Run KForge Sonar", kind: "analysis", tool: "sonar", dependencies: ["scan"] },
      { id: "health", name: "Calculate project health", kind: "health", tool: "health", dependencies: ["scan", "sonar"] },
      { id: "dependency-audit", name: "Audit dependencies", kind: "security", tool: "dependency_audit", dependencies: ["scan"] },
      { id: "documentation", name: "Check documentation", kind: "documentation", tool: "documentation_audit", dependencies: ["scan"] },
      { id: "git", name: "Inspect Git state", kind: "git", tool: "git_status", dependencies: ["scan"] },
      { id: "summary", name: "Summarize evidence", kind: "summary", tool: "summary", dependencies: ["graph", "sonar", "health", "dependency-audit", "documentation", "git"] },
    ],
  },
  "fix-critical": { type: "fix-critical", label: "Fix critical issue", description: "Stops at manual review unless a safe verified patch exists.", steps: linear([["scan", "Scan project", "scan"], ["prioritize", "Sort critical and high findings", "prioritize_findings"], ["context", "Build bounded context", "build_context"], ["analyze", "Analyze target", "analyze"], ["eligibility", "Determine patch eligibility", "patch_eligibility"], ["snapshot", "Create snapshot", "snapshot"], ["preview", "Preview patch", "patch_preview"], ["confirm", "Confirm write operation", "confirmation"], ["apply", "Apply verified patch", "patch_apply"], ["typecheck", "Verify typecheck", "typecheck"], ["test", "Verify tests", "test"], ["build", "Verify build", "build"], ["runtime", "Verify runtime", "runtime"], ["verify", "Complete verification", "summary"]]).map((step) => step.id === "confirm" || step.id === "apply" ? { ...step, requiresConfirmation: true } : step) },
  "improve-security": { type: "improve-security", label: "Improve security", description: "Collects security evidence and limits changes to verified safe fixes.", steps: linear([["scan", "Scan project", "scan"], ["secrets", "Detect secrets", "secret_detection"], ["dependencies", "Audit dependencies", "dependency_audit"], ["tools", "Check security tools", "security_tools"], ["permissions", "Review permissions", "permission_review"], ["findings", "Summarize findings", "summary"], ["safe-fixes", "Determine safe fixes", "patch_eligibility"], ["verify", "Verify evidence", "summary"]]) },
  "improve-tests": { type: "improve-tests", label: "Improve tests", description: "Uses test inventory and real test evidence without fabricating coverage improvements.", steps: linear([["framework", "Discover test framework", "test_framework"], ["inventory", "Build test inventory", "test_inventory"], ["test", "Run tests", "test"], ["weak-areas", "Detect weak areas", "test_analysis"], ["impact", "Analyze impact", "impact_analysis"], ["safe-tests", "Determine safe test additions", "patch_eligibility"], ["targeted", "Run targeted tests", "test"], ["full-tests", "Run full tests", "test"], ["build", "Run production build", "build"]]) },
  refactor: { type: "refactor", label: "Prepare refactor", description: "Builds a bounded refactor plan and only applies explicitly approved safe work.", steps: linear([["graph", "Build dependency graph", "graph"], ["architecture", "Inspect architecture", "architecture"], ["impact", "Analyze impact", "impact_analysis"], ["candidates", "Select candidate files", "candidate_files"], ["plan", "Create refactor plan", "plan"], ["preview", "Preview safe refactor", "patch_preview"], ["snapshot", "Create snapshot", "snapshot"], ["apply", "Apply approved safe refactor", "patch_apply"], ["test", "Run tests", "test"], ["build", "Run build", "build"], ["runtime", "Verify runtime", "runtime"], ["verify", "Verify outcome", "summary"]]).map((step) => step.id === "apply" ? { ...step, requiresConfirmation: true } : step) },
  "prepare-release": { type: "prepare-release", label: "Prepare release", description: "Evaluates only real local release evidence and blocks dependent steps after a prerequisite fails.", steps: linear([["health", "Calculate health", "health"], ["security", "Review security", "sonar"], ["typecheck", "Run typecheck", "typecheck"], ["test", "Run tests", "test"], ["build", "Run build", "build"], ["runtime", "Verify runtime", "runtime"], ["git", "Inspect Git status", "git_status"], ["changes", "Summarize changes", "git_diff"], ["version", "Inspect version", "version"], ["artifacts", "Inspect artifacts", "artifacts"], ["release-gate", "Evaluate release gate", "release_gate"]]) },
  "prepare-github": { type: "prepare-github", label: "Prepare GitHub", description: "Creates local evidence and previews only; it never performs remote destructive actions.", steps: linear([["git", "Inspect Git status", "git_status"], ["diff", "Inspect diff", "git_diff"], ["branch", "Inspect branch", "git_status"], ["commit-preview", "Create commit preview", "commit_preview"], ["test-evidence", "Inspect test evidence", "test_evidence"], ["build-evidence", "Inspect build evidence", "build_evidence"], ["release-evidence", "Inspect release evidence", "release_evidence"], ["github-checks", "Inspect GitHub checks", "github_checks"], ["preview", "Create PR or release preview", "github_preview"]]) },
  documentation: { type: "documentation", label: "Documentation audit", description: "Compares documented setup and claims with local evidence, then limits changes to unique safe replacements.", steps: linear([["readme", "Read README", "documentation_audit"], ["setup", "Check setup instructions", "documentation_audit"], ["scripts", "Check scripts", "documentation_audit"], ["paths", "Check paths", "documentation_audit"], ["environment", "Check environment docs", "documentation_audit"], ["claims", "Check version and feature claims", "documentation_audit"], ["compare", "Compare with code", "documentation_audit"], ["safe-fix", "Determine safe unique fix", "patch_eligibility"]]) },
  performance: { type: "performance", label: "Performance audit", description: "Records actual local strategy and measurements when available; it does not invent benchmarks.", steps: linear([["size", "Measure project size", "scan"], ["cache", "Inspect cache status", "cache_status"], ["discovery", "Measure discovery", "discovery_timing"], ["graph", "Measure graph", "graph"], ["search", "Measure search", "search_timing"], ["sonar", "Measure Sonar", "sonar"], ["memory", "Inspect memory budget", "memory_status"], ["summary", "Summarize measurements", "summary"]]) },
};

export const supportedMissionTypes = Object.keys(missionStrategies) as MissionType[];

export function createMissionFromStrategy(projectId: string, id: string, type: MissionType, goal?: string): KForgeMission {
  const strategy = missionStrategies[type];
  const createdAt = new Date().toISOString();
  const steps: MissionStep[] = strategy.steps.map((step, index) => ({ id: step.id, missionId: id, index, name: step.name, kind: step.kind, tool: step.tool, status: "queued", dependencies: step.dependencies, logs: [], evidence: [], requiresConfirmation: Boolean(step.requiresConfirmation), attempts: 0, retryCount: 0 }));
  return { id, projectId, type, name: strategy.label, goal: goal || strategy.description, state: "planning", status: "planning", createdAt, progress: 0, steps, evidence: [], changedFiles: [], warnings: [], recovery: { resume: true, rollback: false, inspect: true, detail: "Read-only steps may be safely replayed after inspection. Write steps require a valid snapshot and explicit confirmation.", recoveryRequired: false } };
}

export function getMissionStrategy(type: MissionType) { return missionStrategies[type]; }

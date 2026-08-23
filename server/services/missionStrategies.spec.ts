import { describe, expect, it } from "vitest";
import { createMissionFromStrategy, missionStrategies, supportedMissionTypes } from "./missionStrategies";

describe("KForge Mission Strategies V3", () => {
  it("exposes every supported mission type through a named strategy", () => {
    expect(supportedMissionTypes).toEqual(expect.arrayContaining(["audit", "fix-critical", "improve-security", "improve-tests", "refactor", "prepare-release", "prepare-github", "documentation", "performance"]));
    for (const type of supportedMissionTypes) expect(missionStrategies[type].steps.length).toBeGreaterThan(1);
  });

  it("creates the full audit DAG with independent evidence branches and a final summary", () => {
    const mission = createMissionFromStrategy("project", "mission", "audit");
    expect(mission.state).toBe("planning");
    expect(mission.steps.map((step) => step.id)).toEqual(["scan", "graph", "sonar", "health", "dependency-audit", "documentation", "git", "summary"]);
    expect(mission.steps.find((step) => step.id === "graph")?.dependencies).toEqual(["scan"]);
    expect(mission.steps.find((step) => step.id === "sonar")?.dependencies).toEqual(["scan"]);
    expect(mission.steps.find((step) => step.id === "summary")?.dependencies).toEqual(["graph", "sonar", "health", "dependency-audit", "documentation", "git"]);
    expect(mission.steps.every((step, index) => step.missionId === "mission" && step.index === index)).toBe(true);
  });
});

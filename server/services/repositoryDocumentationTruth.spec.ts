import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootFile = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
const capabilityMatrix = () => readFileSync(new URL("../../docs/KFORGE-CAPABILITY-MATRIX.md", import.meta.url), "utf8");

describe("repository documentation truth contract", () => {
  it("keeps documented verification commands aligned with package scripts", () => {
    const manifest = JSON.parse(rootFile("package.json")) as { scripts?: Record<string, string> };
    const scripts = manifest.scripts || {};
    const runGuide = rootFile("RUN.md");

    expect(scripts.lint).toBeTruthy();
    expect(scripts["test:e2e"]).toBeTruthy();
    expect(scripts["verify:gate"]).toBeTruthy();
    expect(runGuide).toContain("npm run lint");
    expect(runGuide).toContain("npm run test:e2e");
    expect(runGuide).toContain("npm run verify:gate");
    expect(runGuide).not.toContain("There is no repository `lint` script");
  });

  it("keeps browser acceptance and verification baselines evidence-scoped instead of regressing to stale unavailability claims", () => {
    const status = rootFile("PROJECT_STATUS.md");
    const readme = rootFile("README.md");
    const matrix = capabilityMatrix();
    const combined = `${status}\n${readme}\n${matrix}`;

    expect(status).toContain("Authoritative reference baseline captured");
    expect(status).toMatch(/Run #\d+/);
    expect(status).toMatch(/SHA `[0-9a-f]{40}`/);
    expect(status).toContain("This file is a dated evidence snapshot");
    expect(readme).toContain("Reference verification baseline");
    expect(readme).toContain("Playwright browser acceptance");
    expect(matrix).toContain("Axe browser analysis");

    for (const staleClaim of [
      "live visual/browser automation is unavailable",
      "The current environment has no browser automation bridge",
      "Live visual and keyboard acceptance requires an available browser automation bridge or external deployment",
    ]) {
      expect(combined).not.toContain(staleClaim);
    }
  });

  it("does not regress the dependency baseline to vulnerabilities already cleared by the authoritative gate", () => {
    const status = rootFile("PROJECT_STATUS.md");
    const matrix = capabilityMatrix();
    const dependencyAudit = rootFile("docs/verification/DEPENDENCY_AND_TOOLCHAIN_AUDIT.md");
    const combined = `${status}\n${matrix}`;

    expect(status).toMatch(/npm audit.*0 vulnerabilities/i);
    expect(matrix).toMatch(/npm audit.*0 vulnerabilities/i);
    expect(dependencyAudit).toContain("Run #254");
    expect(dependencyAudit).toContain("0 vulnerabilities");
    expect(combined).not.toContain("dependency audit still reports 2 moderate-severity vulnerabilities");
    expect(combined).not.toContain("these are not marked fixed");
  });
});

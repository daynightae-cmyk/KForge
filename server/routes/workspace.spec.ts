import { describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { createSnapshot, restoreSnapshot } from "../services/snapshots";
import { executeProjectAction, makeProjectSummary, scanProject } from "./workspace";

const fixturesRoot = path.resolve(process.cwd(), "fixtures");
const fixture = (name: string) => path.join(fixturesRoot, name);

describe("KForge Workspace engines", () => {
  it("detects a React and Vite project with source and script evidence", async () => {
    const project = await makeProjectSummary(fixture("workspace-clean"));
    const scan = await scanProject(project);
    expect(scan.profile.framework).toEqual(expect.arrayContaining(["React", "Vite", "Node.js"]));
    expect(scan.profile.languages).toEqual(expect.arrayContaining(["TypeScript", "JavaScript"]));
    expect(scan.profile.scripts).toHaveProperty("build");
    expect(scan.profile.sourceFileCount).toBeGreaterThan(0);
  });

  it("normalizes a TypeScript compiler failure into a typecheck diagnostic", async () => {
    const project = await makeProjectSummary(fixture("workspace-broken-typescript"));
    const scan = await scanProject(project);
    expect(scan.summaries.typecheck).toBe("fail");
    expect(scan.issues.some((entry) => entry.category === "typecheck" && entry.source === "TypeScript")).toBe(true);
  }, 20_000);

  it("detects TODO-based project completeness findings", async () => {
    const project = await makeProjectSummary(fixture("workspace-mock"));
    const scan = await scanProject(project);
    expect(scan.issues.some((entry) => entry.category === "completeness" && entry.file === "src/index.ts")).toBe(true);
  });

  it("reports an actual failing test command", async () => {
    const project = await makeProjectSummary(fixture("workspace-failing-test"));
    const result = await executeProjectAction(project, "test");
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("fixture test failed intentionally");
  });

  it("creates and restores a file snapshot", async () => {
    const projectPath = fixture("workspace-clean");
    const file = path.join(projectPath, "src", "snapshot-target.txt");
    await fs.writeFile(file, "before", "utf8");
    const snapshot = await createSnapshot(projectPath, ["src/snapshot-target.txt"], "Workspace snapshot test");
    await fs.writeFile(file, "after", "utf8");
    await restoreSnapshot(projectPath, snapshot.id);
    await expect(fs.readFile(file, "utf8")).resolves.toBe("before");
    await fs.rm(file, { force: true });
  });
});

import { describe, expect, it } from "vitest";
import type { AgentContext } from "./agent";
import { buildRedactedCloudPlanInput } from "./agent";

function context(files: AgentContext["files"]): AgentContext {
  return {
    project: { name: "Fixture", root: "D:/Fixture", branch: "main", projectType: "TypeScript" },
    technology: ["TypeScript"],
    commands: {},
    git: { branch: "main", modifiedFiles: 0, untrackedFiles: 0, ahead: 0, behind: 0, status: "## main" },
    diagnostics: [],
    files,
    totalCharacters: files.reduce((total, file) => total + file.content.length, 0),
  };
}

describe("cloud plan disclosure input", () => {
  it("redacts mission secrets and reports exact data classes without source code", () => {
    const outbound = buildRedactedCloudPlanInput(context([{ path: "package.json", reason: "configuration", content: "{}", redacted: false }]), "api_key=super-secret plan this project");
    expect(outbound.prompt).not.toContain("super-secret");
    expect(outbound.prompt).toContain("[REDACTED]");
    expect(outbound.redactionApplied).toBe(true);
    expect(outbound.sourceCodeIncluded).toBe(false);
    expect(outbound.dataClasses).toEqual(["METADATA", "PROJECT_CONTEXT"]);
  });

  it("marks source code when a source file is included in the bounded redacted context", () => {
    const outbound = buildRedactedCloudPlanInput(context([{ path: "src/index.ts", reason: "active-problem", content: "export const value = 1;", redacted: false }]), "review the diagnostic");
    expect(outbound.sourceCodeIncluded).toBe(true);
    expect(outbound.dataClasses).toEqual(["METADATA", "PROJECT_CONTEXT", "SOURCE_CODE"]);
  });
});

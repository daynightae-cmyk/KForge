import { promises as fs } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { previewDocumentationFix } from "./documentationAudit";

describe("KForge documentation safe fixes", () => {
  it("refuses a preview when the exact documented claim occurs more than once", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-docs-"));
    try {
      await fs.writeFile(path.join(root, "README.md"), "Run npm run obsolete\nThen run npm run obsolete\n", "utf8");
      const preview = await previewDocumentationFix(root, {
        auditedAt: new Date().toISOString(),
        documents: ["README.md"],
        findings: [{
          id: "documentation:duplicate",
          sourceDocument: "README.md",
          claim: "npm run obsolete",
          evidence: "The README contains the obsolete command.",
          actualState: "The script is unavailable.",
          severity: "high",
          suggestedFix: "Use npm run test.",
          fix: { before: "npm run obsolete", after: "npm run test" },
        }],
      }, "documentation:duplicate");
      expect(preview.patch).toBeUndefined();
      expect(preview.reason).toContain("not unique");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

import { promises as fs } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import type { ProjectProfile } from "../../shared/workspace";
import { auditDocumentation, previewDocumentationFix } from "./documentationAudit";

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

  it("keeps package, browser, setup, and run documentation on the KNOuX Forge identity", async () => {
    const root = process.cwd();
    const packageManifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as { name?: string };
    const packageLock = JSON.parse(await fs.readFile(path.join(root, "package-lock.json"), "utf8")) as { name?: string; packages?: Record<string, { name?: string }> };
    const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
    const runGuide = await fs.readFile(path.join(root, "RUN.md"), "utf8");
    const html = await fs.readFile(path.join(root, "index.html"), "utf8");
    const environment = await fs.readFile(path.join(root, ".env.example"), "utf8");
    expect(packageManifest.name).toBe("knoux-forge");
    expect(packageLock.name).toBe("knoux-forge");
    expect(packageLock.packages?.[""]?.name).toBe("knoux-forge");
    expect(`${readme}\n${runGuide}\n${html}`).not.toMatch(/fusion[- ]starter|hello world project/i);
    expect(readme).toContain("# KNOuX Forge");
    expect(readme).toContain("http://localhost:8080/workspace");
    expect(readme).toContain("http://localhost:3000/workspace");
    expect(readme).toContain("does not claim browser console");
    expect(runGuide).toContain("There is no repository `lint` script.");
    expect(environment).not.toContain("API_BASE_URL");
    expect(environment).toContain("KFORGE_WORKSPACE_ROOT=.");
  });

  it("audits Markdown commands without treating ordinary npm prose as a script", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-doc-command-"));
    try {
      await fs.writeFile(path.join(root, "README.md"), "Requires Node.js with npm and Git.\n\n```powershell\nnpm run missing\n```\n", "utf8");
      const audit = await auditDocumentation(root, { scripts: {}, commands: {}, envFiles: [] } as ProjectProfile);
      expect(audit.findings.map((finding) => finding.claim)).toEqual(["npm run missing"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

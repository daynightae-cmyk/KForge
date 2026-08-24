import { promises as fs } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { detectSecurityTools, isSecurityToolId, runSecurityTool } from "./securityTools";

describe("Security Tool Manager network policy", () => {
  it("registers npm audit but blocks it before execution in Offline Mode", async () => {
    const projectPath = await fs.mkdtemp(path.join(process.cwd(), "kforge-security-tools-"));
    try {
      await fs.writeFile(path.join(projectPath, "package.json"), JSON.stringify({ name: "audit-fixture", version: "1.0.0" }), "utf8");
      await fs.writeFile(path.join(projectPath, "package-lock.json"), JSON.stringify({ name: "audit-fixture", version: "1.0.0", lockfileVersion: 3, packages: { "": { name: "audit-fixture", version: "1.0.0" } } }), "utf8");
      const detected = await detectSecurityTools(projectPath, true);
      expect(isSecurityToolId("npm-audit")).toBe(true);
      expect(detected.find((tool) => tool.id === "npm-audit")).toMatchObject({ label: "npm audit", state: "AVAILABLE" });
      const blocked = await runSecurityTool(projectPath, true, false, "npm-audit");
      expect(blocked).toMatchObject({ state: "BLOCKED" });
      expect(blocked.detail).toContain("Offline Mode");
      expect(blocked.lastRun).toBeUndefined();
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true });
    }
  }, 15_000);
});

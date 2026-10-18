import { promises as fs } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { detectSecurityTools, isSecurityToolId, runSecurityTool } from "./securityTools";

describe("Security Tool Manager network policy", () => {
  // Declared first on purpose: the version-probe cache is module scoped, so the stall fixture
  // must be exercised before any successful probe of npm-audit is cached.
  it.skipIf(process.platform !== "win32")("reports a stalled version probe as a bounded timeout rather than mislabelling the host", async () => {
    const projectPath = await fs.mkdtemp(path.join(process.cwd(), "kforge-security-tools-"));
    const previousPath = process.env.KFORGE_NPM_PATH;
    const previousBudget = process.env.KFORGE_VERSION_PROBE_TIMEOUT_MS;
    try {
      await fs.writeFile(path.join(projectPath, "package.json"), JSON.stringify({ name: "audit-fixture", version: "1.0.0" }), "utf8");
      await fs.writeFile(path.join(projectPath, "package-lock.json"), JSON.stringify({ name: "audit-fixture", version: "1.0.0", lockfileVersion: 3, packages: { "": { name: "audit-fixture", version: "1.0.0" } } }), "utf8");
      const stalledNpm = path.join(projectPath, "stalled-npm.cmd");
      // Sleeps ~3s, far beyond the 1s budget configured below.
      await fs.writeFile(stalledNpm, ["@echo off", "ping -n 4 127.0.0.1 >nul", "echo 9.9.9", ""].join("\r\n"), "utf8");
      process.env.KFORGE_NPM_PATH = stalledNpm;
      process.env.KFORGE_VERSION_PROBE_TIMEOUT_MS = "1000";
      const started = Date.now();
      const detected = await detectSecurityTools(projectPath, true);
      const elapsed = Date.now() - started;
      const npmAudit = detected.find((tool) => tool.id === "npm-audit")!;
      // The probe must be bounded by the configured budget, not by how long the tool stalls.
      expect(elapsed).toBeLessThan(8_000);
      expect(npmAudit.state).toBe("FAILED");
      expect(npmAudit.detail).toContain("exceeded the time budget");
      // A stalled tool must never be reported as available.
      expect(npmAudit.detail).not.toContain("were detected");
      expect(npmAudit.version).toBeUndefined();
    } finally {
      if (previousPath === undefined) delete process.env.KFORGE_NPM_PATH;
      else process.env.KFORGE_NPM_PATH = previousPath;
      if (previousBudget === undefined) delete process.env.KFORGE_VERSION_PROBE_TIMEOUT_MS;
      else process.env.KFORGE_VERSION_PROBE_TIMEOUT_MS = previousBudget;
      await fs.rm(projectPath, { recursive: true, force: true });
    }
  }, 30_000);

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

  it("reports identical tool states across repeated detection without re-probing", async () => {
    const projectPath = await fs.mkdtemp(path.join(process.cwd(), "kforge-security-tools-"));
    try {
      await fs.writeFile(path.join(projectPath, "package.json"), JSON.stringify({ name: "audit-fixture", version: "1.0.0" }), "utf8");
      await fs.writeFile(path.join(projectPath, "package-lock.json"), JSON.stringify({ name: "audit-fixture", version: "1.0.0", lockfileVersion: 3, packages: { "": { name: "audit-fixture", version: "1.0.0" } } }), "utf8");
      const first = await detectSecurityTools(projectPath, true);
      const second = await detectSecurityTools(projectPath, true);
      expect(second.map((tool) => `${tool.id}:${tool.state}`)).toEqual(first.map((tool) => `${tool.id}:${tool.state}`));
      expect(second.find((tool) => tool.id === "npm-audit")).toMatchObject({ label: "npm audit", state: "AVAILABLE" });
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true });
    }
  }, 15_000);
});

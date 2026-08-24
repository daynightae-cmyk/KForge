import { promises as fs } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { getProjectTrust, setProjectTrust } from "./projectTrust";

describe("project trust persistence", () => {
  it("atomically survives a fresh read without leaving duplicate temporary state", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-trust-restart-"));
    const project = path.join(root, "project");
    try {
      await fs.mkdir(project);
      expect(await getProjectTrust(root, project)).toBe("untrusted");
      await setProjectTrust(root, project, "trusted");
      expect(await getProjectTrust(root, project)).toBe("trusted");
      expect((await fs.readdir(path.join(root, ".kforge"))).filter((file) => file.endsWith(".tmp"))).toEqual([]);
      const stored = JSON.parse(await fs.readFile(path.join(root, ".kforge", "project-trust.json"), "utf8")) as { projects?: Record<string, string> };
      expect(Object.values(stored.projects || {})).toEqual(["trusted"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 75 });
    }
  });
});

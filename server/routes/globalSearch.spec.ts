import type { AddressInfo } from "net";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../index";
import type { GlobalSearchResponse } from "../../shared/workspace";

afterEach(() => vi.unstubAllEnvs());

describe("Global Search evidence contract", () => {
  it("returns bounded source coverage and capability navigation for real local entities", async () => {
    vi.stubEnv("KFORGE_WORKSPACE_ROOT", path.resolve(process.cwd(), "fixtures"));
    const server = createServer().listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/workspace/search?q=message`);
      expect(response.status).toBe(200);
      const payload = await response.json() as GlobalSearchResponse;
      expect(payload.query).toBe("message");
      expect(payload.results).toEqual(expect.arrayContaining([
        expect.objectContaining({ entity: "Symbols", title: "message", target: "Project graph", source: expect.stringContaining("project graph") }),
      ]));
      expect(Object.keys(payload.coverage)).toEqual(expect.arrayContaining(["Projects", "Files", "Symbols", "APIs", "Routes", "Problems", "Tasks", "Agents", "Models", "Marketplace", "Git", "GitHub", "Release", "Documentation", "Dependencies", "Technologies", "Results"]));
      expect(payload.coverage.Symbols?.searchedCount).toBeGreaterThan(0);
      expect(payload.coverage.Problems?.reason).toContain("typing did not start hidden scans");
      expect(payload.coverage.Models?.reason).toContain("did not contact a remote registry");
      expect(payload.coverage.Results?.totalOrUnknown).toBe(payload.results.length);
      const agentResponse = await fetch(`http://127.0.0.1:${address.port}/api/workspace/search?q=audit`);
      const agentPayload = await agentResponse.json() as GlobalSearchResponse;
      expect(agentPayload.results).toEqual(expect.arrayContaining([
        expect.objectContaining({ entity: "Agents", entityId: "audit", target: "Agents" }),
      ]));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 45_000);
});

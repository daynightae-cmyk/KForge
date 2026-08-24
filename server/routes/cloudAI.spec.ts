import type { AddressInfo } from "net";
import { promises as fs } from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../index";
import { setLocalPlatformMode } from "../services/localPlatform";
import { setProjectTrust } from "../services/projectTrust";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("cloud AI planning route", () => {
  it("returns exact disclosure before any configured provider contact and truthful NOT_CONFIGURED state otherwise", async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(process.cwd(), "kforge-cloud-route-"));
    roots.push(workspaceRoot);
    const projectPath = path.join(workspaceRoot, "fixture");
    await fs.mkdir(projectPath);
    await fs.writeFile(path.join(projectPath, "package.json"), JSON.stringify({ name: "cloud-route-fixture", version: "1.0.0" }), "utf8");
    await fs.writeFile(path.join(projectPath, "README.md"), "# Fixture", "utf8");
    vi.stubEnv("KFORGE_WORKSPACE_ROOT", workspaceRoot);
    vi.stubEnv("OPENAI_API_KEY", "route-secret-never-returned");
    vi.stubEnv("KFORGE_OPENAI_MODEL", "test-model");
    await setLocalPlatformMode(workspaceRoot, "online");
    await setProjectTrust(workspaceRoot, projectPath, "trusted");

    const server = createServer().listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    try {
      const address = server.address() as AddressInfo;
      const base = `http://127.0.0.1:${address.port}/api/workspace`;
      const workspace = await (await fetch(`${base}/projects`)).json() as { projects: Array<{ id: string }> };
      const projectId = workspace.projects[0].id;
      const response = await fetch(`${base}/projects/${projectId}/agent/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mission: "Review project evidence", cloudProvider: "openai" }) });
      expect(response.status).toBe(428);
      const payload = await response.json() as Record<string, unknown> & { disclosure: Record<string, unknown> };
      expect(payload.state).toBe("CONFIRMATION_REQUIRED");
      expect(payload.disclosure).toMatchObject({ provider: "OpenAI", destination: "https://api.openai.com/v1/responses", dataClasses: ["METADATA", "PROJECT_CONTEXT"], projectSourceSent: false, secretRedaction: true, confirmation: "REQUIRED", result: "NOT_STARTED" });
      expect(JSON.stringify(payload)).not.toContain("route-secret-never-returned");

      const control = await (await fetch(`${base}/projects/${projectId}/online/control-center`)).json() as { services: Array<{ id: string; state: string; lastAttemptedContact: string | null }> };
      expect(control.services.find((service) => service.id === "cloud-ai")).toMatchObject({ state: "DISCONNECTED", lastAttemptedContact: null });

      const originalFetch = globalThis.fetch;
      const externalRequests: Array<{ url: string; init?: RequestInit }> = [];
      vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(`http://127.0.0.1:${address.port}`)) return originalFetch(input, init);
        externalRequests.push({ url, init });
        return new Response(JSON.stringify({ output_text: "Confirmed cloud plan" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }) as typeof fetch);
      const confirmed = await fetch(`${base}/projects/${projectId}/agent/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mission: "Review project evidence", cloudProvider: "openai", confirmedCloud: true }) });
      expect(confirmed.status).toBe(200);
      const confirmedPayload = await confirmed.json() as { plan: string; mode: string; disclosure: { confirmation: string; result: string; completedAt: string | null } };
      expect(confirmedPayload).toMatchObject({ plan: "Confirmed cloud plan", mode: "cloud-ai", disclosure: { confirmation: "CONFIRMED", result: "SUCCEEDED" } });
      expect(confirmedPayload.disclosure.completedAt).toBeTruthy();
      expect(externalRequests).toHaveLength(1);
      expect(externalRequests[0].url).toBe("https://api.openai.com/v1/responses");
      expect(externalRequests[0].init?.body).toContain("Review project evidence");
      const connectedControl = await (await fetch(`${base}/projects/${projectId}/online/control-center`)).json() as { services: Array<{ id: string; state: string; lastAttemptedContact: string | null }> };
      expect(connectedControl.services.find((service) => service.id === "cloud-ai")).toMatchObject({ state: "CONNECTED", lastAttemptedContact: expect.any(String) });

      vi.stubEnv("OPENAI_API_KEY", "");
      vi.stubEnv("KFORGE_OPENAI_MODEL", "");
      const missing = await fetch(`${base}/projects/${projectId}/agent/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mission: "Review project evidence", cloudProvider: "openai" }) });
      expect(missing.status).toBe(409);
      const missingPayload = await missing.json() as { state: string; disclosure: { result: string }; error: string };
      expect(missingPayload).toMatchObject({ state: "NOT_CONFIGURED", disclosure: { result: "BLOCKED" } });
      expect(missingPayload.error).toContain("NOT_CONFIGURED");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, 30_000);
});

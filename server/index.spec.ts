import { once } from "events";
import { request as httpRequest } from "http";
import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "./index";

function rawApiRequest(authority: string, hostHeader: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = hostHeader ? { Host: hostHeader } : { Host: "" };
    const req = httpRequest({ host: "127.0.0.1", port: Number(authority.split(":")[1]), path: "/api/ping", method: "GET", headers, setHost: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("server hardening boundaries", () => {
  let server: Server | null = null;
  let baseUrl = "";
  let strictServer: Server | null = null;
  let strictBaseUrl = "";
  let strictAuthority = "";

  beforeEach(async () => {
    const app = createServer();
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Hardening test server did not expose a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const strictApp = createServer({ enforceLoopbackHostHeader: true });
    strictServer = strictApp.listen(0, "127.0.0.1");
    await once(strictServer, "listening");
    const strictAddress = strictServer.address();
    if (!strictAddress || typeof strictAddress === "string") throw new Error("Strict hardening test server did not expose a TCP port.");
    strictAuthority = `127.0.0.1:${strictAddress.port}`;
    strictBaseUrl = `http://${strictAuthority}`;
  });

  afterEach(async () => {
    if (server) {
      server.close();
      await once(server, "close");
      server = null;
    }
    if (strictServer) {
      strictServer.close();
      await once(strictServer, "close");
      strictServer = null;
    }
  });

  it("refuses cross-site browser callers before any API route observes them", async () => {
    const response = await fetch(`${baseUrl}/api/ping`, { headers: { "sec-fetch-site": "cross-site" } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Cross-site browser requests cannot reach the KForge API.", code: "KFORGE_CROSS_SITE_REJECTED" });
  });

  it("refuses cross-origin browser callers that cannot read the response", async () => {
    const response = await fetch(`${baseUrl}/api/ping`, { headers: { origin: "https://attacker.example" } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Cross-origin browser requests cannot reach the KForge API.", code: "KFORGE_CROSS_ORIGIN_REJECTED" });
  });

  it("refuses malformed browser origin values", async () => {
    const response = await fetch(`${baseUrl}/api/ping`, { headers: { origin: "not-an-origin" } });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("KFORGE_CROSS_ORIGIN_REJECTED");
  });

  it("accepts the same-origin workbench caller", async () => {
    const authority = new URL(baseUrl).host;
    const response = await fetch(`${baseUrl}/api/ping`, { headers: { origin: `http://${authority}`, "sec-fetch-site": "same-origin" } });
    expect(response.status).toBe(200);
  });

  it("accepts non-browser local callers that send no browser origin evidence", async () => {
    const response = await fetch(`${baseUrl}/api/ping`);
    expect(response.status).toBe(200);
  });

  it("refuses rebound Host headers only on the loopback-enforced runtime", async () => {
    const rebound = await rawApiRequest(strictAuthority, "attacker.example");
    expect(rebound.status).toBe(403);
    expect(JSON.parse(rebound.body)).toEqual({ error: "KForge API requests require a loopback Host header.", code: "KFORGE_HOST_REJECTED" });

    const loopback = await rawApiRequest(strictAuthority, strictAuthority);
    expect(loopback.status).toBe(200);

    const viaLocalhost = await rawApiRequest(strictAuthority, strictAuthority.replace("127.0.0.1", "localhost"));
    expect(viaLocalhost.status).toBe(200);

    const missingHost = await rawApiRequest(strictAuthority, "");
    expect(missingHost.status).toBe(403);

    const devAuthority = new URL(baseUrl).host;
    const devServerAllowsLanHost = await rawApiRequest(devAuthority, "dev-host.example");
    expect(devServerAllowsLanHost.status).toBe(200);
  });

  it("returns normalized JSON for malformed bodies without leaking stacks", async () => {
    const response = await fetch(`${baseUrl}/api/ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-valid-json",
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "Malformed JSON body." });
  });

  it("does not fingerprint the server implementation", async () => {
    const response = await fetch(`${baseUrl}/api/ping`);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-powered-by")).toBeNull();
  });

  it("rejects provider identifiers that decode to filesystem traversal", async () => {
    const response = await fetch(`${baseUrl}/api/workspace/ai/command-center/providers/..%2Fescape/models`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid provider command identifier." });
  });

  it("rejects session identifiers that decode to filesystem traversal", async () => {
    const response = await fetch(`${baseUrl}/api/workspace/ai/command-center/sessions/..%5Cescape/events`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid provider command identifier." });
  });

  it("rejects malformed percent-encoded provider command identifiers", async () => {
    const response = await fetch(`${baseUrl}/api/workspace/ai/command-center/sessions/%E0%A4%A/events`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid provider command identifier." });
  });

  it("exposes unsigned release truth without trusted-publisher claims", async () => {
    const { resolveReleaseState } = await import("../shared/releaseState");
    const state = resolveReleaseState({});
    expect(state.signingStatus).toBe("UNSIGNED");
    expect(state.trustStatus).toBe("DEVELOPMENT_ARTIFACT");
  });
});

import { once } from "events";
import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "./index";

describe("server hardening boundaries", () => {
  let server: Server | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    const app = createServer();
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Hardening test server did not expose a TCP port.");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server) {
      server.close();
      await once(server, "close");
      server = null;
    }
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

  it("exposes unsigned release truth without trusted-publisher claims", async () => {
    const { resolveReleaseState } = await import("../shared/releaseState");
    const state = resolveReleaseState({});
    expect(state.signingStatus).toBe("UNSIGNED");
    expect(state.trustStatus).toBe("DEVELOPMENT_ARTIFACT");
  });
});

import { once } from "events";
import express from "express";
import type { Server } from "http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KFORGE_CONTENT_SECURITY_POLICY, KFORGE_PERMISSIONS_POLICY, kforgeSecurityHeaders, kforgeTerminalErrorHandler } from "./httpHardening";

let server: Server | null = null;

afterEach(async () => {
  vi.restoreAllMocks();
  if (!server) return;
  const closing = server;
  server = null;
  closing.close();
  await once(closing, "close");
});

async function listen(app: express.Express) {
  const instance = app.listen(0, "127.0.0.1");
  await once(instance, "listening");
  server = instance;
  const address = instance.address();
  if (!address || typeof address === "string") throw new Error("HTTP hardening test server did not expose a TCP port.");
  return `http://127.0.0.1:${address.port}`;
}

describe("KForge HTTP hardening", () => {
  it("serves the browser runtime under the same CSP family as the packaged desktop shell", async () => {
    const app = express();
    app.use(kforgeSecurityHeaders);
    app.get("/", (_req, res) => res.type("html").send("<!doctype html><main>KForge</main>"));
    const baseUrl = await listen(app);

    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe(KFORGE_CONTENT_SECURITY_POLICY);
    expect(response.headers.get("permissions-policy")).toBe(KFORGE_PERMISSIONS_POLICY);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(KFORGE_CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(KFORGE_CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(KFORGE_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
  });

  it("returns a generic JSON 500 without stack, message, or absolute path", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = express();
    app.get("/boom", () => {
      throw new Error("SECRET_STACK_MARKER at C:\\private\\workspace\\state.json");
    });
    app.use(kforgeTerminalErrorHandler);
    const baseUrl = await listen(app);

    const response = await fetch(`${baseUrl}/boom`);
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.json();
    expect(body).toEqual({ error: "KForge request failed.", code: "KFORGE_INTERNAL_ERROR" });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("SECRET_STACK_MARKER");
    expect(serialized).not.toContain("private");
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]?.[0])).toContain("GET /boom");
  });

  it("preserves a deliberate 4xx status without echoing the failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = express();
    app.get("/too-large", () => {
      const error = new Error("payload too large for this endpoint") as Error & { status: number };
      error.status = 413;
      throw error;
    });
    app.use(kforgeTerminalErrorHandler);
    const baseUrl = await listen(app);

    const response = await fetch(`${baseUrl}/too-large`);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "KForge rejected an invalid request.", code: "KFORGE_REQUEST_REJECTED" });
  });
});

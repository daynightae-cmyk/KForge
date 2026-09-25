import { describe, expect, it, vi } from "vitest";
import {
  RemoteFetchError,
  isBlockedIPv4,
  isBlockedIPv6,
  safeFetchRemote,
  type FetchImpl,
  type SafeFetchPolicy,
} from "./fetchPolicy";

const ORIGIN = "https://registry.modelcontextprotocol.io";
const PUBLIC_RESOLVER = async () => [{ address: "93.184.216.34", family: 4 }];

function basePolicy(overrides: Partial<SafeFetchPolicy> = {}): SafeFetchPolicy {
  return {
    sourceId: "mcp-official-registry",
    allowedOrigins: [ORIGIN],
    networkAllowed: true,
    hostResolver: PUBLIC_RESOLVER,
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("safeFetchRemote network policy", () => {
  it("refuses OFFLINE callers before any socket opens", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ servers: [] }));
    await expect(safeFetchRemote(`${ORIGIN}/v0.1/servers`, basePolicy({ networkAllowed: false }), fetchImpl)).rejects.toMatchObject({
      code: "OFFLINE_BLOCKED",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects origins outside the allowlist", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    await expect(
      safeFetchRemote("https://evil.example.com/v0.1/servers", basePolicy(), fetchImpl),
    ).rejects.toMatchObject({ code: "ORIGIN_NOT_ALLOWED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects subdomain lookalikes of the approved origin", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    await expect(
      safeFetchRemote("https://registry.modelcontextprotocol.io.evil.com/v0.1/servers", basePolicy(), fetchImpl),
    ).rejects.toMatchObject({ code: "ORIGIN_NOT_ALLOWED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires HTTPS for remote hosts", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    await expect(
      safeFetchRemote(
        "http://registry.modelcontextprotocol.io/v0.1/servers",
        basePolicy({ allowedOrigins: ["http://registry.modelcontextprotocol.io"] }),
        fetchImpl,
      ),
    ).rejects.toMatchObject({ code: "ORIGIN_NOT_ALLOWED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never sends credentials embedded in URLs", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    await expect(
      safeFetchRemote("https://user:secret@registry.modelcontextprotocol.io/v0.1/servers", basePolicy(), fetchImpl),
    ).rejects.toMatchObject({ code: "ORIGIN_NOT_ALLOWED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks literal loopback/private/link-local hosts (SSRF)", async () => {
    for (const host of ["https://127.0.0.1/x", "https://10.0.0.5/x", "https://192.168.1.1/x", "https://169.254.169.254/x", "https://localhost/x"]) {
      const origin = new URL(host).origin;
      const fetchImpl = vi.fn(async () => jsonResponse({}));
      await expect(safeFetchRemote(host, basePolicy({ allowedOrigins: [origin] }), fetchImpl)).rejects.toMatchObject({
        code: "SSRF_BLOCKED",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("blocks hosts whose DNS resolves to private addresses", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    await expect(
      safeFetchRemote(
        `${ORIGIN}/v0.1/servers`,
        basePolicy({ hostResolver: async () => [{ address: "10.1.2.3", family: 4 }] }),
        fetchImpl,
      ),
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks hosts that do not resolve (fail closed)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    await expect(
      safeFetchRemote(
        `${ORIGIN}/v0.1/servers`,
        basePolicy({
          hostResolver: async () => {
            throw new Error("ENOTFOUND");
          },
        }),
        fetchImpl,
      ),
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects redirects that leave the allowlist", async () => {
    const fetchImpl: FetchImpl = async () => new Response(null, { status: 302, headers: { location: "https://evil.example.com/x" } });
    await expect(safeFetchRemote(`${ORIGIN}/v0.1/servers`, basePolicy(), fetchImpl)).rejects.toMatchObject({
      code: "ORIGIN_NOT_ALLOWED",
    });
  });

  it("rejects redirect loops past the bound", async () => {
    const fetchImpl: FetchImpl = async () => new Response(null, { status: 302, headers: { location: `${ORIGIN}/loop` } });
    await expect(safeFetchRemote(`${ORIGIN}/v0.1/servers`, basePolicy({ maxRedirects: 2 }), fetchImpl)).rejects.toMatchObject({
      code: "TOO_MANY_REDIRECTS",
    });
  });

  it("follows relative redirects inside the allowlist", async () => {
    const fetchImpl: FetchImpl = async (url) =>
      url.endsWith("/loop")
        ? new Response(null, { status: 302, headers: { location: "/v0.1/servers?cursor=abc" } })
        : jsonResponse({ servers: [] });
    const result = await safeFetchRemote(`${ORIGIN}/loop`, basePolicy(), fetchImpl);
    expect(result.httpStatus).toBe(200);
    expect(result.text).toContain("servers");
  });
});

describe("safeFetchRemote bounds and resilience", () => {
  it("refuses oversized declared bodies before reading", async () => {
    const fetchImpl: FetchImpl = async () =>
      new Response("{}", { status: 200, headers: { "Content-Length": String(10 * 1024 * 1024) } });
    await expect(safeFetchRemote(`${ORIGIN}/v0.1/servers`, basePolicy({ maxResponseBytes: 1024 }), fetchImpl)).rejects.toMatchObject({
      code: "TOO_LARGE",
    });
  });

  it("bounds streamed bodies (decompression-bomb shape)", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(2048)));
        controller.close();
      },
    });
    const fetchImpl: FetchImpl = async () => new Response(stream, { status: 200 });
    await expect(safeFetchRemote(`${ORIGIN}/v0.1/servers`, basePolicy({ maxResponseBytes: 1024 }), fetchImpl)).rejects.toMatchObject({
      code: "TOO_LARGE",
    });
  });

  it("times out hung providers", async () => {
    const fetchImpl: FetchImpl = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("This operation was aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    await expect(safeFetchRemote(`${ORIGIN}/v0.1/servers`, basePolicy({ timeoutMs: 50 }), fetchImpl)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });

  it("retries 429 with Retry-After then succeeds", async () => {
    let calls = 0;
    const fetchImpl: FetchImpl = async () => {
      calls += 1;
      if (calls === 1) return new Response(null, { status: 429, headers: { "Retry-After": "0" } });
      return jsonResponse({ servers: [] });
    };
    const result = await safeFetchRemote(`${ORIGIN}/v0.1/servers`, basePolicy(), fetchImpl);
    expect(result.httpStatus).toBe(200);
    expect(result.attempts).toBe(2);
    expect(calls).toBe(2);
  });

  it("gives up after bounded 429 retries", async () => {
    const fetchImpl: FetchImpl = async () => new Response(null, { status: 429, headers: { "Retry-After": "0" } });
    const error = await safeFetchRemote(`${ORIGIN}/v0.1/servers`, basePolicy({ maxRetries: 1 }), fetchImpl).catch((e) => e);
    expect(error).toBeInstanceOf(RemoteFetchError);
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.httpStatus).toBe(429);
  });

  it("retries transient 500s then succeeds", async () => {
    let calls = 0;
    const fetchImpl: FetchImpl = async () => {
      calls += 1;
      if (calls === 1) return new Response("boom", { status: 500 });
      return jsonResponse({ servers: [] });
    };
    const result = await safeFetchRemote(`${ORIGIN}/v0.1/servers`, basePolicy(), fetchImpl);
    expect(result.httpStatus).toBe(200);
    expect(calls).toBe(2);
  });

  it("passes 304 through with validators intact", async () => {
    const fetchImpl: FetchImpl = async (_url, init) => {
      expect((init?.headers as Record<string, string>)["If-None-Match"]).toBe('"abc"');
      return new Response(null, { status: 304, headers: { etag: '"abc"' } });
    };
    const result = await safeFetchRemote(`${ORIGIN}/v0.1/servers`, basePolicy({ ifNoneMatch: '"abc"' }), fetchImpl);
    expect(result.notModified).toBe(true);
    expect(result.httpStatus).toBe(304);
    expect(result.headers.etag).toBe('"abc"');
  });

  it("maps 404 to a redacted HTTP error", async () => {
    const fetchImpl: FetchImpl = async () => new Response("nope", { status: 404 });
    const error = await safeFetchRemote(`${ORIGIN}/v0.1/servers/missing`, basePolicy(), fetchImpl).catch((e) => e);
    expect(error).toBeInstanceOf(RemoteFetchError);
    expect(error.code).toBe("HTTP_ERROR");
    expect(error.httpStatus).toBe(404);
    expect(String(error.message)).not.toContain("secret");
  });

  it("captures rate-limit headers and strips auth headers", async () => {
    let seenHeaders: Record<string, string> = {};
    const fetchImpl: FetchImpl = async (_url, init) => {
      seenHeaders = { ...(init?.headers as Record<string, string>) };
      return jsonResponse(
        { servers: [] },
        { headers: { etag: '"e1"', "x-ratelimit-limit": "100", "x-ratelimit-remaining": "99", "x-ratelimit-reset": "60" } },
      );
    };
    const result = await safeFetchRemote(
      `${ORIGIN}/v0.1/servers`,
      basePolicy({ headers: { Authorization: "Bearer s3cret", Cookie: "a=b" } }),
      fetchImpl,
    );
    expect(seenHeaders.Authorization).toBeUndefined();
    expect(seenHeaders.Cookie).toBeUndefined();
    expect(result.headers.etag).toBe('"e1"');
    expect(result.headers.rateLimit.limit).toBe("100");
    expect(result.destination).toBe(ORIGIN);
  });

  it("rejects malformed URLs", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    await expect(safeFetchRemote("::not a url::", basePolicy(), fetchImpl)).rejects.toMatchObject({
      code: "ORIGIN_NOT_ALLOWED",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("IP blocklists", () => {
  it("blocks reserved IPv4 ranges", () => {
    for (const host of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.10.20", "0.0.0.0", "224.0.0.1", "192.0.2.1", "198.51.100.7", "203.0.113.9"]) {
      expect(isBlockedIPv4(host)).toBe(true);
    }
    expect(isBlockedIPv4("93.184.216.34")).toBe(false);
    expect(isBlockedIPv4("172.32.0.1")).toBe(false);
  });

  it("blocks special IPv6 addresses", () => {
    expect(isBlockedIPv6("::1")).toBe(true);
    expect(isBlockedIPv6("fe80::1")).toBe(true);
    expect(isBlockedIPv6("fc00::1")).toBe(true);
    expect(isBlockedIPv6("ff02::1")).toBe(true);
    expect(isBlockedIPv6("2606:4700:4700::1111")).toBe(false);
  });
});

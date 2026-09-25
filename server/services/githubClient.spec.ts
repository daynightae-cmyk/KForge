import { describe, expect, it, vi } from "vitest";
import {
  GH_ACCEPT_HEADER,
  GH_API_VERSION,
  GH_DEFAULT_CONCURRENCY,
  GH_LEAST_PRIVILEGE_GUIDANCE,
  GH_LEAST_PRIVILEGE_SCOPES,
  classifyGhRateLimit,
  ghApiArgs,
  ghPagination,
  mapWithConcurrency,
  normalizeGhRateLimit,
  readGhRateLimit,
  runGhApi,
  type GhExecution,
} from "./githubClient";

describe("gh api hardening arguments", () => {
  it("pins the API version and Accept headers on every read", () => {
    expect(ghApiArgs("repos/o/r")).toEqual([
      "api",
      "repos/o/r",
      "-H",
      `Accept: ${GH_ACCEPT_HEADER}`,
      "-H",
      `X-GitHub-Api-Version: ${GH_API_VERSION}`,
    ]);
    expect(GH_API_VERSION).toBe("2026-03-10");
  });

  it("routes reads through the injected runner without touching the network", async () => {
    const seen: string[][] = [];
    const runner = vi.fn(async (_command: string, args: string[], _cwd: string, _timeout: number): Promise<GhExecution> => {
      seen.push(args);
      return { ok: true, code: 0, output: "{}" };
    });
    await runGhApi(runner, { endpoint: "repos/o/r", cwd: "D:/proj" });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0]).toBe("gh");
    expect(seen[0]).toContain("X-GitHub-Api-Version: 2026-03-10");
  });
});

describe("bounded request concurrency", () => {
  it("caps simultaneous executions and preserves order", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const gate = () => new Promise<void>((resolve) => setTimeout(resolve, 15));
    const results = await mapWithConcurrency([0, 1, 2, 3, 4, 5, 6, 7, 8], GH_DEFAULT_CONCURRENCY, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gate();
      inFlight -= 1;
      return item * 10;
    });
    expect(results).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80]);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(GH_DEFAULT_CONCURRENCY).toBe(3);
  });

  it("handles empty input without spawning work", async () => {
    const fn = vi.fn(async (item: number) => item);
    await expect(mapWithConcurrency([], 3, fn)).resolves.toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("rate-limit evidence", () => {
  const payload = JSON.stringify({ resources: { core: { limit: 5000, remaining: 4999, reset: Math.floor(Date.now() / 1000) + 60 } } });

  it("normalizes valid rate_limit output", () => {
    const evidence = normalizeGhRateLimit(payload);
    expect(evidence).toMatchObject({ state: "AVAILABLE", limit: 5000, remaining: 4999 });
    expect(evidence.resetInSeconds).toBeGreaterThan(0);
  });

  it("refuses malformed or partial output without inventing quota", () => {
    expect(normalizeGhRateLimit("not json").state).toBe("UNAVAILABLE");
    expect(normalizeGhRateLimit(JSON.stringify({ resources: {} })).state).toBe("UNAVAILABLE");
    expect(normalizeGhRateLimit(JSON.stringify({ resources: { core: { limit: 60 } } })).state).toBe("UNAVAILABLE");
  });

  it("reads rate limits through the runner and never throws", async () => {
    const ok = vi.fn(async (): Promise<GhExecution> => ({ ok: true, code: 0, output: payload }));
    expect((await readGhRateLimit(ok, "D:/proj")).state).toBe("AVAILABLE");
    const failing = vi.fn(async (): Promise<GhExecution> => ({ ok: false, code: 1, output: "boom" }));
    expect((await readGhRateLimit(failing, "D:/proj")).state).toBe("UNAVAILABLE");
    const throwing = vi.fn(async (): Promise<GhExecution> => { throw new Error("spawn"); });
    expect((await readGhRateLimit(throwing, "D:/proj")).state).toBe("UNAVAILABLE");
  });
});

describe("rate-limit classification", () => {
  it("detects primary exhaustion", () => {
    const result = classifyGhRateLimit("HTTP 403: API rate limit exceeded for installation");
    expect(result).toMatchObject({ limited: true, kind: "primary", retryAfterSeconds: null });
  });

  it("detects secondary abuse/concurrency limits", () => {
    const result = classifyGhRateLimit("You have exceeded a secondary rate limit for abuse detection");
    expect(result).toMatchObject({ limited: true, kind: "secondary", retryAfterSeconds: null });
    expect(result.detail).toContain("concurrency bound");
  });

  it("stays quiet on clean output", () => {
    expect(classifyGhRateLimit("{}").limited).toBe(false);
  });
});

describe("least-privilege guidance", () => {
  it("recommends read-only fine-grained scopes, never a classic PAT", () => {
    expect(GH_LEAST_PRIVILEGE_SCOPES).toContain("contents:read");
    expect(GH_LEAST_PRIVILEGE_GUIDANCE).toContain("fine-grained");
    expect(GH_LEAST_PRIVILEGE_GUIDANCE).toContain("Never use a broad classic PAT");
  });
});

describe("pagination bound evidence", () => {
  it("records explicit first-page bounds", () => {
    expect(ghPagination(20)).toMatchObject({ page: 1, perPage: 20, boundedFirstPage: true });
  });
});

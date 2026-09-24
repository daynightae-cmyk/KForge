/**
 * GitHub read hardening over the EXISTING `gh api` transport (Slice 7, P0).
 *
 * This is not a second GitHub client: the same `gh api` endpoints, the same
 * ambient `gh auth` credential, and the same explicit-refresh route use this
 * thin policy layer. Added production behaviors:
 *
 * 1. Pinned API version header (X-GitHub-Api-Version: 2026-03-10) plus an
 *    explicit Accept header on every read, per current GitHub REST guidance.
 * 2. Bounded request concurrency (default 3 in flight) so one explicit
 *    refresh cannot burst secondary rate limits.
 * 3. Rate-limit evidence from the `rate_limit` endpoint (limit, remaining,
 *    reset epoch) attached to refresh responses.
 * 4. Primary vs secondary rate-limit classification from API error output,
 *    with wait-until-reset guidance. NOTE: `gh` CLI does not surface the
 *    HTTP Retry-After header, so retryAfterSeconds is always null and the
 *    reset epoch from rate-limit evidence is the authoritative wait signal.
 * 5. Least-privilege authentication guidance (fine-grained token or GitHub
 *    App with read-only scopes; never a broad classic PAT).
 * 6. Explicit first-page pagination bounds recorded per source instead of
 *    silent truncation.
 *
 * Deliberately NOT included: ETag/If-None-Match conditional requests and
 * Link-header pagination traversal. Both require `gh api --include/--cache`
 * behaviors that cannot be verified against the unknown `gh` versions on
 * owner machines; a wrong assumption there would break the whole GitHub
 * surface. Rate budget is instead conserved via bounded first-page reads
 * plus the concurrency limit above.
 */

export const GH_API_VERSION = "2026-03-10";
export const GH_ACCEPT_HEADER = "application/vnd.github+json";
export const GH_DEFAULT_CONCURRENCY = 3;
export const GH_DEFAULT_TIMEOUT_MS = 20_000;

export interface GhExecution {
  ok: boolean;
  code: number;
  output: string;
}

export type GhRunner = (command: string, args: string[], cwd: string, timeoutMs: number) => Promise<GhExecution>;

/** Build `gh api` arguments with pinned version and explicit Accept headers. */
export function ghApiArgs(endpoint: string, extraHeaders: string[] = []): string[] {
  return ["api", endpoint, "-H", `Accept: ${GH_ACCEPT_HEADER}`, "-H", `X-GitHub-Api-Version: ${GH_API_VERSION}`, ...extraHeaders];
}

/** Single `gh api` read through the existing transport. */
export async function runGhApi(
  runner: GhRunner,
  input: { endpoint: string; cwd: string; timeoutMs?: number; extraHeaders?: string[] },
): Promise<GhExecution> {
  return runner("gh", ghApiArgs(input.endpoint, input.extraHeaders), input.cwd, input.timeoutMs ?? GH_DEFAULT_TIMEOUT_MS);
}

/**
 * Bounded-concurrency pool. Preserves input order, caps simultaneous
 * executions at `limit`, and never drops or duplicates items.
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const bounded = Math.max(1, Math.floor(limit));
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = new Array(Math.min(bounded, items.length)).fill(undefined).map(async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface GhRateLimitEvidence {
  state: "AVAILABLE" | "UNAVAILABLE";
  limit?: number;
  remaining?: number;
  reset?: number;
  resetInSeconds?: number;
  detail: string;
}

/** Normalize the `rate_limit` endpoint payload. Malformed/absent data stays UNAVAILABLE, never invented. */
export function normalizeGhRateLimit(output: string, now = Date.now()): GhRateLimitEvidence {
  try {
    const parsed = JSON.parse(output) as { resources?: { core?: { limit?: unknown; remaining?: unknown; reset?: unknown } } };
    const core = parsed?.resources?.core;
    if (typeof core?.limit !== "number" || typeof core?.remaining !== "number" || typeof core?.reset !== "number") {
      return { state: "UNAVAILABLE", detail: "The rate_limit endpoint did not return core quota evidence." };
    }
    return {
      state: "AVAILABLE",
      limit: core.limit,
      remaining: core.remaining,
      reset: core.reset,
      resetInSeconds: Math.max(0, core.reset - Math.floor(now / 1000)),
      detail: `Core quota ${core.remaining}/${core.limit} remaining; resets at epoch ${core.reset}.`,
    };
  } catch {
    return { state: "UNAVAILABLE", detail: "The rate_limit endpoint returned non-JSON output." };
  }
}

/** Read rate-limit evidence through the existing transport. Failures stay evidence, never throws. */
export async function readGhRateLimit(runner: GhRunner, cwd: string, timeoutMs = 10_000): Promise<GhRateLimitEvidence> {
  try {
    const execution = await runGhApi(runner, { endpoint: "rate_limit", cwd, timeoutMs });
    if (!execution.ok) return { state: "UNAVAILABLE", detail: execution.output || "The rate_limit read failed." };
    return normalizeGhRateLimit(execution.output);
  } catch (error) {
    return { state: "UNAVAILABLE", detail: error instanceof Error ? error.message.slice(0, 300) : "The rate_limit read failed." };
  }
}

export type GhRateLimitKind = "primary" | "secondary" | "none";

export interface GhRateLimitClassification {
  limited: boolean;
  kind: GhRateLimitKind;
  retryAfterSeconds: null;
  detail: string;
}

/**
 * Classify primary vs secondary rate limiting from API error output.
 * `gh` CLI does not surface the HTTP Retry-After header, so callers must
 * use the reset epoch from rate-limit evidence as the wait signal.
 */
export function classifyGhRateLimit(output: string): GhRateLimitClassification {
  const text = output.toLowerCase();
  if (/(secondary rate limit|abuse detection|too many requests.*concurrent|concurrent.*requests)/.test(text)) {
    return {
      limited: true,
      kind: "secondary",
      retryAfterSeconds: null,
      detail: "Secondary rate limit (concurrency/abuse detection). Serialize requests, honor the concurrency bound, and wait before retrying; Retry-After is not surfaced by gh CLI output.",
    };
  }
  if (/(rate limit exceeded|api rate limit|rate_limit|http 429|429)/.test(text)) {
    return {
      limited: true,
      kind: "primary",
      retryAfterSeconds: null,
      detail: "Primary rate limit exhausted. Wait until the reset epoch in rate-limit evidence; Retry-After is not surfaced by gh CLI output.",
    };
  }
  return { limited: false, kind: "none", retryAfterSeconds: null, detail: "No rate-limit signal in output." };
}

/** Minimum read-only scopes for the existing GitHub read surfaces. */
export const GH_LEAST_PRIVILEGE_SCOPES = ["contents:read", "issues:read", "pull-requests:read", "actions:read", "checks:read", "statuses:read", "deployments:read"] as const;

export const GH_LEAST_PRIVILEGE_GUIDANCE =
  "Authenticate with `gh auth login` using a fine-grained personal access token or GitHub App installation " +
  `with read-only access (${GH_LEAST_PRIVILEGE_SCOPES.join(", ")}). Never use a broad classic PAT: it grants more than these read-only surfaces require.`;

export interface GhPagination {
  page: 1;
  perPage: number;
  boundedFirstPage: true;
  detail: string;
}

/** Explicit first-page bound recorded per source instead of silent truncation. */
export function ghPagination(perPage: number): GhPagination {
  return {
    page: 1,
    perPage,
    boundedFirstPage: true,
    detail: `First-page bounded read (per_page=${perPage}); further pages require an explicit follow-up and are not silently merged.`,
  };
}

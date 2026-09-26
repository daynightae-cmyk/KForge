import { lookup as dnsLookup } from "dns/promises";
import type { RemoteSourceId } from "./contracts";
import type { RateLimitEvidence } from "./contracts";

/**
 * Reusable safe-fetch layer for approved remote metadata reads (Slice 1).
 *
 * Guarantees:
 * - OFFLINE / network-disabled callers are refused BEFORE any socket opens.
 * - Only exact allowlisted HTTPS origins are contacted (SSRF guard).
 * - Loopback / private / reserved IP literals and DNS answers are blocked
 *   unless the source definition explicitly allows loopback (local runtimes).
 * - Redirects are followed manually and every hop is re-validated.
 * - Response bodies are bounded (size + decompression bombs).
 * - Timeouts use AbortSignal; 429 honors Retry-After with bounded retries.
 * - Errors are redacted: no credentials, tokens, or response bodies leak.
 */

export type RemoteFetchErrorCode =
  | "OFFLINE_BLOCKED"
  | "ORIGIN_NOT_ALLOWED"
  | "SSRF_BLOCKED"
  | "TIMEOUT"
  | "ABORTED"
  | "TOO_LARGE"
  | "TOO_MANY_REDIRECTS"
  | "RATE_LIMITED"
  | "HTTP_ERROR"
  | "NETWORK_ERROR";

export class RemoteFetchError extends Error {
  readonly code: RemoteFetchErrorCode;
  readonly httpStatus: number | null;
  readonly retryAfterSeconds?: number;

  constructor(code: RemoteFetchErrorCode, message: string, httpStatus: number | null = null, retryAfterSeconds?: number) {
    super(message);
    this.name = "RemoteFetchError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface SafeFetchPolicy {
  sourceId: RemoteSourceId;
  /** Exact allowed origins, e.g. ["https://registry.modelcontextprotocol.io"]. */
  allowedOrigins: string[];
  /** Refuse the request without opening a socket when false (OFFLINE mode gate). */
  networkAllowed: boolean;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  maxRetries?: number;
  allowLoopback?: boolean;
  /** Conditional request validators carried from the bounded cache. */
  ifNoneMatch?: string;
  ifModifiedSince?: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /**
   * DNS resolver override (tests only). Production uses dns/promises lookup.
   * The override keeps unit tests hermetic: no real DNS leaves the machine.
   */
  hostResolver?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
}

export interface SafeFetchResult {
  httpStatus: number;
  notModified: boolean;
  headers: {
    etag?: string;
    lastModified?: string;
    cacheControl?: string;
    retryAfterSeconds?: number;
    rateLimit: RateLimitEvidence;
  };
  /** Raw UTF-8 body. Schema validation is the adapter's job, never the UI's. */
  text: string;
  bytes: number;
  attempts: number;
  destination: string;
}

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRY_AFTER_SECONDS = 60;

function redactUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "").slice(0, 500);
  } catch {
    return value
      .replace(/(api[_-]?key|token|password|secret|authorization|access[_-]?token|refresh[_-]?token)=([^\s&]+)/gi, "$1=[REDACTED]")
      .slice(0, 200);
  }
}

function isIPv4Literal(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function ipv4ToInt(host: string): number | null {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3];
}

function inRange(value: number, base: string, bits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = bits === 0 ? 0 : ~((2 ** (32 - bits)) - 1) >>> 0;
  return (value & mask) === (baseInt & mask);
}

/** Fail-closed private/reserved IPv4 check (loopback, RFC1918, link-local, multicast, TEST-NET, ...). */
export function isBlockedIPv4(host: string): boolean {
  const value = ipv4ToInt(host);
  if (value === null) return true;
  if (value >>> 24 === 127) return true; // 127.0.0.0/8 loopback
  if (inRange(value, "10.0.0.0", 8)) return true;
  if (inRange(value, "172.16.0.0", 12)) return true;
  if (inRange(value, "192.168.0.0", 16)) return true;
  if (inRange(value, "169.254.0.0", 16)) return true; // link-local
  if (inRange(value, "224.0.0.0", 4)) return true; // multicast
  if (inRange(value, "0.0.0.0", 8)) return true;
  if (inRange(value, "192.0.2.0", 24)) return true; // TEST-NET-1
  if (inRange(value, "198.51.100.0", 24)) return true; // TEST-NET-2
  if (inRange(value, "203.0.113.0", 24)) return true; // TEST-NET-3
  if (inRange(value, "192.88.99.0", 24)) return true; // 6to4 relay
  if (inRange(value, "192.18.0.0", 15)) return true; // benchmark
  return false;
}

/** Fail-closed IPv6 check: loopback, unspecified, link-local, unique-local, multicast. */
export function isBlockedIPv6(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[(.*)\]$/, "$1").split("%")[0];
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("ff")) return true;
  if (normalized.includes(".")) {
    const last = normalized.slice(normalized.lastIndexOf(":") + 1);
    if (isIPv4Literal(last)) return isBlockedIPv4(last);
  }
  return false;
}

function isBlockedLiteral(host: string): boolean {
  const bare = host.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (bare === "localhost") return true;
  if (isIPv4Literal(bare)) return isBlockedIPv4(bare);
  if (bare.includes(":")) return isBlockedIPv6(bare);
  return false;
}

function isLoopbackLiteral(host: string): boolean {
  const bare = host.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return bare === "localhost" || bare === "127.0.0.1" || bare === "::1";
}

function originOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

function assertOriginAllowed(url: string, allowedOrigins: string[], sourceId: RemoteSourceId): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RemoteFetchError("ORIGIN_NOT_ALLOWED", `Remote source '${sourceId}': malformed URL is not an approved origin.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new RemoteFetchError("ORIGIN_NOT_ALLOWED", `Remote source '${sourceId}': URL scheme '${parsed.protocol}' is not allowed.`);
  }
  if (parsed.protocol === "http:" && !isLoopbackLiteral(parsed.hostname)) {
    throw new RemoteFetchError("ORIGIN_NOT_ALLOWED", `Remote source '${sourceId}': remote metadata reads require HTTPS.`);
  }
  if (!allowedOrigins.includes(originOf(url))) {
    throw new RemoteFetchError(
      "ORIGIN_NOT_ALLOWED",
      `Remote source '${sourceId}': origin '${redactUrl(originOf(url))}' is not allowlisted.`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new RemoteFetchError("ORIGIN_NOT_ALLOWED", `Remote source '${sourceId}': credentials in URL are never sent.`);
  }
}

async function assertNoBlockedResolution(
  hostname: string,
  allowLoopback: boolean,
  sourceId: RemoteSourceId,
  hostResolver?: SafeFetchPolicy["hostResolver"],
): Promise<void> {
  const bare = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (allowLoopback && isLoopbackLiteral(bare)) return;
  if (isBlockedLiteral(bare)) {
    throw new RemoteFetchError("SSRF_BLOCKED", `Remote source '${sourceId}': blocked host '${bare}' (loopback/private/reserved).`);
  }
  // Best-effort DNS-rebinding mitigation: refuse when the current DNS answer
  // resolves to a blocked address. (TOCTOU between lookup and connect is a
  // documented residual; the origin allowlist remains the primary boundary.)
  let answers;
  try {
    answers = hostResolver ? await hostResolver(bare) : await dnsLookup(bare, { all: true });
  } catch {
    throw new RemoteFetchError("SSRF_BLOCKED", `Remote source '${sourceId}': host '${bare}' does not resolve.`);
  }
  for (const answer of answers) {
    if (answer.family === 4 ? isBlockedIPv4(answer.address) : isBlockedIPv6(answer.address)) {
      throw new RemoteFetchError("SSRF_BLOCKED", `Remote source '${sourceId}': host '${bare}' resolves to a blocked address.`);
    }
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.floor(seconds), MAX_RETRY_AFTER_SECONDS);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, Math.min(Math.floor((date - Date.now()) / 1000), MAX_RETRY_AFTER_SECONDS));
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readBoundedBody(response: Response, maxBytes: number, sourceId: RemoteSourceId): Promise<{ text: string; bytes: number }> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new RemoteFetchError("TOO_LARGE", `Remote source '${sourceId}': declared response size exceeds the ${maxBytes} byte bound.`);
    }
  }
  // Counting decoded bytes also bounds decompression bombs: fetch
  // transparently decompresses gzip/br, so a tiny wire body that expands past
  // the bound is still refused here.
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > maxBytes) throw new RemoteFetchError("TOO_LARGE", `Remote source '${sourceId}': response exceeds the ${maxBytes} byte bound.`);
    return { text, bytes };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RemoteFetchError("TOO_LARGE", `Remote source '${sourceId}': response exceeds the ${maxBytes} byte bound.`);
      }
      chunks.push(value);
    }
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return { text: buffer.toString("utf8"), bytes: total };
}

/**
 * Fetch approved remote metadata with policy enforcement.
 * Never sends project source, credentials, or secrets; never executes remote content.
 */
export async function safeFetchRemote(
  url: string,
  policy: SafeFetchPolicy,
  fetchImpl: FetchImpl = globalThis.fetch,
): Promise<SafeFetchResult> {
  if (!policy.networkAllowed) {
    throw new RemoteFetchError("OFFLINE_BLOCKED", `Remote source '${policy.sourceId}': network access is disabled by the current operating mode. No request was made.`);
  }
  const timeoutMs = policy.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = policy.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const maxRedirects = policy.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxRetries = policy.maxRetries ?? DEFAULT_MAX_RETRIES;
  const method = policy.method ?? "GET";

  let currentUrl = url;
  let redirects = 0;
  for (;;) {
    assertOriginAllowed(currentUrl, policy.allowedOrigins, policy.sourceId);
    const hostname = new URL(currentUrl).hostname;
    await assertNoBlockedResolution(hostname, policy.allowLoopback === true, policy.sourceId, policy.hostResolver);

    let attempts = 0;
    for (;;) {
      attempts += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
      const headers: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": "KNOuX-Forge/remote-source (explicit metadata read)",
        ...(policy.ifNoneMatch ? { "If-None-Match": policy.ifNoneMatch } : {}),
        ...(policy.ifModifiedSince ? { "If-Modified-Since": policy.ifModifiedSince } : {}),
        ...(policy.headers ?? {}),
      };
      delete headers.Authorization;
      delete headers.authorization;
      delete headers.Cookie;
      delete headers.cookie;
      let response: Response;
      try {
        response = await fetchImpl(currentUrl, {
          method,
          headers,
          body: policy.body,
          signal: controller.signal,
          redirect: "manual",
        });
      } catch (error) {
        clearTimeout(timer);
        if (error instanceof RemoteFetchError) throw error;
        const reason = error instanceof Error ? error.message : "network failure";
        if (error instanceof Error && (error.name === "AbortError" || /abort|timeout/i.test(reason))) {
          throw new RemoteFetchError("TIMEOUT", `Remote source '${policy.sourceId}': request timed out after ${timeoutMs}ms. [REDACTED]`);
        }
        throw new RemoteFetchError("NETWORK_ERROR", `Remote source '${policy.sourceId}': network failure. [REDACTED]`);
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 304) {
        await response.body?.cancel().catch(() => undefined);
        return {
          httpStatus: 304,
          notModified: true,
          headers: {
            etag: response.headers.get("etag") || undefined,
            lastModified: response.headers.get("last-modified") || undefined,
            rateLimit: { observed429: false, source: `Remote source ${policy.sourceId}` },
          },
          text: "",
          bytes: 0,
          attempts,
          destination: redactUrl(originOf(currentUrl)),
        };
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) throw new RemoteFetchError("HTTP_ERROR", `Remote source '${policy.sourceId}': redirect without location (HTTP ${response.status}).`, response.status);
        redirects += 1;
        if (redirects > maxRedirects) {
          throw new RemoteFetchError("TOO_MANY_REDIRECTS", `Remote source '${policy.sourceId}': exceeded ${maxRedirects} validated redirects.`);
        }
        currentUrl = new URL(location, currentUrl).toString();
        break;
      }

      if (response.status === 429) {
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        await response.body?.cancel().catch(() => undefined);
        if (attempts > maxRetries + 1) {
          throw new RemoteFetchError("RATE_LIMITED", `Remote source '${policy.sourceId}': rate limited (HTTP 429) after ${attempts} attempts.`, 429, retryAfter);
        }
        const backoff = retryAfter !== undefined ? retryAfter * 1000 : Math.min(1000 * 2 ** (attempts - 1), 8000);
        await sleep(backoff);
        continue;
      }

      if (response.status >= 500 && response.status < 600 && attempts <= maxRetries + 1 && attempts <= 3) {
        await response.body?.cancel().catch(() => undefined);
        await sleep(Math.min(1000 * 2 ** (attempts - 1), 8000));
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel().catch(() => undefined);
        throw new RemoteFetchError("HTTP_ERROR", `Remote source '${policy.sourceId}': HTTP ${response.status}. [REDACTED]`, response.status);
      }

      const { text, bytes } = await readBoundedBody(response, maxBytes, policy.sourceId);
      return {
        httpStatus: response.status,
        notModified: false,
        headers: {
          etag: response.headers.get("etag") || undefined,
          lastModified: response.headers.get("last-modified") || undefined,
          cacheControl: response.headers.get("cache-control") || undefined,
          retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
          rateLimit: {
            limit: response.headers.get("x-ratelimit-limit") || undefined,
            remaining: response.headers.get("x-ratelimit-remaining") || undefined,
            reset: response.headers.get("x-ratelimit-reset") || undefined,
            observed429: false,
            source: `Remote source ${policy.sourceId}`,
          },
        },
        text,
        bytes,
        attempts,
        destination: redactUrl(originOf(currentUrl)),
      };
    }
  }
}

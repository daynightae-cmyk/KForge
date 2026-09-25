import { lookup } from "dns/promises";
import type { ProviderAdapterKind } from "../../shared/providerCommandCenter";
import { isBlockedIPv4, isBlockedIPv6 } from "./remoteSources/fetchPolicy";

export const MAX_PROVIDER_JSON_BYTES = 8 * 1024 * 1024;
export const MAX_PROVIDER_ERROR_BYTES = 32 * 1024;
export const MAX_PROVIDER_STREAM_BYTES = 64 * 1024 * 1024;

const LOCAL_PROVIDER_KINDS = new Set<ProviderAdapterKind>(["ollama", "lm-studio", "llama-cpp"]);
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLocalProviderKind(kind: ProviderAdapterKind): boolean {
  return LOCAL_PROVIDER_KINDS.has(kind);
}

function isIpv4Literal(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isIpv6Literal(host: string): boolean {
  return /^\[.*\]$/.test(host) || host.includes(":");
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function isLoopbackHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (LOOPBACK_HOSTNAMES.has(host) || LOOPBACK_HOSTNAMES.has(hostname.toLowerCase())) return true;
  if (isIpv4Literal(host)) return host.startsWith("127.");
  return host === "::1";
}

export class ProviderRequestRefused extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "ProviderRequestRefused";
    this.reason = reason;
  }
}

export interface ProviderDestinationOptions {
  kind: ProviderAdapterKind;
  /** Hostname resolution is skipped for injected test fetchers so unit tests stay hermetic. */
  resolveHostnames: boolean;
  resolver?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
}

async function assertResolvedAddresses(hostname: string, options: ProviderDestinationOptions): Promise<void> {
  const resolver = options.resolver ?? (async (host: string) => (await lookup(host, { all: true })).map((entry) => ({ address: entry.address, family: entry.family })));
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new ProviderRequestRefused(`Provider host '${hostname}' could not be resolved. No request was made.`);
  }
  if (!addresses.length) throw new ProviderRequestRefused(`Provider host '${hostname}' resolved to no addresses. No request was made.`);
  const allowLoopback = isLocalProviderKind(options.kind);
  for (const entry of addresses) {
    const address = entry.address.replace(/^\[|\]$/g, "");
    const blocked = entry.family === 6 || isIpv6Literal(address) ? isBlockedIPv6(address) : isBlockedIPv4(address);
    if (!blocked) continue;
    if (allowLoopback && isLoopbackHost(address)) continue;
    throw new ProviderRequestRefused(`Provider host '${hostname}' resolves to a blocked address (${address}). Private, loopback, link-local and cloud-metadata destinations are refused.`);
  }
}

/**
 * Provider endpoints are operator-configured, so they cannot use a fixed
 * origin allow-list. What still holds is that only declared local runtimes may
 * address loopback, and no provider may address private, link-local or
 * cloud-metadata ranges through a public hostname.
 */
export async function assertProviderDestination(url: string, options: ProviderDestinationOptions): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ProviderRequestRefused("Provider endpoint is not a valid absolute URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ProviderRequestRefused("Provider endpoint must use http or https.");
  }
  if (parsed.username || parsed.password) {
    throw new ProviderRequestRefused("Provider endpoint must not embed credentials.");
  }
  const hostname = normalizeHost(parsed.hostname);
  if (!hostname) throw new ProviderRequestRefused("Provider endpoint has no host.");
  const loopbackDestination = isLoopbackHost(hostname);
  if (isIpv4Literal(hostname)) {
    if (isBlockedIPv4(hostname) && !(loopbackDestination && isLocalProviderKind(options.kind))) {
      throw new ProviderRequestRefused(`Provider endpoint address ${hostname} is blocked. Private, loopback, link-local and cloud-metadata destinations are refused.`);
    }
    return;
  }
  if (isIpv6Literal(hostname)) {
    if (isBlockedIPv6(hostname) && !(loopbackDestination && isLocalProviderKind(options.kind))) {
      throw new ProviderRequestRefused(`Provider endpoint address ${hostname} is blocked. Private, loopback, link-local and cloud-metadata destinations are refused.`);
    }
    return;
  }
  if (hostname === "localhost") {
    if (!isLocalProviderKind(options.kind)) {
      throw new ProviderRequestRefused("Provider endpoint 'localhost' is only allowed for declared local model runtimes.");
    }
    return;
  }
  if (options.resolveHostnames) await assertResolvedAddresses(hostname, options);
}

export async function providerRequest(
  url: string,
  init: RequestInit,
  kind: ProviderAdapterKind,
  fetcher: typeof fetch,
): Promise<Response> {
  const resolveHostnames = fetcher === globalThis.fetch;
  await assertProviderDestination(url, { kind, resolveHostnames });
  const response = await fetcher(url, { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    const destination = location ? ` to ${safeLocationLabel(location)}` : "";
    throw new ProviderRequestRefused(`Provider endpoint redirected (HTTP ${response.status})${destination}. Configure the final provider URL instead of following redirects.`);
  }
  return response;
}

function safeLocationLabel(location: string): string {
  try {
    return new URL(location, "https://invalid.local").origin.slice(0, 200);
  } catch {
    return "[unparsable location]";
  }
}

export async function readBoundedProviderText(response: Response, maxBytes = MAX_PROVIDER_ERROR_BYTES): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new ProviderRequestRefused(`Provider response exceeds the ${maxBytes} byte bound.`);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new ProviderRequestRefused(`Provider response exceeds the ${maxBytes} byte bound.`);
    }
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ProviderRequestRefused(`Provider response exceeds the ${maxBytes} byte bound.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export async function readBoundedProviderJson(response: Response): Promise<unknown> {
  return JSON.parse(await readBoundedProviderText(response, MAX_PROVIDER_JSON_BYTES));
}

export interface BoundedProviderStreamReader {
  read(): Promise<ReadableStreamReadResult<Uint8Array>>;
  cancel(reason?: unknown): Promise<void>;
  releaseLock(): void;
}

export function boundedProviderStreamReader(
  response: Response,
  maxBytes = MAX_PROVIDER_STREAM_BYTES,
): BoundedProviderStreamReader {
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderRequestRefused("Provider response exposed no readable stream body.");
  let total = 0;
  return {
    async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
      const chunk = await reader.read();
      if (chunk.done || !chunk.value) return chunk;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ProviderRequestRefused(`Provider stream exceeds the ${maxBytes} byte bound.`);
      }
      return chunk;
    },
    async cancel(reason?: unknown): Promise<void> {
      await reader.cancel(reason).catch(() => undefined);
    },
    releaseLock(): void {
      try {
        reader.releaseLock();
      } catch {
        return;
      }
    },
  };
}

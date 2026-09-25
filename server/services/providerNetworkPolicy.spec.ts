import { describe, expect, it, vi } from "vitest";
import { assertProviderDestination, boundedProviderStreamReader, isLocalProviderKind, ProviderRequestRefused, providerRequest, readBoundedProviderJson, readBoundedProviderText, MAX_PROVIDER_ERROR_BYTES, MAX_PROVIDER_JSON_BYTES } from "./providerNetworkPolicy";

const blockedResolver = async () => [{ address: "169.254.169.254", family: 4 }];
const publicResolver = async () => [{ address: "93.184.216.34", family: 4 }];

describe("provider destination policy", () => {
  it("classifies declared local runtimes as the only loopback-capable kinds", () => {
    expect(isLocalProviderKind("ollama")).toBe(true);
    expect(isLocalProviderKind("lm-studio")).toBe(true);
    expect(isLocalProviderKind("llama-cpp")).toBe(true);
    expect(isLocalProviderKind("openai")).toBe(false);
    expect(isLocalProviderKind("openai-compatible")).toBe(false);
    expect(isLocalProviderKind("anthropic")).toBe(false);
    expect(isLocalProviderKind("gemini")).toBe(false);
  });

  it("refuses non-http(s) and credential-embedding provider endpoints", async () => {
    await expect(assertProviderDestination("file:///C:/Windows/System32/cmd.exe", { kind: "openai", resolveHostnames: false })).rejects.toBeInstanceOf(ProviderRequestRefused);
    await expect(assertProviderDestination("https://user:secret@api.example.com/v1", { kind: "openai", resolveHostnames: false })).rejects.toThrow(/must not embed credentials/);
    await expect(assertProviderDestination("not-a-url", { kind: "openai", resolveHostnames: false })).rejects.toThrow(/valid absolute URL/);
  });

  it("refuses cloud providers pointed at loopback, private and cloud-metadata literals", async () => {
    for (const url of ["http://127.0.0.1:11434/v1", "http://localhost:1234/v1", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/v1", "http://192.168.1.9/v1", "http://[::1]:1234/v1", "http://0.0.0.0:8080"]) {
      await expect(assertProviderDestination(url, { kind: "openai", resolveHostnames: false })).rejects.toBeInstanceOf(ProviderRequestRefused);
    }
  });

  it("allows loopback only for declared local model runtimes", async () => {
    await expect(assertProviderDestination("http://127.0.0.1:11434", { kind: "ollama", resolveHostnames: false })).resolves.toBeUndefined();
    await expect(assertProviderDestination("http://localhost:1234/v1", { kind: "lm-studio", resolveHostnames: false })).resolves.toBeUndefined();
    await expect(assertProviderDestination("http://[::1]:1234/v1", { kind: "llama-cpp", resolveHostnames: false })).resolves.toBeUndefined();
    await expect(assertProviderDestination("http://169.254.169.254/", { kind: "ollama", resolveHostnames: false })).rejects.toBeInstanceOf(ProviderRequestRefused);
    await expect(assertProviderDestination("http://192.168.0.10:1234", { kind: "ollama", resolveHostnames: false })).rejects.toBeInstanceOf(ProviderRequestRefused);
    await expect(assertProviderDestination("http://0.0.0.0:11434", { kind: "ollama", resolveHostnames: false })).rejects.toBeInstanceOf(ProviderRequestRefused);
  });

  it("refuses public hostnames that resolve to blocked ranges when the real network stack is used", async () => {
    await expect(assertProviderDestination("https://provider.example/v1", { kind: "openai", resolveHostnames: true, resolver: blockedResolver })).rejects.toThrow(/blocked address \(169\.254\.169\.254\)/);
    await expect(assertProviderDestination("https://provider.example/v1", { kind: "openai", resolveHostnames: true, resolver: publicResolver })).resolves.toBeUndefined();
    await expect(assertProviderDestination("https://provider.example/v1", { kind: "openai", resolveHostnames: true, resolver: async () => { throw new Error("ENOTFOUND"); } })).rejects.toThrow(/could not be resolved/);
  });

  it("refuses provider redirects instead of following them to an unvalidated host", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data?token=secret" } })) as unknown as typeof fetch;
    await expect(providerRequest("https://api.openai.com/v1/models", {}, "openai", fetcher)).rejects.toThrow(/redirected \(HTTP 302\)/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(providerRequest("https://api.openai.com/v1/models", {}, "openai", fetcher)).rejects.toThrow(/169\.254\.169\.254/);
  });

  it("never sends provider requests to a blocked literal destination", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    await expect(providerRequest("http://169.254.169.254/latest/meta-data", {}, "openai", fetcher)).rejects.toBeInstanceOf(ProviderRequestRefused);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("passes same-host requests through with manual redirect handling", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const response = await providerRequest("https://api.openai.com/v1/models", { headers: { Accept: "application/json" } }, "openai", fetcher);
    expect(response.status).toBe(200);
  });

  it("bounds provider JSON bodies instead of parsing an unbounded remote payload", async () => {
    const small = await readBoundedProviderJson(new Response(JSON.stringify({ data: [1, 2] }), { status: 200 }));
    expect(small).toEqual({ data: [1, 2] });

    const oversized = new Response("x".repeat(MAX_PROVIDER_JSON_BYTES + 1), { status: 200, headers: { "content-type": "application/json" } });
    await expect(readBoundedProviderJson(oversized)).rejects.toThrow(/byte bound/);

    const declared = new Response("{}", { status: 200, headers: { "content-type": "application/json", "content-length": String(MAX_PROVIDER_JSON_BYTES + 1) } });
    await expect(readBoundedProviderJson(declared)).rejects.toThrow(/byte bound/);

    const oversizedError = new Response("e".repeat(MAX_PROVIDER_ERROR_BYTES + 1), { status: 500 });
    await expect(readBoundedProviderText(oversizedError)).rejects.toThrow(/byte bound/);
  });

  it("bounds a provider stream instead of accumulating an unbounded response", async () => {
    const withinBound = boundedProviderStreamReader(new Response("ab".repeat(4), { status: 200 }));
    let total = 0;
    for (;;) {
      const chunk = await withinBound.read();
      if (chunk.done) break;
      total += chunk.value?.byteLength || 0;
    }
    expect(total).toBe(8);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(4));
        controller.close();
      },
    });
    const capped = boundedProviderStreamReader(new Response(stream, { status: 200 }), 4);
    await expect(capped.read()).resolves.toMatchObject({ done: false });
    await expect(capped.read()).rejects.toThrow(/byte bound/);

    expect(() => boundedProviderStreamReader(new Response(null, { status: 204 }))).toThrow(/no readable stream body/);
  });
});

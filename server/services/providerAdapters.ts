import { normalizeModelRecord, normalizeProviderError, type CanonicalModel, type NormalizedErrorKind, type ProviderAdapterKind } from "../../shared/providerCommandCenter";

export interface AdapterContext {
  baseUrl: string;
  credential: string;
  organization?: string | null;
  customHeaders?: Record<string, string>;
  timeoutMs: number;
  modelsEndpointOverride?: string | null;
  chatEndpointOverride?: string | null;
}

export interface CanonicalUsage {
  input: number | null;
  output: number | null;
  reasoning: number | null;
  cached: number | null;
  total: number | null;
}

export interface ToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ModelResponse {
  text: string;
  toolCalls: ToolCallRequest[];
  usage: CanonicalUsage;
  finishReason: string | null;
  requestId: string | null;
  latencyMs: number;
  model: string;
}

export interface ModelTestEvidence {
  ok: boolean;
  latencyMs: number;
  ttftMs: number | null;
  outputPreview: string | null;
  usage: CanonicalUsage;
  finishReason: string | null;
  requestId: string | null;
  httpStatus: number | null;
  errorKind: NormalizedErrorKind | null;
  errorDetail: string | null;
}

export interface StreamingTestEvidence extends ModelTestEvidence {
  eventCount: number;
  terminalOk: boolean;
}

export type ToolVerdict = "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN" | "FAILED";

export interface ToolTestEvidence {
  verdict: ToolVerdict;
  latencyMs: number;
  observedToolCall: ToolCallRequest | null;
  httpStatus: number | null;
  errorKind: NormalizedErrorKind | null;
  detail: string;
}

export interface ProviderAdapter {
  kind: ProviderAdapterKind;
  authHeaders(ctx: AdapterContext): Record<string, string>;
  discoveryUrl(ctx: AdapterContext): string;
  validateConfiguration(ctx: AdapterContext): Promise<{ ok: boolean; reason: string }>;
  testConnection(ctx: AdapterContext, fetcher?: typeof fetch): Promise<{ ok: boolean; latencyMs: number; httpStatus: number | null; errorKind: NormalizedErrorKind | null; errorDetail: string | null; requestId: string | null }>;
  listModels(ctx: AdapterContext, fetcher?: typeof fetch): Promise<CanonicalModel[]>;
  testModel(ctx: AdapterContext, model: string, fetcher?: typeof fetch): Promise<ModelTestEvidence>;
  testStreaming(ctx: AdapterContext, model: string, fetcher?: typeof fetch): Promise<StreamingTestEvidence>;
  testTools(ctx: AdapterContext, model: string, fetcher?: typeof fetch): Promise<ToolTestEvidence>;
  createResponse(ctx: AdapterContext, model: string, system: string, user: string, fetcher?: typeof fetch): Promise<ModelResponse>;
  normalizeUsage(raw: unknown): CanonicalUsage;
  normalizeError(status: number | null, message: string): NormalizedErrorKind;
}

export const HARMLESS_MODEL_PROMPT = "Reply with exactly: KFORGE-OK";
export const TOOL_PROBE_NAME = "kforge_capability_probe";

function withTimeout(ms: number) {
  return AbortSignal.timeout(Math.min(60_000, Math.max(2_000, ms)));
}

function requestIdOf(response: Response): string | null {
  for (const name of ["x-request-id", "request-id", "x-requestid", "openai-request-id", "anthropic-request-id"]) {
    const value = response.headers.get(name);
    if (value) return value;
  }
  return null;
}

function openAIUsage(raw: unknown): CanonicalUsage {
  const usage = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).usage : null;
  const record = typeof usage === "object" && usage !== null ? (usage as Record<string, unknown>) : {};
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return {
    input: number(record.prompt_tokens),
    output: number(record.completion_tokens),
    reasoning: number((record.completion_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens),
    cached: number((record.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens),
    total: number(record.total_tokens),
  };
}

function sseEvents(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((payload) => payload.length > 0);
}

function openAIToolCalls(choice: unknown): ToolCallRequest[] {
  const message = typeof choice === "object" && choice !== null ? (choice as { message?: unknown }).message : null;
  const calls = typeof message === "object" && message !== null ? (message as { tool_calls?: unknown }).tool_calls : null;
  if (!Array.isArray(calls)) return [];
  return calls.flatMap((call) => {
    if (typeof call !== "object" || call === null) return [];
    const fn = (call as { function?: unknown }).function;
    if (typeof fn !== "object" || fn === null) return [];
    const record = fn as { name?: unknown; arguments?: unknown };
    if (typeof record.name !== "string") return [];
    let args: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(typeof record.arguments === "string" ? record.arguments : "{}");
      if (typeof parsed === "object" && parsed !== null) args = parsed as Record<string, unknown>;
    } catch {
      /* unparseable tool arguments are preserved as empty */
    }
    return [{ name: record.name, arguments: args }];
  });
}

function toolProbeSchema() {
  return [{ type: "function", function: { name: TOOL_PROBE_NAME, description: "KForge capability probe. Never executes anything.", parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] } } }];
}

async function readJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function failEvidence(latencyMs: number, httpStatus: number | null, message: string): ModelTestEvidence {
  const errorKind = normalizeProviderError(httpStatus, message);
  return { ok: false, latencyMs, ttftMs: null, outputPreview: null, usage: { input: null, output: null, reasoning: null, cached: null, total: null }, finishReason: null, requestId: null, httpStatus, errorKind, errorDetail: message };
}

const openAICompatible: ProviderAdapter = {
  kind: "openai-compatible",
  authHeaders: (ctx) => ({ "Content-Type": "application/json", Authorization: `Bearer ${ctx.credential}`, ...ctx.customHeaders }),
  discoveryUrl: (ctx) => ctx.modelsEndpointOverride || `${ctx.baseUrl.replace(/\/+$/, "")}/models`,
  async validateConfiguration(ctx) {
    if (!/^https?:\/\//i.test(ctx.baseUrl)) return { ok: false, reason: "Base URL must be an http(s) URL." };
    if (!ctx.credential.trim()) return { ok: false, reason: "NOT_CONFIGURED: credential is missing." };
    return { ok: true, reason: "Configuration is structurally valid." };
  },
  async testConnection(ctx, fetcher = fetch) {
    const started = Date.now();
    try {
      const response = await fetcher(this.discoveryUrl(ctx), { headers: this.authHeaders(ctx), signal: withTimeout(ctx.timeoutMs) });
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        const detail = `Connection probe failed with HTTP ${response.status}.`;
        return { ok: false, latencyMs, httpStatus: response.status, errorKind: normalizeProviderError(response.status, detail), errorDetail: detail, requestId: requestIdOf(response) };
      }
      return { ok: true, latencyMs, httpStatus: response.status, errorKind: null, errorDetail: null, requestId: requestIdOf(response) };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Connection probe failed.";
      return { ok: false, latencyMs: Date.now() - started, httpStatus: null, errorKind: normalizeProviderError(null, detail), errorDetail: detail, requestId: null };
    }
  },
  async listModels(ctx, fetcher = fetch) {
    const response = await fetcher(this.discoveryUrl(ctx), { headers: this.authHeaders(ctx), signal: withTimeout(ctx.timeoutMs) });
    if (!response.ok) throw new Error(`Discovery failed with HTTP ${response.status}.`);
    const payload = (await readJsonSafe(response)) as { data?: unknown[] };
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const nowIso = new Date().toISOString();
    return rows.filter((row) => typeof row === "object" && row !== null).map((row) => normalizeModelRecord("custom", row, nowIso));
  },
  async testModel(ctx, model, fetcher = fetch) {
    const started = Date.now();
    const url = ctx.chatEndpointOverride || `${ctx.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    try {
      const response = await fetcher(url, {
        method: "POST",
        headers: this.authHeaders(ctx),
        body: JSON.stringify({ model, temperature: 0, max_tokens: 16, messages: [{ role: "user", content: HARMLESS_MODEL_PROMPT }] }),
        signal: withTimeout(ctx.timeoutMs),
      });
      const latencyMs = Date.now() - started;
      if (!response.ok) return failEvidence(latencyMs, response.status, `Model test failed with HTTP ${response.status}.`);
      const data = (await readJsonSafe(response)) as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> };
      const output = data?.choices?.[0]?.message?.content;
      const text = typeof output === "string" ? output : "";
      return { ok: true, latencyMs, ttftMs: latencyMs, outputPreview: text.slice(0, 200), usage: openAIUsage(data), finishReason: data?.choices?.[0]?.finish_reason || null, requestId: requestIdOf(response), httpStatus: response.status, errorKind: null, errorDetail: null };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Model test failed.";
      return failEvidence(Date.now() - started, null, detail);
    }
  },
  async testStreaming(ctx, model, fetcher = fetch) {
    const started = Date.now();
    const url = ctx.chatEndpointOverride || `${ctx.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    try {
      const response = await fetcher(url, {
        method: "POST",
        headers: { ...this.authHeaders(ctx), Accept: "text/event-stream" },
        body: JSON.stringify({ model, temperature: 0, max_tokens: 16, stream: true, messages: [{ role: "user", content: HARMLESS_MODEL_PROMPT }] }),
        signal: withTimeout(ctx.timeoutMs),
      });
      if (!response.ok) return { ...failEvidence(Date.now() - started, response.status, `Stream test failed with HTTP ${response.status}.`), eventCount: 0, terminalOk: false };
      const text = await response.text();
      const events = sseEvents(text).filter((payload) => payload !== "[DONE]");
      const terminalOk = /\[DONE\]/.test(text) || events.length > 0;
      const latencyMs = Date.now() - started;
      return { ok: events.length > 0 && terminalOk, latencyMs, ttftMs: latencyMs, outputPreview: events[0]?.slice(0, 200) || null, usage: { input: null, output: null, reasoning: null, cached: null, total: null }, finishReason: terminalOk ? "stop" : null, requestId: requestIdOf(response), httpStatus: response.status, errorKind: events.length ? null : "STREAM_INTERRUPTED", errorDetail: events.length ? null : "Stream completed with no valid events.", eventCount: events.length, terminalOk };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Stream test failed.";
      return { ...failEvidence(Date.now() - started, null, detail), eventCount: 0, terminalOk: false };
    }
  },
  async testTools(ctx, model, fetcher = fetch) {
    const started = Date.now();
    const url = ctx.chatEndpointOverride || `${ctx.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    try {
      const response = await fetcher(url, {
        method: "POST",
        headers: this.authHeaders(ctx),
        body: JSON.stringify({ model, temperature: 0, max_tokens: 32, messages: [{ role: "user", content: "Invoke the capability probe tool." }], tools: toolProbeSchema(), tool_choice: "auto" }),
        signal: withTimeout(ctx.timeoutMs),
      });
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        if (response.status === 400 && /tool|function/i.test(body)) {
          return { verdict: "UNSUPPORTED", latencyMs, observedToolCall: null, httpStatus: response.status, errorKind: null, detail: "Provider rejected tool schema; tools are UNSUPPORTED for this model." };
        }
        return { verdict: "FAILED", latencyMs, observedToolCall: null, httpStatus: response.status, errorKind: normalizeProviderError(response.status, body), detail: `Tool probe failed with HTTP ${response.status}.` };
      }
      const data = (await readJsonSafe(response)) as { choices?: unknown[] };
      const calls = openAIToolCalls(data?.choices?.[0]);
      const probe = calls.find((call) => call.name === TOOL_PROBE_NAME);
      if (probe) return { verdict: "SUPPORTED", latencyMs, observedToolCall: probe, httpStatus: response.status, errorKind: null, detail: "Model returned a structured kforge_capability_probe invocation." };
      return { verdict: "UNKNOWN", latencyMs, observedToolCall: null, httpStatus: response.status, errorKind: null, detail: "Provider accepted the tool schema but returned no probe invocation." };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Tool probe failed.";
      return { verdict: "FAILED", latencyMs: Date.now() - started, observedToolCall: null, httpStatus: null, errorKind: normalizeProviderError(null, detail), detail };
    }
  },
  async createResponse(ctx, model, system, user, fetcher = fetch) {
    const started = Date.now();
    const url = ctx.chatEndpointOverride || `${ctx.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const response = await fetcher(url, {
      method: "POST",
      headers: this.authHeaders(ctx),
      body: JSON.stringify({ model, temperature: 0.1, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      signal: withTimeout(120_000),
    });
    if (!response.ok) throw new Error(`Generation failed with HTTP ${response.status}.`);
    const data = (await readJsonSafe(response)) as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> };
    const content = data?.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content.trim() : "";
    if (!text && openAIToolCalls(data?.choices?.[0]).length === 0) throw new Error("Provider returned no content.");
    return { text, toolCalls: openAIToolCalls(data?.choices?.[0]), usage: openAIUsage(data), finishReason: data?.choices?.[0]?.finish_reason || null, requestId: requestIdOf(response), latencyMs: Date.now() - started, model };
  },
  normalizeUsage: openAIUsage,
  normalizeError: (status, message) => normalizeProviderError(status, message),
};

function anthropicHeaders(ctx: AdapterContext): Record<string, string> {
  return { "Content-Type": "application/json", "x-api-key": ctx.credential, "anthropic-version": "2023-06-01", ...ctx.customHeaders };
}

const anthropicAdapter: ProviderAdapter = {
  kind: "anthropic",
  authHeaders: anthropicHeaders,
  discoveryUrl: (ctx) => ctx.modelsEndpointOverride || `${ctx.baseUrl.replace(/\/+$/, "")}/models`,
  async validateConfiguration(ctx) {
    if (!ctx.credential.trim()) return { ok: false, reason: "NOT_CONFIGURED: credential is missing." };
    return { ok: true, reason: "Configuration is structurally valid." };
  },
  async testConnection(ctx, fetcher = fetch) {
    const started = Date.now();
    try {
      const response = await fetcher(this.discoveryUrl(ctx), { headers: anthropicHeaders(ctx), signal: withTimeout(ctx.timeoutMs) });
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        const detail = `Connection probe failed with HTTP ${response.status}.`;
        return { ok: false, latencyMs, httpStatus: response.status, errorKind: normalizeProviderError(response.status, detail), errorDetail: detail, requestId: requestIdOf(response) };
      }
      return { ok: true, latencyMs, httpStatus: response.status, errorKind: null, errorDetail: null, requestId: requestIdOf(response) };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Connection probe failed.";
      return { ok: false, latencyMs: Date.now() - started, httpStatus: null, errorKind: normalizeProviderError(null, detail), errorDetail: detail, requestId: null };
    }
  },
  async listModels(ctx, fetcher = fetch) {
    const response = await fetcher(this.discoveryUrl(ctx), { headers: anthropicHeaders(ctx), signal: withTimeout(ctx.timeoutMs) });
    if (!response.ok) throw new Error(`Discovery failed with HTTP ${response.status}.`);
    const payload = (await readJsonSafe(response)) as { data?: unknown[] };
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const nowIso = new Date().toISOString();
    return rows.filter((row) => typeof row === "object" && row !== null).map((row) => normalizeModelRecord("anthropic", row, nowIso));
  },
  async testModel(ctx, model, fetcher = fetch) {
    const started = Date.now();
    try {
      const response = await fetcher(`${ctx.baseUrl.replace(/\/+$/, "")}/messages`, {
        method: "POST",
        headers: anthropicHeaders(ctx),
        body: JSON.stringify({ model, max_tokens: 16, system: "Follow instructions exactly.", messages: [{ role: "user", content: HARMLESS_MODEL_PROMPT }] }),
        signal: withTimeout(ctx.timeoutMs),
      });
      const latencyMs = Date.now() - started;
      if (!response.ok) return failEvidence(latencyMs, response.status, `Model test failed with HTTP ${response.status}.`);
      const data = (await readJsonSafe(response)) as { content?: Array<{ type?: string; text?: string }>; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number }; id?: string };
      const text = (data?.content || []).filter((part) => part.type === "text").map((part) => part.text || "").join("");
      const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
      return { ok: true, latencyMs, ttftMs: latencyMs, outputPreview: text.slice(0, 200), usage: { input: number(data?.usage?.input_tokens), output: number(data?.usage?.output_tokens), reasoning: null, cached: null, total: number(data?.usage?.input_tokens) !== null && number(data?.usage?.output_tokens) !== null ? (number(data?.usage?.input_tokens) || 0) + (number(data?.usage?.output_tokens) || 0) : null }, finishReason: data?.stop_reason || null, requestId: typeof data?.id === "string" ? data.id : requestIdOf(response), httpStatus: response.status, errorKind: null, errorDetail: null };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Model test failed.";
      return failEvidence(Date.now() - started, null, detail);
    }
  },
  async testStreaming(ctx, model, fetcher = fetch) {
    const started = Date.now();
    try {
      const response = await fetcher(`${ctx.baseUrl.replace(/\/+$/, "")}/messages`, {
        method: "POST",
        headers: { ...anthropicHeaders(ctx), Accept: "text/event-stream" },
        body: JSON.stringify({ model, max_tokens: 16, stream: true, system: "Follow instructions exactly.", messages: [{ role: "user", content: HARMLESS_MODEL_PROMPT }] }),
        signal: withTimeout(ctx.timeoutMs),
      });
      if (!response.ok) return { ...failEvidence(Date.now() - started, response.status, `Stream test failed with HTTP ${response.status}.`), eventCount: 0, terminalOk: false };
      const text = await response.text();
      const events = sseEvents(text);
      const terminalOk = /message_stop/.test(text) && events.length > 0;
      const latencyMs = Date.now() - started;
      return { ok: events.length > 0 && terminalOk, latencyMs, ttftMs: latencyMs, outputPreview: events[0]?.slice(0, 200) || null, usage: { input: null, output: null, reasoning: null, cached: null, total: null }, finishReason: terminalOk ? "end_turn" : null, requestId: requestIdOf(response), httpStatus: response.status, errorKind: events.length ? null : "STREAM_INTERRUPTED", errorDetail: events.length ? null : "Stream completed with no valid events.", eventCount: events.length, terminalOk };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Stream test failed.";
      return { ...failEvidence(Date.now() - started, null, detail), eventCount: 0, terminalOk: false };
    }
  },
  async testTools(ctx, model, fetcher = fetch) {
    const started = Date.now();
    try {
      const response = await fetcher(`${ctx.baseUrl.replace(/\/+$/, "")}/messages`, {
        method: "POST",
        headers: anthropicHeaders(ctx),
        body: JSON.stringify({ model, max_tokens: 32, tools: [{ name: TOOL_PROBE_NAME, description: "KForge capability probe. Never executes anything.", input_schema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] } }], messages: [{ role: "user", content: "Invoke the capability probe tool." }] }),
        signal: withTimeout(ctx.timeoutMs),
      });
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        if (response.status === 400 && /tool/i.test(body)) {
          return { verdict: "UNSUPPORTED", latencyMs, observedToolCall: null, httpStatus: response.status, errorKind: null, detail: "Provider rejected tool schema; tools are UNSUPPORTED for this model." };
        }
        return { verdict: "FAILED", latencyMs, observedToolCall: null, httpStatus: response.status, errorKind: normalizeProviderError(response.status, body), detail: `Tool probe failed with HTTP ${response.status}.` };
      }
      const data = (await readJsonSafe(response)) as { content?: Array<{ type?: string; name?: string; input?: unknown }> };
      const use = (data?.content || []).find((part) => part.type === "tool_use" && part.name === TOOL_PROBE_NAME);
      if (use) return { verdict: "SUPPORTED", latencyMs, observedToolCall: { name: TOOL_PROBE_NAME, arguments: typeof use.input === "object" && use.input !== null ? (use.input as Record<string, unknown>) : {} }, httpStatus: response.status, errorKind: null, detail: "Model returned a structured kforge_capability_probe invocation." };
      return { verdict: "UNKNOWN", latencyMs, observedToolCall: null, httpStatus: response.status, errorKind: null, detail: "Provider accepted tools but returned no probe invocation." };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Tool probe failed.";
      return { verdict: "FAILED", latencyMs: Date.now() - started, observedToolCall: null, httpStatus: null, errorKind: normalizeProviderError(null, detail), detail };
    }
  },
  async createResponse(ctx, model, system, user, fetcher = fetch) {
    const started = Date.now();
    const response = await fetcher(`${ctx.baseUrl.replace(/\/+$/, "")}/messages`, {
      method: "POST",
      headers: anthropicHeaders(ctx),
      body: JSON.stringify({ model, max_tokens: 2_048, system, messages: [{ role: "user", content: user }] }),
      signal: withTimeout(120_000),
    });
    if (!response.ok) throw new Error(`Generation failed with HTTP ${response.status}.`);
    const data = (await readJsonSafe(response)) as { content?: Array<{ type?: string; text?: string; name?: string; input?: unknown }>; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number }; id?: string };
    const text = (data?.content || []).filter((part) => part.type === "text").map((part) => part.text || "").join("").trim();
    const toolCalls = (data?.content || []).filter((part) => part.type === "tool_use" && typeof part.name === "string").map((part) => ({ name: part.name as string, arguments: typeof part.input === "object" && part.input !== null ? (part.input as Record<string, unknown>) : {} }));
    if (!text && toolCalls.length === 0) throw new Error("Provider returned no content.");
    const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    return { text, toolCalls, usage: { input: number(data?.usage?.input_tokens), output: number(data?.usage?.output_tokens), reasoning: null, cached: null, total: null }, finishReason: data?.stop_reason || null, requestId: typeof data?.id === "string" ? data.id : requestIdOf(response), latencyMs: Date.now() - started, model };
  },
  normalizeUsage(raw: unknown) {
    const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    return { input: number(record.input_tokens), output: number(record.output_tokens), reasoning: null, cached: null, total: null };
  },
  normalizeError: (status, message) => normalizeProviderError(status, message),
};

function geminiHeaders(ctx: AdapterContext): Record<string, string> {
  return { "Content-Type": "application/json", "x-goog-api-key": ctx.credential, ...ctx.customHeaders };
}

const geminiAdapter: ProviderAdapter = {
  kind: "gemini",
  authHeaders: geminiHeaders,
  discoveryUrl: (ctx) => ctx.modelsEndpointOverride || `${ctx.baseUrl.replace(/\/+$/, "")}/models`,
  async validateConfiguration(ctx) {
    if (!ctx.credential.trim()) return { ok: false, reason: "NOT_CONFIGURED: credential is missing." };
    return { ok: true, reason: "Configuration is structurally valid." };
  },
  async testConnection(ctx, fetcher = fetch) {
    const started = Date.now();
    try {
      const response = await fetcher(this.discoveryUrl(ctx), { headers: geminiHeaders(ctx), signal: withTimeout(ctx.timeoutMs) });
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        const detail = `Connection probe failed with HTTP ${response.status}.`;
        return { ok: false, latencyMs, httpStatus: response.status, errorKind: normalizeProviderError(response.status, detail), errorDetail: detail, requestId: requestIdOf(response) };
      }
      return { ok: true, latencyMs, httpStatus: response.status, errorKind: null, errorDetail: null, requestId: requestIdOf(response) };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Connection probe failed.";
      return { ok: false, latencyMs: Date.now() - started, httpStatus: null, errorKind: normalizeProviderError(null, detail), errorDetail: detail, requestId: null };
    }
  },
  async listModels(ctx, fetcher = fetch) {
    const response = await fetcher(this.discoveryUrl(ctx), { headers: geminiHeaders(ctx), signal: withTimeout(ctx.timeoutMs) });
    if (!response.ok) throw new Error(`Discovery failed with HTTP ${response.status}.`);
    const payload = (await readJsonSafe(response)) as { models?: unknown[] };
    const rows = Array.isArray(payload?.models) ? payload.models : [];
    const nowIso = new Date().toISOString();
    return rows.filter((row) => typeof row === "object" && row !== null).map((row) => normalizeModelRecord("gemini", row, nowIso));
  },
  async testModel(ctx, model, fetcher = fetch) {
    const started = Date.now();
    try {
      const response = await fetcher(`${ctx.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: geminiHeaders(ctx),
        body: JSON.stringify({ systemInstruction: { parts: [{ text: "Follow instructions exactly." }] }, contents: [{ role: "user", parts: [{ text: HARMLESS_MODEL_PROMPT }] }], generationConfig: { temperature: 0, maxOutputTokens: 16 } }),
        signal: withTimeout(ctx.timeoutMs),
      });
      const latencyMs = Date.now() - started;
      if (!response.ok) return failEvidence(latencyMs, response.status, `Model test failed with HTTP ${response.status}.`);
      const data = (await readJsonSafe(response)) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } };
      const text = (data?.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("");
      const usage = data?.usageMetadata || {};
      const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
      return { ok: true, latencyMs, ttftMs: latencyMs, outputPreview: text.slice(0, 200), usage: { input: number(usage.promptTokenCount), output: number(usage.candidatesTokenCount), reasoning: null, cached: null, total: number(usage.totalTokenCount) }, finishReason: data?.candidates?.[0]?.finishReason || null, requestId: requestIdOf(response), httpStatus: response.status, errorKind: null, errorDetail: null };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Model test failed.";
      return failEvidence(Date.now() - started, null, detail);
    }
  },
  async testStreaming(ctx, model, fetcher = fetch) {
    const started = Date.now();
    try {
      const response = await fetcher(`${ctx.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers: { ...geminiHeaders(ctx), Accept: "text/event-stream" },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: "Follow instructions exactly." }] }, contents: [{ role: "user", parts: [{ text: HARMLESS_MODEL_PROMPT }] }], generationConfig: { temperature: 0, maxOutputTokens: 16 } }),
        signal: withTimeout(ctx.timeoutMs),
      });
      if (!response.ok) return { ...failEvidence(Date.now() - started, response.status, `Stream test failed with HTTP ${response.status}.`), eventCount: 0, terminalOk: false };
      const text = await response.text();
      const events = sseEvents(text);
      const terminalOk = events.length > 0;
      const latencyMs = Date.now() - started;
      return { ok: terminalOk, latencyMs, ttftMs: latencyMs, outputPreview: events[0]?.slice(0, 200) || null, usage: { input: null, output: null, reasoning: null, cached: null, total: null }, finishReason: terminalOk ? "STOP" : null, requestId: requestIdOf(response), httpStatus: response.status, errorKind: terminalOk ? null : "STREAM_INTERRUPTED", errorDetail: terminalOk ? null : "Stream completed with no valid events.", eventCount: events.length, terminalOk };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Stream test failed.";
      return { ...failEvidence(Date.now() - started, null, detail), eventCount: 0, terminalOk: false };
    }
  },
  async testTools(ctx, model, fetcher = fetch) {
    const started = Date.now();
    try {
      const response = await fetcher(`${ctx.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: geminiHeaders(ctx),
        body: JSON.stringify({ systemInstruction: { parts: [{ text: "Invoke the capability probe tool." }] }, contents: [{ role: "user", parts: [{ text: "Invoke the capability probe tool." }] }], tools: [{ functionDeclarations: [{ name: TOOL_PROBE_NAME, description: "KForge capability probe. Never executes anything.", parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] } }] }] }),
        signal: withTimeout(ctx.timeoutMs),
      });
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        if (response.status === 400 && /tool|function/i.test(body)) {
          return { verdict: "UNSUPPORTED", latencyMs, observedToolCall: null, httpStatus: response.status, errorKind: null, detail: "Provider rejected function declarations; tools are UNSUPPORTED for this model." };
        }
        return { verdict: "FAILED", latencyMs, observedToolCall: null, httpStatus: response.status, errorKind: normalizeProviderError(response.status, body), detail: `Tool probe failed with HTTP ${response.status}.` };
      }
      const data = (await readJsonSafe(response)) as { candidates?: Array<{ content?: { parts?: Array<{ functionCall?: { name?: string; args?: unknown } }> } }> };
      const call = (data?.candidates?.[0]?.content?.parts || []).find((part) => part.functionCall?.name === TOOL_PROBE_NAME)?.functionCall;
      if (call) return { verdict: "SUPPORTED", latencyMs, observedToolCall: { name: TOOL_PROBE_NAME, arguments: typeof call.args === "object" && call.args !== null ? (call.args as Record<string, unknown>) : {} }, httpStatus: response.status, errorKind: null, detail: "Model returned a structured kforge_capability_probe invocation." };
      return { verdict: "UNKNOWN", latencyMs, observedToolCall: null, httpStatus: response.status, errorKind: null, detail: "Provider accepted function declarations but returned no probe invocation." };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Tool probe failed.";
      return { verdict: "FAILED", latencyMs: Date.now() - started, observedToolCall: null, httpStatus: null, errorKind: normalizeProviderError(null, detail), detail };
    }
  },
  async createResponse(ctx, model, system, user, fetcher = fetch) {
    const started = Date.now();
    const response = await fetcher(`${ctx.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: geminiHeaders(ctx),
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { temperature: 0 } }),
      signal: withTimeout(120_000),
    });
    if (!response.ok) throw new Error(`Generation failed with HTTP ${response.status}.`);
    const data = (await readJsonSafe(response)) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name?: string; args?: unknown } }> }; finishReason?: string }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } };
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((part) => part.text || "").join("").trim();
    const toolCalls = parts.filter((part) => typeof part.functionCall?.name === "string").map((part) => ({ name: part.functionCall?.name as string, arguments: typeof part.functionCall?.args === "object" && part.functionCall?.args !== null ? (part.functionCall.args as Record<string, unknown>) : {} }));
    if (!text && toolCalls.length === 0) throw new Error("Provider returned no content.");
    const usage = data?.usageMetadata || {};
    const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    return { text, toolCalls, usage: { input: number(usage.promptTokenCount), output: number(usage.candidatesTokenCount), reasoning: null, cached: null, total: number(usage.totalTokenCount) }, finishReason: data?.candidates?.[0]?.finishReason || null, requestId: requestIdOf(response), latencyMs: Date.now() - started, model };
  },
  normalizeUsage(raw: unknown) {
    const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    return { input: number(record.promptTokenCount), output: number(record.candidatesTokenCount), reasoning: null, cached: null, total: number(record.totalTokenCount) };
  },
  normalizeError: (status, message) => normalizeProviderError(status, message),
};

const openRouterAdapter: ProviderAdapter = {
  ...openAICompatible,
  kind: "openrouter",
  authHeaders: (ctx) => ({ "Content-Type": "application/json", Authorization: `Bearer ${ctx.credential}`, "HTTP-Referer": "https://localhost/kforge", "X-Title": "KNOuX Forge", ...ctx.customHeaders }),
};

const openAIAdapter: ProviderAdapter = {
  ...openAICompatible,
  kind: "openai",
  discoveryUrl: (ctx) => ctx.modelsEndpointOverride || `${ctx.baseUrl.replace(/\/+$/, "")}/models`,
};

function ollamaHeaders(ctx: AdapterContext): Record<string, string> {
  return { "Content-Type": "application/json", ...ctx.customHeaders };
}

const ollamaAdapter: ProviderAdapter = {
  kind: "ollama",
  authHeaders: ollamaHeaders,
  discoveryUrl: (ctx) => ctx.modelsEndpointOverride || `${ctx.baseUrl.replace(/\/+$/, "")}/api/tags`,
  async validateConfiguration(ctx) {
    if (!/^https?:\/\//i.test(ctx.baseUrl)) return { ok: false, reason: "Base URL must be an http(s) URL." };
    return { ok: true, reason: "Local runtime requires no credential." };
  },
  async testConnection(ctx, fetcher = fetch) {
    const started = Date.now();
    try {
      const response = await fetcher(this.discoveryUrl(ctx), { headers: ollamaHeaders(ctx), signal: withTimeout(ctx.timeoutMs) });
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        const detail = `Connection probe failed with HTTP ${response.status}.`;
        return { ok: false, latencyMs, httpStatus: response.status, errorKind: normalizeProviderError(response.status, detail), errorDetail: detail, requestId: requestIdOf(response) };
      }
      return { ok: true, latencyMs, httpStatus: response.status, errorKind: null, errorDetail: null, requestId: requestIdOf(response) };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Connection probe failed.";
      return { ok: false, latencyMs: Date.now() - started, httpStatus: null, errorKind: normalizeProviderError(null, detail), errorDetail: detail, requestId: null };
    }
  },
  async listModels(ctx, fetcher = fetch) {
    const response = await fetcher(this.discoveryUrl(ctx), { headers: ollamaHeaders(ctx), signal: withTimeout(ctx.timeoutMs) });
    if (!response.ok) throw new Error(`Discovery failed with HTTP ${response.status}.`);
    const payload = (await readJsonSafe(response)) as { models?: unknown[] };
    const rows = Array.isArray(payload?.models) ? payload.models : [];
    const nowIso = new Date().toISOString();
    return rows
      .filter((row) => typeof row === "object" && row !== null)
      .map((row) => {
        const record = row as Record<string, unknown>;
        return normalizeModelRecord("ollama", { id: record.name, name: record.name, context_length: (record.details as Record<string, unknown> | undefined)?.context_length }, nowIso);
      });
  },
  async testModel(ctx, model, fetcher = fetch) {
    const started = Date.now();
    try {
      const response = await fetcher(`${ctx.baseUrl.replace(/\/+$/, "")}/api/chat`, {
        method: "POST",
        headers: ollamaHeaders(ctx),
        body: JSON.stringify({ model, stream: false, messages: [{ role: "user", content: HARMLESS_MODEL_PROMPT }] }),
        signal: withTimeout(ctx.timeoutMs),
      });
      const latencyMs = Date.now() - started;
      if (!response.ok) return failEvidence(latencyMs, response.status, `Model test failed with HTTP ${response.status}.`);
      const data = (await readJsonSafe(response)) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
      const text = data?.message?.content || "";
      const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
      return { ok: true, latencyMs, ttftMs: latencyMs, outputPreview: text.slice(0, 200), usage: { input: number(data?.prompt_eval_count), output: number(data?.eval_count), reasoning: null, cached: null, total: null }, finishReason: "stop", requestId: requestIdOf(response), httpStatus: response.status, errorKind: null, errorDetail: null };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Model test failed.";
      return failEvidence(Date.now() - started, null, detail);
    }
  },
  async testStreaming(ctx, model, fetcher = fetch) {
    const started = Date.now();
    try {
      const response = await fetcher(`${ctx.baseUrl.replace(/\/+$/, "")}/api/chat`, {
        method: "POST",
        headers: ollamaHeaders(ctx),
        body: JSON.stringify({ model, stream: true, messages: [{ role: "user", content: HARMLESS_MODEL_PROMPT }] }),
        signal: withTimeout(ctx.timeoutMs),
      });
      if (!response.ok) return { ...failEvidence(Date.now() - started, response.status, `Stream test failed with HTTP ${response.status}.`), eventCount: 0, terminalOk: false };
      const text = await response.text();
      const lines = text.split(/\r?\n/).filter((line) => line.trim().startsWith("{"));
      let parsed = 0;
      let terminalOk = false;
      for (const line of lines) {
        try {
          const chunk = JSON.parse(line) as { done?: boolean };
          parsed += 1;
          if (chunk.done === true) terminalOk = true;
        } catch {
          /* partial NDJSON line is not a valid event */
        }
      }
      const latencyMs = Date.now() - started;
      return { ok: parsed > 0 && terminalOk, latencyMs, ttftMs: latencyMs, outputPreview: lines[0]?.slice(0, 200) || null, usage: { input: null, output: null, reasoning: null, cached: null, total: null }, finishReason: terminalOk ? "stop" : null, requestId: requestIdOf(response), httpStatus: response.status, errorKind: parsed ? null : "STREAM_INTERRUPTED", errorDetail: parsed ? null : "Stream completed with no valid NDJSON events.", eventCount: parsed, terminalOk };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Stream test failed.";
      return { ...failEvidence(Date.now() - started, null, detail), eventCount: 0, terminalOk: false };
    }
  },
  async testTools(ctx, model, fetcher = fetch) {
    const started = Date.now();
    try {
      const response = await fetcher(`${ctx.baseUrl.replace(/\/+$/, "")}/api/chat`, {
        method: "POST",
        headers: ollamaHeaders(ctx),
        body: JSON.stringify({ model, stream: false, messages: [{ role: "user", content: "Invoke the capability probe tool." }], tools: [{ type: "function", function: { name: TOOL_PROBE_NAME, description: "KForge capability probe. Never executes anything.", parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] } } }] }),
        signal: withTimeout(ctx.timeoutMs),
      });
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        if (response.status === 400 && /tool/i.test(body)) {
          return { verdict: "UNSUPPORTED", latencyMs, observedToolCall: null, httpStatus: response.status, errorKind: null, detail: "Runtime rejected tool schema; tools are UNSUPPORTED for this model." };
        }
        return { verdict: "FAILED", latencyMs, observedToolCall: null, httpStatus: response.status, errorKind: normalizeProviderError(response.status, body), detail: `Tool probe failed with HTTP ${response.status}.` };
      }
      const data = (await readJsonSafe(response)) as { message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }> } };
      const probe = (data?.message?.tool_calls || []).find((call) => call.function?.name === TOOL_PROBE_NAME);
      if (probe?.function) return { verdict: "SUPPORTED", latencyMs, observedToolCall: { name: TOOL_PROBE_NAME, arguments: typeof probe.function.arguments === "object" && probe.function.arguments !== null ? (probe.function.arguments as Record<string, unknown>) : {} }, httpStatus: response.status, errorKind: null, detail: "Model returned a structured kforge_capability_probe invocation." };
      return { verdict: "UNKNOWN", latencyMs, observedToolCall: null, httpStatus: response.status, errorKind: null, detail: "Runtime accepted tools but returned no probe invocation." };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Tool probe failed.";
      return { verdict: "FAILED", latencyMs: Date.now() - started, observedToolCall: null, httpStatus: null, errorKind: normalizeProviderError(null, detail), detail };
    }
  },
  async createResponse(ctx, model, system, user, fetcher = fetch) {
    const started = Date.now();
    const response = await fetcher(`${ctx.baseUrl.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: ollamaHeaders(ctx),
      body: JSON.stringify({ model, stream: false, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      signal: withTimeout(120_000),
    });
    if (!response.ok) throw new Error(`Generation failed with HTTP ${response.status}.`);
    const data = (await readJsonSafe(response)) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
    const text = (data?.message?.content || "").trim();
    if (!text) throw new Error("Runtime returned no content.");
    const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    return { text, toolCalls: [], usage: { input: number(data?.prompt_eval_count), output: number(data?.eval_count), reasoning: null, cached: null, total: null }, finishReason: "stop", requestId: requestIdOf(response), latencyMs: Date.now() - started, model };
  },
  normalizeUsage(raw: unknown) {
    const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    return { input: number(record.prompt_eval_count), output: number(record.eval_count), reasoning: null, cached: null, total: null };
  },
  normalizeError: (status, message) => normalizeProviderError(status, message),
};

const lmStudioAdapter: ProviderAdapter = {
  ...openAICompatible,
  kind: "lm-studio",
  authHeaders: (ctx) => ({ "Content-Type": "application/json", ...ctx.customHeaders }),
};

const llamaCppAdapter: ProviderAdapter = {
  ...openAICompatible,
  kind: "llama-cpp",
  authHeaders: (ctx) => ({ "Content-Type": "application/json", ...ctx.customHeaders }),
  async listModels(ctx, fetcher = fetch) {
    try {
      return await openAICompatible.listModels(ctx, fetcher);
    } catch {
      const nowIso = new Date().toISOString();
      return [{ id: "llama-cpp-server-model", displayName: "llama.cpp server model", providerId: "llama-cpp", family: "llama.cpp", version: "UNKNOWN", aliases: [], contextWindow: null, maxOutput: null, inputModalities: ["text"], outputModalities: ["text"], capabilities: { text: "SUPPORTED", vision: "PROVIDER_NOT_REPORTED", audio: "PROVIDER_NOT_REPORTED", video: "PROVIDER_NOT_REPORTED", tools: "UNSUPPORTED", structuredOutput: "PROVIDER_NOT_REPORTED", jsonMode: "PROVIDER_NOT_REPORTED", streaming: "SUPPORTED", reasoning: "PROVIDER_NOT_REPORTED", embeddings: "PROVIDER_NOT_REPORTED", imageGeneration: "UNSUPPORTED", codeSpecialization: "UNKNOWN", fineTuning: "UNSUPPORTED", cachedInput: "PROVIDER_NOT_REPORTED", batch: "UNSUPPORTED", temperature: "SUPPORTED", topP: "SUPPORTED", seed: "SUPPORTED", responseFormat: "PROVIDER_NOT_REPORTED" }, priceInput: null, priceOutput: null, priceCache: null, priceSource: "UNKNOWN", availability: "UNKNOWN", preview: false, rateLimitEvidence: null, lastDiscoveredAt: nowIso, rawEvidenceState: "HEURISTIC" }];
    }
  },
};

const registry: Record<ProviderAdapterKind, ProviderAdapter> = {
  openai: openAIAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
  openrouter: openRouterAdapter,
  ollama: ollamaAdapter,
  "lm-studio": lmStudioAdapter,
  "llama-cpp": llamaCppAdapter,
  "openai-compatible": openAICompatible,
};

export function getAdapter(kind: ProviderAdapterKind): ProviderAdapter {
  return registry[kind];
}

export function adapterKinds(): ProviderAdapterKind[] {
  return Object.keys(registry) as ProviderAdapterKind[];
}

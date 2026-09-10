import type { CanonicalModel, NormalizedErrorKind, ProviderAdapterKind } from "../../shared/providerCommandCenter";
import { normalizeModelRecord, normalizeProviderError, UNKNOWN_CAPABILITIES } from "../../shared/providerCommandCenter";

export interface AdapterContext {
  baseUrl: string;
  credential: string;
  organization?: string | null;
  customHeaders?: Record<string, string>;
  timeoutMs?: number;
  modelsEndpointOverride?: string | null;
  chatEndpointOverride?: string | null;
}

export interface CanonicalUsage {
  input: number | null;
  output: number | null;
  total: number | null;
  reasoning: number | null;
  cached: number | null;
  source: "PROVIDER_REPORTED" | "UNKNOWN";
}

export interface AdapterToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AdapterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
}

export interface AdapterRequest {
  model: string;
  messages: AdapterMessage[];
  tools?: AdapterToolDefinition[];
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface AdapterToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AdapterResponse {
  text: string;
  toolCalls: AdapterToolCall[];
  usage: CanonicalUsage;
  requestId: string | null;
  finishReason: string | null;
  httpStatus: number;
}

export type ModelEvent =
  | { type: "delta"; text: string }
  | { type: "tool_call"; toolCall: AdapterToolCall }
  | { type: "usage"; usage: CanonicalUsage }
  | { type: "done"; finishReason: string | null; requestId: string | null }
  | { type: "error"; errorKind: NormalizedErrorKind; detail: string; httpStatus: number | null };

export interface AdapterConnectionResult {
  ok: boolean;
  latencyMs: number;
  httpStatus: number | null;
  requestId: string | null;
  errorKind: NormalizedErrorKind | null;
  errorDetail: string | null;
}

export interface AdapterModelTestResult extends AdapterConnectionResult {
  usage: CanonicalUsage;
  responseObserved: boolean;
}

export interface AdapterStreamingTestResult extends AdapterConnectionResult {
  eventCount: number;
  terminalOk: boolean;
}

export interface AdapterToolTestResult {
  verdict: "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN";
  latencyMs: number;
  httpStatus: number | null;
  errorKind: NormalizedErrorKind | null;
  detail: string;
}

export interface ProviderAdapter {
  kind: ProviderAdapterKind;
  validateConfiguration(ctx: AdapterContext): Promise<{ ok: boolean; reason: string }>;
  testConnection(ctx: AdapterContext, fetcher?: typeof fetch): Promise<AdapterConnectionResult>;
  listModels(ctx: AdapterContext, fetcher?: typeof fetch): Promise<CanonicalModel[]>;
  testModel(ctx: AdapterContext, modelId: string, fetcher?: typeof fetch): Promise<AdapterModelTestResult>;
  testStreaming(ctx: AdapterContext, modelId: string, fetcher?: typeof fetch): Promise<AdapterStreamingTestResult>;
  testTools(ctx: AdapterContext, modelId: string, fetcher?: typeof fetch): Promise<AdapterToolTestResult>;
  createResponse(ctx: AdapterContext, request: AdapterRequest, fetcher?: typeof fetch): Promise<AdapterResponse>;
  streamResponse(ctx: AdapterContext, request: AdapterRequest, fetcher?: typeof fetch): AsyncGenerator<ModelEvent>;
  normalizeError(status: number | null, message: string): NormalizedErrorKind;
}

const emptyUsage = (): CanonicalUsage => ({ input: null, output: null, total: null, reasoning: null, cached: null, source: "UNKNOWN" });

function safeJson(value: string) {
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function base(ctx: AdapterContext) {
  return ctx.baseUrl.replace(/\/+$/, "");
}

function mergeHeaders(...parts: Array<Record<string, string> | undefined>) {
  return Object.assign({}, ...parts.filter(Boolean));
}

function signalFor(ctx: AdapterContext, external?: AbortSignal) {
  if (external) return external;
  return AbortSignal.timeout(Math.min(120_000, Math.max(2_000, ctx.timeoutMs ?? 30_000)));
}

async function responseError(response: Response) {
  const text = await response.text().catch(() => "");
  return text.slice(0, 2_000) || `HTTP ${response.status}`;
}

function requestId(response: Response) {
  return response.headers.get("x-request-id") || response.headers.get("request-id") || response.headers.get("x-goog-request-id") || null;
}

function openAIUsage(payload: Record<string, unknown>): CanonicalUsage {
  const usage = record(payload.usage);
  const details = record(usage.prompt_tokens_details ?? usage.input_tokens_details);
  const completionDetails = record(usage.completion_tokens_details ?? usage.output_tokens_details);
  const input = numberOrNull(usage.prompt_tokens ?? usage.input_tokens);
  const output = numberOrNull(usage.completion_tokens ?? usage.output_tokens);
  const total = numberOrNull(usage.total_tokens) ?? (input !== null && output !== null ? input + output : null);
  return {
    input,
    output,
    total,
    reasoning: numberOrNull(completionDetails.reasoning_tokens),
    cached: numberOrNull(details.cached_tokens),
    source: input !== null || output !== null || total !== null ? "PROVIDER_REPORTED" : "UNKNOWN",
  };
}

function anthropicUsage(payload: Record<string, unknown>): CanonicalUsage {
  const usage = record(payload.usage);
  const input = numberOrNull(usage.input_tokens);
  const output = numberOrNull(usage.output_tokens);
  return {
    input,
    output,
    total: input !== null && output !== null ? input + output : null,
    reasoning: null,
    cached: numberOrNull(usage.cache_read_input_tokens),
    source: input !== null || output !== null ? "PROVIDER_REPORTED" : "UNKNOWN",
  };
}

function geminiUsage(payload: Record<string, unknown>): CanonicalUsage {
  const usage = record(payload.usageMetadata);
  const input = numberOrNull(usage.promptTokenCount);
  const output = numberOrNull(usage.candidatesTokenCount);
  return {
    input,
    output,
    total: numberOrNull(usage.totalTokenCount) ?? (input !== null && output !== null ? input + output : null),
    reasoning: numberOrNull(usage.thoughtsTokenCount),
    cached: numberOrNull(usage.cachedContentTokenCount),
    source: Object.keys(usage).length ? "PROVIDER_REPORTED" : "UNKNOWN",
  };
}

function normalizeToolArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    const parsed = safeJson(raw);
    return record(parsed);
  }
  return record(raw);
}

function openAIMessageBody(request: AdapterRequest, stream: boolean) {
  const system = request.messages.filter((message) => message.role === "system");
  const others = request.messages.filter((message) => message.role !== "system");
  const messages = [...system, ...others].map((message) => ({ role: message.role, content: message.content, ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}) }));
  return {
    model: request.model,
    messages,
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}),
    ...(typeof request.temperature === "number" ? { temperature: request.temperature } : {}),
    ...(request.tools?.length ? { tools: request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })), tool_choice: "auto" } : {}),
  };
}

function openAIModel(providerId: string, raw: unknown, nowIso: string) {
  return normalizeModelRecord(providerId, raw, nowIso);
}

function localModel(providerId: string, id: string, raw: Record<string, unknown>, nowIso: string): CanonicalModel {
  return {
    id,
    displayName: string(raw.name) || id,
    providerId,
    family: string(raw.family) || id.split(/[:/-]/)[0] || "UNKNOWN",
    version: string(raw.version) || "UNKNOWN",
    aliases: [],
    contextWindow: numberOrNull(raw.context_length ?? raw.context_window),
    maxOutput: numberOrNull(raw.max_output),
    inputModalities: ["text"],
    outputModalities: ["text"],
    capabilities: { ...UNKNOWN_CAPABILITIES, text: "SUPPORTED", streaming: "SUPPORTED", tools: "PROVIDER_NOT_REPORTED" },
    priceInput: null,
    priceOutput: null,
    priceCache: null,
    priceSource: "UNKNOWN",
    availability: "AVAILABLE",
    preview: false,
    rateLimitEvidence: null,
    lastDiscoveredAt: nowIso,
    rawEvidenceState: "PROVIDER_REPORTED",
  };
}

function modelProbeTool(): AdapterToolDefinition {
  return {
    name: "kforge_capability_probe",
    description: "Return the supplied harmless value to prove structured tool calling. Do not execute any command.",
    inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false },
  };
}

function modelProbeMessages(): AdapterMessage[] {
  return [{ role: "user", content: "Reply with exactly KFORGE_OK." }];
}

function toolProbeMessages(): AdapterMessage[] {
  return [{ role: "user", content: "Call kforge_capability_probe with value KFORGE_OK. Do not answer with normal text." }];
}

class OpenAIProtocolAdapter implements ProviderAdapter {
  kind: ProviderAdapterKind;
  private providerId: string;
  private modelsPath: string;
  private chatPath: string;
  private credentialRequired: boolean;
  private fixedHeaders: Record<string, string>;

  constructor(options: { kind: ProviderAdapterKind; providerId: string; modelsPath: string; chatPath: string; credentialRequired: boolean; fixedHeaders?: Record<string, string> }) {
    this.kind = options.kind;
    this.providerId = options.providerId;
    this.modelsPath = options.modelsPath;
    this.chatPath = options.chatPath;
    this.credentialRequired = options.credentialRequired;
    this.fixedHeaders = options.fixedHeaders || {};
  }

  async validateConfiguration(ctx: AdapterContext) {
    if (!/^https?:\/\//i.test(ctx.baseUrl)) return { ok: false, reason: "Provider base URL must be http(s)." };
    try {
      const parsed = new URL(ctx.baseUrl);
      if (parsed.username || parsed.password) return { ok: false, reason: "Provider base URL must not embed credentials." };
    } catch { return { ok: false, reason: "Provider base URL is invalid." }; }
    if (this.credentialRequired && !ctx.credential) return { ok: false, reason: "NOT_CONFIGURED: add a credential before contacting this provider." };
    return { ok: true, reason: "Configuration is structurally valid." };
  }

  private headers(ctx: AdapterContext) {
    return mergeHeaders(
      { "content-type": "application/json" },
      this.fixedHeaders,
      ctx.credential ? { Authorization: `Bearer ${ctx.credential}` } : undefined,
      ctx.organization ? { "OpenAI-Organization": ctx.organization } : undefined,
      ctx.customHeaders,
    );
  }

  private modelsUrl(ctx: AdapterContext) {
    return ctx.modelsEndpointOverride?.trim() || `${base(ctx)}${this.modelsPath}`;
  }

  private chatUrl(ctx: AdapterContext) {
    return ctx.chatEndpointOverride?.trim() || `${base(ctx)}${this.chatPath}`;
  }

  async testConnection(ctx: AdapterContext, fetcher: typeof fetch = fetch): Promise<AdapterConnectionResult> {
    const started = Date.now();
    try {
      const response = await fetcher(this.modelsUrl(ctx), { headers: this.headers(ctx), signal: signalFor(ctx) });
      if (!response.ok) {
        const detail = await responseError(response);
        return { ok: false, latencyMs: Date.now() - started, httpStatus: response.status, requestId: requestId(response), errorKind: this.normalizeError(response.status, detail), errorDetail: detail };
      }
      return { ok: true, latencyMs: Date.now() - started, httpStatus: response.status, requestId: requestId(response), errorKind: null, errorDetail: null };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Connection failed.";
      return { ok: false, latencyMs: Date.now() - started, httpStatus: null, requestId: null, errorKind: this.normalizeError(null, detail), errorDetail: detail };
    }
  }

  async listModels(ctx: AdapterContext, fetcher: typeof fetch = fetch) {
    const response = await fetcher(this.modelsUrl(ctx), { headers: this.headers(ctx), signal: signalFor(ctx) });
    if (!response.ok) throw new Error(await responseError(response));
    const payload = record(await response.json());
    const rows = array(payload.data ?? payload.models);
    const now = new Date().toISOString();
    return rows.map((row) => openAIModel(this.providerId, row, now));
  }

  async createResponse(ctx: AdapterContext, request: AdapterRequest, fetcher: typeof fetch = fetch): Promise<AdapterResponse> {
    const response = await fetcher(this.chatUrl(ctx), {
      method: "POST",
      headers: this.headers(ctx),
      body: JSON.stringify(openAIMessageBody(request, false)),
      signal: signalFor(ctx, request.signal),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const payload = record(await response.json());
    const choice = record(array(payload.choices)[0]);
    const message = record(choice.message);
    const toolCalls = array(message.tool_calls).map((item, index) => {
      const call = record(item);
      const fn = record(call.function);
      return { id: string(call.id) || `call-${index}`, name: string(fn.name), arguments: normalizeToolArguments(fn.arguments) };
    }).filter((call) => Boolean(call.name));
    return {
      text: string(message.content),
      toolCalls,
      usage: openAIUsage(payload),
      requestId: requestId(response),
      finishReason: string(choice.finish_reason) || null,
      httpStatus: response.status,
    };
  }

  async *streamResponse(ctx: AdapterContext, request: AdapterRequest, fetcher: typeof fetch = fetch): AsyncGenerator<ModelEvent> {
    let response: Response;
    try {
      response = await fetcher(this.chatUrl(ctx), {
        method: "POST",
        headers: this.headers(ctx),
        body: JSON.stringify(openAIMessageBody(request, true)),
        signal: signalFor(ctx, request.signal),
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Streaming request failed.";
      yield { type: "error", errorKind: this.normalizeError(null, detail), detail, httpStatus: null };
      return;
    }
    if (!response.ok || !response.body) {
      const detail = await responseError(response);
      yield { type: "error", errorKind: this.normalizeError(response.status, detail), detail, httpStatus: response.status };
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: string | null = null;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        for (const line of block.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          const payload = record(safeJson(data));
          if (Object.keys(record(payload.usage)).length) yield { type: "usage", usage: openAIUsage(payload) };
          const choice = record(array(payload.choices)[0]);
          finishReason = string(choice.finish_reason) || finishReason;
          const delta = record(choice.delta);
          const text = string(delta.content);
          if (text) yield { type: "delta", text };
          for (const rawCall of array(delta.tool_calls)) {
            const call = record(rawCall);
            const index = numberOrNull(call.index) ?? 0;
            const fn = record(call.function);
            const current = toolAcc.get(index) || { id: string(call.id) || `call-${index}`, name: "", args: "" };
            if (string(call.id)) current.id = string(call.id);
            current.name += string(fn.name);
            current.args += string(fn.arguments);
            toolAcc.set(index, current);
          }
        }
      }
    }
    for (const call of toolAcc.values()) {
      if (call.name) yield { type: "tool_call", toolCall: { id: call.id, name: call.name, arguments: normalizeToolArguments(call.args) } };
    }
    yield { type: "done", finishReason, requestId: requestId(response) };
  }

  async testModel(ctx: AdapterContext, modelId: string, fetcher: typeof fetch = fetch): Promise<AdapterModelTestResult> {
    const started = Date.now();
    try {
      const result = await this.createResponse(ctx, { model: modelId, messages: modelProbeMessages(), maxOutputTokens: 16 }, fetcher);
      return { ok: Boolean(result.text || result.toolCalls.length), responseObserved: Boolean(result.text || result.toolCalls.length), latencyMs: Date.now() - started, httpStatus: result.httpStatus, requestId: result.requestId, errorKind: null, errorDetail: null, usage: result.usage };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Model test failed.";
      return { ok: false, responseObserved: false, latencyMs: Date.now() - started, httpStatus: null, requestId: null, errorKind: this.normalizeError(null, detail), errorDetail: detail, usage: emptyUsage() };
    }
  }

  async testStreaming(ctx: AdapterContext, modelId: string, fetcher: typeof fetch = fetch): Promise<AdapterStreamingTestResult> {
    const started = Date.now();
    let eventCount = 0;
    let terminalOk = false;
    let errorKind: NormalizedErrorKind | null = null;
    let errorDetail: string | null = null;
    for await (const event of this.streamResponse(ctx, { model: modelId, messages: modelProbeMessages(), maxOutputTokens: 16 }, fetcher)) {
      if (event.type === "delta" || event.type === "tool_call") eventCount += 1;
      if (event.type === "done") terminalOk = true;
      if (event.type === "error") { errorKind = event.errorKind; errorDetail = event.detail; }
    }
    return { ok: terminalOk && eventCount > 0 && !errorKind, eventCount, terminalOk, latencyMs: Date.now() - started, httpStatus: errorKind ? null : 200, requestId: null, errorKind, errorDetail };
  }

  async testTools(ctx: AdapterContext, modelId: string, fetcher: typeof fetch = fetch): Promise<AdapterToolTestResult> {
    const started = Date.now();
    try {
      const result = await this.createResponse(ctx, { model: modelId, messages: toolProbeMessages(), tools: [modelProbeTool()], maxOutputTokens: 64 }, fetcher);
      const supported = result.toolCalls.some((call) => call.name === "kforge_capability_probe");
      return { verdict: supported ? "SUPPORTED" : "UNKNOWN", latencyMs: Date.now() - started, httpStatus: result.httpStatus, errorKind: null, detail: supported ? "Provider returned a structured function/tool invocation." : "Provider completed the request but did not return a structured tool invocation." };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "Tool test failed.";
      const kind = this.normalizeError(null, detail);
      return { verdict: kind === "TOOL_UNSUPPORTED" || /tool|function/i.test(detail) ? "UNSUPPORTED" : "UNKNOWN", latencyMs: Date.now() - started, httpStatus: null, errorKind: kind, detail };
    }
  }

  normalizeError(status: number | null, message: string) { return normalizeProviderError(status, message); }
}

class AnthropicAdapter implements ProviderAdapter {
  kind: ProviderAdapterKind = "anthropic";
  async validateConfiguration(ctx: AdapterContext) {
    if (!/^https?:\/\//i.test(ctx.baseUrl)) return { ok: false, reason: "Anthropic base URL must be http(s)." };
    if (!ctx.credential) return { ok: false, reason: "NOT_CONFIGURED: add an Anthropic API key." };
    return { ok: true, reason: "Configuration is structurally valid." };
  }
  private headers(ctx: AdapterContext) {
    return mergeHeaders({ "content-type": "application/json", "x-api-key": ctx.credential, "anthropic-version": "2023-06-01" }, ctx.customHeaders);
  }
  private modelsUrl(ctx: AdapterContext) { return ctx.modelsEndpointOverride?.trim() || `${base(ctx)}/models`; }
  private messagesUrl(ctx: AdapterContext) { return ctx.chatEndpointOverride?.trim() || `${base(ctx)}/messages`; }
  async testConnection(ctx: AdapterContext, fetcher: typeof fetch = fetch): Promise<AdapterConnectionResult> {
    const started = Date.now();
    try {
      const response = await fetcher(this.modelsUrl(ctx), { headers: this.headers(ctx), signal: signalFor(ctx) });
      if (!response.ok) { const detail = await responseError(response); return { ok: false, latencyMs: Date.now() - started, httpStatus: response.status, requestId: requestId(response), errorKind: this.normalizeError(response.status, detail), errorDetail: detail }; }
      return { ok: true, latencyMs: Date.now() - started, httpStatus: response.status, requestId: requestId(response), errorKind: null, errorDetail: null };
    } catch (error: unknown) { const detail = error instanceof Error ? error.message : "Connection failed."; return { ok: false, latencyMs: Date.now() - started, httpStatus: null, requestId: null, errorKind: this.normalizeError(null, detail), errorDetail: detail }; }
  }
  async listModels(ctx: AdapterContext, fetcher: typeof fetch = fetch) {
    const response = await fetcher(this.modelsUrl(ctx), { headers: this.headers(ctx), signal: signalFor(ctx) });
    if (!response.ok) throw new Error(await responseError(response));
    const payload = record(await response.json());
    const now = new Date().toISOString();
    return array(payload.data).map((raw) => {
      const row = record(raw);
      const id = string(row.id) || "UNKNOWN";
      return {
        id,
        displayName: string(row.display_name) || id,
        providerId: "anthropic",
        family: id.split("-").slice(0, 2).join("-") || id,
        version: string(row.version) || "UNKNOWN",
        aliases: [], contextWindow: null, maxOutput: null,
        inputModalities: ["text"], outputModalities: ["text"],
        capabilities: { ...UNKNOWN_CAPABILITIES, text: "SUPPORTED", streaming: "SUPPORTED", tools: "SUPPORTED" },
        priceInput: null, priceOutput: null, priceCache: null, priceSource: "UNKNOWN" as const,
        availability: /deprecated/i.test(id) ? "DEPRECATED" as const : "UNKNOWN" as const,
        preview: false, rateLimitEvidence: null, lastDiscoveredAt: now, rawEvidenceState: "PROVIDER_REPORTED" as const,
      } satisfies CanonicalModel;
    });
  }
  private body(request: AdapterRequest, stream: boolean) {
    const system = request.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const messages = request.messages.filter((m) => m.role !== "system" && m.role !== "tool").map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
    return {
      model: request.model,
      max_tokens: request.maxOutputTokens || 1024,
      messages,
      stream,
      ...(system ? { system } : {}),
      ...(typeof request.temperature === "number" ? { temperature: request.temperature } : {}),
      ...(request.tools?.length ? { tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })) } : {}),
    };
  }
  async createResponse(ctx: AdapterContext, request: AdapterRequest, fetcher: typeof fetch = fetch): Promise<AdapterResponse> {
    const response = await fetcher(this.messagesUrl(ctx), { method: "POST", headers: this.headers(ctx), body: JSON.stringify(this.body(request, false)), signal: signalFor(ctx, request.signal) });
    if (!response.ok) throw new Error(await responseError(response));
    const payload = record(await response.json());
    const blocks = array(payload.content).map(record);
    const text = blocks.filter((item) => item.type === "text").map((item) => string(item.text)).join("");
    const toolCalls = blocks.filter((item) => item.type === "tool_use").map((item, index) => ({ id: string(item.id) || `tool-${index}`, name: string(item.name), arguments: record(item.input) })).filter((call) => Boolean(call.name));
    return { text, toolCalls, usage: anthropicUsage(payload), requestId: requestId(response), finishReason: string(payload.stop_reason) || null, httpStatus: response.status };
  }
  async *streamResponse(ctx: AdapterContext, request: AdapterRequest, fetcher: typeof fetch = fetch): AsyncGenerator<ModelEvent> {
    let response: Response;
    try { response = await fetcher(this.messagesUrl(ctx), { method: "POST", headers: this.headers(ctx), body: JSON.stringify(this.body(request, true)), signal: signalFor(ctx, request.signal) }); }
    catch (error: unknown) { const detail = error instanceof Error ? error.message : "Streaming request failed."; yield { type: "error", errorKind: this.normalizeError(null, detail), detail, httpStatus: null }; return; }
    if (!response.ok || !response.body) { const detail = await responseError(response); yield { type: "error", errorKind: this.normalizeError(response.status, detail), detail, httpStatus: response.status }; return; }
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; const tools = new Map<number, { id: string; name: string; json: string }>(); let finish: string | null = null;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break; buffer += decoder.decode(chunk.value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/); buffer = blocks.pop() || "";
      for (const block of blocks) for (const line of block.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const payload = record(safeJson(line.slice(5).trim())); const type = string(payload.type);
        if (type === "content_block_start") { const index = numberOrNull(payload.index) ?? 0; const content = record(payload.content_block); if (content.type === "tool_use") tools.set(index, { id: string(content.id) || `tool-${index}`, name: string(content.name), json: JSON.stringify(record(content.input)).replace(/^\{\}|^null$/, "") }); }
        if (type === "content_block_delta") { const index = numberOrNull(payload.index) ?? 0; const delta = record(payload.delta); if (delta.type === "text_delta" && string(delta.text)) yield { type: "delta", text: string(delta.text) }; if (delta.type === "input_json_delta") { const current = tools.get(index); if (current) current.json += string(delta.partial_json); } }
        if (type === "message_delta") { finish = string(record(payload.delta).stop_reason) || finish; if (Object.keys(record(payload.usage)).length) yield { type: "usage", usage: anthropicUsage(payload) }; }
        if (type === "message_start") { const message = record(payload.message); if (Object.keys(record(message.usage)).length) yield { type: "usage", usage: anthropicUsage(message) }; }
      }
    }
    for (const tool of tools.values()) if (tool.name) yield { type: "tool_call", toolCall: { id: tool.id, name: tool.name, arguments: normalizeToolArguments(tool.json || "{}") } };
    yield { type: "done", finishReason: finish, requestId: requestId(response) };
  }
  async testModel(ctx: AdapterContext, modelId: string, fetcher: typeof fetch = fetch) { const started = Date.now(); try { const r = await this.createResponse(ctx, { model: modelId, messages: modelProbeMessages(), maxOutputTokens: 16 }, fetcher); return { ok: Boolean(r.text || r.toolCalls.length), responseObserved: Boolean(r.text || r.toolCalls.length), latencyMs: Date.now() - started, httpStatus: r.httpStatus, requestId: r.requestId, errorKind: null, errorDetail: null, usage: r.usage }; } catch (error: unknown) { const detail = error instanceof Error ? error.message : "Model test failed."; return { ok: false, responseObserved: false, latencyMs: Date.now() - started, httpStatus: null, requestId: null, errorKind: this.normalizeError(null, detail), errorDetail: detail, usage: emptyUsage() }; } }
  async testStreaming(ctx: AdapterContext, modelId: string, fetcher: typeof fetch = fetch) { const started = Date.now(); let eventCount = 0; let terminalOk = false; let errorKind: NormalizedErrorKind | null = null; let errorDetail: string | null = null; for await (const event of this.streamResponse(ctx, { model: modelId, messages: modelProbeMessages(), maxOutputTokens: 16 }, fetcher)) { if (event.type === "delta" || event.type === "tool_call") eventCount++; if (event.type === "done") terminalOk = true; if (event.type === "error") { errorKind = event.errorKind; errorDetail = event.detail; } } return { ok: terminalOk && eventCount > 0 && !errorKind, eventCount, terminalOk, latencyMs: Date.now() - started, httpStatus: errorKind ? null : 200, requestId: null, errorKind, errorDetail }; }
  async testTools(ctx: AdapterContext, modelId: string, fetcher: typeof fetch = fetch) { const started = Date.now(); try { const r = await this.createResponse(ctx, { model: modelId, messages: toolProbeMessages(), tools: [modelProbeTool()], maxOutputTokens: 64 }, fetcher); const supported = r.toolCalls.some((call) => call.name === "kforge_capability_probe"); return { verdict: supported ? "SUPPORTED" as const : "UNKNOWN" as const, latencyMs: Date.now() - started, httpStatus: r.httpStatus, errorKind: null, detail: supported ? "Anthropic returned a structured tool_use block." : "Anthropic returned no structured tool_use block." }; } catch (error: unknown) { const detail = error instanceof Error ? error.message : "Tool test failed."; const kind = this.normalizeError(null, detail); return { verdict: /tool/i.test(detail) ? "UNSUPPORTED" as const : "UNKNOWN" as const, latencyMs: Date.now() - started, httpStatus: null, errorKind: kind, detail }; } }
  normalizeError(status: number | null, message: string) { return normalizeProviderError(status, message); }
}

class GeminiAdapter implements ProviderAdapter {
  kind: ProviderAdapterKind = "gemini";
  async validateConfiguration(ctx: AdapterContext) { if (!/^https?:\/\//i.test(ctx.baseUrl)) return { ok: false, reason: "Gemini base URL must be http(s)." }; if (!ctx.credential) return { ok: false, reason: "NOT_CONFIGURED: add a Gemini API key." }; return { ok: true, reason: "Configuration is structurally valid." }; }
  private headers(ctx: AdapterContext) { return mergeHeaders({ "content-type": "application/json", "x-goog-api-key": ctx.credential }, ctx.customHeaders); }
  private modelsUrl(ctx: AdapterContext) { return ctx.modelsEndpointOverride?.trim() || `${base(ctx)}/models`; }
  private generateUrl(ctx: AdapterContext, model: string, stream = false) { if (ctx.chatEndpointOverride?.trim()) return ctx.chatEndpointOverride.trim(); const id = model.replace(/^models\//, ""); return `${base(ctx)}/models/${encodeURIComponent(id)}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`; }
  async testConnection(ctx: AdapterContext, fetcher: typeof fetch = fetch): Promise<AdapterConnectionResult> { const started = Date.now(); try { const response = await fetcher(this.modelsUrl(ctx), { headers: this.headers(ctx), signal: signalFor(ctx) }); if (!response.ok) { const detail = await responseError(response); return { ok: false, latencyMs: Date.now() - started, httpStatus: response.status, requestId: requestId(response), errorKind: this.normalizeError(response.status, detail), errorDetail: detail }; } return { ok: true, latencyMs: Date.now() - started, httpStatus: response.status, requestId: requestId(response), errorKind: null, errorDetail: null }; } catch (error: unknown) { const detail = error instanceof Error ? error.message : "Connection failed."; return { ok: false, latencyMs: Date.now() - started, httpStatus: null, requestId: null, errorKind: this.normalizeError(null, detail), errorDetail: detail }; } }
  async listModels(ctx: AdapterContext, fetcher: typeof fetch = fetch) { const response = await fetcher(this.modelsUrl(ctx), { headers: this.headers(ctx), signal: signalFor(ctx) }); if (!response.ok) throw new Error(await responseError(response)); const payload = record(await response.json()); const now = new Date().toISOString(); return array(payload.models).map((raw) => { const row = record(raw); const full = string(row.name); const id = full.replace(/^models\//, "") || "UNKNOWN"; const methods = array(row.supportedGenerationMethods).map(string); return { id, displayName: string(row.displayName) || id, providerId: "gemini", family: id.split("-").slice(0, 2).join("-") || id, version: string(row.version) || "UNKNOWN", aliases: [], contextWindow: numberOrNull(row.inputTokenLimit), maxOutput: numberOrNull(row.outputTokenLimit), inputModalities: ["text"], outputModalities: ["text"], capabilities: { ...UNKNOWN_CAPABILITIES, text: methods.includes("generateContent") ? "SUPPORTED" : "PROVIDER_NOT_REPORTED", streaming: methods.includes("streamGenerateContent") || methods.includes("generateContent") ? "SUPPORTED" : "PROVIDER_NOT_REPORTED", tools: "PROVIDER_NOT_REPORTED" }, priceInput: null, priceOutput: null, priceCache: null, priceSource: "UNKNOWN" as const, availability: "UNKNOWN" as const, preview: /preview|experimental/i.test(id), rateLimitEvidence: null, lastDiscoveredAt: now, rawEvidenceState: "PROVIDER_REPORTED" as const } satisfies CanonicalModel; }); }
  private body(request: AdapterRequest) { const system = request.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n"); const contents = request.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })); return { ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents, generationConfig: { ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}), ...(typeof request.temperature === "number" ? { temperature: request.temperature } : {}) }, ...(request.tools?.length ? { tools: [{ functionDeclarations: request.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema })) }] } : {}) }; }
  private parse(payload: Record<string, unknown>, response: Response): AdapterResponse { const candidate = record(array(payload.candidates)[0]); const content = record(candidate.content); const parts = array(content.parts).map(record); const text = parts.map((part) => string(part.text)).join(""); const toolCalls = parts.map((part, index) => ({ call: record(part.functionCall), index })).filter(({ call }) => Object.keys(call).length).map(({ call, index }) => ({ id: `gemini-${index}`, name: string(call.name), arguments: record(call.args) })).filter((call) => Boolean(call.name)); return { text, toolCalls, usage: geminiUsage(payload), requestId: requestId(response), finishReason: string(candidate.finishReason) || null, httpStatus: response.status }; }
  async createResponse(ctx: AdapterContext, request: AdapterRequest, fetcher: typeof fetch = fetch) { const response = await fetcher(this.generateUrl(ctx, request.model), { method: "POST", headers: this.headers(ctx), body: JSON.stringify(this.body(request)), signal: signalFor(ctx, request.signal) }); if (!response.ok) throw new Error(await responseError(response)); return this.parse(record(await response.json()), response); }
  async *streamResponse(ctx: AdapterContext, request: AdapterRequest, fetcher: typeof fetch = fetch): AsyncGenerator<ModelEvent> { let response: Response; try { response = await fetcher(this.generateUrl(ctx, request.model, true), { method: "POST", headers: this.headers(ctx), body: JSON.stringify(this.body(request)), signal: signalFor(ctx, request.signal) }); } catch (error: unknown) { const detail = error instanceof Error ? error.message : "Streaming request failed."; yield { type: "error", errorKind: this.normalizeError(null, detail), detail, httpStatus: null }; return; } if (!response.ok || !response.body) { const detail = await responseError(response); yield { type: "error", errorKind: this.normalizeError(response.status, detail), detail, httpStatus: response.status }; return; } const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let finish: string | null = null; while (true) { const chunk = await reader.read(); if (chunk.done) break; buffer += decoder.decode(chunk.value, { stream: true }); const blocks = buffer.split(/\r?\n\r?\n/); buffer = blocks.pop() || ""; for (const block of blocks) for (const line of block.split(/\r?\n/)) { if (!line.startsWith("data:")) continue; const payload = record(safeJson(line.slice(5).trim())); const candidate = record(array(payload.candidates)[0]); finish = string(candidate.finishReason) || finish; const parts = array(record(candidate.content).parts).map(record); for (const part of parts) { if (string(part.text)) yield { type: "delta", text: string(part.text) }; const fn = record(part.functionCall); if (string(fn.name)) yield { type: "tool_call", toolCall: { id: `gemini-${Date.now()}`, name: string(fn.name), arguments: record(fn.args) } }; } if (Object.keys(record(payload.usageMetadata)).length) yield { type: "usage", usage: geminiUsage(payload) }; } } yield { type: "done", finishReason: finish, requestId: requestId(response) }; }
  async testModel(ctx: AdapterContext, modelId: string, fetcher: typeof fetch = fetch) { const started = Date.now(); try { const r = await this.createResponse(ctx, { model: modelId, messages: modelProbeMessages(), maxOutputTokens: 16 }, fetcher); return { ok: Boolean(r.text || r.toolCalls.length), responseObserved: Boolean(r.text || r.toolCalls.length), latencyMs: Date.now() - started, httpStatus: r.httpStatus, requestId: r.requestId, errorKind: null, errorDetail: null, usage: r.usage }; } catch (error: unknown) { const detail = error instanceof Error ? error.message : "Model test failed."; return { ok: false, responseObserved: false, latencyMs: Date.now() - started, httpStatus: null, requestId: null, errorKind: this.normalizeError(null, detail), errorDetail: detail, usage: emptyUsage() }; } }
  async testStreaming(ctx: AdapterContext, modelId: string, fetcher: typeof fetch = fetch) { const started = Date.now(); let eventCount = 0; let terminalOk = false; let errorKind: NormalizedErrorKind | null = null; let errorDetail: string | null = null; for await (const event of this.streamResponse(ctx, { model: modelId, messages: modelProbeMessages(), maxOutputTokens: 16 }, fetcher)) { if (event.type === "delta" || event.type === "tool_call") eventCount++; if (event.type === "done") terminalOk = true; if (event.type === "error") { errorKind = event.errorKind; errorDetail = event.detail; } } return { ok: terminalOk && eventCount > 0 && !errorKind, eventCount, terminalOk, latencyMs: Date.now() - started, httpStatus: errorKind ? null : 200, requestId: null, errorKind, errorDetail }; }
  async testTools(ctx: AdapterContext, modelId: string, fetcher: typeof fetch = fetch) { const started = Date.now(); try { const r = await this.createResponse(ctx, { model: modelId, messages: toolProbeMessages(), tools: [modelProbeTool()], maxOutputTokens: 64 }, fetcher); const supported = r.toolCalls.some((call) => call.name === "kforge_capability_probe"); return { verdict: supported ? "SUPPORTED" as const : "UNKNOWN" as const, latencyMs: Date.now() - started, httpStatus: r.httpStatus, errorKind: null, detail: supported ? "Gemini returned a structured functionCall." : "Gemini returned no structured functionCall." }; } catch (error: unknown) { const detail = error instanceof Error ? error.message : "Tool test failed."; const kind = this.normalizeError(null, detail); return { verdict: /function|tool/i.test(detail) ? "UNSUPPORTED" as const : "UNKNOWN" as const, latencyMs: Date.now() - started, httpStatus: null, errorKind: kind, detail }; } }
  normalizeError(status: number | null, message: string) { return normalizeProviderError(status, message); }
}

class OllamaAdapter implements ProviderAdapter {
  kind: ProviderAdapterKind = "ollama";
  async validateConfiguration(ctx: AdapterContext) { return /^https?:\/\//i.test(ctx.baseUrl) ? { ok: true, reason: "Configuration is structurally valid." } : { ok: false, reason: "Ollama base URL must be http(s)." }; }
  private headers(ctx: AdapterContext) { return mergeHeaders({ "content-type": "application/json" }, ctx.customHeaders); }
  private tagsUrl(ctx: AdapterContext) { return ctx.modelsEndpointOverride?.trim() || `${base(ctx)}/api/tags`; }
  private chatUrl(ctx: AdapterContext) { return ctx.chatEndpointOverride?.trim() || `${base(ctx)}/api/chat`; }
  async testConnection(ctx: AdapterContext, fetcher: typeof fetch = fetch): Promise<AdapterConnectionResult> { const started = Date.now(); try { const response = await fetcher(this.tagsUrl(ctx), { headers: this.headers(ctx), signal: signalFor(ctx) }); if (!response.ok) { const detail = await responseError(response); return { ok: false, latencyMs: Date.now() - started, httpStatus: response.status, requestId: requestId(response), errorKind: this.normalizeError(response.status, detail), errorDetail: detail }; } return { ok: true, latencyMs: Date.now() - started, httpStatus: response.status, requestId: requestId(response), errorKind: null, errorDetail: null }; } catch (error: unknown) { const detail = error instanceof Error ? error.message : "Connection failed."; return { ok: false, latencyMs: Date.now() - started, httpStatus: null, requestId: null, errorKind: this.normalizeError(null, detail), errorDetail: detail }; } }
  async listModels(ctx: AdapterContext, fetcher: typeof fetch = fetch) { const response = await fetcher(this.tagsUrl(ctx), { headers: this.headers(ctx), signal: signalFor(ctx) }); if (!response.ok) throw new Error(await responseError(response)); const payload = record(await response.json()); const now = new Date().toISOString(); return array(payload.models).map((raw) => { const row = record(raw); const details = record(row.details); return localModel("ollama", string(row.name) || string(row.model) || "UNKNOWN", { ...row, family: details.family }, now); }); }
  private body(request: AdapterRequest, stream: boolean) { return { model: request.model, messages: request.messages.filter((m) => m.role !== "tool").map((m) => ({ role: m.role === "system" ? "system" : m.role === "assistant" ? "assistant" : "user", content: m.content })), stream, ...(request.tools?.length ? { tools: request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })) } : {}), options: { ...(typeof request.temperature === "number" ? { temperature: request.temperature } : {}) } }; }
  private parse(payload: Record<string, unknown>, status = 200): AdapterResponse { const message = record(payload.message); const toolCalls = array(message.tool_calls).map((raw, index) => { const call = record(raw); const fn = record(call.function); return { id: `ollama-${index}`, name: string(fn.name), arguments: record(fn.arguments) }; }).filter((call) => Boolean(call.name)); const input = numberOrNull(payload.prompt_eval_count); const output = numberOrNull(payload.eval_count); return { text: string(message.content) || string(payload.response), toolCalls, usage: { input, output, total: input !== null && output !== null ? input + output : null, reasoning: null, cached: null, source: input !== null || output !== null ? "PROVIDER_REPORTED" : "UNKNOWN" }, requestId: null, finishReason: payload.done === true ? string(payload.done_reason) || "stop" : null, httpStatus: status }; }
  async createResponse(ctx: AdapterContext, request: AdapterRequest, fetcher: typeof fetch = fetch) { const response = await fetcher(this.chatUrl(ctx), { method: "POST", headers: this.headers(ctx), body: JSON.stringify(this.body(request, false)), signal: signalFor(ctx, request.signal) }); if (!response.ok) throw new Error(await responseError(response)); return this.parse(record(await response.json()), response.status); }
  async *streamResponse(ctx: AdapterContext, request: AdapterRequest, fetcher: typeof fetch = fetch): AsyncGenerator<ModelEvent> { let response: Response; try { response = await fetcher(this.chatUrl(ctx), { method: "POST", headers: this.headers(ctx), body: JSON.stringify(this.body(request, true)), signal: signalFor(ctx, request.signal) }); } catch (error: unknown) { const detail = error instanceof Error ? error.message : "Streaming request failed."; yield { type: "error", errorKind: this.normalizeError(null, detail), detail, httpStatus: null }; return; } if (!response.ok || !response.body) { const detail = await responseError(response); yield { type: "error", errorKind: this.normalizeError(response.status, detail), detail, httpStatus: response.status }; return; } const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; while (true) { const chunk = await reader.read(); if (chunk.done) break; buffer += decoder.decode(chunk.value, { stream: true }); const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ""; for (const line of lines) { if (!line.trim()) continue; const payload = record(safeJson(line)); const parsed = this.parse(payload, response.status); if (parsed.text) yield { type: "delta", text: parsed.text }; for (const toolCall of parsed.toolCalls) yield { type: "tool_call", toolCall }; if (parsed.usage.source === "PROVIDER_REPORTED") yield { type: "usage", usage: parsed.usage }; if (payload.done === true) yield { type: "done", finishReason: parsed.finishReason, requestId: null }; } } }
  async testModel(ctx: AdapterContext, modelId: string, fetcher: typeof fetch = fetch) { const started = Date.now(); try { const r = await this.createResponse(ctx, { model: modelId, messages: modelProbeMessages(), maxOutputTokens: 16 }, fetcher); return { ok: Boolean(r.text || r.toolCalls.length), responseObserved: Boolean(r.text || r.toolCalls.length), latencyMs: Date.now() - started, httpStatus: r.httpStatus, requestId: null, errorKind: null, errorDetail: null, usage: r.usage }; } catch (error: unknown) { const detail = error instanceof Error ? error.message : "Model test failed."; return { ok: false, responseObserved: false, latencyMs: Date.now() - started, httpStatus: null, requestId: null, errorKind: this.normalizeError(null, detail), errorDetail: detail, usage: emptyUsage() }; } }
  async testStreaming(ctx: AdapterContext, modelId: string, fetcher: typeof fetch = fetch) { const started = Date.now(); let eventCount = 0; let terminalOk = false; let errorKind: NormalizedErrorKind | null = null; let errorDetail: string | null = null; for await (const event of this.streamResponse(ctx, { model: modelId, messages: modelProbeMessages(), maxOutputTokens: 16 }, fetcher)) { if (event.type === "delta" || event.type === "tool_call") eventCount++; if (event.type === "done") terminalOk = true; if (event.type === "error") { errorKind = event.errorKind; errorDetail = event.detail; } } return { ok: terminalOk && eventCount > 0 && !errorKind, eventCount, terminalOk, latencyMs: Date.now() - started, httpStatus: errorKind ? null : 200, requestId: null, errorKind, errorDetail }; }
  async testTools(ctx: AdapterContext, modelId: string, fetcher: typeof fetch = fetch) { const started = Date.now(); try { const r = await this.createResponse(ctx, { model: modelId, messages: toolProbeMessages(), tools: [modelProbeTool()] }, fetcher); const supported = r.toolCalls.some((call) => call.name === "kforge_capability_probe"); return { verdict: supported ? "SUPPORTED" as const : "UNKNOWN" as const, latencyMs: Date.now() - started, httpStatus: r.httpStatus, errorKind: null, detail: supported ? "Ollama returned a structured tool call." : "Ollama completed without a structured tool call; model support remains unknown." }; } catch (error: unknown) { const detail = error instanceof Error ? error.message : "Tool test failed."; const kind = this.normalizeError(null, detail); return { verdict: /tool/i.test(detail) ? "UNSUPPORTED" as const : "UNKNOWN" as const, latencyMs: Date.now() - started, httpStatus: null, errorKind: kind, detail }; } }
  normalizeError(status: number | null, message: string) { return normalizeProviderError(status, message); }
}

const adapters: Record<ProviderAdapterKind, ProviderAdapter> = {
  openai: new OpenAIProtocolAdapter({ kind: "openai", providerId: "openai", modelsPath: "/models", chatPath: "/chat/completions", credentialRequired: true }),
  openrouter: new OpenAIProtocolAdapter({ kind: "openrouter", providerId: "openrouter", modelsPath: "/models", chatPath: "/chat/completions", credentialRequired: true, fixedHeaders: { "HTTP-Referer": "https://knoux-forge.local", "X-Title": "KNOuX Forge" } }),
  "lm-studio": new OpenAIProtocolAdapter({ kind: "lm-studio", providerId: "lm-studio", modelsPath: "/v1/models", chatPath: "/v1/chat/completions", credentialRequired: false }),
  "llama-cpp": new OpenAIProtocolAdapter({ kind: "llama-cpp", providerId: "llama-cpp", modelsPath: "/v1/models", chatPath: "/v1/chat/completions", credentialRequired: false }),
  "openai-compatible": new OpenAIProtocolAdapter({ kind: "openai-compatible", providerId: "custom", modelsPath: "/models", chatPath: "/chat/completions", credentialRequired: true }),
  anthropic: new AnthropicAdapter(),
  gemini: new GeminiAdapter(),
  ollama: new OllamaAdapter(),
};

export function getAdapter(kind: ProviderAdapterKind): ProviderAdapter {
  const adapter = adapters[kind];
  if (!adapter) throw new Error(`Unsupported provider adapter: ${kind}`);
  return adapter;
}

export function listProviderAdapterKinds() {
  return Object.keys(adapters) as ProviderAdapterKind[];
}

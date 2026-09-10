export type CapabilityState = "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN" | "PROVIDER_NOT_REPORTED";

export type ProviderAdapterKind =
  | "openai"
  | "anthropic"
  | "gemini"
  | "openrouter"
  | "ollama"
  | "lm-studio"
  | "llama-cpp"
  | "openai-compatible";

export type ProviderType = "builtin-cloud" | "local" | "custom";

export type NormalizedErrorKind =
  | "AUTH_FAILED"
  | "MODEL_NOT_FOUND"
  | "MODEL_UNAVAILABLE"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "CONTEXT_EXCEEDED"
  | "INVALID_REQUEST"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "POLICY_REJECTED"
  | "TOOL_UNSUPPORTED"
  | "STREAM_INTERRUPTED"
  | "UNKNOWN";

export interface CanonicalModelCapabilities {
  text: CapabilityState;
  vision: CapabilityState;
  audio: CapabilityState;
  video: CapabilityState;
  tools: CapabilityState;
  structuredOutput: CapabilityState;
  jsonMode: CapabilityState;
  streaming: CapabilityState;
  reasoning: CapabilityState;
  embeddings: CapabilityState;
  imageGeneration: CapabilityState;
  codeSpecialization: CapabilityState;
  fineTuning: CapabilityState;
  cachedInput: CapabilityState;
  batch: CapabilityState;
  temperature: CapabilityState;
  topP: CapabilityState;
  seed: CapabilityState;
  responseFormat: CapabilityState;
}

export interface CanonicalModel {
  id: string;
  displayName: string;
  providerId: string;
  family: string;
  version: string;
  aliases: string[];
  contextWindow: number | null;
  maxOutput: number | null;
  inputModalities: string[];
  outputModalities: string[];
  capabilities: CanonicalModelCapabilities;
  priceInput: number | null;
  priceOutput: number | null;
  priceCache: number | null;
  priceSource: "PROVIDER_REPORTED" | "ESTIMATED" | "UNKNOWN";
  availability: "AVAILABLE" | "PREVIEW" | "BETA" | "DEPRECATED" | "UNKNOWN";
  preview: boolean;
  rateLimitEvidence: string | null;
  lastDiscoveredAt: string | null;
  rawEvidenceState: "PROVIDER_REPORTED" | "HEURISTIC" | "UNKNOWN";
}

export interface ProviderSummary {
  id: string;
  name: string;
  kind: ProviderAdapterKind;
  type: ProviderType;
  baseUrl: string | null;
  authState: "CONFIGURED" | "NOT_CONFIGURED";
  credentialState: "CONFIGURED" | "NOT_CONFIGURED";
  credentialSource: "os-vault" | "ephemeral-memory" | "server-environment" | "none";
  modelsDiscovered: number;
  favoriteModel: string | null;
  health: "HEALTHY" | "DEGRADED" | "UNREACHABLE" | "NOT_EVALUATED" | "NOT_CONFIGURED";
  lastVerifiedAt: string | null;
  lastSuccessfulAuthAt: string | null;
  maskedKey: string | null;
  discoveryState: "NEVER_RUN" | "SUCCEEDED" | "FAILED" | "PARTIAL";
  customHeaders: string[];
  streaming: CapabilityState;
  timeoutMs: number;
}

export interface ConnectionTestEvidence {
  providerId: string;
  modelId: string | null;
  kind: "connection" | "model" | "stream" | "tools";
  startedAt: string;
  finishedAt: string;
  latencyMs: number;
  httpStatus: number | null;
  ok: boolean;
  streamingOutcome: "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN" | "FAILED" | "NOT_TESTED";
  toolOutcome: "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN" | "FAILED" | "NOT_TESTED";
  tokenEvidence: { input: number | null; output: number | null; total: number | null } | null;
  providerRequestId: string | null;
  errorKind: NormalizedErrorKind | null;
  errorDetail: string | null;
}

export type ProviderSessionStatus =
  | "READY"
  | "CONTEXT_PREPARING"
  | "WAITING_FOR_DISCLOSURE"
  | "PLANNING"
  | "WAITING_FOR_APPROVAL"
  | "RUNNING"
  | "TOOL_EXECUTING"
  | "APPLYING"
  | "VERIFYING"
  | "PREVIEW_STARTING"
  | "PREVIEWING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "ROLLED_BACK";

export interface ProviderSessionTelemetry {
  ttftMs: number | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cachedTokens: number | null;
  totalTokens: number | null;
  costSource: "PROVIDER_REPORTED" | "ESTIMATED" | "UNKNOWN";
  estimatedCost: number | null;
  toolCalls: number;
  filesChanged: number;
  testState: string | null;
  buildState: string | null;
  previewState: string | null;
  retries: number;
  providerRequestId: string | null;
  finishReason: string | null;
}

export interface ProviderSessionSummary {
  id: string;
  projectId: string | null;
  providerId: string;
  modelId: string;
  mode: "ASK" | "PLAN" | "IMPLEMENT" | "REVIEW" | "DEBUG" | "TEST" | "REFACTOR" | "SECURITY_AUDIT" | "FULL_MISSION";
  status: ProviderSessionStatus;
  task: string;
  contextScope: string;
  createdAt: string;
  updatedAt: string;
  disclosureConfirmed: boolean;
  disclosureDestination: string | null;
  cloudDisclosure: boolean;
  checkpointId: string | null;
  previewSessionId: string | null;
  autonomy: string;
  pendingApproval: { id: string; kind: string; summary: string; createdAt: string } | null;
  telemetry: ProviderSessionTelemetry;
  error: string | null;
}

export type ProviderSessionEventType =
  | "MODEL_TOKEN"
  | "MODEL_MESSAGE"
  | "TOOL_REQUEST"
  | "TOOL_STARTED"
  | "TOOL_FINISHED"
  | "FILE_READ"
  | "PATCH_PROPOSED"
  | "PATCH_APPLIED"
  | "COMMAND_STARTED"
  | "COMMAND_FINISHED"
  | "TEST_RESULT"
  | "BUILD_RESULT"
  | "PREVIEW_STATE"
  | "APPROVAL_REQUIRED"
  | "USAGE_UPDATE"
  | "ERROR"
  | "SESSION_COMPLETED";

export interface ProviderSessionEvent {
  id: string;
  sessionId: string;
  type: ProviderSessionEventType;
  at: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface ProviderSessionPatch {
  id: string;
  sessionId: string;
  file: string;
  oldText: string;
  newText: string;
  reason: string;
  risk: "safe" | "review" | "approval" | "blocked";
  state: "PROPOSED" | "APPLIED" | "REJECTED" | "ROLLED_BACK";
  createdAt: string;
  appliedAt: string | null;
}

export interface ProviderContextInspection {
  project: { id: string; name: string; path: string; branch: string };
  task: string;
  model: string;
  provider: string;
  destination: string;
  filesIncluded: Array<{ path: string; reason: string; characters: number }>;
  filesExcluded?: Array<{ path: string; reason: string }>;
  totalCharacters: number;
  estimatedTokens: number;
  diagnostics: unknown[];
  git: unknown;
  technology: string[];
  disclosureConfirmed: boolean;
  sourceCodeIncluded: boolean;
}

export const UNKNOWN_CAPABILITIES: CanonicalModelCapabilities = {
  text: "UNKNOWN",
  vision: "UNKNOWN",
  audio: "UNKNOWN",
  video: "UNKNOWN",
  tools: "UNKNOWN",
  structuredOutput: "UNKNOWN",
  jsonMode: "UNKNOWN",
  streaming: "UNKNOWN",
  reasoning: "UNKNOWN",
  embeddings: "UNKNOWN",
  imageGeneration: "UNKNOWN",
  codeSpecialization: "UNKNOWN",
  fineTuning: "UNKNOWN",
  cachedInput: "UNKNOWN",
  batch: "UNKNOWN",
  temperature: "UNKNOWN",
  topP: "UNKNOWN",
  seed: "UNKNOWN",
  responseFormat: "UNKNOWN",
};

export function maskApiKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "••••••••";
  return `••••••••••••••••••••••••${trimmed.slice(-4)}`;
}

export function normalizeProviderError(status: number | null, message: string): NormalizedErrorKind {
  const text = message.toLowerCase();
  if (status === 401 || status === 403 || /invalid api key|unauthorized|authentication|auth/i.test(message)) return "AUTH_FAILED";
  if (status === 404 || /model not found|does not exist/i.test(message)) return "MODEL_NOT_FOUND";
  if (status === 429 && /quota|billing|credit|insufficient/i.test(message)) return "QUOTA_EXCEEDED";
  if (status === 429 || /rate.?limit|too many requests/.test(text)) return "RATE_LIMITED";
  if (/context|too long|maximum context|token limit/.test(text)) return "CONTEXT_EXCEEDED";
  if (status === 400 || /invalid request|bad request/.test(text)) return "INVALID_REQUEST";
  if (/timeout|timed out|abort/i.test(message)) return "TIMEOUT";
  if (/fetch failed|econn|enotfound|network|socket/i.test(message)) return "NETWORK_ERROR";
  if (/tool|function calling not supported/i.test(message)) return "TOOL_UNSUPPORTED";
  if (/stream/i.test(message) && /interrupt|closed|aborted/.test(text)) return "STREAM_INTERRUPTED";
  if (/policy|moderation|blocked|rejected/i.test(message)) return "POLICY_REJECTED";
  if (status !== null && status >= 500) return "PROVIDER_ERROR";
  if (status !== null && status >= 400) return "INVALID_REQUEST";
  return "UNKNOWN";
}

export function normalizeModelRecord(providerId: string, raw: unknown, nowIso: string): CanonicalModel {
  const record = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : "UNKNOWN";
  const displayName = typeof record.display_name === "string" && record.display_name.trim()
    ? record.display_name.trim()
    : typeof record.name === "string" && record.name.trim()
      ? record.name.trim()
      : id;
  const contextWindow = typeof record.context_window === "number" && Number.isFinite(record.context_window)
    ? Math.round(record.context_window)
    : typeof record.context_length === "number" && Number.isFinite(record.context_length)
      ? Math.round(record.context_length)
      : null;
  const maxOutput = typeof record.max_output === "number" && Number.isFinite(record.max_output)
    ? Math.round(record.max_output)
    : null;
  const pricing = typeof record.pricing === "object" && record.pricing !== null ? record.pricing as Record<string, unknown> : null;
  const price = (key: string): number | null => {
    const value = pricing?.[key];
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return null;
  };
  const priceInput = price("prompt") ?? price("input");
  const priceOutput = price("completion") ?? price("output");
  const supported = (value: unknown): CapabilityState => value === true ? "SUPPORTED" : value === false ? "UNSUPPORTED" : "PROVIDER_NOT_REPORTED";
  const caps = typeof record.capabilities === "object" && record.capabilities !== null ? record.capabilities as Record<string, unknown> : {};
  const supportedTools = Array.isArray(record.supported_parameters) ? record.supported_parameters.map((entry) => String(entry)) : [];
  const hasToolParam = (name: string) => supportedTools.includes(name);
  return {
    id,
    displayName,
    providerId,
    family: typeof record.family === "string" && record.family.trim() ? record.family.trim() : id.split(/[:/-]/)[0] || "UNKNOWN",
    version: typeof record.version === "string" && record.version.trim() ? record.version.trim() : "UNKNOWN",
    aliases: Array.isArray(record.aliases) ? record.aliases.filter((entry): entry is string => typeof entry === "string") : [],
    contextWindow,
    maxOutput,
    inputModalities: Array.isArray(record.input_modalities) ? record.input_modalities.filter((entry): entry is string => typeof entry === "string") : ["text"],
    outputModalities: Array.isArray(record.output_modalities) ? record.output_modalities.filter((entry): entry is string => typeof entry === "string") : ["text"],
    capabilities: {
      ...UNKNOWN_CAPABILITIES,
      text: "SUPPORTED",
      tools: caps.tools !== undefined ? supported(caps.tools) : supported(record.supports_tools ?? (supportedTools.length ? true : undefined)),
      streaming: caps.streaming !== undefined ? supported(caps.streaming) : "PROVIDER_NOT_REPORTED",
      vision: caps.vision !== undefined ? supported(caps.vision) : supported(record.supports_vision),
      reasoning: caps.reasoning !== undefined ? supported(caps.reasoning) : supported(record.supports_reasoning),
      structuredOutput: caps.structured_output !== undefined ? supported(caps.structured_output) : "PROVIDER_NOT_REPORTED",
      jsonMode: hasToolParam("response_format") ? "SUPPORTED" : "PROVIDER_NOT_REPORTED",
      temperature: hasToolParam("temperature") ? "SUPPORTED" : "PROVIDER_NOT_REPORTED",
      topP: hasToolParam("top_p") ? "SUPPORTED" : "PROVIDER_NOT_REPORTED",
      seed: hasToolParam("seed") ? "SUPPORTED" : "PROVIDER_NOT_REPORTED",
    },
    priceInput,
    priceOutput,
    priceCache: price("cache") ?? price("cached_input"),
    priceSource: priceInput !== null || priceOutput !== null ? "PROVIDER_REPORTED" : "UNKNOWN",
    availability: /deprecated/i.test(id) ? "DEPRECATED" : /preview/i.test(id) ? "PREVIEW" : /beta/i.test(id) ? "BETA" : "UNKNOWN",
    preview: /preview|beta/i.test(id),
    rateLimitEvidence: typeof record.rate_limit === "string" ? record.rate_limit : null,
    lastDiscoveredAt: nowIso,
    rawEvidenceState: "PROVIDER_REPORTED",
  };
}

export function redactSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/authorization|api[-_ ]?key|x-api-key|x-goog-api-key|cookie|set-cookie/i.test(key)) {
      void value;
      redacted[key] = "[REDACTED]";
    } else redacted[key] = value;
  }
  return redacted;
}

export function containsPlaintextSecret(payload: unknown, secrets: string[]): boolean {
  if (secrets.length === 0) return false;
  const text = JSON.stringify(payload);
  return secrets.some((secret) => secret.length >= 8 && text.includes(secret));
}

export interface LocalAIProviderStatus {
  provider: "ollama" | "lm-studio" | "none";
  available: boolean;
  endpoint?: string;
  models: string[];
  reason?: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

interface LmStudioModelsResponse {
  data?: Array<{ id?: string }>;
}

async function responseJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

export async function detectLocalAIProvider(): Promise<LocalAIProviderStatus> {
  const ollama = await responseJson<OllamaTagsResponse>("http://127.0.0.1:11434/api/tags");
  const ollamaModels = (ollama?.models || []).map((model) => model.name).filter((name): name is string => Boolean(name));
  if (ollamaModels.length) return { provider: "ollama", available: true, endpoint: "http://127.0.0.1:11434", models: ollamaModels };
  if (ollama) return { provider: "ollama", available: false, endpoint: "http://127.0.0.1:11434", models: [], reason: "Ollama is reachable but no local model is installed." };

  const lmStudio = await responseJson<LmStudioModelsResponse>("http://127.0.0.1:1234/v1/models");
  const lmStudioModels = (lmStudio?.data || []).map((model) => model.id).filter((id): id is string => Boolean(id));
  if (lmStudioModels.length) return { provider: "lm-studio", available: true, endpoint: "http://127.0.0.1:1234", models: lmStudioModels };
  if (lmStudio) return { provider: "lm-studio", available: false, endpoint: "http://127.0.0.1:1234", models: [], reason: "LM Studio is reachable but no loaded local model is reported." };

  return { provider: "none", available: false, models: [], reason: "No supported local AI server is reachable. KForge will not use fabricated AI output." };
}

export async function requestLocalPlan(system: string, user: string): Promise<{ provider: LocalAIProviderStatus; content: string }> {
  const provider = await detectLocalAIProvider();
  if (!provider.available || !provider.endpoint || !provider.models[0]) throw new Error(provider.reason || "Local AI is unavailable.");
  if (provider.provider === "ollama") {
    const response = await fetch(`${provider.endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: provider.models[0], stream: false, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error(`Ollama request failed with HTTP ${response.status}.`);
    const payload = await response.json() as { message?: { content?: string } };
    const content = payload.message?.content?.trim();
    if (!content) throw new Error("Ollama returned no plan content.");
    return { provider, content };
  }
  const response = await fetch(`${provider.endpoint}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: provider.models[0], messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.2 }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`LM Studio request failed with HTTP ${response.status}.`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("LM Studio returned no plan content.");
  return { provider, content };
}

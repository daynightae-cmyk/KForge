import { useEffect, useMemo, useState } from "react";
import type { ProjectSummary } from "@shared/workspace";
import type { CanonicalModel, ConnectionTestEvidence, ProviderSummary } from "@shared/providerCommandCenter";
import { fetchJson, jsonRequest } from "./api";
import { EmptyState, StatusBadge } from "./ui";
import "./providerStudio.css";

interface SessionRow {
  id: string;
  projectId: string | null;
  providerId: string;
  modelId: string;
  mode: string;
  status: string;
  task: string;
  createdAt: string;
}

const MODES = ["ASK", "PLAN", "IMPLEMENT", "REVIEW", "DEBUG", "TEST", "REFACTOR", "SECURITY_AUDIT", "FULL_MISSION"];
const AUTONOMY = ["CHAT ONLY", "READ ONLY", "REVIEW", "SAFE IMPLEMENTATION", "FULL PROJECT MISSION"];

export default function ProviderStudio({ project }: { view: string; project?: ProjectSummary }) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("openai");
  const [models, setModels] = useState<CanonicalModel[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [tab, setTab] = useState<"MODELS" | "SESSIONS" | "USAGE" | "CONFIG" | "SECURITY" | "EVENTS">("MODELS");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [capabilityFilter, setCapabilityFilter] = useState<string>("all");
  const [selectedModel, setSelectedModel] = useState<CanonicalModel | null>(null);
  const [testEvidence, setTestEvidence] = useState<ConnectionTestEvidence | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealConfirm, setRevealConfirm] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [form, setForm] = useState({ name: "", baseUrl: "", apiKey: "", organization: "", timeoutMs: 30000, streaming: true });
  const [assign, setAssign] = useState({ model: "", mode: "PLAN", contextScope: "Repository", task: "", disclosure: false, autonomy: "SAFE IMPLEMENTATION" });
  const [compare, setCompare] = useState<string[]>([]);

  const refresh = async () => {
    try {
      const [prov, sess] = await Promise.all([
        fetchJson<{ providers: ProviderSummary[] }>("/api/workspace/ai/command-center/providers"),
        fetchJson<{ sessions: SessionRow[] }>("/api/workspace/ai/command-center/sessions"),
      ]);
      setProviders(prov.providers || []);
      setSessions(sess.sessions || []);
      if (!prov.providers.some((entry) => entry.id === selectedProvider) && prov.providers[0]) setSelectedProvider(prov.providers[0].id);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Provider Studio unavailable.");
    }
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!selectedProvider) return;
    void fetchJson<{ models: CanonicalModel[] }>(`/api/workspace/ai/command-center/providers/${encodeURIComponent(selectedProvider)}/models`)
      .then((data) => {
        setModels(data.models || []);
        setSelectedModel((current) => (current && data.models.some((entry) => entry.id === current.id) ? current : null));
      })
      .catch(() => setModels([]));
  }, [selectedProvider]);

  const activeProvider = useMemo(() => providers.find((entry) => entry.id === selectedProvider) || null, [providers, selectedProvider]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return models
      .filter((model) => (!query || model.id.toLowerCase().includes(query) || model.displayName.toLowerCase().includes(query)))
      .filter((model) => {
        if (capabilityFilter === "all") return true;
        if (capabilityFilter === "tools") return model.capabilities.tools === "SUPPORTED";
        if (capabilityFilter === "vision") return model.capabilities.vision === "SUPPORTED";
        if (capabilityFilter === "streaming") return model.capabilities.streaming === "SUPPORTED";
        if (capabilityFilter === "reasoning") return model.capabilities.reasoning === "SUPPORTED";
        return true;
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [models, search, capabilityFilter]);

  const runTest = async (kind: ConnectionTestEvidence["kind"]) => {
    setMessage(`Running ${kind} test… No project code is sent.`);
    try {
      const evidence = await fetchJson<ConnectionTestEvidence>(
        `/api/workspace/ai/command-center/providers/${encodeURIComponent(selectedProvider)}/test`,
        jsonRequest({ kind, modelId: selectedModel?.id || assign.model || null }),
      );
      setTestEvidence(evidence);
      setMessage(evidence.ok ? `${kind} test passed in ${evidence.latencyMs}ms.` : `${kind} test failed: ${evidence.errorDetail || evidence.errorKind}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Provider test failed.");
    }
  };

  const discover = async () => {
    setMessage("Discovering models… Contacting provider models endpoint.");
    try {
      const result = await fetchJson<{ models: CanonicalModel[] }>(
        `/api/workspace/ai/command-center/providers/${encodeURIComponent(selectedProvider)}/discover`,
        jsonRequest({}),
      );
      setModels(result.models || []);
      setMessage(`Discovered ${result.models?.length || 0} models from provider evidence.`);
      void refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Discovery failed.");
    }
  };

  const addProvider = async () => {
    setMessage("Registering custom provider… Credential is stored server-side and never echoed.");
    try {
      const result = await fetchJson<{ provider: ProviderSummary }>(
        "/api/workspace/ai/command-center/providers",
        jsonRequest({ name: form.name, baseUrl: form.baseUrl, apiKey: form.apiKey, organization: form.organization, timeoutMs: form.timeoutMs, streaming: form.streaming }),
      );
      setForm({ name: "", baseUrl: "", apiKey: "", organization: "", timeoutMs: 30000, streaming: true });
      setSelectedProvider(result.provider.id);
      setMessage(`Provider ${result.provider.name} registered. Test connection, then Discover Models.`);
      void refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Provider registration failed.");
    }
  };

  const reveal = async () => {
    if (!revealConfirm) {
      setMessage("Full key reveal requires explicit confirmation. Tick the confirmation first.");
      return;
    }
    try {
      const result = await fetchJson<{ masked: string; value?: string }>(
        `/api/workspace/ai/command-center/providers/${encodeURIComponent(selectedProvider)}/reveal`,
        jsonRequest({ confirmed: true }),
      );
      setRevealed(result.value || null);
      window.setTimeout(() => setRevealed(null), 15000);
      setRevealConfirm(false);
      setMessage("Full key revealed temporarily. It will re-mask automatically and was not written to logs or history.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reveal failed.");
    }
  };

  const createSession = async () => {
    if (!assign.model || !assign.task.trim()) {
      setMessage("Choose a model and describe the engineering task before starting a session.");
      return;
    }
    try {
      const result = await fetchJson<{ session: SessionRow }>(
        "/api/workspace/ai/command-center/sessions",
        jsonRequest({ projectId: project?.id || null, providerId: selectedProvider, modelId: assign.model, mode: assign.mode, task: assign.task, contextScope: assign.contextScope, disclosureConfirmed: assign.disclosure }),
      );
      setSessions((current) => [result.session, ...current]);
      setTab("SESSIONS");
      setMessage(`Session ${result.session.id} created in READY state. Tool execution remains authority-gated.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Session creation failed.");
    }
  };

  const toggleCompare = (id: string) => setCompare((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id].slice(0, 4)));
  const compared = models.filter((model) => compare.includes(model.id));

  return (
    <div className="kw-provider-studio" data-testid="provider-studio">
      <div className="kw-provider-studio-head">
        <div>
          <p>KNOuX / AI / Provider Studio</p>
          <h2>Provider + Model Command Center</h2>
          <small>Full-width control plane. Credentials stay masked. Discovery uses real provider endpoints. Unknown stays UNKNOWN.</small>
        </div>
        <div className="kw-provider-studio-actions">
          <button onClick={() => { setLeftOpen((open) => !open); }}>{leftOpen ? "Hide providers" : "Show providers"}</button>
          <button onClick={() => { setRightOpen((open) => !open); }}>{rightOpen ? "Hide inspector" : "Show inspector"}</button>
          <button onClick={() => void refresh()}>Refresh</button>
        </div>
      </div>
      {message && <p className="kw-message" role="status">{message}</p>}
      <div className="kw-provider-studio-grid" data-left={leftOpen ? "open" : "closed"} data-right={rightOpen ? "open" : "closed"}>
        {leftOpen && (
          <aside className="kw-provider-list" aria-label="Providers">
            <h3>Providers</h3>
            {(providers || []).map((provider) => (
              <button key={provider.id} className={provider.id === selectedProvider ? "is-active" : ""} onClick={() => setSelectedProvider(provider.id)}>
                <strong>{provider.name}</strong>
                <small>{provider.type} · {provider.authState} · {provider.modelsDiscovered} models</small>
                <span><StatusBadge value={provider.health} /> <StatusBadge value={provider.discoveryState} /></span>
              </button>
            ))}
            <section className="kw-provider-add">
              <h4>Add custom OpenAI-compatible provider</h4>
              <label>Provider name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Reasonix" /></label>
              <label>Base URL<input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://provider.example/v1" /></label>
              <label>API key<input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder="sk-…" autoComplete="off" /></label>
              <label>Organization / project<input value={form.organization} onChange={(event) => setForm({ ...form, organization: event.target.value })} placeholder="optional" /></label>
              <div className="kw-row">
                <button onClick={() => void addProvider()}>Add provider</button>
              </div>
            </section>
          </aside>
        )}
        <main className="kw-provider-main" aria-label="Provider workspace">
          {activeProvider && (
            <section className="kw-provider-hero">
              <strong>{activeProvider.name}</strong>
              <span><StatusBadge value={activeProvider.health} /> <StatusBadge value={activeProvider.authState} /></span>
              <code>{activeProvider.baseUrl || "no endpoint"}</code>
              <small>Credential: {activeProvider.maskedKey || "NOT_CONFIGURED"} · Source: {activeProvider.credentialSource} · Last verified: {activeProvider.lastVerifiedAt || "never"}</small>
              <div className="kw-row">
                <button onClick={() => void runTest("connection")}>Test connection</button>
                <button onClick={() => void runTest("model")}>Test model</button>
                <button onClick={() => void runTest("stream")}>Test stream</button>
                <button onClick={() => void runTest("tools")}>Test tool calling</button>
                <button onClick={() => void discover()}>Discover all models</button>
              </div>
              {testEvidence && (
                <details open>
                  <summary>Last test evidence · {testEvidence.kind} · {testEvidence.ok ? "PASS" : "FAIL"} · {testEvidence.latencyMs}ms</summary>
                  <pre>{JSON.stringify({ ...testEvidence, errorDetail: testEvidence.errorDetail }, null, 2)}</pre>
                </details>
              )}
            </section>
          )}
          <nav className="kw-provider-tabs" aria-label="Provider tabs">
            {(["MODELS", "SESSIONS", "USAGE", "CONFIG", "SECURITY", "EVENTS"] as const).map((entry) => (
              <button key={entry} className={tab === entry ? "is-active" : ""} onClick={() => setTab(entry)}>{entry}</button>
            ))}
          </nav>
          {tab === "MODELS" && (
            <section>
              <div className="kw-row">
                <input aria-label="Search models" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search models…" />
                <select aria-label="Capability filter" value={capabilityFilter} onChange={(event) => setCapabilityFilter(event.target.value)}>
                  <option value="all">All capabilities</option>
                  <option value="tools">Tools supported</option>
                  <option value="vision">Vision supported</option>
                  <option value="streaming">Streaming supported</option>
                  <option value="reasoning">Reasoning supported</option>
                </select>
              </div>
              {filtered.length === 0 ? <EmptyState title="No models discovered" detail="Run Discover All Models against the real provider endpoint. Capabilities are never invented." /> : (
                <div className="kw-model-table" role="table" aria-label="Discovered models">
                  {filtered.map((model) => (
                    <article key={model.id} role="row" className={selectedModel?.id === model.id ? "is-selected" : ""}>
                      <div>
                        <strong>{model.displayName}</strong>
                        <code>{model.id}</code>
                        <small>ctx {model.contextWindow ?? "UNKNOWN"} · {model.priceSource} · {model.availability}</small>
                      </div>
                      <div className="kw-model-flags">
                        <StatusBadge value={model.capabilities.tools} />
                        <span>tools</span>
                        <StatusBadge value={model.capabilities.vision} />
                        <span>vision</span>
                        <StatusBadge value={model.capabilities.streaming} />
                        <span>stream</span>
                      </div>
                      <div className="kw-row">
                        <button onClick={() => { setSelectedModel(model); setAssign({ ...assign, model: model.id }); }}>Inspect</button>
                        <button onClick={() => toggleCompare(model.id)}>{compare.includes(model.id) ? "Uncompare" : "Compare"}</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {compared.length >= 2 && (
                <details open>
                  <summary>Compare {compared.length} models</summary>
                  <pre>{JSON.stringify(compared.map((model) => ({ id: model.id, context: model.contextWindow, tools: model.capabilities.tools, vision: model.capabilities.vision, price: [model.priceInput, model.priceOutput], availability: model.availability })), null, 2)}</pre>
                </details>
              )}
            </section>
          )}
          {tab === "SESSIONS" && (
            <section>
              <h3>Model sessions</h3>
              <div className="kw-row">
                <input aria-label="Task composer" value={assign.task} onChange={(event) => setAssign({ ...assign, task: event.target.value })} placeholder="Fix the export flow and run the full test suite…" />
                <select aria-label="Session mode" value={assign.mode} onChange={(event) => setAssign({ ...assign, mode: event.target.value })}>
                  {MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                </select>
                <select aria-label="Autonomy" value={assign.autonomy} onChange={(event) => setAssign({ ...assign, autonomy: event.target.value })}>
                  {AUTONOMY.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                </select>
                <button onClick={() => void createSession()}>Use on project</button>
              </div>
              <label><input type="checkbox" checked={assign.disclosure} onChange={(event) => setAssign({ ...assign, disclosure: event.target.checked })} /> I confirm project content may leave this machine for provider {activeProvider?.name || selectedProvider}. Model: {assign.model || "none selected"}. Scope: {assign.contextScope}. Autonomy: {assign.autonomy}.</label>
              {sessions.length === 0 ? <EmptyState title="No sessions" detail="Project sessions appear here with provider, model, mode, task and result evidence." /> : (
                <ul className="kw-session-list">
                  {sessions.map((session) => (
                    <li key={session.id}><strong>{session.mode}</strong> <code>{session.modelId}</code> <span>{session.status}</span><small>{session.task}</small></li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {tab === "USAGE" && (
            <section>
              <h3>Token and cost HUD</h3>
              <p>Model: {selectedModel?.id || assign.model || "none"} · Context: {selectedModel?.contextWindow ?? "UNKNOWN"} · Last latency: {testEvidence?.latencyMs ?? "UNKNOWN"}ms · Tokens: UNKNOWN until a provider-reported run exists. Costs are ESTIMATED unless the provider reports actual cost.</p>
            </section>
          )}
          {tab === "CONFIG" && (
            <section>
              <h3>Configuration</h3>
              <p>Timeout: {activeProvider?.timeoutMs}ms · Streaming: {activeProvider?.streaming} · Custom headers: {(activeProvider?.customHeaders || []).join(", ") || "none"}</p>
              <p>Parameters are negotiated per model capability. Temperature, top_p, seed, JSON mode and reasoning effort appear only where the model reports support.</p>
            </section>
          )}
          {tab === "SECURITY" && (
            <section>
              <h3>Security</h3>
              <p>Credential: {activeProvider?.maskedKey || "NOT_CONFIGURED"} ({activeProvider?.credentialSource})</p>
              <label><input type="checkbox" checked={revealConfirm} onChange={(event) => setRevealConfirm(event.target.checked)} /> I explicitly request full key reveal for this session only.</label>
              <div className="kw-row">
                <button onClick={() => void reveal()}>Reveal full key</button>
                <button onClick={() => { setRevealed(null); }}>Mask again</button>
              </div>
              {revealed && <pre data-testid="revealed-key">{revealed}</pre>}
              <p>Full keys never appear in logs, telemetry, request history, execution ledger, session history or error output. Reveal is temporary and privileged.</p>
            </section>
          )}
          {tab === "EVENTS" && (
            <section>
              <h3>Events</h3>
              <p>Discovery: {activeProvider?.discoveryState} · Health: {activeProvider?.health} · Last verified: {activeProvider?.lastVerifiedAt || "never"}</p>
              <pre>{JSON.stringify({ provider: activeProvider, lastTest: testEvidence }, null, 2)}</pre>
            </section>
          )}
        </main>
        {rightOpen && (
          <aside className="kw-provider-inspector" aria-label="Model inspector">
            <h3>Inspector</h3>
            {!selectedModel ? <p>Select a model to inspect capabilities, limits, pricing, compatibility and raw provider metadata.</p> : (
              <div>
                <strong>{selectedModel.displayName}</strong>
                <code>{selectedModel.id}</code>
                <p>Provider: {selectedModel.providerId} · Family: {selectedModel.family} · Version: {selectedModel.version}</p>
                <p>Context: {selectedModel.contextWindow ?? "UNKNOWN"} · Max output: {selectedModel.maxOutput ?? "UNKNOWN"}</p>
                <p>Price: in {selectedModel.priceInput ?? "UNKNOWN"} / out {selectedModel.priceOutput ?? "UNKNOWN"} ({selectedModel.priceSource})</p>
                <details open><summary>Capabilities</summary><pre>{JSON.stringify(selectedModel.capabilities, null, 2)}</pre></details>
                <details><summary>Raw provider metadata (secondary)</summary><pre>{JSON.stringify(selectedModel, null, 2)}</pre></details>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

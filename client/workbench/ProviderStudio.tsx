import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSummary } from "@shared/workspace";
import type {
  CanonicalModel,
  ConnectionTestEvidence,
  ProviderSessionSummary,
  ProviderSummary,
} from "@shared/providerCommandCenter";
import { fetchJson, jsonRequest } from "./api";
import { EmptyState, StatusBadge } from "./ui";
import SessionWorkspace from "./SessionWorkspace";
import "./providerStudio.css";

const MODES = ["ASK", "PLAN", "IMPLEMENT", "REVIEW", "DEBUG", "TEST", "REFACTOR", "SECURITY_AUDIT", "FULL_MISSION"] as const;
const AUTONOMY = ["CHAT ONLY", "READ ONLY", "REVIEW", "SAFE IMPLEMENTATION", "FULL PROJECT MISSION"] as const;

type ProviderTab = "MODELS" | "SESSIONS" | "USAGE" | "CONFIG" | "SECURITY" | "EVENTS";

interface VaultStatus {
  availability: string;
  backend: string;
  migration: { outcome: string; migrated: number; detail: string };
}

function parseHeaderLines(value: string) {
  const result: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const name = line.slice(0, index).trim();
    const headerValue = line.slice(index + 1).trim();
    if (name && headerValue) result[name] = headerValue;
  }
  return result;
}

export default function ProviderStudio({ project }: { view: string; project?: ProjectSummary }) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("openai");
  const [models, setModels] = useState<CanonicalModel[]>([]);
  const [sessions, setSessions] = useState<ProviderSessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<ProviderSessionSummary | null>(null);
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [tab, setTab] = useState<ProviderTab>("MODELS");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [capabilityFilter, setCapabilityFilter] = useState("all");
  const [selectedModel, setSelectedModel] = useState<CanonicalModel | null>(null);
  const [testEvidence, setTestEvidence] = useState<ConnectionTestEvidence | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const revealTimer = useRef<number | null>(null);
  const [revealConfirm, setRevealConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [replacementKey, setReplacementKey] = useState("");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [form, setForm] = useState({ name: "", baseUrl: "", apiKey: "", organization: "", timeoutMs: 30000, streaming: true, modelsEndpoint: "", chatEndpoint: "", customHeaders: "" });
  const [assign, setAssign] = useState({ model: "", mode: "PLAN", contextScope: "Repository", task: "", disclosure: false, autonomy: "SAFE IMPLEMENTATION" });
  const [compare, setCompare] = useState<string[]>([]);

  const activeProvider = useMemo(() => providers.find((entry) => entry.id === selectedProvider) || null, [providers, selectedProvider]);

  const refresh = async () => {
    try {
      const [prov, sess, vaultState] = await Promise.all([
        fetchJson<{ providers: ProviderSummary[] }>("/api/workspace/ai/command-center/providers"),
        fetchJson<{ sessions: ProviderSessionSummary[] }>("/api/workspace/ai/command-center/sessions"),
        fetchJson<VaultStatus>("/api/workspace/ai/command-center/vault"),
      ]);
      setProviders(prov.providers || []);
      setSessions(sess.sessions || []);
      setVault(vaultState);
      if (!prov.providers.some((entry) => entry.id === selectedProvider) && prov.providers[0]) setSelectedProvider(prov.providers[0].id);
      if (activeSession) {
        const updated = sess.sessions.find((entry) => entry.id === activeSession.id);
        if (updated) setActiveSession(updated);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Provider Studio unavailable.");
    }
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => () => { if (revealTimer.current !== null) window.clearTimeout(revealTimer.current); }, []);

  useEffect(() => {
    setRevealed(null);
    setRevealConfirm(false);
    setDeleteConfirm(false);
    setTestEvidence(null);
    if (!selectedProvider) return;
    void fetchJson<{ models: CanonicalModel[] }>(`/api/workspace/ai/command-center/providers/${encodeURIComponent(selectedProvider)}/models`)
      .then((data) => {
        setModels(data.models || []);
        setSelectedModel((current) => current && data.models.some((entry) => entry.id === current.id) ? current : null);
      })
      .catch(() => setModels([]));
  }, [selectedProvider]);

  const perform = async (label: string, task: () => Promise<void>) => {
    setBusy(true);
    setMessage(label);
    try {
      await task();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${label} failed.`);
    } finally {
      setBusy(false);
    }
  };

  const runTest = (kind: ConnectionTestEvidence["kind"]) => perform(`Running real ${kind} probe… No project code is sent.`, async () => {
    const evidence = await fetchJson<ConnectionTestEvidence>(
      `/api/workspace/ai/command-center/providers/${encodeURIComponent(selectedProvider)}/test`,
      jsonRequest({ kind, modelId: selectedModel?.id || assign.model || null }),
    );
    setTestEvidence(evidence);
    setMessage(evidence.ok ? `${kind} probe passed in ${evidence.latencyMs}ms.` : `${kind} probe did not pass: ${evidence.errorDetail || evidence.errorKind || "provider did not prove capability"}`);
    await refresh();
  });

  const discover = (force = false) => perform(force ? "Refreshing provider model evidence…" : "Discovering models from provider protocol…", async () => {
    const route = force ? "refresh" : "discover";
    const result = await fetchJson<{ models: CanonicalModel[]; cached?: boolean }>(
      `/api/workspace/ai/command-center/providers/${encodeURIComponent(selectedProvider)}/${route}`,
      jsonRequest({}),
    );
    setModels(result.models || []);
    setSelectedModel(null);
    setMessage(`${result.cached ? "Recovered cached" : "Discovered"} ${result.models?.length || 0} model(s) from ${activeProvider?.name || selectedProvider} evidence.`);
    await refresh();
  });

  const addProvider = () => perform("Registering custom provider with protected credentials…", async () => {
    const result = await fetchJson<{ provider: ProviderSummary }>(
      "/api/workspace/ai/command-center/providers",
      jsonRequest({
        name: form.name,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
        organization: form.organization,
        timeoutMs: form.timeoutMs,
        streaming: form.streaming,
        modelsEndpoint: form.modelsEndpoint || undefined,
        chatEndpoint: form.chatEndpoint || undefined,
        customHeaders: parseHeaderLines(form.customHeaders),
      }),
    );
    setForm({ name: "", baseUrl: "", apiKey: "", organization: "", timeoutMs: 30000, streaming: true, modelsEndpoint: "", chatEndpoint: "", customHeaders: "" });
    setSelectedProvider(result.provider.id);
    setMessage(`Provider ${result.provider.name} registered. Run Test connection, then Discover all models.`);
    await refresh();
  });

  const replaceKey = () => perform("Replacing provider credential in the secure credential boundary…", async () => {
    await fetchJson(`/api/workspace/ai/command-center/providers/${encodeURIComponent(selectedProvider)}/key`, jsonRequest({ apiKey: replacementKey }));
    setReplacementKey("");
    setMessage("Credential replaced. Connection and model health remain unverified until tested again.");
    await refresh();
  });

  const deleteKey = () => perform("Deleting protected credential…", async () => {
    await fetchJson(`/api/workspace/ai/command-center/providers/${encodeURIComponent(selectedProvider)}/key`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: deleteConfirm }) });
    setDeleteConfirm(false);
    setRevealed(null);
    setMessage("Credential deleted. Provider is NOT_CONFIGURED until a new credential is supplied.");
    await refresh();
  });

  const reveal = () => perform("Requesting deliberate temporary reveal…", async () => {
    if (!revealConfirm) throw new Error("Full key reveal requires explicit confirmation first.");
    const result = await fetchJson<{ masked: string; value?: string; expiresInMs?: number }>(
      `/api/workspace/ai/command-center/providers/${encodeURIComponent(selectedProvider)}/reveal`,
      jsonRequest({ confirmed: true }),
    );
    setRevealed(result.value || null);
    setRevealConfirm(false);
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
    revealTimer.current = window.setTimeout(() => { setRevealed(null); revealTimer.current = null; }, result.expiresInMs || 15_000);
    setMessage("Full credential revealed temporarily by explicit action. It will re-mask automatically.");
  });

  const copyRevealed = async () => {
    if (!revealed) { setMessage("Reveal the credential explicitly before copying it."); return; }
    try {
      await navigator.clipboard.writeText(revealed);
      setMessage("Credential copied from the privileged temporary reveal. No copy value is recorded in session evidence.");
    } catch {
      setMessage("Clipboard access is unavailable in this runtime.");
    }
  };

  const createSession = () => perform("Creating auditable AI engineering session…", async () => {
    if (!assign.model || !assign.task.trim()) throw new Error("Choose a model and describe the engineering task before creating a session.");
    const result = await fetchJson<{ session: ProviderSessionSummary }>(
      "/api/workspace/ai/command-center/sessions",
      jsonRequest({ projectId: project?.id || null, providerId: selectedProvider, modelId: assign.model, mode: assign.mode, task: assign.task, contextScope: assign.contextScope, disclosureConfirmed: assign.disclosure, autonomy: assign.autonomy }),
    );
    setSessions((current) => [result.session, ...current.filter((entry) => entry.id !== result.session.id)]);
    setActiveSession(result.session);
    setMessage("");
  });

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return models
      .filter((model) => !query || model.id.toLowerCase().includes(query) || model.displayName.toLowerCase().includes(query))
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

  const toggleCompare = (id: string) => setCompare((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id].slice(0, 4));
  const compared = models.filter((model) => compare.includes(model.id));

  if (activeSession) {
    return <SessionWorkspace initialSession={activeSession} provider={providers.find((entry) => entry.id === activeSession.providerId) || null} providers={providers} project={project} onBack={() => { setActiveSession(null); setTab("SESSIONS"); void refresh(); }} onSessionChange={(next) => setActiveSession(next)} />;
  }

  return (
    <div className="kw-provider-studio" data-testid="provider-studio">
      <header className="kw-provider-studio-head">
        <div>
          <p>KNOuX / AI / Provider Studio</p>
          <h2>Provider + Model Command Center</h2>
          <small>Full-width engineering control plane. Credentials stay masked. Provider protocols are adapter-owned. Unknown stays UNKNOWN.</small>
        </div>
        <div className="kw-provider-studio-actions">
          <span className="kw-vault-pill" title={vault?.migration.detail}>Vault <strong>{vault?.backend || "UNKNOWN"}</strong></span>
          <button onClick={() => setLeftOpen((open) => !open)}>{leftOpen ? "Hide providers" : "Show providers"}</button>
          <button onClick={() => setRightOpen((open) => !open)}>{rightOpen ? "Hide inspector" : "Show inspector"}</button>
          <button disabled={busy} onClick={() => void refresh()}>Refresh</button>
        </div>
      </header>

      {message && <p className="kw-message" role="status">{message}</p>}
      <div className="kw-provider-studio-grid" data-left={leftOpen ? "open" : "closed"} data-right={rightOpen ? "open" : "closed"}>
        {leftOpen && (
          <aside className="kw-provider-list" aria-label="Providers">
            <div className="kw-pane-heading"><strong>PROVIDERS</strong><small>{providers.length}</small></div>
            {providers.map((providerRow) => (
              <button key={providerRow.id} className={providerRow.id === selectedProvider ? "is-active" : ""} onClick={() => setSelectedProvider(providerRow.id)}>
                <span><strong>{providerRow.name}</strong><StatusBadge value={providerRow.health} /></span>
                <small>{providerRow.type} · {providerRow.authState}</small>
                <small>{providerRow.modelsDiscovered} models · {providerRow.discoveryState}</small>
              </button>
            ))}
            <section className="kw-provider-add">
              <h4>Add custom OpenAI-compatible provider</h4>
              <label>Provider name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Provider name" /></label>
              <label>Base URL<input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://provider.example/v1" /></label>
              <label>API key<input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder="Provider credential" autoComplete="off" /></label>
              <label>Organization / project<input value={form.organization} onChange={(event) => setForm({ ...form, organization: event.target.value })} placeholder="optional" /></label>
              <details>
                <summary>Advanced adapter configuration</summary>
                <label>Models endpoint override<input value={form.modelsEndpoint} onChange={(event) => setForm({ ...form, modelsEndpoint: event.target.value })} placeholder="optional full URL" /></label>
                <label>Generation endpoint override<input value={form.chatEndpoint} onChange={(event) => setForm({ ...form, chatEndpoint: event.target.value })} placeholder="optional full URL" /></label>
                <label>Protected headers<textarea value={form.customHeaders} onChange={(event) => setForm({ ...form, customHeaders: event.target.value })} placeholder="Header-Name: protected value" rows={3} /></label>
                <label>Timeout ms<input type="number" min={1000} max={120000} value={form.timeoutMs} onChange={(event) => setForm({ ...form, timeoutMs: Number(event.target.value) || 30000 })} /></label>
                <label className="kw-inline-check"><input type="checkbox" checked={form.streaming} onChange={(event) => setForm({ ...form, streaming: event.target.checked })} /> Streaming expected</label>
              </details>
              <button disabled={busy || !form.name || !form.baseUrl || !form.apiKey} onClick={() => void addProvider()}>Add provider securely</button>
            </section>
          </aside>
        )}

        <main className="kw-provider-main" aria-label="Provider workspace">
          {activeProvider && (
            <section className="kw-provider-hero">
              <div className="kw-provider-identity">
                <div><p>{activeProvider.type}</p><h3>{activeProvider.name}</h3><code>{activeProvider.baseUrl || "no endpoint"}</code></div>
                <div className="kw-provider-health"><StatusBadge value={activeProvider.health} /><StatusBadge value={activeProvider.authState} /><StatusBadge value={activeProvider.discoveryState} /></div>
              </div>
              <small>Credential {activeProvider.maskedKey || "NOT_CONFIGURED"} · source {activeProvider.credentialSource} · last verified {activeProvider.lastVerifiedAt || "never"}</small>
              <div className="kw-row">
                <button disabled={busy} onClick={() => void runTest("connection")}>Test connection</button>
                <button disabled={busy} onClick={() => void runTest("model")}>Test model</button>
                <button disabled={busy} onClick={() => void runTest("stream")}>Test stream</button>
                <button disabled={busy} onClick={() => void runTest("tools")}>Test tool calling</button>
                <button disabled={busy} onClick={() => void discover(false)}>Discover all models</button>
                <button disabled={busy} onClick={() => void discover(true)}>Refresh models</button>
              </div>
              {testEvidence && (
                <details open className="kw-test-evidence">
                  <summary>Last real probe · {testEvidence.kind} · {testEvidence.ok ? "PASS" : "NOT PROVEN"} · {testEvidence.latencyMs}ms</summary>
                  <pre>{JSON.stringify(testEvidence, null, 2)}</pre>
                </details>
              )}
            </section>
          )}

          <nav className="kw-provider-tabs" aria-label="Provider tabs">
            {(["MODELS", "SESSIONS", "USAGE", "CONFIG", "SECURITY", "EVENTS"] as ProviderTab[]).map((entry) => <button key={entry} className={tab === entry ? "is-active" : ""} onClick={() => setTab(entry)}>{entry}</button>)}
          </nav>

          {tab === "MODELS" && (
            <section className="kw-provider-section">
              <div className="kw-filter-bar">
                <input aria-label="Search models" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search discovered models…" />
                <select aria-label="Capability filter" value={capabilityFilter} onChange={(event) => setCapabilityFilter(event.target.value)}><option value="all">All capabilities</option><option value="tools">Tools supported</option><option value="vision">Vision supported</option><option value="streaming">Streaming supported</option><option value="reasoning">Reasoning supported</option></select>
                <span>{filtered.length}/{models.length}</span>
              </div>
              {filtered.length === 0 ? <EmptyState title="No models discovered" detail="Run Discover all models. KForge contacts only the selected provider adapter and never invents model capabilities." /> : (
                <div className="kw-model-table" role="table" aria-label="Discovered models">
                  {filtered.map((model) => (
                    <article key={model.id} role="row" className={selectedModel?.id === model.id ? "is-selected" : ""}>
                      <div><strong>{model.displayName}</strong><code>{model.id}</code><small>ctx {model.contextWindow ?? "UNKNOWN"} · output {model.maxOutput ?? "UNKNOWN"} · {model.availability}</small></div>
                      <div className="kw-model-flags"><span>TOOLS <StatusBadge value={model.capabilities.tools} /></span><span>VISION <StatusBadge value={model.capabilities.vision} /></span><span>STREAM <StatusBadge value={model.capabilities.streaming} /></span><span>REASON <StatusBadge value={model.capabilities.reasoning} /></span></div>
                      <div className="kw-row"><button onClick={() => { setSelectedModel(model); setAssign({ ...assign, model: model.id }); }}>Inspect / Use</button><button onClick={() => toggleCompare(model.id)}>{compare.includes(model.id) ? "Uncompare" : "Compare"}</button></div>
                    </article>
                  ))}
                </div>
              )}
              {compared.length >= 2 && <section className="kw-compare-lab"><h4>Model Compare · {compared.length}</h4><div className="kw-compare-grid">{compared.map((model) => <article key={model.id}><strong>{model.displayName}</strong><code>{model.id}</code><span>Context {model.contextWindow ?? "UNKNOWN"}</span><span>Tools {model.capabilities.tools}</span><span>Vision {model.capabilities.vision}</span><span>Reasoning {model.capabilities.reasoning}</span><span>Input price {model.priceInput ?? "UNKNOWN"}</span></article>)}</div></section>}
            </section>
          )}

          {tab === "SESSIONS" && (
            <section className="kw-provider-section">
              <div className="kw-session-composer">
                <div><h3>Use model on project</h3><small>Session execution is separate from conversation: model output, tools, patches, commands, verification and Preview remain attributable.</small></div>
                <input aria-label="Task composer" value={assign.task} onChange={(event) => setAssign({ ...assign, task: event.target.value })} placeholder="Fix the export flow, verify it, and open Preview…" />
                <div className="kw-session-options">
                  <label>Model<input value={assign.model} onChange={(event) => setAssign({ ...assign, model: event.target.value })} placeholder="Select from Models or enter exact discovered ID" /></label>
                  <label>Mode<select value={assign.mode} onChange={(event) => setAssign({ ...assign, mode: event.target.value })}>{MODES.map((mode) => <option key={mode}>{mode}</option>)}</select></label>
                  <label>Context<select value={assign.contextScope} onChange={(event) => setAssign({ ...assign, contextScope: event.target.value })}><option>Repository</option><option>Selected File</option><option>Selected Folder</option><option>Custom Selection</option></select></label>
                  <label>Autonomy<select value={assign.autonomy} onChange={(event) => setAssign({ ...assign, autonomy: event.target.value })}>{AUTONOMY.map((level) => <option key={level}>{level}</option>)}</select></label>
                </div>
                {activeProvider?.type !== "local" && <label className="kw-cloud-disclosure"><input type="checkbox" checked={assign.disclosure} onChange={(event) => setAssign({ ...assign, disclosure: event.target.checked })} /><span><strong>CONFIRM SEND</strong> Project context may leave this machine for {activeProvider?.name}. Exact file context can be inspected inside the session before model execution.</span></label>}
                <button disabled={busy || !assign.model || !assign.task.trim() || !project} onClick={() => void createSession()}>Create engineering session</button>
                {!project && <small className="kw-warning-text">Select a project in KForge before launching a project engineering session.</small>}
              </div>
              <ul className="kw-session-list">
                {sessions.map((session) => <li key={session.id}><button onClick={() => setActiveSession(session)}><span><strong>{session.task}</strong><StatusBadge value={session.status} /></span><small>{session.providerId}/{session.modelId} · {session.mode} · {new Date(session.createdAt).toLocaleString()}</small><small>{session.projectId || "no project"} · tools {session.telemetry?.toolCalls ?? 0} · files {session.telemetry?.filesChanged ?? 0}</small></button></li>)}
              </ul>
            </section>
          )}

          {tab === "USAGE" && <section className="kw-provider-section"><h3>Measured session usage</h3>{sessions.length ? <div className="kw-usage-grid">{sessions.filter((session) => session.providerId === selectedProvider).slice(0, 25).map((session) => <article key={session.id}><strong>{session.modelId}</strong><span>IN {session.telemetry?.inputTokens ?? "UNKNOWN"}</span><span>OUT {session.telemetry?.outputTokens ?? "UNKNOWN"}</span><span>TTFT {session.telemetry?.ttftMs === null || session.telemetry?.ttftMs === undefined ? "UNKNOWN" : `${session.telemetry.ttftMs}ms`}</span><span>Latency {session.telemetry?.latencyMs === null || session.telemetry?.latencyMs === undefined ? "UNKNOWN" : `${session.telemetry.latencyMs}ms`}</span><small>{session.telemetry?.costSource || "UNKNOWN"} cost evidence</small></article>)}</div> : <EmptyState title="No usage evidence" detail="KForge records provider-reported usage only when the provider returns it. Unknown remains UNKNOWN." />}</section>}

          {tab === "CONFIG" && activeProvider && <section className="kw-provider-section kw-config-grid"><div><h3>Credential configuration</h3><p>Built-in cloud providers can be configured here. Packaged Windows uses the OS-protected vault; development hosts may use environment or ephemeral memory without plaintext disk fallback.</p><label className="kw-field">New / replacement credential<input type="password" value={replacementKey} onChange={(event) => setReplacementKey(event.target.value)} placeholder="Provider credential" autoComplete="off" /></label><button disabled={busy || replacementKey.length < 8} onClick={() => void replaceKey()}>Configure / Replace Key</button></div><div><h3>Provider facts</h3><dl className="kw-tech-dl"><div><dt>Adapter</dt><dd>{activeProvider.kind}</dd></div><div><dt>Type</dt><dd>{activeProvider.type}</dd></div><div><dt>Credential source</dt><dd>{activeProvider.credentialSource}</dd></div><div><dt>Timeout</dt><dd>{activeProvider.timeoutMs}ms</dd></div><div><dt>Models</dt><dd>{activeProvider.modelsDiscovered}</dd></div></dl></div></section>}

          {tab === "SECURITY" && activeProvider && <section className="kw-provider-section kw-security-panel"><h3>Credential boundary</h3><dl className="kw-tech-dl"><div><dt>Vault backend</dt><dd>{vault?.backend || "UNKNOWN"}</dd></div><div><dt>Vault availability</dt><dd>{vault?.availability || "UNKNOWN"}</dd></div><div><dt>Legacy migration</dt><dd>{vault?.migration.outcome || "UNKNOWN"}</dd></div><div><dt>Credential</dt><dd>{revealed || activeProvider.maskedKey || "NOT_CONFIGURED"}</dd></div></dl><label className="kw-inline-check"><input type="checkbox" checked={revealConfirm} onChange={(event) => setRevealConfirm(event.target.checked)} /> I explicitly request temporary full-key reveal</label><div className="kw-row"><button disabled={busy || !revealConfirm || activeProvider.credentialState !== "CONFIGURED"} onClick={() => void reveal()}>Reveal Full Key</button><button disabled={!revealed} onClick={() => void copyRevealed()}>Copy Full Key</button></div><hr /><label className="kw-inline-check"><input type="checkbox" checked={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.checked)} /> Confirm destructive credential deletion</label><button disabled={busy || !deleteConfirm || activeProvider.credentialState !== "CONFIGURED"} onClick={() => void deleteKey()}>Delete Key</button><p className="kw-security-note">Revealed plaintext is rendered only after explicit action and auto-clears. Normal provider lists, sessions, events and model evidence contain no credential value.</p></section>}

          {tab === "EVENTS" && <section className="kw-provider-section"><h3>Provider evidence state</h3><p>No hidden provider polling is performed from this surface. Discovery and tests occur only after explicit actions. Engineering session events are available inside each session.</p><pre>{JSON.stringify({ provider: activeProvider?.id, health: activeProvider?.health, discovery: activeProvider?.discoveryState, lastVerifiedAt: activeProvider?.lastVerifiedAt, vault: vault ? { backend: vault.backend, availability: vault.availability, migration: vault.migration.outcome } : null }, null, 2)}</pre></section>}
        </main>

        {rightOpen && (
          <aside className="kw-provider-inspector" aria-label="Provider model inspector">
            <div className="kw-pane-heading"><strong>INSPECTOR</strong><small>{selectedModel ? "MODEL" : "PROVIDER"}</small></div>
            {selectedModel ? <div className="kw-inspector-stack"><h3>{selectedModel.displayName}</h3><code>{selectedModel.id}</code><dl className="kw-tech-dl"><div><dt>Provider</dt><dd>{selectedModel.providerId}</dd></div><div><dt>Family</dt><dd>{selectedModel.family}</dd></div><div><dt>Version</dt><dd>{selectedModel.version}</dd></div><div><dt>Context</dt><dd>{selectedModel.contextWindow ?? "UNKNOWN"}</dd></div><div><dt>Max output</dt><dd>{selectedModel.maxOutput ?? "UNKNOWN"}</dd></div><div><dt>Availability</dt><dd>{selectedModel.availability}</dd></div><div><dt>Price source</dt><dd>{selectedModel.priceSource}</dd></div><div><dt>Last discovered</dt><dd>{selectedModel.lastDiscoveredAt || "UNKNOWN"}</dd></div></dl><h4>Capabilities</h4><pre>{JSON.stringify(selectedModel.capabilities, null, 2)}</pre><button onClick={() => { setAssign({ ...assign, model: selectedModel.id }); setTab("SESSIONS"); }}>Use on project</button></div> : activeProvider ? <div className="kw-inspector-stack"><h3>{activeProvider.name}</h3><code>{activeProvider.id}</code><dl className="kw-tech-dl"><div><dt>Adapter</dt><dd>{activeProvider.kind}</dd></div><div><dt>Endpoint</dt><dd>{activeProvider.baseUrl || "UNKNOWN"}</dd></div><div><dt>Health</dt><dd>{activeProvider.health}</dd></div><div><dt>Credential</dt><dd>{activeProvider.credentialState}</dd></div><div><dt>Source</dt><dd>{activeProvider.credentialSource}</dd></div><div><dt>Models</dt><dd>{activeProvider.modelsDiscovered}</dd></div></dl><small>Raw provider metadata is intentionally secondary. Sensitive header values are never displayed here.</small></div> : <EmptyState title="No provider selected" detail="Choose a provider to inspect its normalized state." />}
          </aside>
        )}
      </div>
    </div>
  );
}

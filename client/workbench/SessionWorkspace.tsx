import { useEffect, useMemo, useState } from "react";
import type {
  CanonicalModel,
  ProviderContextInspection,
  ProviderSessionEvent,
  ProviderSessionPatch,
  ProviderSessionSummary,
  ProviderSummary,
} from "@shared/providerCommandCenter";
import type { ProjectSummary } from "@shared/workspace";
import { fetchJson, jsonRequest } from "./api";
import { StatusBadge } from "./ui";

interface Props {
  initialSession: ProviderSessionSummary;
  provider: ProviderSummary | null;
  providers: ProviderSummary[];
  project?: ProjectSummary;
  onBack: () => void;
  onSessionChange?: (session: ProviderSessionSummary) => void;
}

function eventLabel(type: ProviderSessionEvent["type"]) {
  return type.replace(/_/g, " ");
}

function eventTone(type: ProviderSessionEvent["type"]) {
  if (type === "ERROR") return "error";
  if (type === "APPROVAL_REQUIRED") return "approval";
  if (["PATCH_PROPOSED", "PATCH_APPLIED"].includes(type)) return "patch";
  if (["TEST_RESULT", "BUILD_RESULT", "COMMAND_STARTED", "COMMAND_FINISHED"].includes(type)) return "command";
  if (type === "PREVIEW_STATE") return "preview";
  if (type.startsWith("TOOL_")) return "tool";
  return "model";
}

function findPreviewUrl(events: ProviderSessionEvent[]) {
  for (const event of [...events].reverse()) {
    if (event.type !== "PREVIEW_STATE") continue;
    const preview = event.data?.preview;
    if (typeof preview === "object" && preview !== null && "url" in preview && typeof (preview as { url?: unknown }).url === "string") return (preview as { url: string }).url;
  }
  return null;
}

export default function SessionWorkspace({ initialSession, provider, providers, project, onBack, onSessionChange }: Props) {
  const [session, setSession] = useState(initialSession);
  const [events, setEvents] = useState<ProviderSessionEvent[]>([]);
  const [patches, setPatches] = useState<ProviderSessionPatch[]>([]);
  const [context, setContext] = useState<ProviderContextInspection | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [startPreview, setStartPreview] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState("");
  const [bottomTab, setBottomTab] = useState<"EVENTS" | "TESTS" | "BUILD" | "OUTPUT" | "PROBLEMS">("EVENTS");
  const [rightTab, setRightTab] = useState<"PREVIEW" | "MODEL" | "CONTEXT" | "DIAGNOSTICS" | "SESSION">("PREVIEW");
  const [switchProvider, setSwitchProvider] = useState(session.providerId);
  const [switchModels, setSwitchModels] = useState<CanonicalModel[]>([]);
  const [switchModel, setSwitchModel] = useState(session.modelId);
  const [switchDisclosure, setSwitchDisclosure] = useState(false);
  const [operatorNote, setOperatorNote] = useState("");
  const endpoint = `/api/workspace/ai/command-center/sessions/${encodeURIComponent(session.id)}`;

  const refreshSession = async () => {
    const result = await fetchJson<{ session: ProviderSessionSummary }>(endpoint);
    setSession(result.session);
    onSessionChange?.(result.session);
    return result.session;
  };

  const refreshPatches = async () => {
    const result = await fetchJson<{ patches: ProviderSessionPatch[] }>(`${endpoint}/patches`);
    setPatches(result.patches || []);
  };

  const refreshContext = async () => {
    try {
      const files = selectedFiles.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
      const suffix = files.length ? `?files=${encodeURIComponent(files.join(","))}` : "";
      const result = await fetchJson<{ context: ProviderContextInspection }>(`${endpoint}/context${suffix}`);
      setContext(result.context);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Context inspection failed.");
    }
  };

  useEffect(() => {
    void Promise.all([refreshSession(), refreshPatches(), refreshContext()]).catch((error) => setMessage(error instanceof Error ? error.message : "Session evidence unavailable."));
    const source = new EventSource(`${endpoint}/events`);
    source.onmessage = (raw) => {
      try {
        const event = JSON.parse(raw.data) as ProviderSessionEvent;
        setEvents((current) => [...current.filter((entry) => entry.id !== event.id), event].slice(-400));
        if (["PATCH_PROPOSED", "PATCH_APPLIED", "APPROVAL_REQUIRED", "SESSION_COMPLETED", "ERROR", "PREVIEW_STATE", "USAGE_UPDATE"].includes(event.type)) {
          void refreshSession().catch(() => undefined);
          if (event.type === "PATCH_PROPOSED" || event.type === "PATCH_APPLIED" || event.type === "APPROVAL_REQUIRED") void refreshPatches().catch(() => undefined);
        }
      } catch {
        /* malformed event data is ignored; persisted evidence remains authoritative */
      }
    };
    source.onerror = () => setMessage((current) => current || "Live event stream interrupted; EventSource will retry automatically.");
    return () => source.close();
    // Session id owns the stream. Helper functions intentionally read its current URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  useEffect(() => {
    void fetchJson<{ models: CanonicalModel[] }>(`/api/workspace/ai/command-center/providers/${encodeURIComponent(switchProvider)}/models`)
      .then((result) => {
        setSwitchModels(result.models || []);
        if (result.models?.length && !result.models.some((model) => model.id === switchModel)) setSwitchModel(result.models[0].id);
      })
      .catch(() => setSwitchModels([]));
  }, [switchProvider]);

  const perform = async (label: string, task: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(label);
    try {
      await task();
      await Promise.all([refreshSession(), refreshPatches()]);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${label} failed.`);
    } finally {
      setBusy(false);
    }
  };

  const start = () => perform("Starting bounded AI engineering run…", async () => {
    const selected = selectedFiles.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    await fetchJson(`${endpoint}/start`, jsonRequest({ autonomy: session.autonomy, startPreview, selectedFiles: selected }));
  });
  const cancel = () => perform("Cancelling model stream and future tool dispatch…", () => fetchJson(`${endpoint}/cancel`, jsonRequest({ stopOwnedRuntime: false })));
  const approve = () => perform("Applying approved patch through KForge authority…", () => fetchJson(`${endpoint}/approve`, jsonRequest({ approvalId: session.pendingApproval?.id || "" })));
  const reject = () => perform("Rejecting pending mutation…", () => fetchJson(`${endpoint}/reject`, jsonRequest({ approvalId: session.pendingApproval?.id || "" })));
  const rollback = () => perform("Restoring session checkpoint…", () => fetchJson(`${endpoint}/rollback`, jsonRequest({ confirmed: true })));
  const applyPatch = (patch: ProviderSessionPatch) => perform(`Applying ${patch.file}…`, () => fetchJson(`${endpoint}/patches/${encodeURIComponent(patch.id)}/apply`, jsonRequest({})));
  const sendNote = () => perform("Recording operator note…", async () => {
    if (!operatorNote.trim()) return;
    await fetchJson(`${endpoint}/note`, jsonRequest({ text: operatorNote }));
    setOperatorNote("");
  });
  const switchActiveModel = () => perform("Switching session model…", () => fetchJson(`${endpoint}/switch`, jsonRequest({ providerId: switchProvider, modelId: switchModel, disclosureConfirmed: switchDisclosure })));

  const previewUrl = useMemo(() => findPreviewUrl(events), [events]);
  const commandEvents = events.filter((event) => ["COMMAND_STARTED", "COMMAND_FINISHED", "TEST_RESULT", "BUILD_RESULT"].includes(event.type));
  const errorEvents = events.filter((event) => event.type === "ERROR");
  const modelEvents = events.filter((event) => event.type !== "MODEL_TOKEN");
  const appliedCount = patches.filter((patch) => patch.state === "APPLIED").length;

  return (
    <div className="kw-ai-session" data-testid="ai-engineering-session">
      <header className="kw-ai-session-head">
        <div className="kw-ai-session-title">
          <button onClick={onBack} aria-label="Back to Provider Studio">←</button>
          <div><p>KNOuX / AI / Engineering Session</p><h2>{session.task}</h2><small>{project?.name || context?.project.name || session.projectId || "No project"} · {session.providerId}/{session.modelId}</small></div>
        </div>
        <div className="kw-ai-session-state"><StatusBadge value={session.status} /><span>Autonomy <strong>{session.autonomy}</strong></span><span>Checkpoint <strong>{session.checkpointId ? "READY" : "NONE"}</strong></span></div>
        <div className="kw-row">
          <label className="kw-inline-check"><input type="checkbox" checked={startPreview} onChange={(event) => setStartPreview(event.target.checked)} /> Preview after verification</label>
          <button disabled={busy || ["RUNNING", "PLANNING", "TOOL_EXECUTING", "VERIFYING", "PREVIEW_STARTING"].includes(session.status)} onClick={() => void start()}>Start / Resume</button>
          <button disabled={busy || ["COMPLETED", "CANCELLED", "ROLLED_BACK"].includes(session.status)} onClick={() => void cancel()}>Stop model</button>
          <button disabled={busy || !session.checkpointId} onClick={() => void rollback()}>Rollback checkpoint</button>
        </div>
      </header>

      {message && <p className="kw-message" role="status">{message}</p>}
      {session.pendingApproval && <section className="kw-ai-approval" role="alert"><div><strong>Approval required</strong><span>{session.pendingApproval.summary}</span><code>{session.pendingApproval.id}</code></div><div className="kw-row"><button disabled={busy} onClick={() => void approve()}>Approve</button><button disabled={busy} onClick={() => void reject()}>Reject</button></div></section>}

      <div className="kw-ai-session-grid">
        <aside className="kw-ai-context-pane">
          <div className="kw-pane-heading"><strong>PROJECT + CONTEXT</strong><button onClick={() => void refreshContext()}>Refresh</button></div>
          <dl className="kw-tech-dl"><div><dt>Project</dt><dd>{context?.project.name || project?.name || "UNKNOWN"}</dd></div><div><dt>Branch</dt><dd>{context?.project.branch || project?.branch || "UNKNOWN"}</dd></div><div><dt>Destination</dt><dd>{context?.destination || session.disclosureDestination || "UNKNOWN"}</dd></div><div><dt>Files</dt><dd>{context?.filesIncluded.length ?? "UNKNOWN"}</dd></div><div><dt>Est. tokens</dt><dd>{context?.estimatedTokens?.toLocaleString() ?? "UNKNOWN"}</dd></div><div><dt>Source sent</dt><dd>{context ? (context.sourceCodeIncluded ? "YES" : "NO") : "UNKNOWN"}</dd></div></dl>
          <label className="kw-field">Operator-selected context files<textarea value={selectedFiles} onChange={(event) => setSelectedFiles(event.target.value)} placeholder="src/app.tsx&#10;server/index.ts" rows={4} /></label>
          <div className="kw-context-files">{(context?.filesIncluded || []).map((file) => <button key={file.path} title={file.reason}><span>{file.path}</span><small>{file.reason} · {file.characters.toLocaleString()} chars</small></button>)}</div>
          <div className="kw-checkpoint-card"><strong>Checkpoint</strong><code>{session.checkpointId || "Created automatically before first mutation"}</code><small>{appliedCount} applied patch(es) · rollback requires explicit action.</small></div>
        </aside>

        <main className="kw-ai-conversation-pane">
          <div className="kw-pane-heading"><strong>MODEL + EXECUTION</strong><span>{modelEvents.length} evidence events</span></div>
          <div className="kw-ai-event-stream" aria-live="polite">
            {modelEvents.length === 0 && <div className="kw-ai-empty"><strong>Ready for engineering</strong><span>Start the session to stream model output, registered tools, patches, verification and Preview evidence here.</span></div>}
            {modelEvents.map((event) => <article key={event.id} className={`kw-ai-event kw-ai-event-${eventTone(event.type)}`}><header><strong>{eventLabel(event.type)}</strong><time>{new Date(event.at).toLocaleTimeString()}</time></header><p>{event.message}</p>{event.data && <details><summary>Evidence</summary><pre>{JSON.stringify(event.data, null, 2)}</pre></details>}</article>)}
          </div>
          <div className="kw-ai-note-composer"><input value={operatorNote} onChange={(event) => setOperatorNote(event.target.value)} placeholder="Add an operator note to the auditable session…" onKeyDown={(event) => { if (event.key === "Enter" && operatorNote.trim()) void sendNote(); }} /><button disabled={busy || !operatorNote.trim()} onClick={() => void sendNote()}>Add note</button></div>
          {patches.length > 0 && <section className="kw-ai-diff-studio"><div className="kw-pane-heading"><strong>AI DIFF STUDIO</strong><span>{patches.length} patch(es)</span></div>{patches.map((patch) => <details key={patch.id} open={patch.state === "PROPOSED"}><summary><span>{patch.file}</span><StatusBadge value={patch.state} /><small>{patch.risk}</small></summary><p>{patch.reason}</p><div className="kw-diff-columns"><pre aria-label="Before">{patch.oldText}</pre><pre aria-label="After">{patch.newText}</pre></div><div className="kw-row">{patch.state === "PROPOSED" && <button disabled={busy || patch.risk === "blocked"} onClick={() => void applyPatch(patch)}>Apply through KForge</button>}<code>{patch.id}</code></div></details>)}</section>}
        </main>

        <aside className="kw-ai-inspector-pane">
          <nav className="kw-mini-tabs" aria-label="AI session inspector tabs">{(["PREVIEW", "MODEL", "CONTEXT", "DIAGNOSTICS", "SESSION"] as const).map((item) => <button key={item} className={rightTab === item ? "is-active" : ""} onClick={() => setRightTab(item)}>{item}</button>)}</nav>
          {rightTab === "PREVIEW" && <section className="kw-live-preview"><div className="kw-pane-heading"><strong>LIVE PREVIEW</strong><StatusBadge value={session.telemetry.previewState || (previewUrl ? "AVAILABLE" : "NOT_STARTED")} /></div>{previewUrl ? <><div className="kw-preview-toolbar"><code>{previewUrl}</code><a href={previewUrl} target="_blank" rel="noreferrer">Open ↗</a></div><iframe title="KForge live project Preview" src={previewUrl} sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin" /></> : <div className="kw-ai-empty"><strong>Preview not started</strong><span>Enable Preview after verification or let the model request the canonical start_preview tool. No screenshot or fake Preview is shown.</span></div>}</section>}
          {rightTab === "MODEL" && <section className="kw-inspector-stack"><h3>Model runtime</h3><dl className="kw-tech-dl"><div><dt>Provider</dt><dd>{provider?.name || session.providerId}</dd></div><div><dt>Model</dt><dd>{session.modelId}</dd></div><div><dt>Status</dt><dd>{session.status}</dd></div><div><dt>TTFT</dt><dd>{session.telemetry.ttftMs === null ? "UNKNOWN" : `${session.telemetry.ttftMs}ms`}</dd></div><div><dt>Latency</dt><dd>{session.telemetry.latencyMs === null ? "UNKNOWN" : `${session.telemetry.latencyMs}ms`}</dd></div><div><dt>Tokens</dt><dd>{session.telemetry.totalTokens ?? "UNKNOWN"}</dd></div><div><dt>Tools</dt><dd>{session.telemetry.toolCalls}</dd></div><div><dt>Files</dt><dd>{session.telemetry.filesChanged}</dd></div></dl><h4>Switch model</h4><label className="kw-field">Provider<select value={switchProvider} onChange={(event) => { setSwitchProvider(event.target.value); setSwitchDisclosure(false); }}>{providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="kw-field">Model<select value={switchModel} onChange={(event) => setSwitchModel(event.target.value)}>{switchModels.length ? switchModels.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>) : <option value={switchModel}>{switchModel || "No discovered model"}</option>}</select></label><label className="kw-inline-check"><input type="checkbox" checked={switchDisclosure} onChange={(event) => setSwitchDisclosure(event.target.checked)} /> Confirm new cloud destination if required</label><button disabled={busy || !switchModel} onClick={() => void switchActiveModel()}>Switch model</button></section>}
          {rightTab === "CONTEXT" && <section className="kw-inspector-stack"><h3>Context disclosure</h3><pre>{JSON.stringify(context, null, 2)}</pre></section>}
          {rightTab === "DIAGNOSTICS" && <section className="kw-inspector-stack"><h3>Diagnostics</h3>{context?.diagnostics?.length ? <pre>{JSON.stringify(context.diagnostics, null, 2)}</pre> : <p>No bounded diagnostics are currently available.</p>}</section>}
          {rightTab === "SESSION" && <section className="kw-inspector-stack"><h3>Session truth</h3><pre>{JSON.stringify(session, null, 2)}</pre></section>}
        </aside>
      </div>

      <section className="kw-ai-bottom-pane"><nav className="kw-mini-tabs" aria-label="AI execution bottom pane">{(["EVENTS", "TESTS", "BUILD", "OUTPUT", "PROBLEMS"] as const).map((item) => <button key={item} className={bottomTab === item ? "is-active" : ""} onClick={() => setBottomTab(item)}>{item}</button>)}</nav>{bottomTab === "EVENTS" && <div className="kw-bottom-log">{events.slice(-80).map((event) => <code key={event.id}>{new Date(event.at).toLocaleTimeString()} [{eventLabel(event.type)}] {event.message}</code>)}</div>}{bottomTab === "TESTS" && <div className="kw-bottom-log">{commandEvents.filter((event) => event.type === "TEST_RESULT").map((event) => <code key={event.id}>{event.message}</code>)}{session.telemetry.testState && <code>Session test state: {session.telemetry.testState}</code>}</div>}{bottomTab === "BUILD" && <div className="kw-bottom-log">{commandEvents.filter((event) => event.type === "BUILD_RESULT").map((event) => <code key={event.id}>{event.message}</code>)}{session.telemetry.buildState && <code>Session build state: {session.telemetry.buildState}</code>}</div>}{bottomTab === "OUTPUT" && <div className="kw-bottom-log">{commandEvents.map((event) => <code key={event.id}>{event.message}</code>)}</div>}{bottomTab === "PROBLEMS" && <div className="kw-bottom-log">{errorEvents.length ? errorEvents.map((event) => <code key={event.id}>{event.message}</code>) : <code>No session errors recorded.</code>}</div>}</section>
    </div>
  );
}

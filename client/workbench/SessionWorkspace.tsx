import { useEffect, useRef, useState } from "react";
import type { ProjectSummary } from "@shared/workspace";
import { fetchJson, jsonRequest } from "./api";
import { EmptyState, StatusBadge } from "./ui";

export interface SessionDetail {
  id: string;
  projectId: string | null;
  providerId: string;
  modelId: string;
  mode: string;
  status: string;
  task: string;
  autonomy: string;
  checkpointId: string | null;
  previewSessionId: string | null;
  pendingApproval: { id: string; kind: string; summary: string; createdAt: string } | null;
  telemetry: Record<string, number | string | null>;
  error: string | null;
  disclosureDestination: string | null;
}

interface SessionEvent {
  id: string;
  kind: string;
  at: string;
  summary: string;
}

interface SessionPatch {
  id: string;
  file: string;
  before: string;
  after: string;
  added: number;
  removed: number;
  risk: string;
  reason: string;
  state: string;
}

interface ContextFile {
  path: string;
  reason: string;
  characters: number;
}

export default function SessionWorkspace({ sessionId, project, onClose, onMessage }: { sessionId: string; project?: ProjectSummary; onClose: () => void; onMessage: (message: string) => void }) {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [patches, setPatches] = useState<SessionPatch[]>([]);
  const [context, setContext] = useState<{ filesIncluded: ContextFile[]; totalCharacters: number; destination: string; sourceCodeIncluded: boolean } | null>(null);
  const [rightTab, setRightTab] = useState<"PREVIEW" | "MODEL" | "CONTEXT" | "SESSION">("MODEL");
  const [switchForm, setSwitchForm] = useState({ providerId: "", modelId: "", disclosure: false });
  const [autonomy, setAutonomy] = useState("SAFE IMPLEMENTATION");
  const [startPreview, setStartPreview] = useState(false);
  const eventsRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    try {
      const [detail, eventData, patchData] = await Promise.all([
        fetchJson<{ session: SessionDetail }>(`/api/workspace/ai/command-center/sessions/${encodeURIComponent(sessionId)}`),
        fetchJson<{ events: SessionEvent[] }>(`/api/workspace/ai/command-center/sessions/${encodeURIComponent(sessionId)}/events`),
        fetchJson<{ patches: SessionPatch[] }>(`/api/workspace/ai/command-center/sessions/${encodeURIComponent(sessionId)}/patches`),
      ]);
      setSession(detail.session);
      setEvents(eventData.events || []);
      setPatches(patchData.patches || []);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Session detail unavailable.");
    }
  };

  useEffect(() => {
    void load();
    const source = new EventSource(`/api/workspace/ai/command-center/sessions/${encodeURIComponent(sessionId)}/events`);
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as SessionEvent;
        setEvents((current) => [...current, event].slice(-200));
        if (event.kind === "SESSION_STATE" || event.kind === "SESSION_COMPLETED") void load();
      } catch {
        /* malformed stream frames are ignored */
      }
    };
    source.onerror = () => source.close();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      source.close();
      window.clearInterval(timer);
    };
  }, [sessionId]);

  useEffect(() => {
    eventsRef.current?.scrollTo({ top: eventsRef.current.scrollHeight });
  }, [events.length]);

  const act = async (path: string, body: unknown, success: string) => {
    try {
      const result = await fetchJson<{ session: SessionDetail }>(`/api/workspace/ai/command-center/sessions/${encodeURIComponent(sessionId)}${path}`, jsonRequest(body));
      if (result.session) setSession(result.session);
      onMessage(success);
      void load();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Session action failed.");
    }
  };

  const loadContext = async () => {
    try {
      const result = await fetchJson<{ context: { filesIncluded: ContextFile[]; totalCharacters: number; destination: string; sourceCodeIncluded: boolean } }>(`/api/workspace/ai/command-center/sessions/${encodeURIComponent(sessionId)}/context`);
      setContext(result.context);
      setRightTab("CONTEXT");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Context unavailable.");
    }
  };

  if (!session) return <p className="kw-message">Loading session workspace…</p>;
  const running = ["CONTEXT_PREPARING", "PLANNING", "RUNNING", "TOOL_EXECUTING", "APPLYING", "VERIFYING", "PREVIEW_STARTING", "PREVIEWING"].includes(session.status);

  return (
    <div className="kw-session-workspace" data-testid="session-workspace">
      <div className="kw-row">
        <strong>{session.mode}</strong>
        <code>{session.providerId}/{session.modelId}</code>
        <StatusBadge value={session.status} />
        <button onClick={onClose}>Back to sessions</button>
        <button onClick={() => void load()}>Refresh</button>
      </div>
      <p><small>{session.task}</small></p>
      {session.error && <p className="kw-message" role="alert">{session.error}</p>}
      {session.pendingApproval && (
        <div className="kw-approval" role="alert">
          <strong>Approval required:</strong> {session.pendingApproval.summary}
          <div className="kw-row">
            <button onClick={() => void act("/approve", { approvalId: session.pendingApproval?.id }, "Action approved.")}>Approve</button>
            <button onClick={() => void act("/reject", { approvalId: session.pendingApproval?.id }, "Action rejected.")}>Reject</button>
          </div>
        </div>
      )}
      <div className="kw-session-grid">
        <section aria-label="Conversation and execution">
          <h4>Conversation + execution</h4>
          <div className="kw-event-stream" ref={eventsRef} role="log" aria-label="Session events">
            {events.length === 0 ? <EmptyState title="No events yet" detail="Start the session to watch model output, tool execution and verification." /> : events.map((event) => (
              <div key={event.id} className={`kw-event kw-event-${event.kind.toLowerCase()}`}>
                <code>{event.kind}</code>
                <span>{event.summary}</span>
                <small>{new Date(event.at).toLocaleTimeString()}</small>
              </div>
            ))}
          </div>
          <div className="kw-row">
            <select aria-label="Autonomy" value={autonomy} onChange={(event) => setAutonomy(event.target.value)}>
              {["CHAT ONLY", "READ ONLY", "REVIEW", "SAFE IMPLEMENTATION", "FULL PROJECT MISSION"].map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
            <label><input type="checkbox" checked={startPreview} onChange={(event) => setStartPreview(event.target.checked)} /> Start Preview</label>
            <button disabled={running} onClick={() => void act("/start", { autonomy, startPreview, selectedFiles: [] }, "Session started. Watch the event stream.")}>Start</button>
            <button disabled={!running} onClick={() => void act("/cancel", { stopOwnedRuntime: false }, "Session cancelled; streaming aborted.")}>Stop</button>
            <button onClick={() => void act("/rollback", { confirmed: true }, "Rolled back to session checkpoint.")}>Rollback{session.checkpointId ? ` (${session.checkpointId.slice(0, 8)})` : ""}</button>
          </div>
        </section>
        <section aria-label="Diff studio">
          <h4>Diff studio {patches.length > 0 && `(${patches.length})`}</h4>
          {patches.length === 0 ? <EmptyState title="No patches proposed" detail="Model-proposed file changes appear here for review before anything is applied." /> : patches.map((patch) => (
            <details key={patch.id} open={patch.state === "PROPOSED"}>
              <summary>{patch.file} (+{patch.added}/-{patch.removed}) · {patch.state}</summary>
              <pre>{unifiedDiff(patch.before, patch.after)}</pre>
              <div className="kw-row">
                {patch.state === "PROPOSED" && <button onClick={() => void act("/approve", { approvalId: patch.id }, `Patch ${patch.file} approved and applied.`)}>Accept file</button>}
                {(patch.state === "PROPOSED" || patch.state === "REJECTED") && <button onClick={() => void patchAction(session.id, patch.id, onMessage, () => void load())}>Apply directly</button>}
                <span><small>{patch.reason}</small></span>
              </div>
            </details>
          ))}
        </section>
        <aside aria-label="Inspector tabs">
          <nav className="kw-provider-tabs">
            {(["PREVIEW", "MODEL", "CONTEXT", "SESSION"] as const).map((entry) => (
              <button key={entry} className={rightTab === entry ? "is-active" : ""} onClick={() => { setRightTab(entry); if (entry === "CONTEXT") void loadContext(); }}>{entry}</button>
            ))}
          </nav>
          {rightTab === "MODEL" && <pre>{JSON.stringify({ provider: session.providerId, model: session.modelId, telemetry: session.telemetry, checkpoint: session.checkpointId, preview: session.previewSessionId }, null, 2)}</pre>}
          {rightTab === "CONTEXT" && (context ? <div><p>Destination: {context.destination} · Source included: {context.sourceCodeIncluded ? "yes" : "no"} · {context.totalCharacters} chars</p><ul>{context.filesIncluded.map((file) => <li key={file.path}><code>{file.path}</code> <small>{file.reason} · {file.characters} chars</small></li>)}</ul></div> : <p>Loading context…</p>)}
          {rightTab === "SESSION" && <pre>{JSON.stringify(session, null, 2)}</pre>}
          {rightTab === "PREVIEW" && <p>Canonical Preview: {project ? "open Developer Tools / Preview for the live application. Session preview references are preserved when switching tabs." : "no project context."}</p>}
          <h4>Switch model</h4>
          <div className="kw-row">
            <input aria-label="New provider" placeholder="provider id" value={switchForm.providerId} onChange={(event) => setSwitchForm({ ...switchForm, providerId: event.target.value })} />
            <input aria-label="New model" placeholder="model id" value={switchForm.modelId} onChange={(event) => setSwitchForm({ ...switchForm, modelId: event.target.value })} />
            <label><input type="checkbox" checked={switchForm.disclosure} onChange={(event) => setSwitchForm({ ...switchForm, disclosure: event.target.checked })} /> Fresh disclosure</label>
            <button onClick={() => void act("/switch", { providerId: switchForm.providerId, modelId: switchForm.modelId, destination: switchForm.providerId, disclosureConfirmed: switchForm.disclosure }, "Model switched; checkpoint preserved.")}>Switch</button>
          </div>
        </aside>
      </div>
    </div>
  );
}

async function patchAction(sessionId: string, patchId: string, onMessage: (message: string) => void, reload: () => void) {
  try {
    await fetchJson(`/api/workspace/ai/command-center/sessions/${encodeURIComponent(sessionId)}/patches/${encodeURIComponent(patchId)}/apply`, { method: "POST" });
    onMessage("Patch applied.");
    reload();
  } catch (error) {
    onMessage(error instanceof Error ? error.message : "Patch apply failed.");
  }
}

function unifiedDiff(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const out: string[] = [];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < Math.min(max, 60); index += 1) {
    const left = beforeLines[index];
    const right = afterLines[index];
    if (left === right) {
      if (left !== undefined) out.push(`  ${left}`.slice(0, 160));
    } else {
      if (left !== undefined) out.push(`- ${left}`.slice(0, 160));
      if (right !== undefined) out.push(`+ ${right}`.slice(0, 160));
    }
  }
  if (max > 60) out.push(`… (${max - 60} more lines)`);
  return out.join("\n");
}

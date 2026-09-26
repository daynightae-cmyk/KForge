import { useState } from "react";
import { FolderOpen, GitBranch, Loader2, Rocket, Settings2, Store, Terminal } from "lucide-react";
import { EmptyState } from "./ui";
import { fetchJson, jsonRequest } from "./api";

export const PROJECT_OPENED_EVENT = "kforge:project-opened";

function announceProjectOpened(projectId: string, name: string) {
  window.dispatchEvent(new CustomEvent(PROJECT_OPENED_EVENT, { detail: { projectId, name } }));
}

type StartMode = "open" | "clone";

/**
 * Every project-scoped surface needs the same recovery when no project is
 * active. Rather than repeating an inert "No project selected" panel, this
 * offers the two real ways a project enters KForge, against the real
 * `/projects/open` and `/projects/clone` services, and reports the real reason
 * a service refused instead of inventing success.
 */
export function ProjectStartActions({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useState<StartMode>("open");
  const [projectPath, setProjectPath] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [targetName, setTargetName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const openProject = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await fetchJson<{ project: { id: string; name: string } }>("/api/workspace/projects/open", jsonRequest({ path: projectPath.trim() }));
      announceProjectOpened(result.project.id, result.project.name);
      setMessage(`${result.project.name} is now the active project.`);
      setProjectPath("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "KForge could not open that project directory.");
    } finally {
      setBusy(false);
    }
  };

  const cloneProject = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await fetchJson<{ project: { id: string; name: string } }>("/api/workspace/projects/clone", jsonRequest({ remoteUrl: remoteUrl.trim(), targetName: targetName.trim(), confirmed: true }));
      announceProjectOpened(result.project.id, result.project.name);
      setMessage(`${result.project.name} was cloned into the workspace and is now active.`);
      setRemoteUrl("");
      setTargetName("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "KForge could not clone that repository.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={compact ? "kw-start-actions kw-start-actions--compact" : "kw-start-actions"} aria-label="Add a project to KForge">
      <div className="kw-start-actions__tabs" role="tablist" aria-label="Project source">
        <button role="tab" aria-selected={mode === "open"} className={mode === "open" ? "is-active" : ""} onClick={() => setMode("open")}><FolderOpen size={14} />Open local project</button>
        <button role="tab" aria-selected={mode === "clone"} className={mode === "clone" ? "is-active" : ""} onClick={() => setMode("clone")}><GitBranch size={14} />Clone repository</button>
      </div>
      {mode === "open" ? (
        <div className="kw-start-actions__row">
          <label className="kw-start-actions__field">
            <span>Absolute project directory</span>
            <input aria-label="Project directory" value={projectPath} onChange={(event) => setProjectPath(event.target.value)} placeholder="C:\\Projects\\my-app" spellCheck={false} />
          </label>
          <button className="kw-start-actions__primary" disabled={busy || !projectPath.trim()} onClick={() => void openProject()}>
            {busy ? <Loader2 size={14} className="kw-spin" /> : <FolderOpen size={14} />}Open project
          </button>
        </div>
      ) : (
        <div className="kw-start-actions__row">
          <label className="kw-start-actions__field">
            <span>Repository URL</span>
            <input aria-label="Repository URL" value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://github.com/owner/repo" spellCheck={false} />
          </label>
          <label className="kw-start-actions__field kw-start-actions__field--narrow">
            <span>Target folder</span>
            <input aria-label="Clone target folder" value={targetName} onChange={(event) => setTargetName(event.target.value)} placeholder="my-app" spellCheck={false} />
          </label>
          <button className="kw-start-actions__primary" disabled={busy || !remoteUrl.trim() || !targetName.trim()} onClick={() => void cloneProject()}>
            {busy ? <Loader2 size={14} className="kw-spin" /> : <GitBranch size={14} />}Clone
          </button>
        </div>
      )}
      <p className="kw-start-actions__note">
        Cloning performs an explicit remote transfer. KForge refuses it unless Online Optional or Online mode is active, and records the contact as evidence.
      </p>
      {message ? <p className="kw-message" role="status">{message}</p> : null}
    </div>
  );
}

export function ProjectRequired({ detail }: { detail: string }) {
  return (
    <EmptyState
      title="No project selected"
      detail={detail}
      action={
        <div className="kw-start-actions__wrap">
          <ProjectStartActions compact />
          <QuickProjectActions />
        </div>
      }
    />
  );
}

const QUICK_ACTIONS: Array<{ label: string; target: string; icon: typeof Terminal }> = [
  { label: "Project commands", target: "Terminal", icon: Terminal },
  { label: "Providers", target: "Providers", icon: Store },
  { label: "Marketplace", target: "Marketplace", icon: Rocket },
  { label: "Settings", target: "Settings", icon: Settings2 },
];

export function QuickProjectActions() {
  const navigate = (target: string) => {
    window.dispatchEvent(new CustomEvent("kforge:navigate", { detail: { target } }));
  };
  return (
    <div className="kw-start-actions__quick" aria-label="Quick actions">
      {QUICK_ACTIONS.map((action) => (
        <button key={action.target} onClick={() => navigate(action.target)}>
          <action.icon size={13} />
          {action.label}
        </button>
      ))}
    </div>
  );
}

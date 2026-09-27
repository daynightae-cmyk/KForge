import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Braces, ChevronRight, FileCode2, GitBranch, Play, ShieldAlert, TerminalSquare, Wrench } from "lucide-react";
import type { BoundedEvidenceCoverage, ProjectProfile, ProjectSummary, WorkspaceActionDescriptor } from "@shared/workspace";
import type { RecordRow, TaskRow } from "./surfaceContracts";
import { fetchJson } from "./api";
import { StatusBadge } from "./ui";

type FilesResponse = { files: string[]; coverage: BoundedEvidenceCoverage };
type GitResponse = { branch: string; changes: Array<{ file: string; staged: boolean; untracked: boolean }>; remoteUrl?: string };
type ActionsResponse = { actions: WorkspaceActionDescriptor[] };
type ToolsResponse = { tools: Array<{ name: string; description?: string; permission?: string }> };
type PreviewCapabilityEvidence = { available: boolean; command?: string; source?: string; reason?: string };
type PreviewResponse = { preview?: RecordRow; capability?: PreviewCapabilityEvidence };
type TasksResponse = { tasks: TaskRow[] };

type Props = {
  project: ProjectSummary;
  onNavigate: (target: string) => void;
};

const maxVisibleFiles = 28;
export default function ProjectContextExplorer({ project, onNavigate }: Props) {
  const [profile, setProfile] = useState<ProjectProfile | null>(null);
  const [files, setFiles] = useState<FilesResponse | null>(null);
  const [git, setGit] = useState<GitResponse | null>(null);
  const [actions, setActions] = useState<WorkspaceActionDescriptor[]>([]);
  const [tools, setTools] = useState<ToolsResponse["tools"]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    const base = `/api/workspace/projects/${encodeURIComponent(project.id)}`;
    const read = async <T,>(url: string) => {
      try { return await fetchJson<T>(url); }
      catch { return null; }
    };
    void Promise.all([
      read<{ profile: ProjectProfile }>(`${base}/profile`),
      read<FilesResponse>(`${base}/files`),
      read<GitResponse>(`${base}/git`),
      read<ActionsResponse>(`${base}/actions`),
      read<ToolsResponse>(`${base}/agent/tools`),
      read<PreviewResponse>(`${base}/preview`),
      read<TasksResponse>(`/api/workspace/tasks?projectId=${encodeURIComponent(project.id)}`),
    ]).then(([profileData, fileData, gitData, actionData, toolData, previewData, taskData]) => {
      if (cancelled) return;
      setProfile(profileData?.profile || null);
      setFiles(fileData);
      setGit(gitData);
      setActions(actionData?.actions || []);
      setTools(toolData?.tools || []);
      setPreview(previewData);
      setTasks(taskData?.tasks || []);
      setMessage(fileData || gitData || profileData ? "" : "Project evidence is temporarily unavailable.");
    });
    return () => { cancelled = true; };
  }, [project.id]);

  const visibleFiles = useMemo(() => (files?.files || []).slice(0, maxVisibleFiles), [files]);
  const scripts = Object.entries(profile?.scripts || {});
  const availableActions = actions.filter((entry) => entry.enabled);
  const previewState = String(preview?.preview?.state || "IDLE").toUpperCase();
  const previewCapability = preview?.capability;
  const previewDetail = previewCapability?.available === false
    ? previewCapability.reason || "Local runtime capability is not available."
    : previewCapability?.command || "No local Preview command was detected.";
  const runningTasks = tasks.filter((task) => ["RUNNING", "QUEUED"].includes(String(task.status).toUpperCase())).length;
  return <div className="kw-project-context" aria-label="Active project Explorer">
    <section className="kw-project-context__identity">
      <div><strong>{project.name}</strong><small title={project.path}>{project.path}</small></div>
      <StatusBadge value={project.trust} />
      <span><GitBranch size={12} />{git?.branch || project.branch || "NO_GIT"}</span>
    </section>

    {message ? <p className="kw-project-context__notice">{message}</p> : null}

    <ProjectSection title="PROJECT" icon={<Braces size={13} />} open>
      <EvidenceRow label="Stack" value={profile?.framework?.join(" + ") || profile?.languages?.join(" + ") || project.projectType || "UNKNOWN"} />
      <EvidenceRow label="Package" value={profile?.packageManager || "NOT_DETECTED"} />
      <EvidenceRow label="Files" value={profile ? String(profile.totalFileCount) : "LOADING"} />
      <EvidenceRow label="Trust" value={project.trust.toUpperCase()} />
    </ProjectSection>

    <ProjectSection title="FILES" icon={<FileCode2 size={13} />} open>
      <div className="kw-project-context__files">
        {visibleFiles.map((file) => <code key={file} title={file}>{file}</code>)}
        {!visibleFiles.length ? <small>No bounded file evidence loaded.</small> : null}
      </div>
      {files ? <small className="kw-project-context__coverage">{files.coverage.state} · {files.coverage.scannedCount} indexed · limit {files.coverage.limit}</small> : null}
    </ProjectSection>

    <ProjectSection title="GIT CHANGES" icon={<GitBranch size={13} />}>
      <button className="kw-project-context__jump" onClick={() => onNavigate("Git")}>
        <span>{git?.changes?.length ?? project.modifiedFiles + project.untrackedFiles} change(s)</span>
        <small>{project.ahead} ahead · {project.behind} behind</small>
        <ChevronRight size={12} />
      </button>
      {(git?.changes || []).slice(0, 8).map((change) => <code key={change.file} title={change.file}>{change.file}</code>)}
    </ProjectSection>

    <ProjectSection title="SCRIPTS" icon={<TerminalSquare size={13} />}>
      {scripts.length ? scripts.slice(0, 12).map(([name, command]) => (
        <button key={name} className="kw-project-context__script" onClick={() => onNavigate("Project commands")}>
          <strong>{name}</strong><code>{command}</code>
        </button>
      )) : <small>No package scripts detected.</small>}
    </ProjectSection>

    <ProjectSection title="TASKS" icon={<Play size={13} />}>
      <button className="kw-project-context__jump" onClick={() => onNavigate("Tasks")}>
        <span>{tasks.length} task(s)</span><small>{runningTasks} active</small><ChevronRight size={12} />
      </button>
    </ProjectSection>
    <ProjectSection title="SERVICES" icon={<Wrench size={13} />}>
      <button className="kw-project-context__jump" onClick={() => onNavigate("Project commands")}>
        <span>{availableActions.length}/{actions.length || 0} project actions available</span>
        <small>{tools.length} agent tool(s) registered</small>
        <ChevronRight size={12} />
      </button>
    </ProjectSection>

    <ProjectSection title="PROBLEMS" icon={<ShieldAlert size={13} />}>
      <button className="kw-project-context__jump" onClick={() => onNavigate("Problems")}>
        <span>{project.healthScore == null ? "NOT_SCANNED" : `Health ${project.healthScore}`}</span>
        <small>Open explicitly to run bounded diagnostics</small>
        <ChevronRight size={12} />
      </button>
    </ProjectSection>

    <ProjectSection title="PREVIEW" icon={<Play size={13} />}>
      <button className="kw-project-context__jump" onClick={() => onNavigate("Preview")}>
        <StatusBadge value={previewState} />
        <small title={previewDetail}>{previewDetail}</small>
        <ChevronRight size={12} />
      </button>
    </ProjectSection>
  </div>;
}

function ProjectSection({ title, icon, children, open = false }: { title: string; icon: ReactNode; children: ReactNode; open?: boolean }) {
  return <details className="kw-project-context__section" open={open}>
    <summary>{icon}<span>{title}</span><ChevronRight size={11} /></summary>
    <div>{children}</div>
  </details>;
}
function EvidenceRow({ label, value }: { label: string; value: string }) {
  return <div className="kw-project-context__evidence"><span>{label}</span><strong title={value}>{value}</strong></div>;
}

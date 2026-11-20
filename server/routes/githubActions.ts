import { Router } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { candidateProjectPaths, makeProjectSummary } from "./workspace";
import { createOperationTransparency, recordRemoteContact } from "../services/onlineControlCenter";
import { isRemoteTransferEnabled } from "../services/localPlatform";
import { runGhApi } from "../services/githubClient";
import {
  executeGhMutation,
  ghCliRunner,
  githubMutationStatus,
  isSafeRunId,
  isSafeWorkflowId,
  parseGitHubRemote,
  pullRequestEndpoint,
  releaseEndpoint,
  validatePullRequestInput,
  validateReleaseInput,
  validateWorkflowDispatch,
  workflowDispatchEndpoint,
  workflowRerunEndpoint,
  type GhMutationResult,
  type GitHubRepoIdentity,
} from "../services/githubActions";

const execFileAsync = promisify(execFile);
const router = Router();

function getWorkspaceRoot() {
  return path.resolve(process.env.KFORGE_WORKSPACE_ROOT || path.resolve(process.cwd(), ".."));
}

async function localHead(cwd: string): Promise<string | null> {
  try {
    const result = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd, timeout: 10_000, shell: false, windowsHide: true });
    const head = (result.stdout || "").trim();
    return /^[0-9a-f]{40}$/i.test(head) ? head : null;
  } catch {
    return null;
  }
}

async function resolveProject(id: string) {
  for (const candidate of await candidateProjectPaths()) {
    const project = await makeProjectSummary(candidate);
    if (project.id === id) return project;
  }
  return null;
}

interface GuardedRequest {
  project: Awaited<ReturnType<typeof makeProjectSummary>>;
  identity: GitHubRepoIdentity;
  sourceSha: string;
}

async function guardMutation(req: import("express").Request, res: import("express").Response, purpose: string): Promise<GuardedRequest | null> {
  const project = await resolveProject(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: "Project not found in the configured KForge workspace." });
    return null;
  }
  if (project.trust !== "trusted") {
    res.status(428).json({ error: "This project is untrusted. Authorized GitHub mutations require explicit project trust.", permission: "ask", code: "PROJECT_TRUST_REQUIRED" });
    return null;
  }
  if (!(await isRemoteTransferEnabled(getWorkspaceRoot()))) {
    res.status(428).json({ error: "GitHub mutations require Online Optional or Online mode. Local First permits metadata reads only, and Offline Mode blocks all remote contact.", permission: "online-optional", code: "REMOTE_WRITE_DISABLED" });
    return null;
  }
  if (req.body?.confirmed !== true) {
    res.status(428).json({ error: `${purpose} requires explicit confirmation tied to this exact repository, action, and target.`, permission: "ask", code: "GITHUB_MUTATION_CONFIRMATION_REQUIRED" });
    return null;
  }
  const identity = parseGitHubRemote(project.remoteUrl);
  if (!identity) {
    res.status(422).json({ error: "This project has no safe GitHub origin remote. KForge will not invent a repository identity.", code: "GITHUB_REMOTE_REQUIRED" });
    return null;
  }
  const head = await localHead(project.path);
  if (!head) {
    res.status(422).json({ error: "The local project has no readable Git HEAD.", code: "GITHUB_HEAD_REQUIRED" });
    return null;
  }
  const expectedHead = typeof req.body?.expectedHead === "string" ? req.body.expectedHead.trim() : "";
  if (!expectedHead) {
    res.status(428).json({ error: "Review the exact local source SHA and supply expectedHead before a remote mutation.", code: "GITHUB_PLAN_HEAD_REQUIRED" });
    return null;
  }
  if (!/^[0-9a-f]{7,40}$/i.test(expectedHead)) {
    res.status(428).json({ error: "The reviewed source SHA must be a 7-40 character Git object id. Refresh GitHub evidence and review the exact HEAD.", code: "GITHUB_PLAN_HEAD_INVALID" });
    return null;
  }
  if (!head.toLowerCase().startsWith(expectedHead.toLowerCase())) {
    res.status(409).json({ error: "The reviewed GitHub action plan is stale because the local HEAD changed.", code: "STALE_GITHUB_PLAN", expectedHead, actualHead: head });
    return null;
  }
  return { project, identity, sourceSha: head };
}

function mutationTransparency(input: { purpose: string; slug: string; startedAt: string; completedAt: string; result: "SUCCEEDED" | "FAILED" | "BLOCKED"; reason?: string }) {
  return createOperationTransparency({
    execution: "REMOTE",
    network: "REQUIRED",
    dataClasses: ["METADATA", "CREDENTIAL_REFERENCE"],
    provider: "GitHub CLI",
    destination: `https://api.github.com/repos/${input.slug}`,
    purpose: input.purpose,
    confirmation: "CONFIRMED",
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    result: input.result,
    reason: input.reason,
  });
}

function recordMutationContact(service: "github" | "remote-ci", slug: string, startedAt: string, result: GhMutationResult) {
  return recordRemoteContact(getWorkspaceRoot(), service, {
    attemptedAt: startedAt,
    succeeded: result.ok,
    destination: `https://api.github.com/repos/${slug}`,
    error: result.ok ? null : result.error || result.state,
  });
}

function verificationRead(endpoint: string, cwd: string) {
  return runGhApi(ghCliRunner, { endpoint, cwd, timeoutMs: 20_000 });
}

router.post("/projects/:id/github/pull-requests", async (req, res) => {
  const startedAt = new Date().toISOString();
  const guarded = await guardMutation(req, res, "Creating a GitHub pull request");
  if (!guarded) return;
  const validated = validatePullRequestInput(req.body || {});
  if (!validated.ok) return res.status(400).json({ error: "error" in validated ? validated.error : "Invalid pull request input.", code: "INVALID_PULL_REQUEST" });
  const result = await executeGhMutation(ghCliRunner, {
    cwd: guarded.project.path,
    method: "POST",
    endpoint: pullRequestEndpoint(guarded.identity),
    fields: { title: validated.title, head: validated.head, base: validated.base, body: validated.body, draft: validated.draft },
    timeoutMs: 30_000,
  });
  const completedAt = new Date().toISOString();
  await recordMutationContact("github", guarded.identity.slug, startedAt, result);
  if (!result.ok) {
    return res.status(githubMutationStatus(result.state)).json({ ok: false, state: result.state, error: result.error, slug: guarded.identity.slug, transparency: mutationTransparency({ purpose: "Create an explicitly confirmed GitHub pull request for the reviewed local source SHA.", slug: guarded.identity.slug, startedAt, completedAt, result: "FAILED", reason: result.error }) });
  }
  const pull = result.data as Record<string, unknown> | null;
  const number = typeof pull?.number === "number" ? pull.number : null;
  const verification = number ? await verificationRead(`repos/${guarded.identity.slug}/pulls/${number}`, guarded.project.path) : null;
  let readBack: { state: string; data?: unknown; error?: string; checks?: Record<string, boolean> } = { state: number ? "NOT_READ" : "NO_IDENTIFIER" };
  if (verification) {
    if (verification.ok) {
      try {
        const remote = JSON.parse(verification.output) as Record<string, unknown>;
        const remoteHead = remote.head && typeof remote.head === "object" ? remote.head as Record<string, unknown> : {};
        const remoteBase = remote.base && typeof remote.base === "object" ? remote.base as Record<string, unknown> : {};
        const checks = {
          number: remote.number === number,
          title: remote.title === validated.title,
          head: remoteHead.ref === validated.head,
          base: remoteBase.ref === validated.base,
        };
        readBack = Object.values(checks).every(Boolean)
          ? { state: "VERIFIED", data: remote }
          : { state: "MISMATCH", data: remote, error: `GitHub read-back did not match the reviewed pull request fields: ${Object.entries(checks).filter(([, ok]) => !ok).map(([field]) => field).join(", ")}.`, checks };
      } catch { readBack = { state: "INVALID_JSON", error: verification.output.slice(0, 500) }; }
    } else {
      readBack = { state: "UNVERIFIED", error: verification.output.slice(0, 500) };
    }
  }
  await recordMutationContact("github", guarded.identity.slug, completedAt, { ok: readBack.state === "VERIFIED", state: "AVAILABLE", data: readBack.data ?? null, error: readBack.error });
  return res.status(201).json({
    ok: true,
    state: "CREATED",
    pullRequest: { number, htmlUrl: typeof pull?.html_url === "string" ? pull.html_url : null, state: typeof pull?.state === "string" ? pull.state : null, draft: pull?.draft === true, head: validated.head, base: validated.base },
    verification: readBack,
    slug: guarded.identity.slug,
    sourceSha: guarded.sourceSha,
    transparency: mutationTransparency({ purpose: "Create an explicitly confirmed GitHub pull request for the reviewed local source SHA.", slug: guarded.identity.slug, startedAt, completedAt, result: "SUCCEEDED" }),
  });
});

router.post("/projects/:id/github/releases", async (req, res) => {
  const startedAt = new Date().toISOString();
  const guarded = await guardMutation(req, res, "Creating a GitHub release");
  if (!guarded) return;
  const validated = validateReleaseInput(req.body || {});
  if (!validated.ok) return res.status(400).json({ error: "error" in validated ? validated.error : "Invalid release input.", code: "INVALID_RELEASE" });
  const result = await executeGhMutation(ghCliRunner, {
    cwd: guarded.project.path,
    method: "POST",
    endpoint: releaseEndpoint(guarded.identity),
    fields: { tag_name: validated.tagName, name: validated.name, body: validated.body, draft: validated.draft, prerelease: validated.prerelease, target_commitish: validated.targetCommitish },
    timeoutMs: 30_000,
  });
  const completedAt = new Date().toISOString();
  await recordMutationContact("github", guarded.identity.slug, startedAt, result);
  if (!result.ok) {
    return res.status(githubMutationStatus(result.state)).json({ ok: false, state: result.state, error: result.error, slug: guarded.identity.slug, transparency: mutationTransparency({ purpose: "Create an explicitly confirmed GitHub release for the reviewed tag and source SHA.", slug: guarded.identity.slug, startedAt, completedAt, result: "FAILED", reason: result.error }) });
  }
  const release = result.data as Record<string, unknown> | null;
  const id = typeof release?.id === "number" ? release.id : null;
  let readBack: { state: string; data?: unknown; error?: string; checks?: Record<string, boolean> } = { state: id ? "NOT_READ" : "NO_IDENTIFIER" };
  if (id) {
    const verification = await verificationRead(`repos/${guarded.identity.slug}/releases/${id}`, guarded.project.path);
    if (verification.ok) {
      try {
        const remote = JSON.parse(verification.output) as Record<string, unknown>;
        const checks = {
          id: remote.id === id,
          tagName: remote.tag_name === validated.tagName,
          name: remote.name === validated.name,
          draft: remote.draft === validated.draft,
          prerelease: remote.prerelease === validated.prerelease,
        };
        readBack = Object.values(checks).every(Boolean)
          ? { state: "VERIFIED", data: remote }
          : { state: "MISMATCH", data: remote, error: `GitHub read-back did not match the reviewed release fields: ${Object.entries(checks).filter(([, ok]) => !ok).map(([field]) => field).join(", ")}.`, checks };
      } catch { readBack = { state: "INVALID_JSON", error: verification.output.slice(0, 500) }; }
    } else {
      readBack = { state: "UNVERIFIED", error: verification.output.slice(0, 500) };
    }
  }
  return res.status(201).json({
    ok: true,
    state: validated.draft ? "DRAFT_CREATED" : "PUBLISHED",
    release: { id, tagName: validated.tagName, name: validated.name, draft: validated.draft, prerelease: validated.prerelease, htmlUrl: typeof release?.html_url === "string" ? release.html_url : null },
    verification: readBack,
    slug: guarded.identity.slug,
    sourceSha: guarded.sourceSha,
    transparency: mutationTransparency({ purpose: "Create an explicitly confirmed GitHub release for the reviewed tag and source SHA.", slug: guarded.identity.slug, startedAt, completedAt, result: "SUCCEEDED" }),
  });
});

router.post("/projects/:id/github/actions/:workflowId/dispatches", async (req, res) => {
  const startedAt = new Date().toISOString();
  if (!isSafeWorkflowId(req.params.workflowId)) return res.status(400).json({ error: "Invalid workflow identifier.", code: "INVALID_WORKFLOW_ID" });
  const guarded = await guardMutation(req, res, "Dispatching a GitHub workflow");
  if (!guarded) return;
  const validated = validateWorkflowDispatch(req.body || {});
  if (!validated.ok) return res.status(400).json({ error: "error" in validated ? validated.error : "Invalid workflow dispatch input.", code: "INVALID_WORKFLOW_DISPATCH" });
  const result = await executeGhMutation(ghCliRunner, {
    cwd: guarded.project.path,
    method: "POST",
    endpoint: workflowDispatchEndpoint(guarded.identity, req.params.workflowId),
    fields: { ref: validated.ref, ...Object.fromEntries(Object.entries(validated.inputs).map(([key, value]) => [`inputs[${key}]`, value])) },
    timeoutMs: 30_000,
    expectJson: false,
  });
  const completedAt = new Date().toISOString();
  await recordMutationContact("remote-ci", guarded.identity.slug, startedAt, result);
  if (!result.ok) {
    return res.status(githubMutationStatus(result.state)).json({ ok: false, state: result.state, error: result.error, slug: guarded.identity.slug, transparency: mutationTransparency({ purpose: "Dispatch an explicitly confirmed GitHub Actions workflow for the reviewed ref.", slug: guarded.identity.slug, startedAt, completedAt, result: "FAILED", reason: result.error }) });
  }
  const runsRead = await verificationRead(`repos/${guarded.identity.slug}/actions/runs?per_page=5`, guarded.project.path);
  let verification: { state: string; data?: unknown; error?: string } = { state: "PENDING_REMOTE_RUN" };
  if (runsRead.ok) {
    try {
      const parsed = JSON.parse(runsRead.output) as { workflow_runs?: Array<Record<string, unknown>> };
      const dispatchEpoch = Date.parse(startedAt);
      // Only a workflow_dispatch run created after this exact dispatch can be
      // evidence for it. A historic run on the same branch is not confirmation.
      const matching = (parsed.workflow_runs || []).find((run) => {
        const created = typeof run.created_at === "string" ? Date.parse(run.created_at) : Number.NaN;
        return run.event === "workflow_dispatch"
          && Number.isFinite(created) && created >= dispatchEpoch - 10_000
          && (run.head_sha === guarded.sourceSha || run.head_branch === validated.ref);
      });
      verification = matching ? { state: "RUN_OBSERVED", data: matching } : { state: "PENDING_REMOTE_RUN" };
    } catch {
      verification = { state: "INVALID_JSON", error: runsRead.output.slice(0, 500) };
    }
  } else {
    verification = { state: "UNVERIFIED", error: runsRead.output.slice(0, 500) };
  }
  return res.status(202).json({
    ok: true,
    state: "DISPATCH_ACCEPTED",
    workflowId: req.params.workflowId,
    ref: validated.ref,
    inputs: validated.inputs,
    verification,
    slug: guarded.identity.slug,
    sourceSha: guarded.sourceSha,
    transparency: mutationTransparency({ purpose: "Dispatch an explicitly confirmed GitHub Actions workflow for the reviewed ref.", slug: guarded.identity.slug, startedAt, completedAt, result: "SUCCEEDED" }),
  });
});

router.post("/projects/:id/github/actions/runs/:runId/rerun", async (req, res) => {
  const startedAt = new Date().toISOString();
  if (!isSafeRunId(req.params.runId)) return res.status(400).json({ error: "Invalid workflow run identifier.", code: "INVALID_RUN_ID" });
  const guarded = await guardMutation(req, res, "Rerunning a GitHub workflow");
  if (!guarded) return;
  const result = await executeGhMutation(ghCliRunner, {
    cwd: guarded.project.path,
    method: "POST",
    endpoint: workflowRerunEndpoint(guarded.identity, req.params.runId),
    timeoutMs: 30_000,
    expectJson: false,
  });
  const completedAt = new Date().toISOString();
  await recordMutationContact("remote-ci", guarded.identity.slug, startedAt, result);
  if (!result.ok) {
    return res.status(githubMutationStatus(result.state)).json({ ok: false, state: result.state, error: result.error, slug: guarded.identity.slug, transparency: mutationTransparency({ purpose: "Rerun an explicitly confirmed GitHub Actions workflow run.", slug: guarded.identity.slug, startedAt, completedAt, result: "FAILED", reason: result.error }) });
  }
  return res.status(202).json({
    ok: true,
    state: "RERUN_ACCEPTED",
    runId: req.params.runId,
    verification: { state: "PENDING_REMOTE_RUN", detail: "GitHub accepted the rerun. The new run state must be read from Actions evidence after GitHub schedules it." },
    slug: guarded.identity.slug,
    sourceSha: guarded.sourceSha,
    transparency: mutationTransparency({ purpose: "Rerun an explicitly confirmed GitHub Actions workflow run.", slug: guarded.identity.slug, startedAt, completedAt, result: "SUCCEEDED" }),
  });
});

export default router;

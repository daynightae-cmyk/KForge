import { execFile } from "child_process";
import { promisify } from "util";
import { GH_ACCEPT_HEADER, GH_API_VERSION, GH_DEFAULT_TIMEOUT_MS } from "./githubClient";

const execFileAsync = promisify(execFile);

/**
 * Authorized GitHub mutation contracts layered over the existing `gh api`
 * transport. This module contains no second GitHub client and no stored
 * credential: it only builds exact, validated `gh api` invocations for the
 * actions the operator explicitly confirmed. Reads remain owned by the
 * existing hardened read path.
 */

export interface GhMutationExecution {
  ok: boolean;
  code: number;
  output: string;
}

export type GhMutationRunner = (command: string, args: string[], cwd: string, timeoutMs: number) => Promise<GhMutationExecution>;

export type GhMutationState = "AVAILABLE" | "REJECTED" | "BLOCKED" | "NOT_CONNECTED" | "RATE_LIMITED" | "UNAVAILABLE" | "UNKNOWN";

export interface GitHubRepoIdentity {
  owner: string;
  repo: string;
  slug: string;
}

export interface GhMutationResult {
  state: GhMutationState;
  ok: boolean;
  data: unknown;
  error?: string;
}

const SAFE_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const SAFE_REPO = /^[A-Za-z0-9._-]{1,100}$/;
const SAFE_REF = /^[A-Za-z0-9._/-]{1,255}$/;
const SAFE_WORKFLOW_ID = /^(?:\d{1,20}|[A-Za-z0-9._-]{1,160})$/;
const SAFE_RUN_ID = /^\d{1,20}$/;
const SAFE_INPUT_KEY = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

export function parseGitHubRemote(remoteUrl?: string): GitHubRepoIdentity | null {
  if (!remoteUrl) return null;
  const value = remoteUrl.trim();
  const match = value.match(/^(?:https?:\/\/)(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i)
    || value.match(/^(?:git@|ssh:\/\/git@)github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  if (!SAFE_OWNER.test(owner) || !SAFE_REPO.test(repo) || repo === "." || repo === "..") return null;
  return { owner, repo, slug: `${owner}/${repo}` };
}

export function safeBranchRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ref = value.trim();
  if (!SAFE_REF.test(ref) || ref.startsWith("-") || ref.startsWith("/") || ref.endsWith("/") || ref.includes("..") || ref.includes("//")) return null;
  return ref;
}

export function validatePullRequestInput(input: { title?: unknown; head?: unknown; base?: unknown; body?: unknown; draft?: unknown }): { ok: true; title: string; head: string; base: string; body: string; draft: boolean } | { ok: false; error: string } {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const head = safeBranchRef(input.head);
  const base = safeBranchRef(input.base);
  const body = typeof input.body === "string" ? input.body : "";
  const draft = input.draft === true;
  if (!title || title.length > 256) return { ok: false, error: "Provide a pull request title between 1 and 256 characters." };
  if (!head || !base) return { ok: false, error: "Provide safe head and base branch names. Branch names cannot contain '..', start with '-', or escape the repository." };
  if (head === base) return { ok: false, error: "The pull request head and base branches must differ." };
  if (body.length > 65_536) return { ok: false, error: "The pull request body exceeds the 65,536 character bound." };
  return { ok: true, title, head, base, body, draft };
}

export function validateReleaseInput(input: { tagName?: unknown; name?: unknown; body?: unknown; draft?: unknown; prerelease?: unknown; targetCommitish?: unknown }): { ok: true; tagName: string; name: string; body: string; draft: boolean; prerelease: boolean; targetCommitish?: string } | { ok: false; error: string } {
  const tagName = safeBranchRef(input.tagName);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const body = typeof input.body === "string" ? input.body : "";
  const targetCommitish = input.targetCommitish === undefined ? undefined : safeBranchRef(input.targetCommitish);
  if (!tagName) return { ok: false, error: "Provide a safe release tag name (letters, digits, '.', '_', '/', or '-')." };
  if (!name || name.length > 256) return { ok: false, error: "Provide a release name between 1 and 256 characters." };
  if (body.length > 65_536) return { ok: false, error: "The release body exceeds the 65,536 character bound." };
  if (input.targetCommitish !== undefined && !targetCommitish) return { ok: false, error: "The target commitish is not a safe ref." };
  return { ok: true, tagName, name, body, draft: input.draft === true, prerelease: input.prerelease === true, ...(targetCommitish ? { targetCommitish } : {}) };
}

export function validateWorkflowDispatch(input: { ref?: unknown; inputs?: unknown }): { ok: true; ref: string; inputs: Record<string, string | number | boolean> } | { ok: false, error: string } {
  const ref = safeBranchRef(input.ref);
  if (!ref) return { ok: false, error: "Provide a safe branch or tag ref for the workflow dispatch." };
  const raw = input.inputs;
  if (raw === undefined || raw === null) return { ok: true, ref, inputs: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Workflow inputs must be a flat object of string, number, or boolean values." };
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 10) return { ok: false, error: "At most 10 workflow inputs may be supplied." };
  const inputs: Record<string, string | number | boolean> = {};
  for (const [key, value] of entries) {
    if (!SAFE_INPUT_KEY.test(key)) return { ok: false, error: `Workflow input key '${key}' is not a safe identifier.` };
    if (typeof value === "string") {
      if (value.length > 1_024) return { ok: false, error: `Workflow input '${key}' exceeds the 1,024 character bound.` };
      inputs[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      inputs[key] = value;
    } else if (typeof value === "boolean") {
      inputs[key] = value;
    } else {
      return { ok: false, error: `Workflow input '${key}' must be a string, finite number, or boolean.` };
    }
  }
  return { ok: true, ref, inputs };
}

export function isSafeWorkflowId(value: string): boolean {
  return SAFE_WORKFLOW_ID.test(value);
}

export function isSafeRunId(value: string): boolean {
  return SAFE_RUN_ID.test(value);
}

/** Build the exact pinned `gh api` mutation arguments. No shell is involved. */
export function ghMutationArgs(method: "POST" | "PATCH" | "PUT", endpoint: string, fields: Record<string, string | number | boolean | undefined> = {}): string[] {
  const args = ["api", "--method", method, endpoint, "-H", `Accept: ${GH_ACCEPT_HEADER}`, "-H", `X-GitHub-Api-Version: ${GH_API_VERSION}`];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (typeof value === "boolean") args.push("-F", `${key}=${value}`);
    else if (typeof value === "number") args.push("-F", `${key}=${value}`);
    else args.push("-f", `${key}=${value}`);
  }
  return args;
}

export function githubMutationStatus(state: GhMutationState): number {
  switch (state) {
    case "REJECTED": return 422;
    case "BLOCKED": return 403;
    case "NOT_CONNECTED": return 428;
    case "RATE_LIMITED": return 429;
    case "UNAVAILABLE": return 503;
    default: return 502;
  }
}

export function classifyGhMutationFailure(output: string): GhMutationState {
  const text = output.toLowerCase();
  if (/(not recognized|enoent|executable file not found|could not be found)/.test(text)) return "UNAVAILABLE";
  if (/(not logged|authenticate|authentication|bad credentials|token.*invalid|gh auth login)/.test(text)) return "NOT_CONNECTED";
  if (/(secondary rate limit|abuse detection|rate limit|api rate limit|http 429|429)/.test(text)) return "RATE_LIMITED";
  if (/(403|forbidden|resource not accessible|insufficient|permission)/.test(text)) return "BLOCKED";
  if (/(422|validation failed|unprocessable)/.test(text)) return "REJECTED";
  if (/(404|not found)/.test(text)) return "UNAVAILABLE";
  return "UNKNOWN";
}

/**
 * Real ambient-credential transport used by the action routes. The caller
 * supplies an exact argument vector; no shell is involved. Successful stdout
 * is returned alone so warnings on stderr cannot corrupt JSON parsing.
 */
export const ghCliRunner: GhMutationRunner = async (command, args, cwd, timeoutMs) => {
  try {
    const result = await execFileAsync(command, args, { cwd, timeout: timeoutMs, shell: false, windowsHide: true, maxBuffer: 2_000_000 });
    return { ok: true, code: 0, output: (result.stdout || "").trim() };
  } catch (error: unknown) {
    const data = typeof error === "object" && error !== null ? error as { stdout?: unknown; stderr?: unknown; message?: unknown; code?: unknown } : {};
    const output = `${typeof data.stdout === "string" ? data.stdout : ""}${typeof data.stderr === "string" ? data.stderr : ""}${typeof data.message === "string" ? data.message : ""}`.trim();
    return { ok: false, code: typeof data.code === "number" ? data.code : 1, output };
  }
};

export async function executeGhCommand(
  runner: GhMutationRunner,
  input: { cwd: string; args: string[]; timeoutMs?: number },
): Promise<GhMutationResult> {
  let execution: GhMutationExecution;
  try {
    execution = await runner("gh", input.args, input.cwd, input.timeoutMs ?? GH_DEFAULT_TIMEOUT_MS);
  } catch (error: unknown) {
    return { ok: false, state: "UNAVAILABLE", data: null, error: error instanceof Error ? error.message.slice(0, 500) : "The GitHub CLI invocation failed." };
  }
  if (!execution.ok) {
    return { ok: false, state: classifyGhMutationFailure(execution.output), data: null, error: execution.output.slice(0, 2_000) || "GitHub rejected the authorized command." };
  }
  return { ok: true, state: "AVAILABLE", data: null };
}

/** Upload verified assets to an existing release. GitHub CLI owns multipart transfer. */
export function releaseUploadArgs(tagName: string, slug: string, assetPaths: readonly string[]): string[] {
  return ["release", "upload", tagName, "--repo", slug, ...assetPaths];
}

export async function executeGhMutation(
  runner: GhMutationRunner,
  input: { cwd: string; method: "POST" | "PATCH" | "PUT"; endpoint: string; fields?: Record<string, string | number | boolean | undefined>; timeoutMs?: number; expectJson?: boolean },
): Promise<GhMutationResult> {
  let execution: GhMutationExecution;
  try {
    execution = await runner("gh", ghMutationArgs(input.method, input.endpoint, input.fields), input.cwd, input.timeoutMs ?? GH_DEFAULT_TIMEOUT_MS);
  } catch (error: unknown) {
    return { ok: false, state: "UNAVAILABLE", data: null, error: error instanceof Error ? error.message.slice(0, 500) : "The GitHub CLI invocation failed." };
  }
  if (!execution.ok) {
    const state = classifyGhMutationFailure(execution.output);
    return { ok: false, state, data: null, error: execution.output.slice(0, 2_000) || "GitHub rejected the authorized mutation." };
  }
  if (input.expectJson === false) {
    return { ok: true, state: "AVAILABLE", data: null };
  }
  try {
    const data = JSON.parse(execution.output);
    return { ok: true, state: "AVAILABLE", data };
  } catch {
    return { ok: false, state: "UNKNOWN", data: null, error: "GitHub returned a successful exit code without JSON output; the mutation result cannot be verified." };
  }
}

export function pullRequestEndpoint(identity: GitHubRepoIdentity): string {
  return `repos/${identity.slug}/pulls`;
}

export function releaseEndpoint(identity: GitHubRepoIdentity): string {
  return `repos/${identity.slug}/releases`;
}

export function workflowDispatchEndpoint(identity: GitHubRepoIdentity, workflowId: string): string {
  return `repos/${identity.slug}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`;
}

export function workflowRerunEndpoint(identity: GitHubRepoIdentity, runId: string): string {
  return `repos/${identity.slug}/actions/runs/${encodeURIComponent(runId)}/rerun`;
}

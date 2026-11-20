import { describe, expect, it, vi } from "vitest";
import {
  classifyGhMutationFailure,
  executeGhCommand,
  executeGhMutation,
  ghMutationArgs,
  githubMutationStatus,
  parseGitHubRemote,
  releaseUploadArgs,
  safeBranchRef,
  validatePullRequestInput,
  validateReleaseInput,
  validateWorkflowDispatch,
  type GhMutationRunner,
} from "./githubActions";

describe("GitHub repository identity", () => {
  it("parses https and ssh GitHub remotes and rejects unrelated hosts", () => {
    expect(parseGitHubRemote("https://github.com/daynightae-cmyk/KForge.git")).toEqual({ owner: "daynightae-cmyk", repo: "KForge", slug: "daynightae-cmyk/KForge" });
    expect(parseGitHubRemote("git@github.com:daynightae-cmyk/KForge.git")).toEqual({ owner: "daynightae-cmyk", repo: "KForge", slug: "daynightae-cmyk/KForge" });
    expect(parseGitHubRemote("https://github.com/owner/repo")).toEqual({ owner: "owner", repo: "repo", slug: "owner/repo" });
    expect(parseGitHubRemote("https://evil.example/owner/repo.git")).toBeNull();
    expect(parseGitHubRemote("https://github.com/../repo.git")).toBeNull();
    expect(parseGitHubRemote(undefined)).toBeNull();
  });

  it("rejects branch refs that could escape or be parsed as options", () => {
    expect(safeBranchRef("feat/release-closure")).toBe("feat/release-closure");
    expect(safeBranchRef("-delete-main")).toBeNull();
    expect(safeBranchRef("main..next")).toBeNull();
    expect(safeBranchRef("/main")).toBeNull();
    expect(safeBranchRef("main//next")).toBeNull();
    expect(safeBranchRef("main next")).toBeNull();
  });
});

describe("GitHub mutation validation", () => {
  it("validates pull request inputs and refuses empty or self-targeting requests", () => {
    expect(validatePullRequestInput({ title: "Close release gap", head: "feat/release", base: "main", body: "Evidence", draft: true })).toMatchObject({ ok: true, draft: true, head: "feat/release", base: "main" });
    expect(validatePullRequestInput({ title: "", head: "feat/release", base: "main" })).toMatchObject({ ok: false });
    expect(validatePullRequestInput({ title: "x", head: "main", base: "main" })).toMatchObject({ ok: false });
    expect(validatePullRequestInput({ title: "x", head: "main..next", base: "main" })).toMatchObject({ ok: false });
  });

  it("validates release inputs and keeps draft versus publication explicit", () => {
    expect(validateReleaseInput({ tagName: "v1.2.3", name: "KForge 1.2.3", body: "notes", draft: true })).toMatchObject({ ok: true, tagName: "v1.2.3", draft: true, prerelease: false });
    expect(validateReleaseInput({ tagName: "-bad", name: "x" })).toMatchObject({ ok: false });
    expect(validateReleaseInput({ tagName: "v1.2.3", name: "" })).toMatchObject({ ok: false });
  });

  it("validates workflow dispatch refs and flat typed inputs", () => {
    expect(validateWorkflowDispatch({ ref: "main", inputs: { environment: "sandbox", attempts: 2, dryRun: true } })).toEqual({ ok: true, ref: "main", inputs: { environment: "sandbox", attempts: 2, dryRun: true } });
    expect(validateWorkflowDispatch({ ref: "main", inputs: { nested: { bad: true } } })).toMatchObject({ ok: false });
    expect(validateWorkflowDispatch({ ref: "main", inputs: { "bad key": "x" } })).toMatchObject({ ok: false });
    expect(validateWorkflowDispatch({ ref: "-bad" })).toMatchObject({ ok: false });
  });
});

describe("GitHub mutation transport", () => {
  it("builds pinned gh api arguments without a shell and preserves typed fields", () => {
    const args = ghMutationArgs("POST", "repos/owner/repo/pulls", { title: "Close gap", draft: true, count: 2, optional: undefined });
    expect(args.slice(0, 4)).toEqual(["api", "--method", "POST", "repos/owner/repo/pulls"]);
    expect(args).toContain("Accept: application/vnd.github+json");
    expect(args).toContain("X-GitHub-Api-Version: 2026-03-10");
    expect(args).toContain("-f");
    expect(args).toContain("title=Close gap");
    expect(args).toContain("-F");
    expect(args).toContain("draft=true");
    expect(args).toContain("count=2");
    expect(args.some((entry) => entry.startsWith("optional="))).toBe(false);
  });

  it("executes an injected runner and parses the verified JSON response", async () => {
    const runner = vi.fn<GhMutationRunner>(async () => ({ ok: true, code: 0, output: JSON.stringify({ number: 42, html_url: "https://github.com/owner/repo/pull/42" }) }));
    const result = await executeGhMutation(runner, { cwd: "C:/project", method: "POST", endpoint: "repos/owner/repo/pulls", fields: { title: "x" } });
    expect(result).toMatchObject({ ok: true, state: "AVAILABLE", data: { number: 42 } });
    expect(runner).toHaveBeenCalledWith("gh", expect.arrayContaining(["api", "--method", "POST", "repos/owner/repo/pulls"]), "C:/project", 20_000);
  });

  it("classifies authentication, rejection, permission, and rate-limit failures honestly", async () => {
    expect(classifyGhMutationFailure("not logged into github.com; run gh auth login")).toBe("NOT_CONNECTED");
    expect(classifyGhMutationFailure("HTTP 422: Validation Failed")).toBe("REJECTED");
    expect(classifyGhMutationFailure("HTTP 403: Resource not accessible by integration")).toBe("BLOCKED");
    expect(classifyGhMutationFailure("secondary rate limit detected")).toBe("RATE_LIMITED");
    expect(classifyGhMutationFailure("gh: command not recognized")).toBe("UNAVAILABLE");
    const runner = vi.fn<GhMutationRunner>(async () => ({ ok: false, code: 1, output: "HTTP 422: Validation Failed" }));
    await expect(executeGhMutation(runner, { cwd: ".", method: "POST", endpoint: "repos/owner/repo/releases" })).resolves.toMatchObject({ ok: false, state: "REJECTED" });
  });

  it("accepts a no-content dispatch only when the caller explicitly does not expect JSON", async () => {
    const runner = vi.fn<GhMutationRunner>(async () => ({ ok: true, code: 0, output: "" }));
    await expect(executeGhMutation(runner, { cwd: ".", method: "POST", endpoint: "repos/owner/repo/actions/workflows/ci.yml/dispatches", expectJson: false })).resolves.toEqual({ ok: true, state: "AVAILABLE", data: null });
    await expect(executeGhMutation(runner, { cwd: ".", method: "POST", endpoint: "repos/owner/repo/actions/workflows/ci.yml/dispatches" })).resolves.toMatchObject({ ok: false, state: "UNKNOWN" });
  });

  it("uses an exact argument vector for asset upload and never clobbers an existing asset", () => {
    const args = releaseUploadArgs("v1.2.3", "owner/repo", ["C:/project/release/setup.exe", "C:/project/release/bundle.zip"]);
    expect(args).toEqual(["release", "upload", "v1.2.3", "--repo", "owner/repo", "C:/project/release/setup.exe", "C:/project/release/bundle.zip"]);
    expect(args).not.toContain("--clobber");
  });

  it("runs non-API commands through the same pinned transport runner and classifies failures", async () => {
    const runner = vi.fn<GhMutationRunner>(async () => ({ ok: false, code: 1, output: "HTTP 403: Resource not accessible" }));
    await expect(executeGhCommand(runner, { cwd: "C:/project", args: ["release", "upload", "v1", "--repo", "owner/repo", "asset.exe"] })).resolves.toMatchObject({ ok: false, state: "BLOCKED" });
    expect(runner).toHaveBeenCalledWith("gh", ["release", "upload", "v1", "--repo", "owner/repo", "asset.exe"], "C:/project", 20_000);
    expect(githubMutationStatus("REJECTED")).toBe(422);
    expect(githubMutationStatus("RATE_LIMITED")).toBe(429);
    expect(githubMutationStatus("UNKNOWN")).toBe(502);
  });
});

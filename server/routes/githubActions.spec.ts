import type { AddressInfo } from "net";
import { execFile } from "child_process";
import { once } from "events";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { afterEach, describe, expect, it, vi } from "vitest";
import githubActionsRouter from "./githubActions";
import { setLocalPlatformMode } from "../services/localPlatform";
import { setProjectTrust } from "../services/projectTrust";
import { makeProjectSummary } from "./workspace";
import express from "express";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function git(cwd: string, args: string[]) {
  return execFileAsync("git", args, { cwd, windowsHide: true });
}

async function makeProject(root: string) {
  const projectPath = path.join(root, "app");
  await fs.mkdir(projectPath, { recursive: true });
  await fs.writeFile(path.join(projectPath, "package.json"), JSON.stringify({ name: "github-action-fixture", private: true, version: "1.0.0" }), "utf8");
  await git(projectPath, ["init", "-q"]);
  await git(projectPath, ["add", "."]);
  await git(projectPath, ["-c", "user.email=kforge@example.invalid", "-c", "user.name=KForge Test", "commit", "-qm", "github fixture"]);
  return projectPath;
}

async function startServer(root: string) {
  vi.stubEnv("KFORGE_WORKSPACE_ROOT", root);
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/workspace", githubActionsRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${address.port}/api/workspace`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function json(base: string, route: string, body: Record<string, unknown>) {
  const response = await fetch(`${base}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { response, body: await response.json() as Record<string, unknown> };
}

describe("authorized GitHub mutation route guards", () => {
  it("requires trust, remote-write policy, confirmation, repository identity, and the reviewed HEAD before transport", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-github-guards-"));
    roots.push(root);
    const projectPath = await makeProject(root);
    const server = await startServer(root);
    try {
      const id = (await makeProjectSummary(projectPath)).id;
      const sourceSha = (await git(projectPath, ["rev-parse", "HEAD"])).stdout.trim();
      const endpoint = `/projects/${encodeURIComponent(id)}/github/pull-requests`;
      const payload = { title: "Guard fixture PR", head: "feature/guard", base: "main", body: "fixture" };

      const untrusted = await json(server.base, endpoint, { ...payload, confirmed: true, expectedHead: sourceSha });
      expect(untrusted.response.status).toBe(428);
      expect(untrusted.body.code).toBe("PROJECT_TRUST_REQUIRED");

      await setProjectTrust(root, projectPath, "trusted");
      const offline = await json(server.base, endpoint, { ...payload, confirmed: true, expectedHead: sourceSha });
      expect(offline.response.status).toBe(428);
      expect(offline.body.code).toBe("REMOTE_WRITE_DISABLED");

      await setLocalPlatformMode(root, "online");
      const unconfirmed = await json(server.base, endpoint, { ...payload, expectedHead: sourceSha });
      expect(unconfirmed.response.status).toBe(428);
      expect(unconfirmed.body.code).toBe("GITHUB_MUTATION_CONFIRMATION_REQUIRED");

      const noRemote = await json(server.base, endpoint, { ...payload, confirmed: true, expectedHead: sourceSha });
      expect(noRemote.response.status).toBe(422);
      expect(noRemote.body.code).toBe("GITHUB_REMOTE_REQUIRED");

      await git(projectPath, ["remote", "add", "origin", "https://github.com/acme/kforge-action-fixture.git"]);

      const noHead = await json(server.base, endpoint, { ...payload, confirmed: true });
      expect(noHead.response.status).toBe(428);
      expect(noHead.body.code).toBe("GITHUB_PLAN_HEAD_REQUIRED");

      const invalidHead = await json(server.base, endpoint, { ...payload, confirmed: true, expectedHead: "not-a-sha" });
      expect(invalidHead.response.status).toBe(428);
      expect(invalidHead.body.code).toBe("GITHUB_PLAN_HEAD_INVALID");

      const stale = await json(server.base, endpoint, { ...payload, confirmed: true, expectedHead: "a".repeat(40) });
      expect(stale.response.status).toBe(409);
      expect(stale.body.code).toBe("STALE_GITHUB_PLAN");

      const invalidInput = await json(server.base, endpoint, { ...payload, head: "main", confirmed: true, expectedHead: sourceSha });
      expect(invalidInput.response.status).toBe(400);
      expect(invalidInput.body.code).toBe("INVALID_PULL_REQUEST");

      const invalidWorkflow = await json(server.base, `/projects/${encodeURIComponent(id)}/github/actions/${encodeURIComponent("../bad")}/dispatches`, { confirmed: true, expectedHead: sourceSha, ref: "main" });
      expect(invalidWorkflow.response.status).toBe(400);
      expect(invalidWorkflow.body.code).toBe("INVALID_WORKFLOW_ID");

      const invalidRun = await json(server.base, `/projects/${encodeURIComponent(id)}/github/actions/runs/${encodeURIComponent("abc")}/rerun`, { confirmed: true, expectedHead: sourceSha });
      expect(invalidRun.response.status).toBe(400);
      expect(invalidRun.body.code).toBe("INVALID_RUN_ID");
    } finally {
      await server.close();
    }
  }, 60_000);
});

import type { AddressInfo } from "net";
import { execFile } from "child_process";
import { once } from "events";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import { createServer } from "../index";
import { setLocalPlatformMode } from "../services/localPlatform";
import { setProjectTrust } from "../services/projectTrust";
import { makeProjectSummary } from "./workspace";
import {
  persistReleasePublication,
  persistReleaseRecord,
  type ReleaseExecutionRecord,
  type ReleasePublicationRecord,
} from "../services/releaseExecution";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function git(cwd: string, args: string[]) {
  return execFileAsync("git", args, { cwd, windowsHide: true });
}

const BUILD_SCRIPT = `import { mkdir, writeFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await mkdir("release", { recursive: true });
await writeFile("dist/app.js", "console.log('built');\\n");
await writeFile("release/setup.exe", "installer-v1");
`;

async function makeProject(root: string, options: { buildScript?: string; remote?: string } = {}) {
  const projectPath = path.join(root, "app");
  await fs.mkdir(projectPath, { recursive: true });
  await fs.writeFile(path.join(projectPath, "package.json"), JSON.stringify({
    name: "kforge-release-fixture",
    private: true,
    version: "1.0.0",
    scripts: { build: "node build.mjs" },
  }, null, 2), "utf8");
  await fs.writeFile(path.join(projectPath, "build.mjs"), options.buildScript ?? BUILD_SCRIPT, "utf8");
  await git(projectPath, ["init", "-q"]);
  if (options.remote) await git(projectPath, ["remote", "add", "origin", options.remote]);
  await git(projectPath, ["add", "."]);
  await git(projectPath, ["-c", "user.email=kforge@example.invalid", "-c", "user.name=KForge Test", "commit", "-qm", "release fixture"]);
  return projectPath;
}

async function startServer(root: string) {
  vi.stubEnv("KFORGE_WORKSPACE_ROOT", root);
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${address.port}/api/workspace`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function projectId(root: string) {
  const project = await makeProjectSummary(path.join(root, "app"));
  return project.id;
}

async function json(base: string, route: string, init?: RequestInit) {
  const response = await fetch(`${base}${route}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  return { response, body: await response.json() as Record<string, unknown> };
}

async function head(projectPath: string) {
  return (await git(projectPath, ["rev-parse", "HEAD"])).stdout.trim();
}

describe("authorized release execution route", () => {
  it("refuses missing trust, confirmation, reviewed HEAD, and invalid version changes before any build", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-release-route-"));
    roots.push(root);
    const projectPath = await makeProject(root);
    const server = await startServer(root);
    try {
      const id = await projectId(root);
      const sourceSha = await head(projectPath);
      const endpoint = `/projects/${encodeURIComponent(id)}/release/execute`;

      const untrusted = await json(server.base, endpoint, { method: "POST", body: JSON.stringify({ confirmed: true, expectedHead: sourceSha }) });
      expect(untrusted.response.status).toBe(428);
      expect(untrusted.body.error).toContain("UNTRUSTED PROJECT");

      await setProjectTrust(root, projectPath, "trusted");
      const unconfirmed = await json(server.base, endpoint, { method: "POST", body: JSON.stringify({ expectedHead: sourceSha }) });
      expect(unconfirmed.response.status).toBe(428);
      expect(unconfirmed.body.code).toBe("RELEASE_CONFIRMATION_REQUIRED");

      const noHead = await json(server.base, endpoint, { method: "POST", body: JSON.stringify({ confirmed: true }) });
      expect(noHead.response.status).toBe(428);
      expect(noHead.body.code).toBe("RELEASE_PLAN_HEAD_REQUIRED");

      const stale = await json(server.base, endpoint, { method: "POST", body: JSON.stringify({ confirmed: true, expectedHead: "a".repeat(40) }) });
      expect(stale.response.status).toBe(409);
      expect(stale.body.code).toBe("STALE_RELEASE_PLAN");

      const badVersion = await json(server.base, endpoint, { method: "POST", body: JSON.stringify({ confirmed: true, expectedHead: sourceSha, version: "v2.0.0" }) });
      expect(badVersion.response.status).toBe(400);

      const unconfirmedVersion = await json(server.base, endpoint, { method: "POST", body: JSON.stringify({ confirmed: true, expectedHead: sourceSha, version: "2.0.0" }) });
      expect(unconfirmedVersion.response.status).toBe(409);
      expect(unconfirmedVersion.body.code).toBe("VERSION_UPDATE_NOT_CONFIRMED");

      const noPackageScript = await json(server.base, endpoint, { method: "POST", body: JSON.stringify({ confirmed: true, expectedHead: sourceSha, mode: "package" }) });
      expect(noPackageScript.response.status).toBe(422);
      expect(noPackageScript.body.code).toBe("PACKAGE_SCRIPT_UNAVAILABLE");

      const records = await json(server.base, `/projects/${encodeURIComponent(id)}/release/records`);
      expect(records.body.records).toEqual([]);
    } finally {
      await server.close();
    }
  }, 120_000);

  it("runs a real build, hashes its output, persists provenance, and never applies a stale signature record", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-release-route-"));
    roots.push(root);
    const projectPath = await makeProject(root);
    await fs.mkdir(path.join(projectPath, "release", "verification"), { recursive: true });
    await fs.writeFile(path.join(projectPath, "release", "verification", "package-windows.json"), JSON.stringify({
      artifactFilename: "setup.exe",
      sha256: "f".repeat(64),
      signatureState: "VALID",
      gitSha: "0".repeat(40),
    }), "utf8");
    const server = await startServer(root);
    try {
      await setProjectTrust(root, projectPath, "trusted");
      const id = await projectId(root);
      const sourceSha = await head(projectPath);
      const executed = await json(server.base, `/projects/${encodeURIComponent(id)}/release/execute`, {
        method: "POST",
        body: JSON.stringify({ confirmed: true, expectedHead: sourceSha, mode: "build" }),
      });
      expect(executed.response.status).toBe(201);
      const record = executed.body.record as ReleaseExecutionRecord;
      expect(record).toMatchObject({ sourceSha, artifactState: "VERIFIED", version: "1.0.0", artifactScan: { truncated: false } });
      expect(record.artifacts.map((artifact) => artifact.path)).toEqual(["dist/app.js", "release/setup.exe"]);
      expect(record.signing).toMatchObject({ state: "UNVERIFIED", match: "STALE_RECORD" });

      const installer = record.artifacts.find((artifact) => artifact.path === "release/setup.exe");
      expect(installer?.sha256).toBe(createHash("sha256").update("installer-v1").digest("hex"));

      // Independent read-back: list records from the API and hash the file again
      // outside the release execution service.
      const listed = await json(server.base, `/projects/${encodeURIComponent(id)}/release/records`);
      const records = listed.body.records as ReleaseExecutionRecord[];
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ id: record.id, artifactDigest: record.artifactDigest });
      const bytes = await fs.readFile(path.join(projectPath, "release", "setup.exe"));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(installer?.sha256);
    } finally {
      await server.close();
    }
  }, 120_000);

  it("rolls back a failed version change and refuses to attach older artifact files", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-release-route-"));
    roots.push(root);
    const projectPath = await makeProject(root, {
      buildScript: `import { mkdir, writeFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await writeFile("dist/old.js", "previous build");
process.exit(1);
`,
    });
    await fs.mkdir(path.join(projectPath, "dist"), { recursive: true });
    await fs.writeFile(path.join(projectPath, "dist", "old.js"), "stale bytes", "utf8");
    const server = await startServer(root);
    try {
      await setProjectTrust(root, projectPath, "trusted");
      const id = await projectId(root);
      const sourceSha = await head(projectPath);
      const executed = await json(server.base, `/projects/${encodeURIComponent(id)}/release/execute`, {
        method: "POST",
        body: JSON.stringify({ confirmed: true, expectedHead: sourceSha, version: "2.0.0", updateManifest: true, rollbackOnFailure: true }),
      });
      expect(executed.response.status).toBe(422);
      const record = executed.body.record as ReleaseExecutionRecord;
      expect(record).toMatchObject({ artifactState: "BUILD_FAILED", artifacts: [], artifactDigest: null });
      expect(record.recovery).toMatchObject({ rolledBack: true });
      const manifest = JSON.parse(await fs.readFile(path.join(projectPath, "package.json"), "utf8")) as { version: string };
      expect(manifest.version).toBe("1.0.0");

      const listed = await json(server.base, `/projects/${encodeURIComponent(id)}/release/records`);
      expect((listed.body.records as ReleaseExecutionRecord[])[0]).toMatchObject({ id: record.id, artifactState: "BUILD_FAILED", artifacts: [] });
    } finally {
      await server.close();
    }
  }, 120_000);
});

describe("authorized release publication route", () => {
  it("refuses publication without confirmation, online policy, a GitHub remote, a matching record, signing acknowledgement, or unchanged bytes", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-release-publish-"));
    roots.push(root);
    const projectPath = await makeProject(root);
    const server = await startServer(root);
    try {
      await setProjectTrust(root, projectPath, "trusted");
      await setLocalPlatformMode(root, "online");
      const id = await projectId(root);
      const sourceSha = await head(projectPath);
      const execute = await json(server.base, `/projects/${encodeURIComponent(id)}/release/execute`, {
        method: "POST",
        body: JSON.stringify({ confirmed: true, expectedHead: sourceSha, mode: "build" }),
      });
      expect(execute.response.status).toBe(201);
      const record = execute.body.record as ReleaseExecutionRecord;
      const endpoint = `/projects/${encodeURIComponent(id)}/release/publish`;

      const unconfirmed = await json(server.base, endpoint, { method: "POST", body: JSON.stringify({ expectedHead: sourceSha, releaseRecordId: record.id }) });
      expect(unconfirmed.response.status).toBe(428);

      const noRemote = await json(server.base, endpoint, { method: "POST", body: JSON.stringify({ confirmed: true, expectedHead: sourceSha, releaseRecordId: record.id }) });
      expect(noRemote.response.status).toBe(422);
      expect(noRemote.body.code).toBe("GITHUB_REMOTE_REQUIRED");

      await git(projectPath, ["remote", "add", "origin", "https://github.com/acme/kforge-release-fixture.git"]);

      const noHead = await json(server.base, endpoint, { method: "POST", body: JSON.stringify({ confirmed: true, releaseRecordId: record.id }) });
      expect(noHead.response.status).toBe(428);
      expect(noHead.body.code).toBe("RELEASE_PUBLICATION_HEAD_REQUIRED");

      const missingRecord = await json(server.base, endpoint, { method: "POST", body: JSON.stringify({ confirmed: true, expectedHead: sourceSha }) });
      expect(missingRecord.response.status).toBe(400);
      expect(missingRecord.body.code).toBe("RELEASE_RECORD_REQUIRED");

      const unknownRecord = await json(server.base, endpoint, { method: "POST", body: JSON.stringify({ confirmed: true, expectedHead: sourceSha, releaseRecordId: "missing-record" }) });
      expect(unknownRecord.response.status).toBe(404);

      const staleHead = await json(server.base, endpoint, { method: "POST", body: JSON.stringify({ confirmed: true, expectedHead: "a".repeat(40), releaseRecordId: record.id }) });
      expect(staleHead.response.status).toBe(409);
      expect(staleHead.body.code).toBe("STALE_RELEASE_PLAN");

      const tagMismatch = await json(server.base, endpoint, { method: "POST", body: JSON.stringify({ confirmed: true, expectedHead: sourceSha, releaseRecordId: record.id, tagName: "v9.9.9" }) });
      expect(tagMismatch.response.status).toBe(409);
      expect(tagMismatch.body.code).toBe("TAG_VERSION_MISMATCH");

      const signing = await json(server.base, endpoint, { method: "POST", body: JSON.stringify({ confirmed: true, expectedHead: sourceSha, releaseRecordId: record.id, tagName: "v1.0.0" }) });
      expect(signing.response.status).toBe(409);
      expect(signing.body.code).toBe("SIGNING_ACKNOWLEDGEMENT_REQUIRED");

      await fs.writeFile(path.join(projectPath, "release", "setup.exe"), "tampered-after-verification", "utf8");
      const changed = await json(server.base, endpoint, { method: "POST", body: JSON.stringify({ confirmed: true, expectedHead: sourceSha, releaseRecordId: record.id, tagName: "v1.0.0", acknowledgeUnsigned: true }) });
      expect(changed.response.status).toBe(409);
      expect(changed.body.code).toBe("RELEASE_ARTIFACT_CHANGED");

      await setLocalPlatformMode(root, "offline");
      const offline = await json(server.base, endpoint, { method: "POST", body: JSON.stringify({ confirmed: true, expectedHead: sourceSha, releaseRecordId: record.id, tagName: "v1.0.0", acknowledgeUnsigned: true }) });
      expect(offline.response.status).toBe(428);
      expect(offline.body.code).toBe("REMOTE_WRITE_DISABLED");
    } finally {
      await server.close();
    }
  }, 120_000);

  it("refuses to publish an incomplete truncated artifact inventory", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-release-publish-"));
    roots.push(root);
    const projectPath = await makeProject(root, { remote: "https://github.com/acme/kforge-release-fixture.git" });
    await fs.mkdir(path.join(projectPath, "release"), { recursive: true });
    await fs.writeFile(path.join(projectPath, "release", "setup.exe"), "installer-v1", "utf8");
    const server = await startServer(root);
    try {
      await setProjectTrust(root, projectPath, "trusted");
      await setLocalPlatformMode(root, "online");
      const id = await projectId(root);
      const sha256 = createHash("sha256").update("installer-v1").digest("hex");
      const record: ReleaseExecutionRecord = {
        schemaVersion: 1,
        id: "truncated-record",
        projectId: id,
        projectPath,
        sourceSha: await head(projectPath),
        branch: "main",
        version: "1.0.0",
        versionChange: null,
        build: { mode: "build", command: "npm run build", ok: true, exitCode: 0, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), outputTail: "ok" },
        artifactState: "VERIFIED",
        artifactScan: { roots: ["release"], limit: 1, truncated: true },
        artifacts: [{ path: "release/setup.exe", kind: "INSTALLER", size: Buffer.byteLength("installer-v1"), sha256, modifiedAt: new Date().toISOString() }],
        artifactDigest: sha256,
        signing: { state: "UNVERIFIED", match: "NO_RECORD", source: "test", detail: "test" },
        publication: { state: "NOT_PUBLISHED", detail: "test" },
        createdAt: new Date().toISOString(),
      };
      await persistReleaseRecord(root, record);
      const response = await json(server.base, `/projects/${encodeURIComponent(id)}/release/publish`, {
        method: "POST",
        body: JSON.stringify({ confirmed: true, expectedHead: record.sourceSha, releaseRecordId: record.id, acknowledgeUnsigned: true }),
      });
      expect(response.response.status).toBe(409);
      expect(response.body.code).toBe("RELEASE_INVENTORY_TRUNCATED");
    } finally {
      await server.close();
    }
  }, 60_000);

  it("reads persisted publication records back for the owning project only", async () => {    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-release-publish-"));
    roots.push(root);
    const projectPath = await makeProject(root);
    const server = await startServer(root);
    try {
      const id = await projectId(root);
      const publication: ReleasePublicationRecord = {
        schemaVersion: 1,
        id: "publication-1",
        projectId: id,
        releaseRecordId: "record-1",
        sourceSha: await head(projectPath),
        tagName: "v1.0.0",
        releaseId: 7,
        releaseUrl: "https://github.com/acme/kforge-release-fixture/releases/tag/v1.0.0",
        outcome: "DRAFT",
        assets: [{ path: "release/setup.exe", name: "setup.exe", size: 2, sha256: "a".repeat(64), state: "VERIFIED" }],
        verification: "VERIFIED",
        detail: "Draft read back.",
        createdAt: new Date().toISOString(),
      };
      await persistReleasePublication(root, publication);
      const response = await json(server.base, `/projects/${encodeURIComponent(id)}/release/publications`);
      expect(response.response.status).toBe(200);
      expect(response.body.publications).toHaveLength(1);
      expect(response.body.publications[0]).toMatchObject({ id: "publication-1", tagName: "v1.0.0", verification: "VERIFIED" });
    } finally {
      await server.close();
    }
  }, 60_000);
});

describe("release record source binding", () => {
  it("rejects a persisted record from a different source SHA before any remote contact", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "kforge-release-publish-"));
    roots.push(root);
    const projectPath = await makeProject(root, { remote: "https://github.com/acme/kforge-release-fixture.git" });
    await fs.mkdir(path.join(projectPath, "release"), { recursive: true });
    await fs.writeFile(path.join(projectPath, "release", "setup.exe"), "installer-v1", "utf8");
    const server = await startServer(root);
    try {
      await setProjectTrust(root, projectPath, "trusted");
      await setLocalPlatformMode(root, "online");
      const id = await projectId(root);
      const sha256 = createHash("sha256").update("installer-v1").digest("hex");
      const record: ReleaseExecutionRecord = {
        schemaVersion: 1,
        id: "foreign-record",
        projectId: id,
        projectPath,
        sourceSha: "a".repeat(40),
        branch: "main",
        version: "1.0.0",
        versionChange: null,
        build: { mode: "build", command: "npm run build", ok: true, exitCode: 0, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), outputTail: "ok" },
        artifactState: "VERIFIED",
        artifactScan: { roots: ["release"], limit: 200, truncated: false },
        artifacts: [{ path: "release/setup.exe", kind: "INSTALLER", size: Buffer.byteLength("installer-v1"), sha256, modifiedAt: new Date().toISOString() }],
        artifactDigest: sha256,
        signing: { state: "UNVERIFIED", match: "NO_RECORD", source: "test", detail: "test" },
        publication: { state: "NOT_PUBLISHED", detail: "test" },
        createdAt: new Date().toISOString(),
      };
      await persistReleaseRecord(root, record);
      const response = await json(server.base, `/projects/${encodeURIComponent(id)}/release/publish`, {
        method: "POST",
        body: JSON.stringify({ confirmed: true, expectedHead: await head(projectPath), releaseRecordId: record.id }),
      });
      expect(response.response.status).toBe(409);
      expect(response.body.code).toBe("RELEASE_RECORD_STALE");
    } finally {
      await server.close();
    }
  }, 60_000);
});

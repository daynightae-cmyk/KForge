import { createHash } from "crypto";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyReleaseArtifact,
  collectArtifactEvidence,
  collectArtifactInventory,
  composeArtifactDigest,
  getReleaseRecord,
  isReleaseVersion,
  listReleasePublications,
  listReleaseRecords,
  persistReleasePublication,
  persistReleaseRecord,
  readBackPublishedAsset,
  resolveReleaseSigning,
  sourceHeadMismatch,
  verifyArtifactBytes,
  type ReleaseExecutionRecord,
  type ReleasePublicationRecord,
} from "./releaseExecution";

const temporaryRoots: string[] = [];

async function temporaryProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "kforge-release-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("release artifact evidence", () => {
  it("hashes real output bytes, skips verification metadata and dependency trees", async () => {
    const root = await temporaryProject();
    await mkdir(path.join(root, "release", "verification"), { recursive: true });
    await mkdir(path.join(root, "dist", "assets"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(path.join(root, "release", "KNOuX-Forge-Setup.exe"), "installer-bytes", "utf8");
    await writeFile(path.join(root, "dist", "assets", "app.js"), "console.log('ok');", "utf8");
    await writeFile(path.join(root, "release", "verification", "package-windows.json"), JSON.stringify({ signatureState: "UNSIGNED" }), "utf8");
    await writeFile(path.join(root, "node_modules", "pkg", "index.js"), "ignored", "utf8");
    await writeFile(path.join(root, "dist", "assets", "notes.txt"), "not an artifact", "utf8");

    const artifacts = await collectArtifactEvidence(root);
    expect(artifacts.map((artifact) => artifact.path)).toEqual(["dist/assets/app.js", "release/KNOuX-Forge-Setup.exe"]);
    expect(artifacts[0]).toMatchObject({ kind: "BUNDLE_FILE", size: Buffer.byteLength("console.log('ok');") });
    expect(artifacts[1]).toMatchObject({ kind: "INSTALLER", size: Buffer.byteLength("installer-bytes") });
    expect(artifacts.every((artifact) => !path.isAbsolute(artifact.path))).toBe(true);
    expect(artifacts[1].sha256).toBe(createHash("sha256").update("installer-bytes").digest("hex"));
  });

  it("produces a stable aggregate digest and changes when artifact bytes change", async () => {
    const first = { path: "release/a.exe", kind: "INSTALLER" as const, size: 1, sha256: "a".repeat(64), modifiedAt: "2026-01-01T00:00:00.000Z" };
    const second = { path: "dist/b.js", kind: "BUNDLE_FILE" as const, size: 2, sha256: "b".repeat(64), modifiedAt: "2026-01-01T00:00:00.000Z" };
    const digest = composeArtifactDigest([second, first]);
    expect(digest).toBe(composeArtifactDigest([first, second]));
    expect(digest).not.toBe(composeArtifactDigest([{ ...first, sha256: "c".repeat(64) }, second]));
    expect(composeArtifactDigest([])).toBeNull();
  });

  it("classifies installer, package, and bundle evidence without inventing identity", () => {
    expect(classifyReleaseArtifact("release/setup.exe")).toBe("INSTALLER");
    expect(classifyReleaseArtifact("release/setup.msi")).toBe("INSTALLER");
    expect(classifyReleaseArtifact("release/bundle.zip")).toBe("PACKAGE");
    expect(classifyReleaseArtifact("release/bundle.tar.gz")).toBe("PACKAGE");
    expect(classifyReleaseArtifact("dist/app.js")).toBe("BUNDLE_FILE");
    expect(classifyReleaseArtifact("release/notes.txt")).toBe("OTHER");
  });
});

describe("release record persistence", () => {
  it("persists provenance atomically and returns only the requested project's records", async () => {
    const workspace = await temporaryProject();
    const record: ReleaseExecutionRecord = {
      schemaVersion: 1,
      id: "record-1",
      projectId: "project-a",
      projectPath: "C:/projects/a",
      sourceSha: "a".repeat(40),
      branch: "main",
      version: "1.2.3",
      versionChange: null,
      build: { mode: "build", command: "npm run build", ok: true, exitCode: 0, startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:01:00.000Z", outputTail: "ok" },
      artifactState: "VERIFIED",
      artifactScan: { roots: ["dist"], limit: 250, truncated: false },
      artifacts: [{ path: "dist/app.js", kind: "BUNDLE_FILE", size: 2, sha256: "b".repeat(64), modifiedAt: "2026-01-01T00:01:00.000Z" }],
      artifactDigest: "c".repeat(64),
      signing: { state: "UNVERIFIED", match: "NO_RECORD", source: "none", detail: "not inspected" },
      publication: { state: "NOT_PUBLISHED", detail: "local only" },
      createdAt: "2026-01-01T00:01:00.000Z",
    };
    await persistReleaseRecord(workspace, record);
    await persistReleaseRecord(workspace, { ...record, id: "record-other", projectId: "project-b" });
    const records = await listReleaseRecords(workspace, "project-a");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: "record-1", artifactState: "VERIFIED", artifactDigest: "c".repeat(64) });
    expect(await getReleaseRecord(workspace, "project-a", "record-1")).toMatchObject({ id: "record-1" });
    expect(await getReleaseRecord(workspace, "project-b", "record-1")).toBeNull();
    expect(await getReleaseRecord(workspace, "project-a", "../record-1")).toBeNull();
  });

  it("persists publication read-back records per project without mixing them", async () => {
    const workspace = await temporaryProject();
    const publication: ReleasePublicationRecord = {
      schemaVersion: 1,
      id: "publication-1",
      projectId: "project-a",
      releaseRecordId: "record-1",
      sourceSha: "a".repeat(40),
      tagName: "v1.2.3",
      releaseId: 55,
      releaseUrl: "https://github.com/acme/example/releases/tag/v1.2.3",
      outcome: "DRAFT",
      assets: [{ path: "release/setup.exe", name: "setup.exe", size: 4, sha256: "d".repeat(64), state: "VERIFIED", assetId: 9 }],
      verification: "VERIFIED",
      detail: "Draft release read back with one verified asset.",
      createdAt: "2026-01-02T00:00:00.000Z",
    };
    await persistReleasePublication(workspace, publication);
    await persistReleasePublication(workspace, { ...publication, id: "publication-other", projectId: "project-b" });
    const listed = await listReleasePublications(workspace, "project-a");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: "publication-1", outcome: "DRAFT", verification: "VERIFIED" });
  });
});

describe("signature evidence attribution", () => {
  const artifacts = [{ path: "release/setup.exe", kind: "INSTALLER" as const, size: 4, sha256: "a".repeat(64), modifiedAt: "2026-01-01T00:00:00.000Z" }];

  it("does not project a stale signature record onto new artifact bytes", () => {
    const signing = resolveReleaseSigning(artifacts, { sha256: "b".repeat(64), artifactFilename: "setup.exe", signatureState: "VALID" });
    expect(signing).toMatchObject({ state: "UNVERIFIED", match: "STALE_RECORD", recordedSha256: "b".repeat(64) });
    expect(signing.detail).toContain("not one of the artifact bytes");
  });

  it("rejects a malformed record and treats absence as unverified, not unsigned", () => {
    expect(resolveReleaseSigning(artifacts, { signatureState: "UNSIGNED" })).toMatchObject({ state: "UNVERIFIED", match: "MALFORMED_RECORD" });
    expect(resolveReleaseSigning(artifacts, null)).toMatchObject({ state: "UNVERIFIED", match: "NO_RECORD" });
  });

  it("applies a matching record with its exact filename and observed state", () => {
    const signing = resolveReleaseSigning(artifacts, {
      sha256: "a".repeat(64),
      artifactFilename: "setup.exe",
      observedSignature: { status: "VALID", subject: "CN=KNOuX", timestamped: true },
    });
    expect(signing).toMatchObject({ state: "VALID", match: "MATCHED", artifactPath: "release/setup.exe" });
    expect(signing.detail).toContain("CN=KNOuX");
  });

  it("rejects a record whose digest belongs to a different filename", () => {
    const signing = resolveReleaseSigning(artifacts, { sha256: "a".repeat(64), artifactFilename: "other.exe", signatureState: "VALID" });
    expect(signing).toMatchObject({ state: "UNVERIFIED", match: "STALE_RECORD" });
  });
});

describe("artifact byte re-verification", () => {
  it("accepts unchanged bytes and reports a changed, missing, or escaping artifact", async () => {
    const root = await temporaryProject();
    await mkdir(path.join(root, "release"), { recursive: true });
    await writeFile(path.join(root, "release", "setup.exe"), "installer-bytes", "utf8");
    const artifacts = await collectArtifactEvidence(root);
    expect(artifacts).toHaveLength(1);
    expect(await verifyArtifactBytes(root, artifacts[0])).toEqual({ ok: true });

    await writeFile(path.join(root, "release", "setup.exe"), "changed-content", "utf8");
    const changed = await verifyArtifactBytes(root, artifacts[0]);
    expect(changed.ok).toBe(false);
    if ("reason" in changed) expect(changed.reason).toContain("SHA-256 changed");

    await rm(path.join(root, "release", "setup.exe"));
    const missing = await verifyArtifactBytes(root, artifacts[0]);
    expect(missing.ok).toBe(false);

    const escaping = await verifyArtifactBytes(root, { ...artifacts[0], path: "../outside.exe" });
    expect(escaping.ok).toBe(false);
  });
});

describe("publication read-back verification", () => {
  const artifact = { path: "release/setup.exe", kind: "INSTALLER" as const, size: 4, sha256: "a".repeat(64), modifiedAt: "2026-01-01T00:00:00.000Z" };

  it("claims VERIFIED only when GitHub reports the matching size and SHA-256 digest", () => {
    expect(readBackPublishedAsset(artifact, { name: "setup.exe", size: 4, digest: `sha256:${"a".repeat(64)}`, id: 9, browser_download_url: "https://github.com/acme/example/releases/download/v1/setup.exe" })).toMatchObject({ state: "VERIFIED", assetId: 9 });
    expect(readBackPublishedAsset(artifact, { name: "setup.exe", size: 4 })).toMatchObject({ state: "UPLOADED_UNVERIFIED" });
    expect(readBackPublishedAsset(artifact, { name: "setup.exe", size: 4, digest: `sha256:${"b".repeat(64)}` })).toMatchObject({ state: "UPLOADED_UNVERIFIED", remoteDigest: `sha256:${"b".repeat(64)}` });
    expect(readBackPublishedAsset(artifact, undefined)).toMatchObject({ state: "MISSING" });
  });
});

describe("artifact inventory bounds", () => {  it("declares truncation instead of presenting a partial inventory as complete", async () => {
    const root = await temporaryProject();
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, "dist", "a.js"), "a", "utf8");
    await writeFile(path.join(root, "dist", "b.js"), "b", "utf8");
    const inventory = await collectArtifactInventory(root, ["dist"], { limit: 1 });
    expect(inventory.truncated).toBe(true);
    expect(inventory.artifacts).toHaveLength(1);
    expect(inventory.limit).toBe(1);
  });
});

describe("stale release plan protection and version policy", () => {
  it("accepts an exact or unambiguous short source SHA and rejects a changed HEAD", () => {
    const actual = "7ebae9fbb56eea78d247506e19d564387283e86c";
    expect(sourceHeadMismatch(actual, actual)).toBeNull();
    expect(sourceHeadMismatch(actual.slice(0, 12), actual)).toBeNull();
    expect(sourceHeadMismatch(undefined, actual)).toBeNull();
    expect(sourceHeadMismatch("a".repeat(40), actual)).toEqual({ expectedHead: "a".repeat(40), actualHead: actual });
  });

  it("requires an explicit semantic version and never infers one from a commit", () => {
    expect(isReleaseVersion("1.2.3")).toBe(true);
    expect(isReleaseVersion("1.2.3-rc.1")).toBe(true);
    expect(isReleaseVersion("v1.2.3")).toBe(false);
    expect(isReleaseVersion("1.2")).toBe(false);
    expect(isReleaseVersion("")).toBe(false);
  });
});

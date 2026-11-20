import { createHash } from "crypto";
import { createReadStream, promises as fs } from "fs";
import path from "path";

export type ReleaseArtifactKind = "INSTALLER" | "PACKAGE" | "BUNDLE_FILE" | "OTHER";

export interface ReleaseArtifactEvidence {
  /** Project-relative POSIX path. Never an absolute host path. */
  path: string;
  kind: ReleaseArtifactKind;
  size: number;
  sha256: string;
  modifiedAt: string;
}

export interface ReleaseVersionChange {
  manifestPath: string;
  from: string | null;
  to: string;
  snapshotId: string;
}

export interface ReleaseBuildEvidence {
  mode: "build" | "package";
  command: string;
  ok: boolean;
  exitCode?: number;
  startedAt: string;
  completedAt: string;
  outputTail: string;
}

export interface ReleaseSigningEvidence {
  state: "UNSIGNED" | "VALID" | "INVALID" | "UNKNOWN" | "UNVERIFIED";
  /** Whether the recorded signature evidence belongs to the artifact bytes in this run. */
  match: "MATCHED" | "NO_RECORD" | "STALE_RECORD" | "MALFORMED_RECORD";
  source: string;
  detail: string;
  recordedSha256?: string;
  artifactPath?: string;
}

export interface ReleasePublicationEvidence {
  state: "NOT_PUBLISHED";
  detail: string;
}

export interface ReleaseArtifactScanEvidence {
  roots: string[];
  limit: number;
  truncated: boolean;
}

export interface ReleaseArtifactInventory {
  artifacts: ReleaseArtifactEvidence[];
  roots: string[];
  limit: number;
  truncated: boolean;
}

export interface ReleaseRecoveryEvidence {
  rolledBack: boolean;
  snapshotId?: string;
  reason: string;
}

export interface ReleaseExecutionRecord {
  schemaVersion: 1;
  id: string;
  projectId: string;
  projectPath: string;
  sourceSha: string;
  branch: string;
  version: string | null;
  versionChange: ReleaseVersionChange | null;
  build: ReleaseBuildEvidence;
  artifactState: "VERIFIED" | "BUILD_FAILED" | "NOT_FOUND";
  artifactScan: ReleaseArtifactScanEvidence;
  artifacts: ReleaseArtifactEvidence[];
  artifactDigest: string | null;
  signing: ReleaseSigningEvidence;
  publication: ReleasePublicationEvidence;
  recovery?: ReleaseRecoveryEvidence;
  createdAt: string;
}

const ARTIFACT_EXTENSIONS = new Set([
  ".exe",
  ".msi",
  ".msix",
  ".appx",
  ".dmg",
  ".pkg",
  ".appimage",
  ".deb",
  ".rpm",
  ".zip",
  ".tgz",
  ".gz",
  ".7z",
  ".nupkg",
  ".whl",
  ".jar",
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".html",
  ".map",
  ".json",
  ".wasm",
  ".node",
]);

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".kforge",
  "node_modules",
  "coverage",
  ".next",
  ".nuxt",
  ".cache",
  "test-results",
  "playwright-report",
]);

const SKIPPED_RELATIVE_PREFIXES = ["release/verification/", ".kforge/"];

export const RELEASE_ARTIFACT_ROOTS = ["release", "dist", "build", "out", "target", "artifacts"] as const;
export const RELEASE_ARTIFACT_LIMIT = 200;
export const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function isReleaseVersion(value: string): boolean {
  return RELEASE_VERSION_PATTERN.test(value.trim());
}

export function classifyReleaseArtifact(relativePath: string): ReleaseArtifactKind {
  const lower = relativePath.toLowerCase();
  const extension = lower.endsWith(".tar.gz") ? ".gz" : path.extname(lower);
  if ([".exe", ".msi", ".msix", ".appx", ".dmg", ".pkg", ".appimage", ".deb", ".rpm"].includes(extension)) return "INSTALLER";
  if ([".zip", ".tgz", ".gz", ".7z", ".nupkg", ".whl", ".jar"].includes(extension)) return "PACKAGE";
  if ([".js", ".mjs", ".cjs", ".css", ".html", ".map", ".json", ".wasm", ".node"].includes(extension)) return "BUNDLE_FILE";
  return "OTHER";
}

function isSafeRelative(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return Boolean(normalized) && !normalized.startsWith("/") && !normalized.startsWith("../") && !normalized.includes("/../") && !path.isAbsolute(normalized);
}

async function sha256File(absolutePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absolutePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function walkArtifacts(projectRoot: string, directory: string, depth: number, maxDepth: number, output: string[], limit: number): Promise<void> {
  if (output.length >= limit || depth > maxDepth) return;
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (output.length >= limit) return;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      await walkArtifacts(projectRoot, path.join(directory, entry.name), depth + 1, maxDepth, output, limit);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!ARTIFACT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(projectRoot, absolute).replace(/\\/g, "/");
    if (!isSafeRelative(relative)) continue;
    if (SKIPPED_RELATIVE_PREFIXES.some((prefix) => relative.startsWith(prefix))) continue;
    output.push(relative);
  }
}

/**
 * Inventory real artifact files under the canonical release roots. Symlinks are
 * skipped so a project cannot make KForge hash a file outside its own checkout.
 * Results are bounded and every digest is computed from the actual file bytes.
 * The returned metadata records whether the bound was reached so a caller never
 * presents a truncated inventory as complete.
 */
export async function collectArtifactInventory(
  projectPath: string,
  roots: readonly string[] = RELEASE_ARTIFACT_ROOTS,
  options: { limit?: number; maxDepth?: number } = {},
): Promise<ReleaseArtifactInventory> {
  const limit = Math.max(1, Math.min(options.limit ?? RELEASE_ARTIFACT_LIMIT, 1_000));
  const maxDepth = Math.max(1, Math.min(options.maxDepth ?? 6, 20));
  const projectRoot = path.resolve(projectPath);
  const candidates: string[] = [];
  for (const root of roots) {
    const safeRoot = root.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!safeRoot || !isSafeRelative(`${safeRoot}/placeholder`)) continue;
    // One extra candidate is enough to prove that the inventory is truncated.
    await walkArtifacts(projectRoot, path.join(projectRoot, safeRoot), 0, maxDepth, candidates, limit + 1);
    if (candidates.length > limit) break;
  }
  const uniqueAll = [...new Set(candidates)];
  const truncated = uniqueAll.length > limit;
  const unique = uniqueAll.slice(0, limit);
  const evidence: ReleaseArtifactEvidence[] = [];
  for (const relative of unique) {
    const absolute = path.resolve(projectRoot, relative);
    const boundary = path.relative(projectRoot, absolute);
    if (boundary.startsWith("..") || path.isAbsolute(boundary)) continue;
    try {
      const stat = await fs.stat(absolute);
      if (!stat.isFile()) continue;
      evidence.push({
        path: relative,
        kind: classifyReleaseArtifact(relative),
        size: stat.size,
        sha256: await sha256File(absolute),
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch {
      // A file can disappear between discovery and hashing. It is omitted, not invented.
    }
  }
  return {
    artifacts: evidence.sort((left, right) => left.path.localeCompare(right.path)),
    roots: [...roots],
    limit,
    truncated,
  };
}

/** Convenience wrapper for callers that only need the artifact list. */
export async function collectArtifactEvidence(
  projectPath: string,
  roots: readonly string[] = RELEASE_ARTIFACT_ROOTS,
  options: { limit?: number; maxDepth?: number } = {},
): Promise<ReleaseArtifactEvidence[]> {
  return (await collectArtifactInventory(projectPath, roots, options)).artifacts;
}

/** Stable aggregate digest over the sorted per-file digests. */
export function composeArtifactDigest(artifacts: readonly ReleaseArtifactEvidence[]): string | null {
  if (!artifacts.length) return null;
  const canonical = [...artifacts]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((artifact) => `${artifact.path}\n${artifact.sha256}\n${artifact.size}`)
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

function safeStorageSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 160) || "unknown";
}

export function releaseRecordDirectory(workspaceRoot: string, projectId: string): string {
  return path.join(path.resolve(workspaceRoot), ".kforge", "release-records", safeStorageSegment(projectId));
}

export async function persistReleaseRecord(workspaceRoot: string, record: ReleaseExecutionRecord): Promise<string> {
  const directory = releaseRecordDirectory(workspaceRoot, record.projectId);
  await fs.mkdir(directory, { recursive: true });
  const safeId = safeStorageSegment(record.id);
  const target = path.join(directory, `${safeId}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(record, null, 2), "utf8");
  await fs.rename(temporary, target);
  return target;
}

function isReleaseRecord(value: unknown, projectId: string): value is ReleaseExecutionRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ReleaseExecutionRecord>;
  return record.schemaVersion === 1
    && record.projectId === projectId
    && typeof record.id === "string"
    && typeof record.sourceSha === "string"
    && Array.isArray(record.artifacts)
    && typeof record.artifactState === "string"
    && typeof record.signing === "object" && record.signing !== null
    && typeof record.publication === "object" && record.publication !== null
    && typeof record.build === "object" && record.build !== null;
}

export async function listReleaseRecords(workspaceRoot: string, projectId: string, limit = 20): Promise<ReleaseExecutionRecord[]> {
  const directory = releaseRecordDirectory(workspaceRoot, projectId);
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const records = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map(async (entry) => {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(path.join(directory, entry.name), "utf8"));
      return isReleaseRecord(parsed, projectId) ? parsed : null;
    } catch {
      return null;
    }
  }));
  return records
    .filter((record): record is ReleaseExecutionRecord => record !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, Math.max(1, Math.min(limit, 100)));
}

export async function getReleaseRecord(workspaceRoot: string, projectId: string, recordId: string): Promise<ReleaseExecutionRecord | null> {
  const id = recordId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/.test(id) || id.includes("..")) return null;
  if (safeStorageSegment(id) !== id) return null;
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(releaseRecordDirectory(workspaceRoot, projectId), `${id}.json`), "utf8"));
    return isReleaseRecord(parsed, projectId) && parsed.id === id ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Resolve signature evidence only when the recorded digest matches a real
 * artifact from this execution. A signature record for a previous build must
 * never make the current artifact look signed or unsigned.
 */
export function resolveReleaseSigning(
  artifacts: readonly ReleaseArtifactEvidence[],
  evidence: Record<string, unknown> | null,
): ReleaseSigningEvidence {
  if (!evidence) {
    return {
      state: "UNVERIFIED",
      match: "NO_RECORD",
      source: "No local signature verification record",
      detail: "No local package signature record was found. This artifact is not proven signed or unsigned.",
    };
  }
  const recordedSha256 = typeof evidence.sha256 === "string" ? evidence.sha256.trim().toLowerCase() : "";
  const artifactFilename = typeof evidence.artifactFilename === "string" ? evidence.artifactFilename.trim() : "";
  if (!/^[0-9a-f]{64}$/.test(recordedSha256)) {
    return {
      state: "UNVERIFIED",
      match: "MALFORMED_RECORD",
      source: "release/verification/package-windows.json",
      detail: "The local package signature record has no valid artifact SHA-256, so it cannot be attributed to any built artifact.",
    };
  }
  const matched = artifacts.find((artifact) => artifact.sha256 === recordedSha256
    && (!artifactFilename || artifact.path.split("/").at(-1) === artifactFilename.replace(/\\/g, "/").split("/").at(-1)));
  if (!matched) {
    return {
      state: "UNVERIFIED",
      match: "STALE_RECORD",
      source: "release/verification/package-windows.json",
      detail: `The signature record belongs to artifact SHA-256 ${recordedSha256.slice(0, 16)}…, which is not one of the artifact bytes from this run. It was not applied to this artifact.`,
      recordedSha256,
    };
  }
  const rawStatus = typeof evidence.signatureState === "string"
    ? evidence.signatureState
    : typeof (evidence.observedSignature as Record<string, unknown> | undefined)?.status === "string"
      ? String((evidence.observedSignature as Record<string, unknown>).status)
      : "";
  const normalized = rawStatus.trim().toUpperCase();
  const state: ReleaseSigningEvidence["state"] = normalized === "VALID" || normalized === "INVALID" || normalized === "UNSIGNED" || normalized === "UNKNOWN"
    ? normalized
    : normalized === "UNAVAILABLE" || normalized === ""
      ? "UNVERIFIED"
      : "UNVERIFIED";
  const observed = evidence.observedSignature && typeof evidence.observedSignature === "object" ? evidence.observedSignature as Record<string, unknown> : null;
  const subject = typeof observed?.subject === "string" ? observed.subject : "";
  const timestamped = observed?.timestamped === true;
  const detail = state === "VALID"
    ? `Windows Authenticode observation reports VALID for ${matched.path}${subject ? ` (subject ${subject})` : ""}${timestamped ? " with a timestamp" : ""}.`
    : state === "UNSIGNED"
      ? `The local verification record reports UNSIGNED for ${matched.path}. This artifact must not be described as signed.`
      : state === "INVALID"
        ? `The local verification record reports an INVALID signature for ${matched.path}. Do not distribute it as trusted.`
        : state === "UNKNOWN"
          ? `The local verification record reports an UNKNOWN signature state for ${matched.path}. No trust conclusion is inferred.`
          : `The local verification record matches ${matched.path}, but it has no usable signature status. This artifact is not proven signed.`;
  return {
    state,
    match: "MATCHED",
    source: "release/verification/package-windows.json",
    detail,
    recordedSha256,
    artifactPath: matched.path,
  };
}

/** Re-hash a persisted artifact and compare it with the recorded identity. */
export async function verifyArtifactBytes(projectPath: string, artifact: ReleaseArtifactEvidence): Promise<{ ok: true } | { ok: false; reason: string }> {
  const projectRoot = path.resolve(projectPath);
  const absolute = path.resolve(projectRoot, artifact.path);
  const boundary = path.relative(projectRoot, absolute);
  if (!artifact.path || boundary.startsWith("..") || path.isAbsolute(boundary)) return { ok: false, reason: `${artifact.path} escapes the project root.` };
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) return { ok: false, reason: `${artifact.path} is no longer a regular file.` };
    if (stat.size !== artifact.size) return { ok: false, reason: `${artifact.path} size changed from ${artifact.size} to ${stat.size} bytes.` };
    const digest = await sha256File(absolute);
    if (digest !== artifact.sha256) return { ok: false, reason: `${artifact.path} SHA-256 changed from ${artifact.sha256.slice(0, 16)}… to ${digest.slice(0, 16)}….` };
    return { ok: true };
  } catch {
    return { ok: false, reason: `${artifact.path} is missing or unreadable.` };
  }
}

export interface ReleasePublicationAsset {
  path: string;
  name: string;
  size: number;
  sha256: string;
  state: "VERIFIED" | "UPLOADED_UNVERIFIED" | "MISSING";
  assetId?: number;
  downloadUrl?: string;
  /** Digest reported by the independent GitHub read-back, when present. */
  remoteDigest?: string;
}

/**
 * Derive one publication asset from GitHub's independent read-back. Byte
 * identity is claimed only when GitHub reports both the expected size and the
 * matching SHA-256 digest; a size match alone remains UPLOADED_UNVERIFIED.
 */
export function readBackPublishedAsset(artifact: ReleaseArtifactEvidence, remote: Record<string, unknown> | undefined): ReleasePublicationAsset {
  const name = artifact.path.split("/").at(-1) || artifact.path;
  if (!remote) return { path: artifact.path, name, size: artifact.size, sha256: artifact.sha256, state: "MISSING" };
  const remoteSize = typeof remote.size === "number" ? remote.size : null;
  const remoteDigest = typeof remote.digest === "string" ? remote.digest.trim().toLowerCase() : "";
  const assetId = typeof remote.id === "number" ? remote.id : undefined;
  const downloadUrl = typeof remote.browser_download_url === "string" ? remote.browser_download_url : undefined;
  const verified = remoteSize === artifact.size && remoteDigest === `sha256:${artifact.sha256}`;
  return {
    path: artifact.path,
    name,
    size: artifact.size,
    sha256: artifact.sha256,
    state: verified ? "VERIFIED" : "UPLOADED_UNVERIFIED",
    ...(assetId ? { assetId } : {}),
    ...(downloadUrl ? { downloadUrl } : {}),
    ...(remoteDigest ? { remoteDigest } : {}),
  };
}

export interface ReleasePublicationRecord {
  schemaVersion: 1;
  id: string;
  projectId: string;
  releaseRecordId: string;
  sourceSha: string;
  tagName: string;
  releaseId: number | null;
  releaseUrl: string | null;
  outcome: "PUBLISHED" | "DRAFT" | "UPLOAD_FAILED" | "UPLOAD_UNVERIFIED" | "PUBLISH_FAILED_DRAFT_RETAINED" | "PUBLISHED_UNVERIFIED";
  assets: ReleasePublicationAsset[];
  verification: "VERIFIED" | "PARTIAL" | "UNVERIFIED";
  detail: string;
  createdAt: string;
}

export function releasePublicationDirectory(workspaceRoot: string, projectId: string): string {
  return path.join(path.resolve(workspaceRoot), ".kforge", "release-publications", safeStorageSegment(projectId));
}

export async function persistReleasePublication(workspaceRoot: string, record: ReleasePublicationRecord): Promise<string> {
  const directory = releasePublicationDirectory(workspaceRoot, record.projectId);
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, `${safeStorageSegment(record.id)}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(record, null, 2), "utf8");
  await fs.rename(temporary, target);
  return target;
}

function isReleasePublicationRecord(value: unknown, projectId: string): value is ReleasePublicationRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ReleasePublicationRecord>;
  return record.schemaVersion === 1
    && record.projectId === projectId
    && typeof record.id === "string"
    && typeof record.tagName === "string"
    && typeof record.outcome === "string"
    && Array.isArray(record.assets);
}

export async function listReleasePublications(workspaceRoot: string, projectId: string, limit = 20): Promise<ReleasePublicationRecord[]> {
  const directory = releasePublicationDirectory(workspaceRoot, projectId);
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const records = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map(async (entry) => {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(path.join(directory, entry.name), "utf8"));
      return isReleasePublicationRecord(parsed, projectId) ? parsed : null;
    } catch {
      return null;
    }
  }));
  return records
    .filter((record): record is ReleasePublicationRecord => record !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, Math.max(1, Math.min(limit, 100)));
}

/**
 * Stale-plan protection: a mutating release step must be tied to the exact
 * source SHA the operator reviewed. An empty expectation is allowed only for
 * read-only operations; release execution always supplies one.
 */
export function sourceHeadMismatch(expectedHead: string | undefined, actualHead: string): { expectedHead: string; actualHead: string } | null {
  const expected = (expectedHead || "").trim();
  const actual = (actualHead || "").trim();
  if (!expected) return null;
  if (!/^[0-9a-f]{7,40}$/i.test(expected) || !/^[0-9a-f]{7,40}$/i.test(actual)) return { expectedHead: expected, actualHead: actual };
  return actual.toLowerCase().startsWith(expected.toLowerCase()) ? null : { expectedHead: expected, actualHead: actual };
}

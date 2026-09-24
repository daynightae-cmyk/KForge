import { z } from "zod";

/**
 * OSV.dev adapter: observational vulnerability intelligence (Slice 3, P0).
 *
 * Source: https://api.osv.dev
 * Docs: https://google.github.io/osv.dev/api/
 * Schema: https://ossf.github.io/osv-schema/
 * Operations: package query, batch query, vulnerability detail. The adapter
 * is OBSERVATIONAL: it reports advisories with affected ranges and fixed
 * versions, but it never modifies package.json, lockfiles, or any other
 * dependency manifest. Fixing remains a separate confirmed workflow.
 *
 * Schemas are intentionally tolerant: only the advisory identity is
 * required and every provider field is optional passthrough. Queries with
 * no matching advisories return an empty list, which is a normal negative
 * result — never an error, never a clean bill of health beyond the query.
 */

export const OSV_SOURCE_ID = "osv" as const;
export const OSV_BASE_URL = "https://api.osv.dev";
export const OSV_MAX_BATCH_QUERIES = 25;

export interface OsvPackageQuery {
  ecosystem?: string;
  name?: string;
  purl?: string;
  version?: string;
  commit?: string;
}

const osvEventSchema = z
  .object({
    introduced: z.string().optional(),
    fixed: z.string().optional(),
    last_affected: z.string().optional(),
    limit: z.string().optional(),
  })
  .passthrough();

const osvRangeSchema = z
  .object({
    type: z.string().optional(),
    repo: z.string().optional(),
    events: z.array(osvEventSchema).optional(),
    database_specific: z.unknown().optional(),
  })
  .passthrough();

const osvAffectedSchema = z
  .object({
    package: z.object({ ecosystem: z.string().optional(), name: z.string().optional(), purl: z.string().optional() }).passthrough().optional(),
    severity: z.unknown().optional(),
    ranges: z.array(osvRangeSchema).optional(),
    versions: z.array(z.string()).optional(),
    database_specific: z.unknown().optional(),
  })
  .passthrough();

const osvSeveritySchema = z.object({ type: z.string().optional(), score: z.string().optional() }).passthrough();

const osvReferenceSchema = z.object({ type: z.string().optional(), url: z.string().optional() }).passthrough();

const osvVulnSchema = z
  .object({
    id: z.string().min(1),
    summary: z.string().optional(),
    details: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    affected: z.array(osvAffectedSchema).optional(),
    severity: z.array(osvSeveritySchema).optional(),
    references: z.array(osvReferenceSchema).optional(),
    published: z.string().optional(),
    modified: z.string().optional(),
    withdrawn: z.string().optional(),
  })
  .passthrough();

const osvQueryResponseSchema = z.object({ vulns: z.array(osvVulnSchema).optional() }).passthrough();

const osvBatchResponseSchema = z
  .object({ results: z.array(z.object({ vulns: z.array(osvVulnSchema).optional() }).passthrough()) })
  .passthrough();

export type OsvVulnRecord = z.infer<typeof osvVulnSchema>;

function errorMessage(context: string): string {
  return `OSV.dev: ${context} does not match the documented response shape; the provider response was refused.`;
}

function parseJson(rawText: string, context: string): unknown {
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    throw new Error(errorMessage(`malformed JSON in ${context}`));
  }
}

/** Validate a single-query response. Absent `vulns` is a normal negative result. */
export function parseOsvQueryResponse(rawText: string): OsvVulnRecord[] {
  const validation = osvQueryResponseSchema.safeParse(parseJson(rawText, "package query"));
  if (!validation.success) throw new Error(errorMessage("package query"));
  return validation.data.vulns ?? [];
}

/** Validate a batch response. Result entries align with request order. */
export function parseOsvBatchResponse(rawText: string): OsvVulnRecord[][] {
  const validation = osvBatchResponseSchema.safeParse(parseJson(rawText, "batch query"));
  if (!validation.success) throw new Error(errorMessage("batch query"));
  return validation.data.results.map((entry) => entry.vulns ?? []);
}

/** Validate a vulnerability-detail response. */
export function parseOsvVulnResponse(rawText: string): OsvVulnRecord {
  const parsed = parseJson(rawText, "vulnerability detail");
  const validation = osvVulnSchema.safeParse(parsed);
  if (!validation.success) throw new Error(errorMessage("vulnerability detail"));
  return validation.data;
}

const ECOSYSTEM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,99}$/;
const NAME_MAX = 300;
const PURL_MAX = 500;
const VERSION_MAX = 100;
const COMMIT_PATTERN = /^[a-f0-9]{7,100}$/i;
export const OSV_VULN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,99}$/;

/** Validate one package query. At least one selector (ecosystem+name, purl, or commit) is required. */
export function validatedOsvQuery(query: OsvPackageQuery): OsvPackageQuery {
  const { ecosystem, name, purl, version, commit } = query;
  if (ecosystem !== undefined && !ECOSYSTEM_PATTERN.test(ecosystem)) {
    throw new Error("OSV.dev: ecosystem contains unsupported characters.");
  }
  if (name !== undefined && (typeof name !== "string" || name.length === 0 || name.length > NAME_MAX)) {
    throw new Error("OSV.dev: package name must be a string of 1-300 characters.");
  }
  if (purl !== undefined && (typeof purl !== "string" || purl.length === 0 || purl.length > PURL_MAX)) {
    throw new Error("OSV.dev: purl must be a string of 1-500 characters.");
  }
  if (version !== undefined && (typeof version !== "string" || version.length === 0 || version.length > VERSION_MAX)) {
    throw new Error("OSV.dev: version must be a string of 1-100 characters.");
  }
  if (commit !== undefined && !COMMIT_PATTERN.test(commit)) {
    throw new Error("OSV.dev: commit must be a hex hash of 7-100 characters.");
  }
  if (!purl && !commit && !(ecosystem && name)) {
    throw new Error("OSV.dev: a query needs ecosystem+name, a purl, or a commit hash.");
  }
  return { ...(ecosystem ? { ecosystem } : {}), ...(name ? { name } : {}), ...(purl ? { purl } : {}), ...(version ? { version } : {}), ...(commit ? { commit } : {}) };
}

/** Validate a batch of package queries (bounded). */
export function validatedOsvBatch(queries: OsvPackageQuery[]): OsvPackageQuery[] {
  if (!Array.isArray(queries) || queries.length === 0 || queries.length > OSV_MAX_BATCH_QUERIES) {
    throw new Error(`OSV.dev: batch must contain 1-${OSV_MAX_BATCH_QUERIES} package queries.`);
  }
  return queries.map((query) => validatedOsvQuery(query));
}

export function validatedOsvVulnId(id: string): string {
  if (!OSV_VULN_ID_PATTERN.test(id)) throw new Error("OSV.dev: vulnerability id contains unsupported characters.");
  return id;
}

export function buildOsvQueryBody(query: OsvPackageQuery): string {
  const validated = validatedOsvQuery(query);
  const body: Record<string, unknown> = {};
  if (validated.commit) body.commit = validated.commit;
  if (validated.version) body.version = validated.version;
  if (validated.purl) body.package = { purl: validated.purl };
  else if (validated.ecosystem && validated.name) body.package = { ecosystem: validated.ecosystem, name: validated.name };
  return JSON.stringify(body);
}

export function buildOsvBatchBody(queries: OsvPackageQuery[]): string {
  return JSON.stringify({ queries: validatedOsvBatch(queries).map((query) => JSON.parse(buildOsvQueryBody(query)) as unknown) });
}

export function buildOsvQueryUrl(base: string): string {
  return new URL("/v1/query", base).toString();
}

export function buildOsvBatchUrl(base: string): string {
  return new URL("/v1/querybatch", base).toString();
}

export function buildOsvVulnUrl(base: string, id: string): string {
  return new URL(`/v1/vulns/${encodeURIComponent(validatedOsvVulnId(id))}`, base).toString();
}

export type OsvSeverityLevel = "critical" | "high" | "medium" | "low" | "info" | "unassessed";

export interface OsvAffectedRange {
  ecosystem?: string;
  packageName?: string;
  rangeType?: string;
  introduced?: string;
  fixed?: string;
  lastAffected?: string;
}

export interface OsvReference {
  type?: string;
  url: string;
}

export interface NormalizedOsvAdvisory {
  kind: "osv-advisory";
  sourceId: typeof OSV_SOURCE_ID;
  id: string;
  aliases: string[];
  summary: string;
  severityLevel: OsvSeverityLevel;
  severityScore?: number;
  severitySource?: string;
  ecosystem?: string;
  packageName?: string;
  purl?: string;
  affectedRanges: OsvAffectedRange[];
  fixedVersions: string[];
  references: OsvReference[];
  published?: string;
  modified?: string;
  withdrawn?: string;
  retrievedAt: string;
  origin: "LIVE" | "CACHE";
  freshness: "CURRENT" | "CACHED" | "STALE";
}

function maxSeverityScore(record: OsvVulnRecord): { score?: number; source?: string } {
  let best: { score?: number; source?: string } = {};
  for (const entry of record.severity ?? []) {
    const score = entry.score !== undefined ? Number(entry.score) : Number.NaN;
    if (!Number.isFinite(score)) continue;
    if (best.score === undefined || score > best.score) best = { score, source: entry.type };
  }
  return best;
}

function severityLevelFor(score: number | undefined): OsvSeverityLevel {
  if (score === undefined) return "unassessed";
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  if (score > 0) return "low";
  return "info";
}

/** Normalize one OSV vulnerability record. Advisory evidence only — never a fix action. */
export function normalizeOsvAdvisory(record: OsvVulnRecord, retrievedAt: string, origin: "LIVE" | "CACHE", freshness: "CURRENT" | "CACHED" | "STALE" = origin === "CACHE" ? "CACHED" : "CURRENT"): NormalizedOsvAdvisory {
  const { score, source } = maxSeverityScore(record);
  const affectedRanges: OsvAffectedRange[] = [];
  const fixedVersions = new Set<string>();
  let ecosystem: string | undefined;
  let packageName: string | undefined;
  let purl: string | undefined;
  for (const affected of record.affected ?? []) {
    ecosystem = ecosystem ?? affected.package?.ecosystem;
    packageName = packageName ?? affected.package?.name;
    purl = purl ?? affected.package?.purl;
    for (const range of affected.ranges ?? []) {
      // One row per range: combine its event stream (introduced/fixed/
      // last_affected) so the UI can state "affected from X, fixed in Y".
      const row: OsvAffectedRange = {
        ...(affected.package?.ecosystem ? { ecosystem: affected.package.ecosystem } : {}),
        ...(affected.package?.name ? { packageName: affected.package.name } : {}),
        ...(range.type ? { rangeType: range.type.slice(0, 60) } : {}),
      };
      for (const event of range.events ?? []) {
        if (event.fixed) fixedVersions.add(event.fixed.slice(0, 100));
        if (event.introduced && !row.introduced) row.introduced = event.introduced.slice(0, 100);
        if (event.fixed && !row.fixed) row.fixed = event.fixed.slice(0, 100);
        if (event.last_affected && !row.lastAffected) row.lastAffected = event.last_affected.slice(0, 100);
      }
      affectedRanges.push(row);
    }
  }
  const references: OsvReference[] = (record.references ?? [])
    .filter((reference) => typeof reference.url === "string" && reference.url.length > 0)
    .slice(0, 24)
    .map((reference) => ({ ...(reference.type ? { type: reference.type.slice(0, 60) } : {}), url: (reference.url as string).slice(0, 2000) }));
  const summary = (record.summary || record.details || "No summary was supplied by the OSV.dev record.").slice(0, 2000);
  return {
    kind: "osv-advisory",
    sourceId: OSV_SOURCE_ID,
    id: record.id,
    aliases: (record.aliases ?? []).slice(0, 24),
    summary,
    severityLevel: severityLevelFor(score),
    ...(score !== undefined ? { severityScore: score } : {}),
    ...(source ? { severitySource: source.slice(0, 60) } : {}),
    ...(ecosystem ? { ecosystem } : {}),
    ...(packageName ? { packageName } : {}),
    ...(purl ? { purl } : {}),
    affectedRanges: affectedRanges.slice(0, 50),
    fixedVersions: [...fixedVersions].slice(0, 24),
    references,
    ...(record.published ? { published: record.published } : {}),
    ...(record.modified ? { modified: record.modified } : {}),
    ...(record.withdrawn ? { withdrawn: record.withdrawn } : {}),
    retrievedAt,
    origin,
    freshness,
  };
}

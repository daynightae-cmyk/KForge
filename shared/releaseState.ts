/**
 * Canonical release-state contract for KNOuX Forge Windows trust.
 *
 * Three explicit release modes:
 * - DEVELOPMENT: may be unsigned.
 * - RELEASE_CANDIDATE: must pass the full engineering gate; may remain
 *   unsigned but must say so clearly.
 * - TRUSTED_RELEASE: full gate PLUS valid Authenticode signature, trusted
 *   release identity evidence, artifact hashes, release manifest, provenance.
 *
 * Dual signing states:
 * - STATE A (certificate configured): sign EXE + installer, verify
 *   Authenticode, record signer identity/subject/timestamp/SHA256, fail the
 *   trusted-release gate if verification fails.
 * - STATE B (certificate not configured): build still works as a
 *   development/release-candidate artifact, but clearly exposes
 *   SIGNING_STATUS=UNSIGNED / TRUST_STATUS=DEVELOPMENT_ARTIFACT.
 */

export type ReleaseMode = "DEVELOPMENT" | "RELEASE_CANDIDATE" | "TRUSTED_RELEASE";

export type SigningConfigured = boolean;

export interface SigningEvidence {
  configured: boolean;
  /** Normalized status: Valid | UNSIGNED | Unknown | NotSupported | Invalid | HashMismatch ... */
  status: string;
  subject?: string;
  issuer?: string;
  timestamped?: boolean;
  /** Present only when a signature was actually verified. */
  thumbprint?: string;
}

export interface ReleaseStateInput {
  mode?: string | undefined;
  winCscLink?: string | undefined;
  cscLink?: string | undefined;
  trustedReleaseRequired?: boolean | undefined;
}

export interface ReleaseState {
  mode: ReleaseMode;
  signingConfigured: boolean;
  signingStatus: "SIGNED_CONFIGURED" | "UNSIGNED";
  trustStatus: "TRUSTED_RELEASE_CANDIDATE" | "DEVELOPMENT_ARTIFACT";
  trustedGateRequiresSignature: boolean;
}

const VALID_MODES: ReleaseMode[] = ["DEVELOPMENT", "RELEASE_CANDIDATE", "TRUSTED_RELEASE"];

export function normalizeReleaseMode(raw: string | undefined): ReleaseMode {
  const candidate = (raw || "").trim().toUpperCase();
  if ((VALID_MODES as string[]).includes(candidate)) return candidate as ReleaseMode;
  return "DEVELOPMENT";
}

export function isSigningConfigured(input: { winCscLink?: string | undefined; cscLink?: string | undefined }): boolean {
  const winLink = (input.winCscLink || "").trim();
  const cscLink = (input.cscLink || "").trim();
  return winLink.length > 0 || cscLink.length > 0;
}

export function resolveReleaseState(input: ReleaseStateInput): ReleaseState {
  const mode = normalizeReleaseMode(input.mode);
  const signingConfigured = isSigningConfigured({ winCscLink: input.winCscLink, cscLink: input.cscLink });
  const trustedGateRequiresSignature = mode === "TRUSTED_RELEASE" || input.trustedReleaseRequired === true;
  return {
    mode,
    signingConfigured,
    signingStatus: signingConfigured ? "SIGNED_CONFIGURED" : "UNSIGNED",
    trustStatus: signingConfigured ? "TRUSTED_RELEASE_CANDIDATE" : "DEVELOPMENT_ARTIFACT",
    trustedGateRequiresSignature,
  };
}

export function resolveReleaseStateFromEnv(env: Record<string, string | undefined>): ReleaseState {
  return resolveReleaseState({
    mode: env.KFORGE_RELEASE_MODE,
    winCscLink: env.WIN_CSC_LINK,
    cscLink: env.CSC_LINK,
    trustedReleaseRequired: env.KFORGE_TRUSTED_RELEASE === "1",
  });
}

/**
 * Validate a trusted-release transition. Returns an error message when the
 * transition must be refused, or null when it is allowed.
 */
export function trustedReleaseBlocker(state: ReleaseState, signatureStatus: string | undefined): string | null {
  if (!state.trustedGateRequiresSignature) return null;
  if (!state.signingConfigured) return "TRUSTED_RELEASE requires WIN_CSC_LINK/CSC_LINK signing material; none is configured.";
  const normalized = (signatureStatus || "").trim().toLowerCase();
  if (normalized !== "valid") return `TRUSTED_RELEASE requires a Valid Authenticode signature; observed status was ${signatureStatus || "UNKNOWN"}.`;
  return null;
}

export function normalizeSigningEvidence(raw: {
  configured: boolean;
  status?: string | undefined;
  subject?: string | undefined;
  issuer?: string | undefined;
  timestamped?: boolean | undefined;
  thumbprint?: string | undefined;
}): SigningEvidence {
  const evidence: SigningEvidence = {
    configured: raw.configured,
    status: (raw.status || (raw.configured ? "Unknown" : "UNSIGNED")).trim() || "Unknown",
  };
  if (raw.subject) evidence.subject = raw.subject;
  if (raw.issuer) evidence.issuer = raw.issuer;
  if (typeof raw.timestamped === "boolean") evidence.timestamped = raw.timestamped;
  if (raw.thumbprint) evidence.thumbprint = raw.thumbprint;
  if (!raw.configured) {
    evidence.status = "UNSIGNED";
    delete evidence.subject;
    delete evidence.issuer;
    delete evidence.timestamped;
    delete evidence.thumbprint;
  }
  return evidence;
}

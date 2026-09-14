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
 * Build signing configuration and observed artifact signature are independent
 * facts. An existing EXE can prove VALID on a machine that does not possess the
 * CI signing secret; the observed artifact truth must never be rewritten from
 * current environment configuration.
 */

export type ReleaseMode = "DEVELOPMENT" | "RELEASE_CANDIDATE" | "TRUSTED_RELEASE";

export type SigningConfigured = boolean;

export interface SigningEvidence {
  /** Legacy build-configuration field; not an artifact-signature observation. */
  configured: boolean;
  /** Artifact status where measured, otherwise a truthful unavailable/unknown state. */
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
  /** Legacy build-configuration projection; not observed Authenticode truth. */
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

export type ObservedSignatureStatus = "VALID" | "UNSIGNED" | "INVALID" | "UNKNOWN" | "UNAVAILABLE";

export interface ObservedSignature {
  inspected: boolean;
  status: ObservedSignatureStatus;
  subject?: string;
  issuer?: string;
  thumbprint?: string;
  timestamped?: boolean;
}

export function normalizeObservedSignature(rawStatus: string | undefined, inspected: boolean): ObservedSignatureStatus {
  if (!inspected) return "UNAVAILABLE";
  const normalized = (rawStatus || "").trim().toLowerCase();
  if (normalized === "valid") return "VALID";
  if (normalized === "notsigned" || normalized === "unsigned" || normalized === "unknownerror") return "UNSIGNED";
  if (normalized === "unavailable" || normalized === "notsupported") return "UNAVAILABLE";
  if (normalized === "hashmismatch" || normalized === "nottrusted" || normalized === "invalid") return "INVALID";
  if (!normalized || normalized === "unknown") return "UNKNOWN";
  return "UNKNOWN";
}

/**
 * Build-time trusted-release transition. Producing a new TRUSTED_RELEASE must
 * have signing material configured and the resulting artifact must be observed
 * as Authenticode Valid.
 */
export function trustedReleaseBlocker(state: ReleaseState, signatureStatus: string | undefined): string | null {
  if (!state.trustedGateRequiresSignature) return null;
  if (!state.signingConfigured) return "TRUSTED_RELEASE requires WIN_CSC_LINK/CSC_LINK signing material; none is configured.";
  if (normalizeObservedSignature(signatureStatus, true) !== "VALID") {
    return `TRUSTED_RELEASE requires a Valid Authenticode signature; observed status was ${signatureStatus || "UNKNOWN"}.`;
  }
  return null;
}

/**
 * Artifact-time verification. This deliberately ignores current CI secret
 * availability. A downloaded artifact signed elsewhere remains VALID when the
 * OS proves it valid.
 */
export function trustedArtifactBlocker(
  observedSignature: ObservedSignature,
  options: { requireSigner?: boolean; requireTimestamp?: boolean } = {},
): string | null {
  if (!observedSignature.inspected) return "Trusted artifact verification requires Windows Authenticode inspection.";
  if (observedSignature.status !== "VALID") {
    return `Trusted artifact verification requires a Valid Authenticode signature; observed status was ${observedSignature.status}.`;
  }
  if (options.requireSigner && !(observedSignature.subject || "").trim()) {
    return "Trusted artifact verification requires signer identity evidence.";
  }
  if (options.requireTimestamp && observedSignature.timestamped !== true) {
    return "Trusted artifact verification requires timestamp evidence.";
  }
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
  return evidence;
}

export function buildArtifactSigningEvidence(input: {
  buildSigningConfigured: boolean;
  inspected: boolean;
  rawStatus?: string | undefined;
  subject?: string | undefined;
  issuer?: string | undefined;
  thumbprint?: string | undefined;
  timestamped?: boolean | undefined;
}): { buildSigningConfigured: boolean; observedSignature: ObservedSignature } {
  const status = normalizeObservedSignature(input.rawStatus, input.inspected);
  const observedSignature: ObservedSignature = { inspected: input.inspected, status };
  if (input.subject) observedSignature.subject = input.subject;
  if (input.issuer) observedSignature.issuer = input.issuer;
  if (input.thumbprint) observedSignature.thumbprint = input.thumbprint;
  if (typeof input.timestamped === "boolean") observedSignature.timestamped = input.timestamped;
  return { buildSigningConfigured: input.buildSigningConfigured, observedSignature };
}

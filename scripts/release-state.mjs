// Shared release-state resolver for Node scripts (package/verify).
// Reads only KFORGE_RELEASE_MODE / WIN_CSC_LINK / CSC_LINK / KFORGE_TRUSTED_RELEASE.
// Never prints secret values.
const VALID_MODES = new Set(["DEVELOPMENT", "RELEASE_CANDIDATE", "TRUSTED_RELEASE"]);

export function normalizeReleaseMode(raw) {
  const candidate = String(raw || "").trim().toUpperCase();
  return VALID_MODES.has(candidate) ? candidate : "DEVELOPMENT";
}

export function isSigningConfigured({ winCscLink, cscLink } = {}) {
  return String(winCscLink || "").trim().length > 0 || String(cscLink || "").trim().length > 0;
}

export function resolveReleaseStateFromEnv(env = process.env) {
  const mode = normalizeReleaseMode(env.KFORGE_RELEASE_MODE);
  const signingConfigured = isSigningConfigured({ winCscLink: env.WIN_CSC_LINK, cscLink: env.CSC_LINK });
  const trustedGateRequiresSignature = mode === "TRUSTED_RELEASE" || env.KFORGE_TRUSTED_RELEASE === "1";
  return {
    mode,
    signingConfigured,
    // Legacy build-configuration projection. This is NOT an observation of an
    // existing artifact and must never be used to overwrite Authenticode truth.
    signingStatus: signingConfigured ? "SIGNED_CONFIGURED" : "UNSIGNED",
    trustStatus: signingConfigured ? "TRUSTED_RELEASE_CANDIDATE" : "DEVELOPMENT_ARTIFACT",
    trustedGateRequiresSignature,
  };
}

export function normalizeObservedSignature(rawStatus, inspected = true) {
  if (!inspected) return "UNAVAILABLE";
  const normalized = String(rawStatus || "").trim().toLowerCase();
  if (normalized === "valid") return "VALID";
  if (normalized === "notsigned" || normalized === "unsigned" || normalized === "unknownerror") return "UNSIGNED";
  if (!normalized || normalized === "unknown") return "UNKNOWN";
  if (normalized === "unavailable" || normalized === "notsupported") return "UNAVAILABLE";
  return "INVALID";
}

// Build-time trusted release policy. Producing a new TRUSTED_RELEASE must have
// actual signing material configured in the build environment AND the resulting
// artifact must be observed as Authenticode Valid.
export function trustedReleaseBlocker(state, signatureStatus) {
  if (!state.trustedGateRequiresSignature) return null;
  if (!state.signingConfigured) return "TRUSTED_RELEASE requires WIN_CSC_LINK/CSC_LINK signing material; none is configured.";
  if (normalizeObservedSignature(signatureStatus, true) !== "VALID") {
    return `TRUSTED_RELEASE requires a Valid Authenticode signature; observed status was ${signatureStatus || "UNKNOWN"}.`;
  }
  return null;
}

// Artifact-time trust policy. Verifying an already-built EXE is intentionally
// independent of whether this machine has the CI signing secret. A downloaded
// artifact signed elsewhere must remain VALID when Windows proves it VALID.
export function trustedArtifactBlocker(observedSignature, { requireSigner = false, requireTimestamp = false } = {}) {
  if (!observedSignature || observedSignature.inspected !== true) {
    return "Trusted artifact verification requires Windows Authenticode inspection.";
  }
  if (normalizeObservedSignature(observedSignature.status, true) !== "VALID") {
    return `Trusted artifact verification requires a Valid Authenticode signature; observed status was ${observedSignature.status || "UNKNOWN"}.`;
  }
  if (requireSigner && !String(observedSignature.subject || "").trim()) {
    return "Trusted artifact verification requires signer identity evidence.";
  }
  if (requireTimestamp && observedSignature.timestamped !== true) {
    return "Trusted artifact verification requires timestamp evidence.";
  }
  return null;
}

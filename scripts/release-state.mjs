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
    signingStatus: signingConfigured ? "SIGNED_CONFIGURED" : "UNSIGNED",
    trustStatus: signingConfigured ? "TRUSTED_RELEASE_CANDIDATE" : "DEVELOPMENT_ARTIFACT",
    trustedGateRequiresSignature,
  };
}

export function trustedReleaseBlocker(state, signatureStatus) {
  if (!state.trustedGateRequiresSignature) return null;
  if (!state.signingConfigured) return "TRUSTED_RELEASE requires WIN_CSC_LINK/CSC_LINK signing material; none is configured.";
  const normalized = String(signatureStatus || "").trim().toLowerCase();
  if (normalized !== "valid") return `TRUSTED_RELEASE requires a Valid Authenticode signature; observed status was ${signatureStatus || "UNKNOWN"}.`;
  return null;
}

import { describe, expect, it } from "vitest";
import {
  buildArtifactSigningEvidence,
  isSigningConfigured,
  normalizeObservedSignature,
  normalizeReleaseMode,
  normalizeSigningEvidence,
  resolveReleaseState,
  trustedReleaseBlocker,
} from "./releaseState";

describe("releaseState", () => {
  it("defaults to DEVELOPMENT/UNSIGNED when no signing material is configured", () => {
    const state = resolveReleaseState({});
    expect(state.mode).toBe("DEVELOPMENT");
    expect(state.signingConfigured).toBe(false);
    expect(state.signingStatus).toBe("UNSIGNED");
    expect(state.trustStatus).toBe("DEVELOPMENT_ARTIFACT");
    expect(state.trustedGateRequiresSignature).toBe(false);
  });

  it("detects signing configuration from WIN_CSC_LINK or CSC_LINK only", () => {
    expect(isSigningConfigured({})).toBe(false);
    expect(isSigningConfigured({ winCscLink: "  " })).toBe(false);
    expect(isSigningConfigured({ winCscLink: "C:\\certs\\kforge.pfx" })).toBe(true);
    expect(isSigningConfigured({ cscLink: "C:\\certs\\kforge.pfx" })).toBe(true);
  });

  it("normalizes release modes without escalation", () => {
    expect(normalizeReleaseMode(undefined)).toBe("DEVELOPMENT");
    expect(normalizeReleaseMode("trusted_release")).toBe("TRUSTED_RELEASE");
    expect(normalizeReleaseMode("RELEASE_CANDIDATE")).toBe("RELEASE_CANDIDATE");
    expect(normalizeReleaseMode("bogus")).toBe("DEVELOPMENT");
  });

  it("requires a Valid signature for TRUSTED_RELEASE", () => {
    const state = resolveReleaseState({ mode: "TRUSTED_RELEASE", winCscLink: "C:\\certs\\kforge.pfx" });
    expect(state.trustedGateRequiresSignature).toBe(true);
    expect(trustedReleaseBlocker(state, "Valid")).toBeNull();
    expect(trustedReleaseBlocker(state, "UnknownError")).toContain("Valid Authenticode");
    const unconfigured = resolveReleaseState({ mode: "TRUSTED_RELEASE" });
    expect(trustedReleaseBlocker(unconfigured, "Valid")).toContain("signing material");
  });

  it("does not block DEVELOPMENT/RELEASE_CANDIDATE when unsigned", () => {
    expect(trustedReleaseBlocker(resolveReleaseState({ mode: "DEVELOPMENT" }), "UNSIGNED")).toBeNull();
    expect(trustedReleaseBlocker(resolveReleaseState({ mode: "RELEASE_CANDIDATE" }), "UNSIGNED")).toBeNull();
  });

  it("preserves artifact-observed evidence independently of build signing material", () => {
    expect(normalizeObservedSignature("Valid", true)).toBe("VALID");
    expect(normalizeObservedSignature("NotSigned", true)).toBe("UNSIGNED");
    expect(normalizeObservedSignature(undefined, false)).toBe("UNAVAILABLE");
    const signedElsewhere = buildArtifactSigningEvidence({ buildSigningConfigured: false, inspected: true, rawStatus: "Valid", subject: "CN=KNOuX Forge" });
    expect(signedElsewhere.buildSigningConfigured).toBe(false);
    expect(signedElsewhere.observedSignature.status).toBe("VALID");
    expect(signedElsewhere.observedSignature.subject).toBe("CN=KNOuX Forge");
  });

  it("keeps signed identity evidence when configured", () => {
    const evidence = normalizeSigningEvidence({
      configured: true,
      status: "Valid",
      subject: "CN=KNOuX Forge",
      issuer: "CN=Example CA",
      timestamped: true,
    });
    expect(evidence.status).toBe("Valid");
    expect(evidence.subject).toBe("CN=KNOuX Forge");
    expect(evidence.timestamped).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { resolveAgentToolStatus } from "./agentTools";

describe("KForge agent tool status semantics", () => {
  it("maps automatically executable tools to AVAILABLE", () => {
    expect(resolveAgentToolStatus({ permission: "safe" })).toBe("AVAILABLE");
  });

  it("maps confirmation-gated ask semantics to AVAILABLE_WITH_CONFIRMATION", () => {
    expect(resolveAgentToolStatus({ permission: "dangerous", requiresConfirmation: true })).toBe("AVAILABLE_WITH_CONFIRMATION");
  });

  it("maps safe-write tools to AVAILABLE_WITH_CONFIRMATION", () => {
    expect(resolveAgentToolStatus({ permission: "safe-write", requiresConfirmation: true })).toBe("AVAILABLE_WITH_CONFIRMATION");
  });

  it("maps blocked tools to BLOCKED even when a policy reason is present", () => {
    expect(resolveAgentToolStatus({ permission: "blocked", unavailableReason: "Forbidden by policy." })).toBe("BLOCKED");
  });

  it("maps unavailable executables to UNAVAILABLE", () => {
    expect(resolveAgentToolStatus({ permission: "safe", unavailableReason: "Executable not installed." })).toBe("UNAVAILABLE");
  });

  it("maps runtime detection failures to ERROR", () => {
    expect(resolveAgentToolStatus({ permission: "safe", runtimeError: "Probe timed out." })).toBe("ERROR");
  });
});

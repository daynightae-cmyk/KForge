import { describe, expect, it } from "vitest";
import type { ProjectProfile } from "../../shared/workspace";
import { selectProjectRuntime } from "./projectExecution";

function profile(runtime?: string, detail = "UNAVAILABLE: no explicit runnable metadata was detected.") {
  return {
    scripts: {},
    commands: runtime ? { runtime } : {},
    commandEvidence: [{ kind: "runtime", command: runtime, source: "fixture metadata", known: Boolean(runtime), detail }],
  } as ProjectProfile;
}

function packageProfile() {
  return { packageManager: "npm", scripts: { start: "node server.js", dev: "vite", preview: "vite preview" }, commands: {}, commandEvidence: [] } as unknown as ProjectProfile;
}

describe("universal project runtime selection", () => {
  it("injects the reserved local port only into an explicit FastAPI web command", () => {
    const selected = selectProjectRuntime(profile("python -m uvicorn app.main:app", "Explicit FastAPI app plus declared uvicorn runner."), 43123, "preview");
    expect(selected).toMatchObject({ available: true, selected: { command: "python", mode: "http", source: "fixture metadata", urlPath: "/docs" } });
    if (selected.available) expect(selected.selected.args).toEqual(["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "43123"]);
  });

  it("executes CLI metadata as a bounded runtime but refuses to call it Preview", () => {
    expect(selectProjectRuntime(profile("cargo run --release", "Explicit Rust binary entrypoint."), 43123, "runtime")).toMatchObject({ available: true, selected: { command: "cargo", mode: "process" } });
    expect(selectProjectRuntime(profile("cargo run --release", "Explicit Rust binary entrypoint."), 43123, "preview")).toMatchObject({ available: false, reason: expect.stringContaining("no metadata-backed HTTP Preview") });
  });

  it("keeps Runtime on the production script without Preview-only port arguments", () => {
    expect(selectProjectRuntime(packageProfile(), 43123, "runtime")).toMatchObject({ available: true, selected: { args: ["run", "start"], display: "npm run start" } });
    expect(selectProjectRuntime(packageProfile(), 43123, "preview")).toMatchObject({ available: true, selected: { args: ["run", "preview", "--", "--port", "43123"], display: "npm run preview -- --port 43123" } });
  });

  it("preserves the exact missing prerequisite and rejects shell syntax", () => {
    expect(selectProjectRuntime(profile(), 43123)).toEqual({ available: false, reason: "UNAVAILABLE: no explicit runnable metadata was detected." });
    expect(selectProjectRuntime(profile(undefined, "UNKNOWN: no explicit runtime entrypoint."), 43123)).toEqual({ available: false, reason: "UNAVAILABLE: no explicit runtime entrypoint." });
    expect(selectProjectRuntime(profile("cargo run; remove-everything"), 43123)).toMatchObject({ available: false });
  });
});

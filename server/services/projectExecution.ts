import type { ProjectProfile } from "../../shared/workspace";

export interface SelectedProjectRuntime {
  command: string;
  args: string[];
  display: string;
  source: string;
  mode: "http" | "process";
  urlPath?: string;
}

export type ProjectRuntimeSelection = { available: true; selected: SelectedProjectRuntime } | { available: false; reason: string };

function packageScript(profile: ProjectProfile, script: string, port: number, purpose: "runtime" | "preview"): SelectedProjectRuntime {
  const manager = profile.packageManager === "pnpm" ? "pnpm" : profile.packageManager === "yarn" ? "yarn" : profile.packageManager === "bun" ? "bun" : "npm";
  const command = process.platform === "win32" ? `${manager}.cmd` : manager;
  const args = ["run", script];
  if (purpose === "preview") args.push(...(manager === "npm" ? ["--", "--port", String(port)] : ["--port", String(port)]));
  return { command, args, display: [manager, ...args].join(" "), source: `package.json#scripts.${script}`, mode: "http" };
}

function safeTokens(command: string) {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.some((token) => /[;&|`$<>]/.test(token))) return undefined;
  return tokens;
}

export function selectProjectRuntime(profile: ProjectProfile, port: number, purpose: "runtime" | "preview" = "runtime"): ProjectRuntimeSelection {
  const script = purpose === "preview"
    ? profile.scripts.preview ? "preview" : profile.scripts.dev ? "dev" : profile.scripts.start ? "start" : undefined
    : profile.scripts.start ? "start" : profile.scripts.dev ? "dev" : profile.scripts.preview ? "preview" : undefined;
  if (script) return { available: true, selected: packageScript(profile, script, port, purpose) };
  const registered = purpose === "preview" ? profile.commands?.dev || profile.commands?.runtime || profile.commands?.production : profile.commands?.runtime || profile.commands?.production || profile.commands?.dev;
  const tokens = registered ? safeTokens(registered) : undefined;
  if (!registered || !tokens) {
    const evidence = profile.commandEvidence?.find((entry) => entry.kind === "runtime" || entry.kind === "dev");
    const detail = evidence?.detail?.replace(/^UNKNOWN:\s*/i, "") || "No explicit runnable metadata was detected.";
    return { available: false, reason: /^UNAVAILABLE:/i.test(detail) ? detail : `UNAVAILABLE: ${detail}` };
  }
  const [rawCommand, ...args] = tokens;
  const command = rawCommand;
  const evidence = profile.commandEvidence?.find((entry) => entry.kind === "runtime" && entry.known);
  const http = (
    (rawCommand === "python" && (args.includes("uvicorn") || args.includes("runserver")))
    || (rawCommand === "php" && args.includes("serve"))
    || (rawCommand.includes("gradlew") && args.includes("bootRun"))
    || (rawCommand === "mvn" && args.includes("spring-boot:run"))
    || (rawCommand === "dotnet" && /web sdk/i.test(evidence?.detail || ""))
    || (rawCommand === "composer" && args.includes("serve"))
  );
  if (purpose === "preview" && !http) return { available: false, reason: `UNAVAILABLE: ${registered} is a runnable process, but no metadata-backed HTTP Preview command was detected.` };
  if (rawCommand === "python" && args.slice(0, 2).join(" ") === "-m uvicorn") args.push("--host", "127.0.0.1", "--port", String(port));
  else if (rawCommand === "python" && args[0] === "manage.py" && args[1] === "runserver") args.push(`127.0.0.1:${port}`);
  else if (rawCommand === "php" && args[0] === "artisan" && args[1] === "serve") args.push("--host=127.0.0.1", `--port=${port}`);
  const urlPath = rawCommand === "python" && args.slice(0, 2).join(" ") === "-m uvicorn" ? "/docs" : undefined;
  return { available: true, selected: { command, args, display: [rawCommand, ...args].join(" "), source: evidence?.source || "Detected project metadata", mode: http ? "http" : "process", urlPath } };
}

import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { RuntimeDependency, RuntimeEvidence, RuntimeHealthKind, RuntimeServiceKind } from "../../shared/topology";

export type RuntimeControlCommand = { executable: string; args: string[]; display: string };

export interface RuntimeControlPlan {
  source: string;
  env?: Record<string, string>;
  stop?: RuntimeControlCommand[];
  forceStop?: RuntimeControlCommand[];
  cleanup?: RuntimeControlCommand[];
  managedExternalListener?: boolean;
}

export interface DetectedRuntimeSpec {
  id: string;
  name: string;
  kind: RuntimeServiceKind;
  rootPath: string;
  command: RuntimeControlCommand;
  source: RuntimeEvidence;
  dependencies?: RuntimeDependency[];
  requestedPort?: number;
  healthKind?: RuntimeHealthKind;
  healthEndpoint?: string;
  browserEntrypoint?: string;
  browserLabel?: string;
  envRequired?: string[];
}

export interface AutomaticTopologyDetection {
  mode: "compose" | "procfile" | "native";
  specs: DetectedRuntimeSpec[];
  controls: Record<string, RuntimeControlPlan>;
  evidenceSources: string[];
  limitations: string[];
}

const ignored = new Set([".git", ".kforge", "node_modules", "dist", "build", "release", ".next", ".venv", "venv", "target", "vendor", "bin", "obj", "coverage"]);
const composeNames = ["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"];

function normalizeId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "service";
}

function rel(root: string, target: string) {
  return path.relative(root, target).split(path.sep).join("/") || ".";
}

function executable(name: string) {
  if (process.platform !== "win32") return name;
  if (name === "mvn") return "mvn.cmd";
  if (name === "gradle") return "gradle.bat";
  if (name === "composer") return "composer.bat";
  return name;
}

function command(exe: string, args: string[]): RuntimeControlCommand {
  const resolved = executable(exe);
  return { executable: resolved, args, display: [exe, ...args].join(" ") };
}

async function text(file: string, maxBytes = 2_000_000) {
  try {
    const stat = await fs.stat(file);
    if (stat.size > maxBytes) return "";
    return await fs.readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function json(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

async function walk(root: string, maxDepth = 6, maxFiles = 12_000) {
  const files: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth || files.length >= maxFiles) return;
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry.isDirectory() && ignored.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute, depth + 1);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  await visit(root, 0);
  return files;
}

function serviceKind(name: string): RuntimeServiceKind {
  const value = name.toLowerCase();
  if (/worker|queue|consumer|job|scheduler/.test(value)) return "worker";
  if (/docs?|storybook/.test(value)) return "documentation";
  if (/admin|backoffice/.test(value)) return "admin";
  if (/websocket|socket|\bws\b/.test(value)) return "websocket";
  if (/api|backend|server/.test(value)) return "api";
  if (/web|frontend|client|\bui\b|portal/.test(value)) return "frontend";
  return "runtime";
}

function browserish(name: string, kind = serviceKind(name)) {
  return kind === "frontend" || kind === "admin" || kind === "documentation" || /web|portal|dashboard|ui/.test(name.toLowerCase());
}

function scriptPort(value: string) {
  const match = value.match(/(?:--port(?:=|\s+)|\bPORT\s*=\s*|localhost:|127\.0\.0\.1:|0\.0\.0\.0:)(\d{2,5})\b/i);
  const port = Number(match?.[1]);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

function sourcePort(value: string) {
  const patterns = [
    /ListenAndServe\(\s*["'`]:(\d{2,5})/,
    /(?:bind|listen)\([^\n]{0,120}["'`](?:127\.0\.0\.1|0\.0\.0\.0|localhost)?:(\d{2,5})/i,
    /(?:TcpListener|SocketAddr)[^\n]{0,180}["'`](?:127\.0\.0\.1|0\.0\.0\.0|localhost)?:(\d{2,5})/i,
    /(?:server\.port|http\.port)\s*[=:]\s*(\d{2,5})/i,
  ];
  for (const expression of patterns) {
    const port = Number(value.match(expression)?.[1]);
    if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
  }
  return undefined;
}

function safeArgv(value: string): RuntimeControlCommand | undefined {
  const trimmed = value.trim();
  if (!trimmed || /(?:&&|\|\||[;|`<>\r\n])/.test(trimmed) || (process.platform === "win32" && /[%!^&]/.test(trimmed))) return undefined;
  const parts: string[] = [];
  const expression = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s]+)/g;
  let consumed = "";
  for (const match of trimmed.matchAll(expression)) {
    const raw = match[0];
    consumed += raw;
    const token = (match[1] ?? match[2] ?? match[3] ?? "")
      .replace(/\\"/g, "\"")
      .replace(/\$\{PORT\}|\$PORT/g, "{PORT}")
      .replace(/\$\{HOST\}|\$HOST/g, "{HOST}");
    if (!token || /\$[A-Za-z_{]/.test(token)) return undefined;
    parts.push(token);
  }
  if (!parts.length) return undefined;
  const nonWhitespace = trimmed.replace(/\s+/g, "");
  if (consumed.replace(/\s+/g, "") !== nonWhitespace) return undefined;
  return command(parts[0], parts.slice(1));
}

function stripYamlComment(line: string) {
  let single = false; let double = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "'" && !double) single = !single;
    else if (char === "\"" && !single && line[index - 1] !== "\\") double = !double;
    else if (char === "#" && !single && !double && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index).trimEnd();
  }
  return line;
}

function indent(line: string) {
  const prefix = line.match(/^\s*/)?.[0] || "";
  return prefix.includes("\t") ? Number.MAX_SAFE_INTEGER : prefix.length;
}

function yamlScalar(value: string) {
  const clean = value.trim();
  if ((clean.startsWith("\"") && clean.endsWith("\"")) || (clean.startsWith("'") && clean.endsWith("'"))) return clean.slice(1, -1);
  return clean;
}

function parsePublishedPort(block: string[]) {
  const sectionIndex = block.findIndex((line) => /^\s*ports\s*:\s*(?:\[.*\])?\s*$/.test(line));
  if (sectionIndex < 0) return undefined;
  const baseIndent = indent(block[sectionIndex]);
  const lines: string[] = [];
  for (let index = sectionIndex + 1; index < block.length; index += 1) {
    if (block[index].trim() && indent(block[index]) <= baseIndent) break;
    lines.push(block[index]);
  }
  const inline = block[sectionIndex].match(/ports\s*:\s*\[(.*)\]/)?.[1];
  if (inline) lines.push(...inline.split(",").map((item) => `- ${item.trim()}`));
  const published = Number(lines.join("\n").match(/\bpublished\s*:\s*["']?(\d{1,5})/)?.[1]);
  if (Number.isInteger(published) && published > 0 && published <= 65535) return published;
  for (const line of lines) {
    const item = yamlScalar(line.replace(/^\s*-\s*/, "")).replace(/\/(?:tcp|udp)$/i, "");
    if (!item || /^\w+\s*:/.test(item) && !/^\d/.test(item) && !/^127\./.test(item) && !/^0\.0\.0\.0/.test(item)) continue;
    const parts = item.split(":");
    const candidate = parts.length >= 3 ? parts[parts.length - 2] : parts.length === 2 ? parts[0] : undefined;
    const port = Number(candidate);
    if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
  }
  return undefined;
}

function parseDependsOn(block: string[]) {
  const sectionIndex = block.findIndex((line) => /^\s*depends_on\s*:/.test(line));
  if (sectionIndex < 0) return [];
  const sameLine = block[sectionIndex].match(/depends_on\s*:\s*\[(.*)\]/)?.[1];
  if (sameLine) return sameLine.split(",").map((item) => normalizeId(yamlScalar(item))).filter(Boolean);
  const baseIndent = indent(block[sectionIndex]);
  const found: string[] = [];
  for (let index = sectionIndex + 1; index < block.length; index += 1) {
    const line = block[index];
    if (line.trim() && indent(line) <= baseIndent) break;
    const list = line.match(/^\s*-\s*([A-Za-z0-9._-]+)\s*$/)?.[1];
    const mapping = line.match(/^\s+([A-Za-z0-9._-]+)\s*:\s*(?:\{.*\})?\s*$/)?.[1];
    const value = list || mapping;
    if (value && !["condition", "restart", "required"].includes(value)) found.push(normalizeId(value));
  }
  return [...new Set(found)];
}

async function detectCompose(projectPath: string): Promise<AutomaticTopologyDetection | undefined> {
  const composePath = composeNames.map((name) => path.join(projectPath, name)).find((file) => existsSync(file));
  if (!composePath) return undefined;
  const raw = await text(composePath);
  if (!raw) return undefined;
  const lines = raw.split(/\r?\n/).map(stripYamlComment);
  const servicesIndex = lines.findIndex((line) => /^\s*services\s*:\s*$/.test(line));
  if (servicesIndex < 0) return undefined;
  const servicesIndent = indent(lines[servicesIndex]);
  let serviceIndent: number | undefined;
  const headers: Array<{ index: number; name: string }> = [];
  for (let index = servicesIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const currentIndent = indent(line);
    if (currentIndent <= servicesIndent) break;
    const match = line.match(/^\s+([A-Za-z0-9._-]+)\s*:\s*$/);
    if (!match) continue;
    if (serviceIndent === undefined) serviceIndent = currentIndent;
    if (currentIndent === serviceIndent) headers.push({ index, name: match[1] });
  }
  if (!headers.length) return undefined;
  const composeRelative = rel(projectPath, composePath);
  const specs: DetectedRuntimeSpec[] = [];
  const controls: Record<string, RuntimeControlPlan> = {};
  const ids = new Set(headers.map((entry) => normalizeId(entry.name)));
  for (let headerIndex = 0; headerIndex < headers.length; headerIndex += 1) {
    const header = headers[headerIndex];
    const end = headers[headerIndex + 1]?.index ?? lines.length;
    const block = lines.slice(header.index, end);
    const id = normalizeId(header.name);
    const kind = serviceKind(header.name);
    const requestedPort = parsePublishedPort(block);
    const isBrowser = Boolean(requestedPort && browserish(header.name, kind));
    const dependencies = parseDependsOn(block).filter((dependency) => ids.has(dependency)).map((dependency): RuntimeDependency => ({
      serviceId: dependency,
      relationship: "CONFIGURED_DEPENDENCY",
      evidence: { source: `${composeRelative}#services.${header.name}.depends_on`, detail: `${header.name} declares Compose dependency ${dependency}.`, confidence: "explicit" },
    }));
    const prefix = ["compose", "-f", composeRelative, "-p", "{SESSION}"];
    const start = command("docker", [...prefix, "up", "--no-deps", "--no-color", header.name]);
    specs.push({
      id, name: header.name, kind, rootPath: projectPath, command: start,
      source: { source: `${composeRelative}#services.${header.name}`, detail: "Docker Compose service definition detected without executing Docker.", confidence: "explicit" },
      dependencies, requestedPort,
      healthKind: requestedPort ? "TCP" : "PROCESS",
      browserEntrypoint: isBrowser ? "/" : undefined,
      browserLabel: isBrowser ? header.name : undefined,
    });
    controls[id] = {
      source: `${composeRelative}#services.${header.name}`,
      managedExternalListener: Boolean(requestedPort),
      stop: [command("docker", [...prefix, "stop", "-t", "4", header.name]), command("docker", [...prefix, "rm", "-f", header.name])],
      forceStop: [command("docker", [...prefix, "kill", header.name]), command("docker", [...prefix, "rm", "-f", header.name])],
      cleanup: [command("docker", [...prefix, "down", "--remove-orphans"])],
    };
  }
  return {
    mode: "compose", specs, controls, evidenceSources: [composeRelative],
    limitations: [
      "Docker Compose discovery is read-only and accepts canonical services/depends_on plus published TCP port evidence; unsupported YAML constructs remain UNKNOWN instead of being guessed.",
      "Compose services are started in an isolated KForge Compose project name and stopped with service-scoped Compose lifecycle commands before process escalation.",
    ],
  };
}

async function detectProcfile(projectPath: string): Promise<AutomaticTopologyDetection | undefined> {
  const procfile = path.join(projectPath, "Procfile");
  if (!existsSync(procfile)) return undefined;
  const raw = await text(procfile, 500_000);
  const specs: DetectedRuntimeSpec[] = [];
  for (const [index, original] of raw.split(/\r?\n/).entries()) {
    const line = original.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z0-9._-]+)\s*:\s*(.+)$/);
    if (!match) continue;
    const parsed = safeArgv(match[2]);
    if (!parsed) continue;
    const name = match[1]; const id = normalizeId(name); const kind = serviceKind(name);
    const requestedPort = scriptPort(parsed.display);
    const hasPort = requestedPort !== undefined || parsed.args.some((arg) => arg.includes("{PORT}"));
    const isBrowser = hasPort && browserish(name, kind);
    specs.push({
      id, name, kind, rootPath: projectPath, command: parsed,
      source: { source: `Procfile:${index + 1}`, detail: `Safe argv Procfile process ${name}; shell operators and undeclared variable expansion are rejected.`, confidence: "explicit" },
      requestedPort, healthKind: hasPort ? "TCP" : "PROCESS",
      browserEntrypoint: isBrowser ? "/" : undefined, browserLabel: isBrowser ? name : undefined,
    });
  }
  if (!specs.length) return undefined;
  return {
    mode: "procfile", specs, controls: {}, evidenceSources: ["Procfile"],
    limitations: ["Procfile discovery executes no shell. Only safely tokenized argv commands with PORT/HOST placeholders are accepted; shell pipelines and arbitrary expansion remain unavailable."],
  };
}

function rootFor(file: string) { return path.dirname(file); }
function under(root: string, file: string) { return rel(root, file); }

async function detectPython(projectPath: string, files: string[]) {
  const manifests = files.filter((file) => ["pyproject.toml", "requirements.txt", "setup.py"].includes(path.basename(file)));
  const roots = [...new Set(manifests.map(rootFor))];
  const specs: DetectedRuntimeSpec[] = [];
  const controls: Record<string, RuntimeControlPlan> = {};
  for (const root of roots) {
    const metadataFiles = manifests.filter((file) => rootFor(file) === root);
    const metadata = (await Promise.all(metadataFiles.map((file) => text(file, 1_000_000)))).join("\n");
    const pythonFiles = files.filter((file) => file.startsWith(`${root}${path.sep}`) && file.endsWith(".py") && !under(root, file).startsWith("tests/")).slice(0, 250);
    const manage = path.join(root, "manage.py");
    const baseName = path.basename(root);
    if (/django/i.test(metadata) && existsSync(manage)) {
      const id = normalizeId(`python-${rel(projectPath, root)}-django`);
      specs.push({ id, name: `${baseName} Django`, kind: browserish(baseName) ? "frontend" : "api", rootPath: root,
        command: command("python", ["manage.py", "runserver", "127.0.0.1:{PORT}"]),
        source: { source: `${rel(projectPath, manage)} + Python dependency metadata`, detail: "Django manage.py and Django dependency metadata detected.", confidence: "high" },
        healthKind: "TCP", browserEntrypoint: browserish(baseName) ? "/" : undefined, browserLabel: browserish(baseName) ? `${baseName} Django` : undefined });
      controls[id] = { source: rel(projectPath, manage) };
      continue;
    }
    let fastApi: { file: string; source: string } | undefined;
    let flask: { file: string; source: string } | undefined;
    let genericMain: { file: string; source: string } | undefined;
    for (const file of pythonFiles) {
      const source = await text(file, 1_000_000);
      if (!fastApi && /\bFastAPI\s*\(/.test(source) && /\bapp\s*=\s*FastAPI\s*\(/.test(source)) fastApi = { file, source };
      if (!flask && /\bFlask\s*\(/.test(source) && /\bapp\s*=\s*Flask\s*\(/.test(source)) flask = { file, source };
      if (!genericMain && /if\s+__name__\s*==\s*["']__main__["']/.test(source)) genericMain = { file, source };
      if (fastApi && flask && genericMain) break;
    }
    if (fastApi && /fastapi/i.test(metadata) && /uvicorn/i.test(metadata)) {
      const moduleName = under(root, fastApi.file).replace(/\.py$/, "").split("/").join(".");
      const id = normalizeId(`python-${rel(projectPath, root)}-fastapi`);
      specs.push({ id, name: `${baseName} FastAPI`, kind: "api", rootPath: root,
        command: command("python", ["-m", "uvicorn", `${moduleName}:app`, "--host", "127.0.0.1", "--port", "{PORT}"]),
        source: { source: rel(projectPath, fastApi.file), detail: "FastAPI app symbol plus declared uvicorn runner detected.", confidence: "high" }, healthKind: "TCP" });
      controls[id] = { source: rel(projectPath, fastApi.file) };
      continue;
    }
    if (flask && /flask/i.test(metadata)) {
      const moduleName = under(root, flask.file).replace(/\.py$/, "").split("/").join(".");
      const id = normalizeId(`python-${rel(projectPath, root)}-flask`);
      specs.push({ id, name: `${baseName} Flask`, kind: browserish(baseName) ? "frontend" : "api", rootPath: root,
        command: command("python", ["-m", "flask", "--app", `${moduleName}:app`, "run", "--host", "127.0.0.1", "--port", "{PORT}"]),
        source: { source: rel(projectPath, flask.file), detail: "Flask app symbol plus Flask dependency metadata detected.", confidence: "high" }, healthKind: "TCP",
        browserEntrypoint: browserish(baseName) ? "/" : undefined, browserLabel: browserish(baseName) ? `${baseName} Flask` : undefined });
      controls[id] = { source: rel(projectPath, flask.file) };
      continue;
    }
    if (genericMain) {
      const source = genericMain.source;
      const usesPort = /(?:os\.(?:environ|getenv)|getenv)\s*\([^\n]{0,40}["']PORT["']/.test(source);
      const fixedPort = sourcePort(source);
      const network = /(?:http\.server|aiohttp|socket\.|\.listen\s*\(|serve\s*\()/.test(source) && (usesPort || fixedPort);
      const id = normalizeId(`python-${rel(projectPath, genericMain.file)}`);
      specs.push({ id, name: `${baseName} Python`, kind: network ? "api" : "runtime", rootPath: path.dirname(genericMain.file),
        command: command("python", [path.basename(genericMain.file)]),
        source: { source: rel(projectPath, genericMain.file), detail: "Explicit Python __main__ entrypoint detected.", confidence: "high" },
        requestedPort: fixedPort, healthKind: network ? "TCP" : "PROCESS" });
      controls[id] = { source: rel(projectPath, genericMain.file) };
    }
  }
  return { specs, controls };
}

async function detectDotNet(projectPath: string, files: string[]) {
  const specs: DetectedRuntimeSpec[] = []; const controls: Record<string, RuntimeControlPlan> = {};
  for (const projectFile of files.filter((file) => file.endsWith(".csproj")).slice(0, 100)) {
    const content = await text(projectFile, 1_500_000);
    const web = /Sdk\s*=\s*["']Microsoft\.NET\.Sdk\.Web["']|Microsoft\.AspNetCore/i.test(content);
    const worker = /Microsoft\.Extensions\.Hosting|Worker\b/i.test(content);
    if (!web && !worker && !/<OutputType>\s*Exe\s*<\/OutputType>/i.test(content)) continue;
    const root = path.dirname(projectFile); const name = path.basename(projectFile, ".csproj"); const kind = web ? (browserish(name) ? "frontend" : "api") : worker ? "worker" : "runtime";
    const id = normalizeId(`dotnet-${rel(projectPath, projectFile)}`);
    specs.push({ id, name, kind, rootPath: root, command: command("dotnet", ["run", "--no-launch-profile"]),
      source: { source: rel(projectPath, projectFile), detail: web ? "Explicit .NET Web SDK/AspNetCore project." : worker ? "Explicit .NET hosted worker project." : "Executable .NET project.", confidence: "high" },
      healthKind: web ? "TCP" : "PROCESS", browserEntrypoint: web && browserish(name) ? "/" : undefined, browserLabel: web && browserish(name) ? name : undefined });
    controls[id] = { source: rel(projectPath, projectFile), env: web ? { ASPNETCORE_URLS: "http://127.0.0.1:{PORT}" } : undefined };
  }
  return { specs, controls };
}

async function detectJava(projectPath: string, files: string[]) {
  const specs: DetectedRuntimeSpec[] = []; const controls: Record<string, RuntimeControlPlan> = {};
  const manifests = files.filter((file) => ["pom.xml", "build.gradle", "build.gradle.kts"].includes(path.basename(file))).slice(0, 120);
  for (const manifest of manifests) {
    const content = await text(manifest, 2_000_000);
    const spring = /spring-boot|org\.springframework\.boot/i.test(content);
    const quarkus = /quarkus/i.test(content);
    if (!spring && !quarkus) continue;
    const root = path.dirname(manifest); const name = path.basename(root); const id = normalizeId(`java-${rel(projectPath, manifest)}`);
    let run: RuntimeControlCommand;
    if (path.basename(manifest) === "pom.xml") run = command("mvn", [spring ? "spring-boot:run" : "quarkus:dev"]);
    else {
      const wrapper = path.join(root, process.platform === "win32" ? "gradlew.bat" : "gradlew");
      run = existsSync(wrapper) ? command(process.platform === "win32" ? "gradlew.bat" : "./gradlew", [spring ? "bootRun" : "quarkusDev"]) : command("gradle", [spring ? "bootRun" : "quarkusDev"]);
    }
    specs.push({ id, name: `${name} ${spring ? "Spring Boot" : "Quarkus"}`, kind: browserish(name) ? "frontend" : "api", rootPath: root, command: run,
      source: { source: rel(projectPath, manifest), detail: `${spring ? "Spring Boot" : "Quarkus"} runtime plugin/dependency metadata detected.`, confidence: "high" },
      healthKind: "TCP", browserEntrypoint: browserish(name) ? "/" : undefined, browserLabel: browserish(name) ? name : undefined });
    controls[id] = { source: rel(projectPath, manifest), env: spring ? { SERVER_ADDRESS: "127.0.0.1", SERVER_PORT: "{PORT}" } : { QUARKUS_HTTP_HOST: "127.0.0.1", QUARKUS_HTTP_PORT: "{PORT}" } };
  }
  return { specs, controls };
}

async function detectGo(projectPath: string, files: string[]) {
  const specs: DetectedRuntimeSpec[] = []; const controls: Record<string, RuntimeControlPlan> = {};
  for (const moduleFile of files.filter((file) => path.basename(file) === "go.mod").slice(0, 80)) {
    const root = path.dirname(moduleFile);
    const mains = files.filter((file) => file.startsWith(`${root}${path.sep}`) && path.basename(file) === "main.go" && under(root, file).split("/").length <= 4).slice(0, 30);
    for (const main of mains) {
      const source = await text(main, 1_500_000); if (!source) continue;
      const mainRoot = path.dirname(main); const name = path.basename(mainRoot) === path.basename(root) ? path.basename(root) : path.basename(mainRoot);
      const http = /net\/http|gin-gonic|fiber\/v2|echo\/v4|fasthttp|ListenAndServe/.test(source);
      const portFromEnv = /(?:os\.)?(?:Getenv|LookupEnv)\s*\(\s*["']PORT["']/.test(source);
      const fixedPort = sourcePort(source);
      const network = http && (portFromEnv || fixedPort !== undefined);
      const id = normalizeId(`go-${rel(projectPath, mainRoot)}`);
      specs.push({ id, name: `${name} Go`, kind: network ? (browserish(name) ? "frontend" : "api") : "runtime", rootPath: mainRoot, command: command("go", ["run", "."]),
        source: { source: rel(projectPath, main), detail: network ? "Go main package with HTTP listener and explicit PORT/fixed-port evidence." : "Go main package entrypoint; listener behavior remains unclaimed.", confidence: "high" },
        requestedPort: fixedPort, healthKind: network ? "TCP" : "PROCESS", browserEntrypoint: network && browserish(name) ? "/" : undefined, browserLabel: network && browserish(name) ? name : undefined });
      controls[id] = { source: rel(projectPath, main) };
    }
  }
  return { specs, controls };
}

async function detectRust(projectPath: string, files: string[]) {
  const specs: DetectedRuntimeSpec[] = []; const controls: Record<string, RuntimeControlPlan> = {};
  for (const cargo of files.filter((file) => path.basename(file) === "Cargo.toml").slice(0, 100)) {
    const root = path.dirname(cargo); const main = path.join(root, "src", "main.rs"); if (!existsSync(main)) continue;
    const [manifest, source] = await Promise.all([text(cargo, 1_000_000), text(main, 1_500_000)]);
    const networkFramework = /actix-web|axum|rocket|warp|hyper|tokio/i.test(manifest) && /TcpListener|bind\s*\(|Server::bind|\.run\s*\(/.test(source);
    const portFromEnv = /(?:std::)?env::var\s*\(\s*["']PORT["']/.test(source);
    const fixedPort = sourcePort(source); const network = networkFramework && (portFromEnv || fixedPort !== undefined);
    const name = path.basename(root); const id = normalizeId(`rust-${rel(projectPath, root)}`);
    specs.push({ id, name: `${name} Rust`, kind: network ? (browserish(name) ? "frontend" : "api") : "runtime", rootPath: root, command: command("cargo", ["run"]),
      source: { source: `${rel(projectPath, cargo)} + ${rel(projectPath, main)}`, detail: network ? "Rust binary with web framework/listener plus explicit PORT/fixed-port evidence." : "Rust binary target detected; listener behavior remains unclaimed.", confidence: "high" },
      requestedPort: fixedPort, healthKind: network ? "TCP" : "PROCESS", browserEntrypoint: network && browserish(name) ? "/" : undefined, browserLabel: network && browserish(name) ? name : undefined });
    controls[id] = { source: rel(projectPath, cargo) };
  }
  return { specs, controls };
}

async function detectPhp(projectPath: string, files: string[]) {
  const specs: DetectedRuntimeSpec[] = []; const controls: Record<string, RuntimeControlPlan> = {};
  for (const composerFile of files.filter((file) => path.basename(file) === "composer.json").slice(0, 100)) {
    const root = path.dirname(composerFile); const composer = await json(composerFile); if (!composer) continue;
    const require = { ...(composer.require && typeof composer.require === "object" ? composer.require as Record<string, unknown> : {}), ...(composer["require-dev"] && typeof composer["require-dev"] === "object" ? composer["require-dev"] as Record<string, unknown> : {}) };
    const laravel = Boolean(require["laravel/framework"] && existsSync(path.join(root, "artisan")));
    const symfony = Object.keys(require).some((name) => name.startsWith("symfony/")) && existsSync(path.join(root, "public", "index.php"));
    if (!laravel && !symfony) continue;
    const name = path.basename(root); const id = normalizeId(`php-${rel(projectPath, root)}`);
    const run = laravel ? command("php", ["artisan", "serve", "--host", "127.0.0.1", "--port", "{PORT}"]) : command("php", ["-S", "127.0.0.1:{PORT}", "-t", "public"]);
    specs.push({ id, name: `${name} ${laravel ? "Laravel" : "Symfony"}`, kind: "frontend", rootPath: root, command: run,
      source: { source: rel(projectPath, composerFile), detail: laravel ? "Laravel framework plus Artisan entrypoint detected." : "Symfony dependencies plus public/index.php front controller detected.", confidence: "high" },
      healthKind: "TCP", browserEntrypoint: "/", browserLabel: name });
    controls[id] = { source: rel(projectPath, composerFile) };
  }
  return { specs, controls };
}

async function detectNative(projectPath: string): Promise<AutomaticTopologyDetection> {
  const files = await walk(projectPath);
  const groups = await Promise.all([
    detectPython(projectPath, files), detectDotNet(projectPath, files), detectJava(projectPath, files),
    detectGo(projectPath, files), detectRust(projectPath, files), detectPhp(projectPath, files),
  ]);
  const specs = groups.flatMap((group) => group.specs);
  const controls = Object.assign({}, ...groups.map((group) => group.controls));
  return {
    mode: "native", specs, controls,
    evidenceSources: [...new Set(specs.map((spec) => spec.source.source))],
    limitations: [
      "Native runtime discovery is read-only and requires explicit framework/entrypoint evidence for Python, .NET, Java, Go, Rust, or PHP; ambiguous commands and listeners remain UNKNOWN.",
      "Go/Rust/Python generic binaries are treated as process-only unless source proves an HTTP/listener path and explicit PORT or fixed-port behavior.",
    ],
  };
}

export async function detectAutomaticTopology(_projectId: string, projectPath: string): Promise<AutomaticTopologyDetection> {
  return await detectCompose(projectPath) || await detectProcfile(projectPath) || await detectNative(projectPath);
}

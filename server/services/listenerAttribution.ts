import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

export type ListenerRelation = "SPAWNED_PROCESS" | "DESCENDANT_PROCESS" | "EXTERNAL_PROCESS" | "UNAVAILABLE";

export interface ListenerAttribution {
  pid?: number;
  relation: ListenerRelation;
  source: string;
  detail: string;
}

interface WindowsListenerProbe {
  pid?: number;
  source: string;
  detail?: string;
  /** True when the OS proved several owners, which must not be guessed at. */
  ambiguous?: boolean;
}

const WINDOWS_NETSTAT_TIMEOUT_MS = 2_000;
const WINDOWS_LISTENER_TIMEOUT_MS = 5_000;
const WINDOWS_ANCESTRY_TIMEOUT_MS = 8_000;
const MAX_CAPTURED_OUTPUT = 2_000_000;

async function runCapture(command: string, args: string[], timeoutMs = 3_000) {
  return await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already exited */ } finish(124); }, timeoutMs);
    child.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); if (stdout.length > MAX_CAPTURED_OUTPUT) stdout = stdout.slice(-MAX_CAPTURED_OUTPUT); });
    child.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); if (stderr.length > 100_000) stderr = stderr.slice(-100_000); });
    child.once("error", () => finish(127));
    child.once("exit", (code) => finish(code ?? 1));
  });
}

async function linuxListenerPid(port: number) {
  const inodes = new Set<string>();
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    const content = await fs.readFile(table, "utf8").catch(() => "");
    for (const line of content.split(/\r?\n/).slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 10 || fields[3] !== "0A") continue;
      const local = fields[1]?.split(":");
      if (!local || local.length !== 2) continue;
      if (Number.parseInt(local[1], 16) !== port) continue;
      if (fields[9]) inodes.add(fields[9]);
    }
  }
  if (!inodes.size) return undefined;
  const processDirectories = await fs.readdir("/proc", { withFileTypes: true }).catch(() => []);
  for (const entry of processDirectories) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const pid = Number(entry.name);
    const fdRoot = path.join("/proc", entry.name, "fd");
    const fds = await fs.readdir(fdRoot).catch(() => [] as string[]);
    for (const fd of fds) {
      const target = await fs.readlink(path.join(fdRoot, fd)).catch(() => "");
      const inode = target.match(/^socket:\[(\d+)\]$/)?.[1];
      if (inode && inodes.has(inode)) return pid;
    }
  }
  return undefined;
}

async function linuxParent(pid: number) {
  const status = await fs.readFile(`/proc/${pid}/status`, "utf8").catch(() => "");
  const parent = Number(status.match(/^PPid:\s+(\d+)/m)?.[1]);
  return Number.isInteger(parent) && parent >= 0 ? parent : undefined;
}

async function linuxDescendant(pid: number, ancestor: number) {
  let current: number | undefined = pid;
  const seen = new Set<number>();
  for (let depth = 0; current && depth < 64 && !seen.has(current); depth += 1) {
    if (current === ancestor) return true;
    seen.add(current);
    current = await linuxParent(current);
  }
  return false;
}

/**
 * Parse the `netstat -ano -p TCP` table for the owning process of a listener.
 *
 * In the Windows TCP table a socket is listening exactly when its foreign
 * endpoint port is `0`; established, waiting and closing rows always carry a
 * non-zero foreign port. That signal is used instead of the `LISTENING` label
 * so the parser stays correct on localized Windows builds, where the state
 * column can be translated while addresses and PIDs remain ASCII.
 *
 * Returns every distinct owner so a caller can refuse to attribute one port to
 * several processes rather than guessing which one answered a probe.
 */
export function parseNetstatListenerPids(stdout: string, port: number): number[] {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return [];
  const owners = new Set<number>();
  for (const line of stdout.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 5 || fields[0] !== "TCP") continue;
    const [, local, foreign, , owner] = fields;
    const localSeparator = local.lastIndexOf(":");
    const foreignSeparator = foreign.lastIndexOf(":");
    if (localSeparator < 0 || foreignSeparator < 0) continue;
    if (Number(local.slice(localSeparator + 1)) !== port) continue;
    // A listening socket has no foreign port. Anything else is a live or
    // closing connection that happens to involve the probed port.
    if (Number(foreign.slice(foreignSeparator + 1)) !== 0) continue;
    const pid = Number(owner);
    if (Number.isInteger(pid) && pid > 0) owners.add(pid);
  }
  return [...owners];
}

async function windowsNetstatListeners(port: number): Promise<WindowsListenerProbe> {
  const result = await runCapture("netstat", ["-ano", "-p", "TCP"], WINDOWS_NETSTAT_TIMEOUT_MS);
  if (result.code !== 0) return { source: "netstat -ano -p TCP", detail: `The Windows TCP table could not be read (exit ${result.code}).` };
  const owners = parseNetstatListenerPids(result.stdout, port);
  if (owners.length === 1) return { pid: owners[0], source: "netstat -ano -p TCP" };
  if (owners.length > 1) {
    return { source: "netstat -ano -p TCP", ambiguous: true, detail: `The Windows TCP table reports ${owners.length} distinct owning processes (${owners.join(", ")}) listening on port ${port}; KForge does not attribute one port to several owners.` };
  }
  return { source: "netstat -ano -p TCP", detail: `The Windows TCP table reported no listener on port ${port}.` };
}

async function windowsPowerShellListener(port: number): Promise<WindowsListenerProbe> {
  // Every owner is enumerated rather than the first match: taking one arbitrary
  // row out of several would let KForge report a clean owner it merely guessed.
  const script = `$p=@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique); if($p.Count -eq 1){[Console]::Write($p[0])} elseif($p.Count -gt 1){[Console]::Write(($p -join ','))}`;
  const result = await runCapture("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], WINDOWS_LISTENER_TIMEOUT_MS);
  const owners = result.stdout.trim().split(",").map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0);
  if (owners.length === 1) return { pid: owners[0], source: "Get-NetTCPConnection" };
  if (owners.length > 1) return { source: "Get-NetTCPConnection", ambiguous: true, detail: `Get-NetTCPConnection reports ${owners.length} distinct owning processes (${owners.join(", ")}) listening on port ${port}; KForge does not attribute one port to several owners.` };
  return { source: "Get-NetTCPConnection", detail: `Get-NetTCPConnection reported no owning process for port ${port} (exit ${result.code}).` };
}

/**
 * Windows listener attribution. `netstat` is a small native table dump and is
 * used first; PowerShell/CIM is only consulted when the native table gives no
 * usable owner, because a `powershell.exe` cold start costs roughly a second
 * and used to sit on every health probe.
 */
async function windowsListenerProbe(port: number): Promise<WindowsListenerProbe> {
  const native = await windowsNetstatListeners(port);
  if (native.pid || native.ambiguous) return native;
  const fallback = await windowsPowerShellListener(port);
  if (fallback.pid || fallback.ambiguous) return fallback;
  return { source: `${native.source} -> ${fallback.source}`, detail: `${native.detail || "No listener owner was available."} ${fallback.detail || ""}`.trim() };
}

async function windowsDescendant(pid: number, ancestor: number) {
  const script = `$p=${pid};$a=${ancestor};$seen=@{};for($i=0;$i -lt 64 -and $p -gt 0;$i++){if($p -eq $a){[Console]::Write('YES');exit 0};if($seen.ContainsKey($p)){break};$seen[$p]=1;$o=Get-CimInstance Win32_Process -Filter \"ProcessId=$p\" -ErrorAction SilentlyContinue;$p=if($o){[int]$o.ParentProcessId}else{0}}`;
  const result = await runCapture("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], WINDOWS_ANCESTRY_TIMEOUT_MS);
  return result.stdout.trim() === "YES";
}

async function unixListenerPid(port: number) {
  const result = await runCapture("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], 4_000);
  const pid = Number(result.stdout.trim().split(/\s+/)[0]);
  return result.code === 0 && Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

async function unixParent(pid: number) {
  const result = await runCapture("ps", ["-o", "ppid=", "-p", String(pid)], 2_000);
  const parent = Number(result.stdout.trim());
  return result.code === 0 && Number.isInteger(parent) && parent >= 0 ? parent : undefined;
}

async function unixDescendant(pid: number, ancestor: number) {
  let current: number | undefined = pid;
  const seen = new Set<number>();
  for (let depth = 0; current && depth < 64 && !seen.has(current); depth += 1) {
    if (current === ancestor) return true;
    seen.add(current);
    current = await unixParent(current);
  }
  return false;
}

export async function attributeListenerPort(port: number, spawnedPid?: number): Promise<ListenerAttribution> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return { relation: "UNAVAILABLE", source: "invalid port", detail: "Listener attribution was not attempted for an invalid port." };
  let pid: number | undefined;
  let source = "";
  let noOwnerDetail: string | undefined;
  try {
    if (process.platform === "linux") { pid = await linuxListenerPid(port); source = "/proc/net/tcp + /proc/<pid>/fd"; }
    else if (process.platform === "win32") { const probe = await windowsListenerProbe(port); pid = probe.pid; source = probe.source; noOwnerDetail = probe.detail; }
    else { pid = await unixListenerPid(port); source = "lsof"; }
  } catch (error) {
    return { relation: "UNAVAILABLE", source: source || process.platform, detail: `Listener attribution failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!pid) return { relation: "UNAVAILABLE", source: source || process.platform, detail: noOwnerDetail || `No owning PID could be attributed to loopback listener ${port} with the available OS evidence.` };
  if (!spawnedPid) return { pid, relation: "EXTERNAL_PROCESS", source, detail: `OS evidence attributes listener ${port} to PID ${pid}; no KForge spawned PID was available for ancestry comparison.` };
  if (pid === spawnedPid) return { pid, relation: "SPAWNED_PROCESS", source, detail: `OS evidence attributes listener ${port} directly to KForge-spawned PID ${pid}.` };
  let descendant = false;
  try {
    descendant = process.platform === "linux" ? await linuxDescendant(pid, spawnedPid) : process.platform === "win32" ? await windowsDescendant(pid, spawnedPid) : await unixDescendant(pid, spawnedPid);
  } catch {
    descendant = false;
  }
  return descendant
    ? { pid, relation: "DESCENDANT_PROCESS", source, detail: `OS evidence attributes listener ${port} to descendant PID ${pid} of KForge-spawned PID ${spawnedPid}.` }
    : { pid, relation: "EXTERNAL_PROCESS", source, detail: `OS evidence attributes listener ${port} to PID ${pid}, which is not in the proven process ancestry of KForge-spawned PID ${spawnedPid}.` };
}

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
    child.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); if (stdout.length > 250_000) stdout = stdout.slice(-250_000); });
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

async function windowsListenerPid(port: number) {
  const script = `$p=Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if($p){[Console]::Write($p)}`;
  const result = await runCapture("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 5_000);
  const pid = Number(result.stdout.trim());
  return result.code === 0 && Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

async function windowsDescendant(pid: number, ancestor: number) {
  const script = `$p=${pid};$a=${ancestor};$seen=@{};for($i=0;$i -lt 64 -and $p -gt 0;$i++){if($p -eq $a){[Console]::Write('YES');exit 0};if($seen.ContainsKey($p)){break};$seen[$p]=1;$o=Get-CimInstance Win32_Process -Filter \"ProcessId=$p\" -ErrorAction SilentlyContinue;$p=if($o){[int]$o.ParentProcessId}else{0}}`;
  const result = await runCapture("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 8_000);
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
  try {
    if (process.platform === "linux") { pid = await linuxListenerPid(port); source = "/proc/net/tcp + /proc/<pid>/fd"; }
    else if (process.platform === "win32") { pid = await windowsListenerPid(port); source = "Get-NetTCPConnection"; }
    else { pid = await unixListenerPid(port); source = "lsof"; }
  } catch (error) {
    return { relation: "UNAVAILABLE", source: source || process.platform, detail: `Listener attribution failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!pid) return { relation: "UNAVAILABLE", source: source || process.platform, detail: `No owning PID could be attributed to loopback listener ${port} with the available OS evidence.` };
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

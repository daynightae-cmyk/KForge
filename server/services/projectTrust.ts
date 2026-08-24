import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

export type ProjectTrust = "trusted" | "untrusted";

interface TrustSettings {
  projects?: Record<string, ProjectTrust>;
}

function trustPath(workspaceRoot: string) {
  return path.join(workspaceRoot, ".kforge", "project-trust.json");
}

async function readTrustSettings(workspaceRoot: string): Promise<TrustSettings> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(trustPath(workspaceRoot), "utf8"));
    return typeof raw === "object" && raw !== null ? raw as TrustSettings : {};
  } catch {
    return {};
  }
}

export async function getProjectTrust(workspaceRoot: string, projectPath: string): Promise<ProjectTrust> {
  const settings = await readTrustSettings(workspaceRoot);
  return settings.projects?.[path.resolve(projectPath)] === "trusted" ? "trusted" : "untrusted";
}

export async function setProjectTrust(workspaceRoot: string, projectPath: string, trust: ProjectTrust) {
  const settings = await readTrustSettings(workspaceRoot);
  settings.projects = { ...(settings.projects || {}), [path.resolve(projectPath)]: trust };
  const destination = trustPath(workspaceRoot);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
  return trust;
}

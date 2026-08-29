export * from "./marketplaceCore";

import type { ProjectProfile, ProjectSummary } from "../../shared/workspace";
import { getProjectMarketplace as getProjectMarketplaceCore } from "./marketplaceCore";

type CompatibilityState = "COMPATIBLE" | "INCOMPATIBLE" | "UNKNOWN";
type LifecycleState = "VERIFIED" | "READY" | "REQUIRED" | "BLOCKED" | "NOT_CONFIGURED" | "NOT_AVAILABLE" | "NOT_APPLICABLE";

function projectCommand(profile: ProjectProfile, tool: string) {
  if (tool === "typecheck") return profile.commands.typecheck;
  if (tool === "test") return profile.commands.test;
  if (tool === "build") return profile.commands.build;
  if (tool === "start" || tool === "health") return profile.commands.runtime || profile.commands.production || profile.commands.dev;
  return undefined;
}

function correctedCompatibility(item: Awaited<ReturnType<typeof getProjectMarketplaceCore>>["items"][number], project: ProjectSummary, profile: ProjectProfile) {
  const tool = item.id.startsWith("tool:kforge:") ? item.id.slice("tool:kforge:".length) : "";
  if (!tool) return item.projectCompatibility;

  const commandBound = ["typecheck", "test", "build", "start", "health"].includes(tool);
  const requiredCommand = projectCommand(profile, tool);
  const operational = item.enabled === true && item.availability === "AVAILABLE";
  const state: CompatibilityState = !operational ? "INCOMPATIBLE" : commandBound ? requiredCommand ? "COMPATIBLE" : "INCOMPATIBLE" : "COMPATIBLE";
  const evidence = !operational
    ? [item.unavailableReason || `The project-aware ${tool} tool is not executable under the current handler, trust, permission, and runtime evidence.`]
    : commandBound
      ? requiredCommand
        ? [`Detected command: ${requiredCommand}`, `Project profile: ${profile.framework.join(", ") || project.projectType}`]
        : [`No verified ${tool} command is present in project command evidence.`]
      : [`The built-in ${tool} tool is executable through its registered typed adapter.`, `Project profile: ${profile.framework.join(", ") || project.projectType}`];
  const installed = item.installed === true && item.installationState?.state === "VERIFIED";
  const compatibilityState: LifecycleState = state === "COMPATIBLE" ? "VERIFIED" : "BLOCKED";
  const flow = [
    { stage: "agent-gap" as const, state: state === "COMPATIBLE" ? "NOT_APPLICABLE" as const : compatibilityState, evidence: state === "COMPATIBLE" ? "No missing capability is inferred; the registered project-aware tool already satisfies the requirement." : evidence[0] },
    { stage: "marketplace" as const, state: "VERIFIED" as const, evidence: "The item came from the normalized Marketplace contract." },
    { stage: "inspect" as const, state: "VERIFIED" as const, evidence: "Full item authority, permission, trust and runtime evidence is available for inspection." },
    { stage: "compatibility" as const, state: compatibilityState, evidence: evidence.join(" ") },
    { stage: "permissions" as const, state: "VERIFIED" as const, evidence: "Permission classes remain exposed before execution or installation." },
    { stage: "trust" as const, state: item.trust === "TRUSTED" ? "VERIFIED" as const : "REQUIRED" as const, evidence: item.trust },
    { stage: "install" as const, state: installed ? "VERIFIED" as const : item.installAction === "INSTALL_REQUIRES_CONFIRMATION" ? "READY" as const : "NOT_CONFIGURED" as const, evidence: installed ? item.installationState?.source || "Canonical installed evidence" : "No installed state is inferred." },
    { stage: "verify" as const, state: installed && state === "COMPATIBLE" ? "VERIFIED" as const : "BLOCKED" as const, evidence: installed && state === "COMPATIBLE" ? "Canonical local registration and project compatibility both passed." : "Verification requires compatible executable and lifecycle evidence." },
    { stage: "return-to-agent" as const, state: installed && state === "COMPATIBLE" ? "READY" as const : "BLOCKED" as const, evidence: installed && state === "COMPATIBLE" ? "The verified result can return to the originating Agent/Task." : "No success is returned while compatibility or lifecycle evidence is blocked." },
  ];
  return { state, evidence, source: "KForge Agent capability analysis" as const, flow };
}

export async function getProjectMarketplace(workspaceRoot: string, onlineOptional: boolean, project: ProjectSummary, profile: ProjectProfile) {
  const result = await getProjectMarketplaceCore(workspaceRoot, onlineOptional, project, profile);
  const items = result.items.map((item) => ({ ...item, projectCompatibility: correctedCompatibility(item, project, profile) }));
  const recommendations = items
    .filter((item) => item.projectCompatibility?.state === "COMPATIBLE")
    .map((item) => ({ itemId: item.id, name: item.name, state: "COMPATIBLE" as const, evidence: item.projectCompatibility!.evidence, installed: item.installed, returnToAgent: item.projectCompatibility!.flow.at(-1)?.state || "BLOCKED" }));
  return { ...result, items, recommendations };
}

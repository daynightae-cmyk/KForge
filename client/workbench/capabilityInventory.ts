import type { KForgeActivity } from "@shared/workspace";
import {
  ACTIVITY_PURPOSE,
  WORKBENCH_SERVICES,
  type ServiceContext,
  type WorkbenchService,
} from "./serviceDirectory";

/**
 * The capability inventory is a projection of the canonical service directory.
 *
 * It exists so an operator can see every reachable destination and the contract
 * that owns it in one place. It is deliberately a *contract* inventory: it
 * describes what KForge has registered, never what the current machine can run.
 * Runtime availability is derived separately from evidence in
 * `serviceAvailability.ts` and the individual surface.
 */

export type CapabilityEntry = Pick<
  WorkbenchService,
  | "activity"
  | "activityLabel"
  | "id"
  | "label"
  | "group"
  | "description"
  | "capability"
  | "context"
  | "primaryAction"
  | "handler"
  | "api"
  | "target"
  | "icon"
> & {
  domainPurpose: string;
};

export const CAPABILITY_ENTRIES: CapabilityEntry[] = WORKBENCH_SERVICES.map((service) => ({
  activity: service.activity,
  activityLabel: service.activityLabel,
  id: service.id,
  label: service.label,
  group: service.group,
  description: service.description,
  capability: service.capability,
  context: service.context,
  primaryAction: service.primaryAction,
  handler: service.handler,
  api: service.api,
  target: service.target,
  icon: service.icon,
  domainPurpose: ACTIVITY_PURPOSE[service.activity],
}));

export type CapabilityFilter = {
  query?: string;
  activity?: KForgeActivity | "all";
  context?: ServiceContext | "all";
};

export function filterCapabilities(entries: CapabilityEntry[], filter: CapabilityFilter = {}): CapabilityEntry[] {
  const terms = String(filter.query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (filter.activity && filter.activity !== "all" && entry.activity !== filter.activity) return false;
    if (filter.context && filter.context !== "all" && entry.context !== filter.context) return false;
    if (!terms.length) return true;
    const haystack = [
      entry.activityLabel,
      entry.label,
      entry.group,
      entry.description,
      entry.capability,
      entry.primaryAction,
      entry.handler,
      entry.api,
      entry.target,
      entry.domainPurpose,
    ].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export type CapabilitySummary = {
  domains: number;
  destinations: number;
  projectScoped: number;
  global: number;
  optional: number;
  projectScopedDomains: number;
};

export function summarizeCapabilities(entries: CapabilityEntry[]): CapabilitySummary {
  const domains = new Set(entries.map((entry) => entry.activity));
  return {
    domains: domains.size,
    destinations: entries.length,
    projectScoped: entries.filter((entry) => entry.context === "project").length,
    global: entries.filter((entry) => entry.context === "global").length,
    optional: entries.filter((entry) => entry.context === "optional").length,
    projectScopedDomains: new Set(
      entries.filter((entry) => entry.context === "project").map((entry) => entry.activity),
    ).size,
  };
}

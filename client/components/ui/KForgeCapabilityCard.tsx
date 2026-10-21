import React, { useMemo } from "react";
import { Zap, Wrench, Package, Plug, Cloud } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MarketplaceItem, InspectorAction } from "../../workbench/surfaceContracts";
import { KForgeServiceCard, type ServiceCardAction, type ServiceCardState } from "./KForgeServiceCard";

export type CapabilityCardProps = {
  item: MarketplaceItem;
  selected?: boolean;
  onSelect?: () => void;
  actions?: InspectorAction[];
  actionsDisabled?: boolean;
  className?: string;
};

const CategoryIcon: React.FC<{ category?: string }> = ({ category }) => {
  const c = (category || "").toLowerCase();
  if (c.includes("agent")) return <Zap size={18} />;
  if (c.includes("model")) return <Cloud size={18} />;
  if (c.includes("tool")) return <Wrench size={18} />;
  if (c.includes("extension")) return <Plug size={18} />;
  return <Package size={18} />;
};

const trustLabel = (item: MarketplaceItem) => {
  if (item.trust === "TRUSTED") return "TRUSTED";
  if (item.trust === "UNTRUSTED") return "UNTRUSTED";
  if (item.trust === "PARTIALLY_TRUSTED") return "PARTIALLY_TRUSTED";
  return item.trust || "NOT_EVALUATED";
};

/**
 * "Installed" is the affirmative install state of a catalog item, so it may
 * only appear on a card that really is installed. Any other phrasing that
 * would read as an install claim is replaced with a neutral one.
 */
const withoutInstallClaim = (value: string | undefined, fallback: string) =>
  value && !/installed/i.test(value) ? value : fallback;

/**
 * The catalog item skin of the canonical KForge service card.
 *
 * An Online catalog item is a service with evidence attached, so it renders
 * through the same card contract as every other KForge capability. The
 * marketplace truth is never flattened: trust, compatibility, integrity and
 * the real availability value stay visible, and an action only appears when a
 * verified adapter enables it.
 */
export const KForgeCapabilityCard: React.FC<CapabilityCardProps> = ({
  item,
  selected,
  onSelect,
  actions,
  actionsDisabled,
  className,
}) => {
  const installed = item.installed === true;
  const updateAvailable = item.updateState?.state === "VERIFIED" && /^UPDATE_AVAILABLE\b/i.test(item.updateState.value || "");

  // Premium concise subset: only enabled actionable items are surfaced on the card.
  // Disabled policy remains in inspector matrix; card stays uncluttered.
  const visibleActions = useMemo(() => {
    if (!actions?.length) return [];
    const enabled = actions.filter((a) => !a.disabled && typeof a.invoke === "function");
    // Keep premium uncluttered: at most 4 primary actions on card
    // Priority: install (when not installed), then health/run/update, then manage, then uninstall
    const order: Record<string, number> = { install: 0, health: 1, run: 2, update: 3, manage: 4, uninstall: 5 };
    return enabled.sort((a, b) => (order[a.id] ?? 99) - (order[b.id] ?? 99));
  }, [actions]);

  const actionCards: ServiceCardAction[] = visibleActions.map((action) => ({
    id: action.id,
    label: action.id === "install" ? "Install" : action.id === "manage" ? "Manage" : action.label,
    disabled: Boolean(actionsDisabled),
    onInvoke: () => action.invoke?.(),
    dataAttributes: { "data-item-id": item.id },
  }));

  const availability = (item.availability || "UNKNOWN").toUpperCase();
  const neutralDetail = availability === "NOT_INSTALLED"
    ? "This local package has not been added to this machine yet."
    : `Catalog availability reported by the marketplace service: ${availability}.`;
  const state: ServiceCardState = installed
    ? { state: "INSTALLED", label: "Installed", detail: `Present in the local workspace${item.version ? ` at version ${item.version}` : ""}.` }
    : updateAvailable
      ? { state: "UPDATE_AVAILABLE", label: "Update", detail: `A verified update is available${item.version ? ` for version ${item.version}` : ""}.` }
      : {
        state: availability,
        label: availability === "NOT_INSTALLED" ? "Installable" : undefined,
        detail: withoutInstallClaim(item.unavailableReason, neutralDetail),
      };

  return (
    <KForgeServiceCard
      skin="catalog"
      className={cn("kw-capability-card", className)}
      title={item.name}
      category={`${item.category} · ${item.source || item.authority?.kind || "Unknown source"} · v${item.version || "version UNKNOWN"}`}
      icon={<CategoryIcon category={item.category} />}
      description={item.description || item.overview || "No description supplied."}
      capability={item.overview && item.overview !== item.description ? item.overview : undefined}
      state={state}
      facts={[
        { label: "Trust", value: trustLabel(item) },
        { label: "Compatibility", value: item.projectCompatibility?.state || "NOT_EVALUATED" },
        { label: "Integrity", value: item.integrity?.state || "UNKNOWN" },
      ]}
      primaryAction={actionCards[0]}
      secondaryActions={actionCards.slice(1)}
      selected={selected}
      onSelect={onSelect}
      dataAttributes={{ "data-item-id": item.id }}
    />
  );
};

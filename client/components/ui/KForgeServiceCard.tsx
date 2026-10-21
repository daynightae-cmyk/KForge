import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import "./serviceCard.css";

/**
 * The single KForge card contract.
 *
 * Every user-facing capability is presented through this component, whether it
 * is a workbench service or an Online catalog item. The card never invents a
 * state: `state.detail` always carries the evidence behind the badge, and an
 * action is only rendered when a real handler exists for it.
 */

export type ServiceCardState = {
  /** Semantic availability, e.g. READY, NEEDS_SETUP, OFFLINE, RUNNING. */
  state: string;
  /** The label shown on the badge when the raw state is not user-facing. */
  label?: string;
  /** The truthful reason behind the state. */
  detail: string;
  /** The prerequisite the user still has to satisfy, when there is one. */
  prerequisite?: string;
};

export type ServiceCardAction = {
  id: string;
  label: string;
  onInvoke: () => void;
  disabled?: boolean;
  primary?: boolean;
  dataAttributes?: Record<string, string | undefined>;
};

export type ServiceCardFact = { label: string; value: string };

export type KForgeServiceCardProps = {
  /** A. Service identity. */
  title: string;
  category: string;
  icon: ReactNode;
  /** B. What the service does. */
  description: string;
  /** C. The user outcome the service delivers. */
  capability?: string;
  /** D. Real availability. */
  state?: ServiceCardState;
  /** Extra evidence values such as trust, compatibility or integrity. */
  facts?: ServiceCardFact[];
  /** E. The one action that best represents the service. */
  primaryAction?: ServiceCardAction;
  /** F. Supporting actions that are genuinely available. */
  secondaryActions?: ServiceCardAction[];
  /** G. Real feedback or result of the last operation. */
  result?: { label: string; detail: string } | null;
  /** H. Context the user needs before the service can do anything. */
  context?: string;
  /** Visual skin. The layout contract is identical for both. */
  skin?: "service" | "catalog";
  className?: string;
  selected?: boolean;
  onSelect?: () => void;
  ariaLabel?: string;
  dataAttributes?: Record<string, string | undefined>;
};

export function KForgeServiceCard({
  title,
  category,
  icon,
  description,
  capability,
  state,
  facts,
  primaryAction,
  secondaryActions,
  result,
  context,
  skin = "service",
  className,
  selected,
  onSelect,
  ariaLabel,
  dataAttributes,
}: KForgeServiceCardProps) {
  const interactive = Boolean(onSelect);
  return (
    <article
      role="article"
      tabIndex={interactive ? 0 : undefined}
      aria-label={ariaLabel || `${title}, ${category}`}
      data-selected={selected === undefined ? undefined : selected ? "true" : "false"}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (!interactive) return;
        if ((event.key === "Enter" || event.key === " ") && event.currentTarget === event.target) {
          event.preventDefault();
          onSelect?.();
        }
      }}
      {...dataAttributes}
      className={cn("kw-service-card", `kw-service-card--${skin}`, selected && "is-selected", className)}
    >
      <header className="kw-service-card__header kw-card-header">
        <span className="kw-service-card__icon" aria-hidden="true">{icon}</span>
        <div className="kw-service-card__identity">
          <h2 className="kw-service-card__title">{title}</h2>
          <p className="kw-service-card__category">{category}</p>
        </div>
        {state ? (
          <div className="kw-service-card__state">
            <span className={`kw-badge kw-service-card__badge kw-service-card__badge--${state.state.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{state.label || state.state.replace(/_/g, " ")}</span>
          </div>
        ) : null}
      </header>

      <p className="kw-service-card__description kw-card-desc">{description}</p>
      {capability ? <p className="kw-service-card__capability">{capability}</p> : null}

      {facts?.length ? (
        <div className="kw-service-card__facts kw-card-evidence">
          {facts.map((fact) => <span key={fact.label}><em>{fact.label}</em> {fact.value}</span>)}
        </div>
      ) : null}

      {state?.detail ? <p className="kw-service-card__evidence">{state.detail}</p> : null}

      {primaryAction || secondaryActions?.length ? (
        <div className="kw-service-card__actions kw-card-actions">
          {primaryAction ? (
            <button
              type="button"
              className="kw-service-card__action kw-action-primary"
              data-action-id={primaryAction.id}
              aria-label={primaryAction.label}
              disabled={primaryAction.disabled}
              onClick={(event) => { event.stopPropagation(); primaryAction.onInvoke(); }}
              {...primaryAction.dataAttributes}
            >
              {primaryAction.label}
            </button>
          ) : null}
          {secondaryActions?.map((action) => (
            <button
              key={action.id}
              type="button"
              className="kw-service-card__action"
              data-action-id={action.id}
              aria-label={action.label}
              disabled={action.disabled}
              onClick={(event) => { event.stopPropagation(); action.onInvoke(); }}
              {...action.dataAttributes}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : <p className="kw-service-card__context">No actions are available for this item right now.</p>}

      {result ? (
        <div className="kw-service-card__result" role="status">
          <strong>{result.label}</strong>
          <span>{result.detail}</span>
        </div>
      ) : null}

      {context || state?.prerequisite ? (
        <p className="kw-service-card__context">{context || state?.prerequisite}</p>
      ) : null}
    </article>
  );
}

export default KForgeServiceCard;

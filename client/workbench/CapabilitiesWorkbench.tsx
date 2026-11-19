import { useMemo, useState } from "react";
import { ChevronRight, Filter, Search, ShieldCheck } from "lucide-react";
import type { KForgeActivity } from "@shared/workspace";
import type { SurfaceProps } from "./surfaceContracts";
import { ACTIVITIES } from "./navigation";
import type { ServiceContext } from "./serviceDirectory";
import { StatusBadge } from "./ui";
import { CAPABILITY_ENTRIES, filterCapabilities, summarizeCapabilities } from "./capabilityInventory";
import "./capabilitiesWorkbench.css";

/**
 * Capabilities is the readable projection of the registrar. A card here proves
 * that a destination and a contract are registered; it does not prove that the
 * current machine, project, trust decision or network policy allow the action.
 */
function CapabilitiesWorkbench({ onNavigate }: SurfaceProps) {
  const [query, setQuery] = useState("");
  const [activity, setActivity] = useState<string>("all");
  const [context, setContext] = useState<string>("all");
  const summary = useMemo(() => summarizeCapabilities(CAPABILITY_ENTRIES), []);
  const entries = useMemo(
    () => filterCapabilities(CAPABILITY_ENTRIES, {
      query,
      activity: activity as KForgeActivity | "all",
      context: context as ServiceContext | "all",
    }),
    [query, activity, context],
  );

  return (
    <section className="kw-capabilities" aria-label="KForge capability inventory">
      <header className="kw-capabilities__hero">
        <div>
          <small>CAPABILITY INVENTORY</small>
          <h2>Every registered destination, one honest contract.</h2>
          <p>
            This inventory is generated from the canonical navigation and service directory. It shows the domain,
            section, primary action, handler and API contract behind each destination. Opening a card deep-links
            into the workbench that owns it; runtime availability is evaluated there from real evidence.
          </p>
        </div>
        <div className="kw-capabilities__stats" aria-label="Inventory summary">
          <span><strong>{summary.destinations}</strong><small>destinations</small></span>
          <span><strong>{summary.domains}</strong><small>domains</small></span>
          <span><strong>{summary.projectScoped}</strong><small>project-scoped</small></span>
          <span><strong>{summary.projectScopedDomains}</strong><small>domains with project gates</small></span>
        </div>
      </header>

      <p className="kw-capabilities__truth">
        <ShieldCheck size={14} aria-hidden="true" />
        Contract inventory, not a readiness claim. A registered API says the server exposes the route; it does not
        say a provider is configured, a project is trusted or a remote service is reachable.
      </p>

      <div className="kw-capabilities__filters">
        <label className="kw-capabilities__search">
          <Search size={14} aria-hidden="true" />
          <input
            aria-label="Search capabilities"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by label, intent, handler or API contract…"
          />
        </label>
        <label>
          <Filter size={13} aria-hidden="true" />
          <span className="sr-only">Filter by domain</span>
          <select aria-label="Filter capabilities by domain" value={activity} onChange={(event) => setActivity(event.target.value)}>
            <option value="all">All domains</option>
            {ACTIVITIES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </label>
        <label>
          <Filter size={13} aria-hidden="true" />
          <span className="sr-only">Filter by context</span>
          <select aria-label="Filter capabilities by context" value={context} onChange={(event) => setContext(event.target.value)}>
            <option value="all">All contexts</option>
            <option value="global">Global</option>
            <option value="project">Project required</option>
            <option value="optional">Optional context</option>
          </select>
        </label>
        <span className="kw-capabilities__count" role="status" aria-live="polite">{entries.length} destination(s)</span>
      </div>

      {entries.length ? (
        <ul className="kw-capabilities__list">
          {entries.map((entry) => {
            const Icon = entry.icon;
            return (
              <li key={entry.target}>
                <button
                  type="button"
                  className="kw-capabilities__row"
                  aria-label={`Open ${entry.label} in ${entry.activityLabel}`}
                  onClick={() => onNavigate(entry.activity, entry.id)}
                >
                  <span className="kw-capabilities__icon" aria-hidden="true"><Icon size={16} /></span>
                  <span className="kw-capabilities__body">
                    <span className="kw-capabilities__row-head">
                      <strong>{entry.label}</strong>
                      <StatusBadge value={entry.context} />
                      {entry.group ? <small>{entry.group}</small> : null}
                    </span>
                    <span className="kw-capabilities__domain">{entry.activityLabel} · {entry.target}</span>
                    <span className="kw-capabilities__description">{entry.description}</span>
                    <span className="kw-capabilities__capability">{entry.capability}</span>
                    <span className="kw-capabilities__contract">
                      <code>{entry.api}</code>
                      <span>{entry.primaryAction} · {entry.handler}</span>
                    </span>
                  </span>
                  <ChevronRight size={15} aria-hidden="true" className="kw-capabilities__chevron" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <section className="kw-empty" aria-label="No capabilities match">
          <h2>No destination matches those filters</h2>
          <p>Clear the search or choose another domain. The inventory never invents a destination to fill the list.</p>
          <button type="button" onClick={() => { setQuery(""); setActivity("all"); setContext("all"); }}>Clear filters</button>
        </section>
      )}

      <footer className="kw-capabilities__footer">
        <ShieldCheck size={15} aria-hidden="true" />
        <p>
          The inventory is read from <code>client/workbench/serviceDirectory.ts</code> at build time. Unit tests
          fail if a destination loses its purpose, context, handler or registered API contract.
        </p>
      </footer>
    </section>
  );
}

export default CapabilitiesWorkbench;

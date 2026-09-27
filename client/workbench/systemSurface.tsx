import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RotateCcw, Save, ShieldCheck } from "lucide-react";
import type { SurfaceProps } from "./surfaceContracts";
import {
  KFORGE_SETTINGS_DOMAIN_HANDLING,
  type KForgePlatformSettings,
  type KForgeActivity,
  type KForgeOnlineView,
} from "@shared/workspace";
import { fetchJson } from "./api";
import { EmptyState, StatusBadge } from "./ui";
import { viewLabel, ACTIVITIES, activityDefinition } from "./navigation";
import SystemStorageCenter from "./SystemStorageCenter";
import { ProjectRequired } from "./ProjectStartActions";

function SystemSurface(props: SurfaceProps) {
  const { view, project, settings, onSettings } = props;
  if (view === "settings") return settings ? <SettingsSurface settings={settings} onSettings={onSettings} /> : <p className="kw-message">Settings unavailable.</p>;
  if (!project) return <ProjectRequired detail={`${viewLabel("system", view)} needs project context.`} />;
  if (view === "storage") return <SystemStorageCenter project={project} />;
  return <EmptyState title="Specialized system surface unavailable" detail={`${viewLabel("system", view)} must be routed through its dedicated System surface. KForge does not fall back to a duplicate generic implementation.`} />;
}
const GROUPS: Array<{ name: string; domains: string[] }> = [
  { name: "APPLICATION", domains: ["General", "Appearance", "Notifications", "Keyboard Shortcuts"] },
  { name: "WORKSPACE", domains: ["Workspace", "Projects", "Git", "GitHub"] },
  { name: "DEVELOPER", domains: ["Preview", "Tasks", "Diagnostics"] },
  { name: "AI", domains: ["AI", "Providers", "Models", "Agents"] },
  { name: "ONLINE", domains: ["Marketplace", "Online / Offline", "Updates"] },
  { name: "SYSTEM", domains: ["Privacy", "Security", "Permissions", "Trust", "Storage", "Cache"] },
];

function SettingsSurface({ settings, onSettings }: { settings: KForgePlatformSettings; onSettings: (settings: KForgePlatformSettings) => void }) {
  const [draft, setDraft] = useState(settings);
  const [message, setMessage] = useState("");
  useEffect(() => setDraft(settings), [settings]);

  const domains = useMemo(() => new Map(KFORGE_SETTINGS_DOMAIN_HANDLING.map(([name, state, detail]) => [name, { state, detail }])), []);

  const save = async () => {
    try {
      const data = await fetchJson<{ settings: KForgePlatformSettings }>("/api/workspace/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: 3,
          general: draft.general,
          appearance: draft.appearance,
          preview: draft.preview,
          privacy: { remoteContextPolicy: draft.privacy.remoteContextPolicy },
          git: {},
        }),
      });
      onSettings(data.settings);
      setDraft(data.settings);
      setMessage("Settings v3 saved locally.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Settings save failed.");
    }
  };

  const reset = async () => {
    if (!window.confirm("Reset KForge local platform settings to verified defaults?")) return;
    try {
      const data = await fetchJson<{ settings: KForgePlatformSettings }>("/api/workspace/settings/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }) });
      onSettings(data.settings);
      setDraft(data.settings);
      setMessage("Verified local defaults restored.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Settings reset failed.");
    }
  };

  const jump = (target: string) => window.dispatchEvent(new CustomEvent("kforge:navigate", { detail: { target } }));

  return <section className="kw-settings kw-settings-v4" aria-label="KForge settings">
    <header className="kw-settings-v4__header">
      <div><small>LOCAL PRODUCT CONFIGURATION</small><h2>Local preferences</h2><p>Only controls backed by persisted KForge state are editable here.</p></div>
      <div><button onClick={() => void reset()}><RotateCcw size={14} />Reset</button><button className="is-primary" onClick={() => void save()}><Save size={14} />Save settings</button></div>
    </header>
    <div className="kw-settings-v4__layout">
      <nav className="kw-settings-v4__index" aria-label="Settings domains">
        {GROUPS.map((group) => <a key={group.name} href={`#settings-${group.name.toLowerCase()}`}>{group.name}</a>)}
      </nav>

      <div className="kw-settings-v4__content">
        <SettingsGroup title="APPLICATION">
          <SettingsCard title="General" state="EDITABLE_REAL">
            <label>Startup activity<select aria-label="Startup activity" value={draft.general.startupActivity} onChange={(event) => setDraft({ ...draft, general: { ...draft.general, startupActivity: event.target.value as KForgeActivity } })}>{ACTIVITIES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
            <label>Startup Online view<select aria-label="Startup Online view" value={draft.general.startupOnlineView} onChange={(event) => setDraft({ ...draft, general: { ...draft.general, startupOnlineView: event.target.value as KForgeOnlineView } })}>{activityDefinition("online").views.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
          </SettingsCard>
          <SettingsCard title="Appearance" state="EDITABLE_REAL">
            <label>Theme<select aria-label="Theme" value={draft.appearance.theme} onChange={(event) => setDraft({ ...draft, appearance: { ...draft.appearance, theme: event.target.value as "light" | "dark" | "system" } })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
            <label>Information density<select aria-label="Information density" value={draft.appearance.density} onChange={(event) => setDraft({ ...draft, appearance: { ...draft.appearance, density: event.target.value as "compact" | "comfortable" } })}><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></label>
            <label className="kw-checkbox"><input aria-label="Reduce motion" type="checkbox" checked={draft.appearance.reducedMotion} onChange={(event) => setDraft({ ...draft, appearance: { ...draft.appearance, reducedMotion: event.target.checked } })}           />Reduce motion</label>
          </SettingsCard>
          <SettingsDomainRow name="Notifications" domains={domains} />
          <SettingsDomainRow name="Keyboard Shortcuts" domains={domains} />
        </SettingsGroup>

        <SettingsGroup title="DEVELOPER">
          <SettingsCard title="Preview" state="EDITABLE_REAL">
            <label className="kw-checkbox"><input aria-label="Automatic Preview health checks" type="checkbox" checked={draft.preview.autoHealthCheck} onChange={(event) => setDraft({ ...draft, preview: { ...draft.preview, autoHealthCheck: event.target.checked } })} />Automatic local health checks</label>
            <label>Health interval<select aria-label="Preview health interval" value={draft.preview.healthIntervalMs} onChange={(event) => setDraft({ ...draft, preview: { ...draft.preview, healthIntervalMs: Number(event.target.value) as KForgePlatformSettings["preview"]["healthIntervalMs"] } })}><option value={3000}>3 seconds</option><option value={5000}>5 seconds</option><option value={10000}>10 seconds</option><option value={30000}>30 seconds</option></select></label>
          </SettingsCard>
          <SettingsDomainRow name="Tasks" domains={domains} target="Tasks" onJump={jump} />
          <SettingsDomainRow name="Diagnostics" domains={domains} target="System Diagnostics" onJump={jump} />
        </SettingsGroup>

        <SettingsGroup title="SYSTEM">
          <SettingsCard title="Privacy" state="EDITABLE_REAL">
            <label>Remote context policy<select aria-label="Remote context policy" value={draft.privacy.remoteContextPolicy} onChange={(event) => setDraft({ ...draft, privacy: { ...draft.privacy, remoteContextPolicy: event.target.value as "blocked" | "ask" } })}><option value="ask">Ask before remote context</option><option value="blocked">Blocked</option></select></label>
            <div className="kw-security-invariants"><ShieldCheck size={18} /><div><strong>Enforced invariants</strong><span>secretRedaction = true · confirmRemoteWrites = true · Git mutation remains confirmation-gated</span></div></div>
          </SettingsCard>
          {["Security", "Permissions", "Trust", "Storage", "Cache"].map((name) => {
            const target = name === "Cache" ? "Storage" : ["Permissions", "Trust", "Storage"].includes(name) ? name : undefined;
            return <SettingsDomainRow key={name} name={name} domains={domains} target={target} onJump={jump} />;
          })}
        </SettingsGroup>
        {["WORKSPACE", "AI", "ONLINE"].map((groupName) => {
          const group = GROUPS.find((entry) => entry.name === groupName)!;
          const targets: Record<string, string | undefined> = {
            Workspace: "Workspace", Projects: "Workspace", Git: "Git", GitHub: "GitHub",
            Providers: "Providers", Models: "Models", Agents: "Agents", Marketplace: "Marketplace",
            "Online / Offline": "Online / Offline", Updates: "Updates",
          };
          return <SettingsGroup key={group.name} title={group.name}>{group.domains.map((name) => <SettingsDomainRow key={name} name={name} domains={domains} target={targets[name]} onJump={jump} />)}</SettingsGroup>;
        })}
      </div>
    </div>
    {message ? <p className="kw-message" role="status">{message}</p> : null}
  </section>;
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section id={`settings-${title.toLowerCase()}`} className="kw-settings-v4__group"><h3>{title}</h3><div>{children}</div></section>;
}

function SettingsCard({ title, state, children }: { title: string; state: string; children: ReactNode }) {
  return <article className="kw-settings-v4__card"><header><strong>{title}</strong><StatusBadge value={state} /></header><div className="kw-settings-grid">{children}</div></article>;
}

function SettingsDomainRow({ name, domains, target, onJump }: { name: string; domains: Map<string, { state: string; detail: string }>; target?: string; onJump?: (target: string) => void }) {
  const domain = domains.get(name);
  if (!domain) return null;
  return <article className="kw-settings-v4__domain"><div><strong>{name}</strong><small>{domain.detail}</small></div><StatusBadge value={domain.state} />{target && onJump && domain.state === "MANAGED_ELSEWHERE" ? <button onClick={() => onJump(target)}>Open</button> : null}</article>;
}

export default SystemSurface;

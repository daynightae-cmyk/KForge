import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { SurfaceProps } from "./surfaceContracts";
import type { KForgePlatformSettings, KForgeActivity, KForgeOnlineView } from "@shared/workspace";
import { fetchJson } from "./api";
import { EmptyState } from "./ui";
import { viewLabel, ACTIVITIES, activityDefinition } from "./navigation";
import { SimpleFetchSurface } from "./surfaceShared";

function SystemSurface(props: SurfaceProps) {
  const { view, project, settings, onSettings } = props;
  if (view === "settings") return settings ? <SettingsSurface settings={settings} onSettings={onSettings} /> : <p className="kw-message">Settings unavailable.</p>;
  if (!project) return <EmptyState title="No project selected" detail={`${viewLabel("system", view)} needs project context.`} />;
  if (view === "storage") return <SimpleFetchSurface url={`/api/workspace/projects/${encodeURIComponent(project.id)}/cache`} title="Storage" />;
  return <EmptyState title="Specialized system surface unavailable" detail={`${viewLabel("system", view)} must be routed through its dedicated System surface. KForge does not fall back to a duplicate generic implementation.`} />;
}

function SettingsSurface({ settings, onSettings }: { settings: KForgePlatformSettings; onSettings: (settings: KForgePlatformSettings) => void }) {
  const [draft, setDraft] = useState(settings);
  const [message, setMessage] = useState("");
  useEffect(() => setDraft(settings), [settings]);
  const save = async () => {
    try {
      const data = await fetchJson<{ settings: KForgePlatformSettings }>("/api/workspace/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 3, general: { startupActivity: draft.general.startupActivity, startupOnlineView: draft.general.startupOnlineView }, appearance: draft.appearance, preview: draft.preview, privacy: { remoteContextPolicy: draft.privacy.remoteContextPolicy }, git: {} }),
      });
      onSettings(data.settings);
      setDraft(data.settings);
      setMessage("Settings v3 saved locally.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Settings save failed.");
    }
  };
  return <section className="kw-settings"><h2>Settings v3</h2><div className="kw-settings-grid"><label>Startup activity<select aria-label="Startup activity" value={draft.general.startupActivity} onChange={(event) => setDraft({ ...draft, general: { ...draft.general, startupActivity: event.target.value as KForgeActivity } })}>{ACTIVITIES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label><label>Startup Online view<select aria-label="Startup Online view" value={draft.general.startupOnlineView} onChange={(event) => setDraft({ ...draft, general: { ...draft.general, startupOnlineView: event.target.value as KForgeOnlineView } })}>{activityDefinition("online").views.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label><label>Theme<select aria-label="Theme" value={draft.appearance.theme} onChange={(event) => setDraft({ ...draft, appearance: { ...draft.appearance, theme: event.target.value as "light" | "dark" | "system" } })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Information density<select aria-label="Information density" value={draft.appearance.density} onChange={(event) => setDraft({ ...draft, appearance: { ...draft.appearance, density: event.target.value as "compact" | "comfortable" } })}><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></label><label className="kw-checkbox"><input aria-label="Reduce motion" type="checkbox" checked={draft.appearance.reducedMotion} onChange={(event) => setDraft({ ...draft, appearance: { ...draft.appearance, reducedMotion: event.target.checked } })} />Reduce motion</label><label>Remote context policy<select aria-label="Remote context policy" value={draft.privacy.remoteContextPolicy} onChange={(event) => setDraft({ ...draft, privacy: { ...draft.privacy, remoteContextPolicy: event.target.value as "blocked" | "ask" } })}><option value="ask">Ask</option><option value="blocked">Blocked</option></select></label></div><div className="kw-security-invariants"><ShieldCheck size={18} /><div><strong>Enforced invariants</strong><span>secretRedaction = true · confirmRemoteWrites = true · Git mutation remains confirmation-gated</span></div></div><button onClick={() => void save()}>Save settings</button>{message && <p className="kw-message" role="status">{message}</p>}</section>;
}

export default SystemSurface;

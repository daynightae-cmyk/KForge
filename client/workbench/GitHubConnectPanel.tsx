import { useState } from "react";
import { Github, ExternalLink, RefreshCw, ShieldCheck, PlugZap, Unplug, LockKeyhole, FolderGit2 } from "lucide-react";

type Connection = KForgeGitHubConnection;
type Installation = KForgeGitHubInstallation;
type Repository = KForgeGitHubRepositories["repositories"][number];
const button = "inline-flex items-center gap-2 rounded-lg border border-violet-400/35 bg-background/70 px-3 py-2 text-xs font-semibold transition-colors hover:border-violet-400/80 hover:bg-violet-500/10 disabled:cursor-not-allowed disabled:opacity-40";

export default function GitHubConnectPanel() {
  const bridge = window.kforgeDesktop;
  const [connection, setConnection] = useState<Connection>({state:"NOT_CHECKED"});
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [selectedInstallation, setSelectedInstallation] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("KForge will contact GitHub only when you explicitly request it.");
  const execute = async (op: () => Promise<void>) => {
    setBusy(true);
    try {await op();}
    catch (error) {setNotice(error instanceof Error ? error.message : "GitHub action failed.");}
    finally {setBusy(false);}
  };
  const check = () => execute(async () => {
    if (!bridge?.githubStatus) return;
    const value = await bridge.githubStatus();
    setConnection(value);
    setNotice(value.message || (value.state === "CONNECTED" ? "GitHub identity verified by the configured Connect service." : "GitHub is not currently connected."));
    if (value.state !== "CONNECTED") {setInstallations([]);setRepos([]);setSelectedInstallation(null);}
  });
  const connect = () => execute(async () => {
    if (!bridge?.githubStart) return;
    const value = await bridge.githubStart();
    setConnection(value);
    setNotice(value.message || "Check the system browser to authorize your account.");
  });
  const disconnect = () => execute(async () => {
    if (!bridge?.githubDisconnect) return;
    const value = await bridge.githubDisconnect();
    setConnection({state:"DISCONNECTED"});
    setInstallations([]);setRepos([]);setSelectedInstallation(null);
    setNotice(value.detail || `Local session cleared. Remote token revocation: ${value.remote_revocation || "UNKNOWN"}.`);
  });
  const readInstallations = () => execute(async () => {
    if (!bridge?.githubInstallations) return;
    const result = await bridge.githubInstallations();
    setInstallations(result.installations || []);
    setRepos([]);
    setNotice("GitHub returned installation access (first page only). Repository access is explicitly scoped by GitHub.");
  });
  const readRepositories = (id: number) => execute(async () => {
    if (!bridge?.githubRepositories) return;
    const result = await bridge.githubRepositories(id);
    setSelectedInstallation(id);
    setRepos(result.repositories || []);
    setNotice(`GitHub returned ${result.repositories.length} repository records for installation ${id}. No local Git operation was performed.`);
  });
  return <section aria-label="Official GitHub App connection" className="mb-4 overflow-hidden rounded-2xl border border-violet-400/30 bg-gradient-to-br from-violet-500/10 via-background/90 to-purple-500/10 p-4 shadow-[0_12px_40px_rgba(68,28,126,0.09)] backdrop-blur-xl">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="rounded-xl border border-violet-400/30 bg-violet-500/10 p-2"><Github className="text-violet-500" size={20}/></div>
        <div>
          <h2 className="text-sm font-bold">KNOuX Forge · Official GitHub Connection</h2>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">Authorize your account through the system browser. Tokens stay on the protected Connect server; the desktop stores only an encrypted pairing capability.</p>
        </div>
      </div>
      <span className="rounded-full border border-violet-400/35 bg-background/70 px-3 py-1 text-[11px] font-semibold">{connection.state}</span>
    </div>
    {connection.account && <div className="mt-3 flex items-center gap-2 rounded-lg border bg-background/50 p-2 text-xs">
      <ShieldCheck size={15} className="text-emerald-500"/>
      <strong>@{connection.account.login}</strong>
      <span className="text-muted-foreground">Verified GitHub account</span>
    </div>}
    <div className="mt-4 flex flex-wrap gap-2">
      <button className={button} disabled={!bridge?.githubStart || busy} onClick={() => void connect()}><PlugZap size={14}/> Connect GitHub</button>
      <button className={button} disabled={!bridge?.githubStatus || busy} onClick={() => void check()}><RefreshCw size={14}/> Check connection</button>
      <button className={button} disabled={!bridge?.githubInstallations || busy || connection.state !== "CONNECTED"} onClick={() => void readInstallations()}><FolderGit2 size={14}/> My installations</button>
      <button className={button} disabled={!bridge?.githubDisconnect || busy || connection.state === "DISCONNECTED" || connection.state === "NOT_CHECKED"} onClick={() => void disconnect()}><Unplug size={14}/> Disconnect</button>
      <a href="https://github.com/apps/knoux-forge-desktop/installations/new" target="_blank" rel="noreferrer" className={button}><ExternalLink size={14}/> Install GitHub App</a>
    </div>
    <p role="status" className="mt-3 rounded-lg border border-violet-400/20 bg-background/60 px-3 py-2 text-xs text-muted-foreground">{!bridge?.githubStart ? "Desktop Electron runtime required; browser-hosted preview cannot start GitHub authorization." : notice}</p>
    {installations.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{installations.map(i => <button key={i.id} className={button} disabled={busy} onClick={() => void readRepositories(i.id)}>{i.account || "Organization"} · {i.repository_selection} · #{i.id}</button>)}</div>}
    {selectedInstallation !== null && <div className="mt-3 grid gap-2 md:grid-cols-2">
      {repos.length ? repos.map(r=><div key={r.id} className="rounded-xl border bg-background/65 p-3 text-xs">
        <div className="flex items-center justify-between gap-2"><strong className="truncate">{r.full_name}</strong><span className="text-muted-foreground">{r.private?"Private":"Public"}</span></div>
        <div className="mt-2 flex justify-between text-muted-foreground"><span>Default branch: {r.default_branch}</span><a target="_blank" rel="noreferrer" href={r.html_url} className="underline underline-offset-2">View on GitHub</a></div>
      </div>) : <p className="text-xs text-muted-foreground">No accessible repository returned in this bounded request.</p>}
    </div>}
    <p className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground"><LockKeyhole size={13}/> Account authorization does not perform Clone, Pull or Push. KForge local Git operations remain independently permission-gated.</p>
  </section>;
}

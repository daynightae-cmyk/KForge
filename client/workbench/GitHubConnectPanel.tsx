import { useState } from "react";
import { Github, ExternalLink, RefreshCw, ShieldCheck, PlugZap, Unplug, LockKeyhole, FolderGit2 } from "lucide-react";

type Connection = KForgeGitHubConnection;
type Installation = KForgeGitHubInstallation;
type PageMeta = KForgeGitHubPageMeta;
type Repository = KForgeGitHubRepositories["repositories"][number];
const button = "inline-flex items-center gap-2 rounded-lg border border-violet-400/35 bg-background/70 px-3 py-2 text-xs font-semibold transition-colors hover:border-violet-400/80 hover:bg-violet-500/10 disabled:cursor-not-allowed disabled:opacity-40";

const describePage = (page: PageMeta): string => {
  if (page.status === "COMPLETE") return "listing complete";
  if (page.status === "RATE_LIMITED") return `rate limited${typeof page.retry_after_seconds === "number" ? `; retry in ~${page.retry_after_seconds}s` : ""}`;
  if (page.status === "DENIED") return `denied (${page.reason || "no reason given"})`;
  return `partial (${page.reason || "unknown reason"})`;
};

export default function GitHubConnectPanel() {
  const bridge = window.kforgeDesktop;
  const [connection, setConnection] = useState<Connection>({state:"NOT_CHECKED"});
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [installationPage, setInstallationPage] = useState<PageMeta | null>(null);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [repoPage, setRepoPage] = useState<PageMeta | null>(null);
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
    if (value.state !== "CONNECTED") {setInstallations([]);setInstallationPage(null);setRepos([]);setRepoPage(null);setSelectedInstallation(null);}
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
    setInstallations([]);setInstallationPage(null);setRepos([]);setRepoPage(null);setSelectedInstallation(null);
    setNotice(value.detail || `Local session cleared. Remote token revocation: ${value.remote_revocation || "UNKNOWN"}.`);
  });
  const readInstallations = (loadMore = false) => execute(async () => {
    if (!bridge?.githubInstallations) return;
    const page = loadMore && installationPage?.next_page ? installationPage.next_page : 1;
    const result = await bridge.githubInstallations(page);
    const meta = result.pagination;
    setInstallations(prev => {
      const records = result.installations || [];
      return page === 1 ? records : [...prev, ...records.filter(r => !prev.some(p => p.id === r.id))];
    });
    setInstallationPage(meta);
    setRepos([]);setRepoPage(null);setSelectedInstallation(null);
    setNotice(`GitHub returned ${(result.installations || []).length} installation records, page ${meta.page}, ${describePage(meta)}. Repository access is explicitly scoped by GitHub.`);
  });
  const readRepositories = (id: number, loadMore = false) => execute(async () => {
    if (!bridge?.githubRepositories) return;
    const page = loadMore && repoPage?.next_page && selectedInstallation === id ? repoPage.next_page : 1;
    const result = await bridge.githubRepositories(id, page);
    const meta = result.pagination;
    setSelectedInstallation(id);
    setRepos(prev => {
      const records = result.repositories || [];
      if (selectedInstallation !== id || page === 1) return records;
      return [...prev, ...records.filter(r => !prev.some(p => p.id === r.id))];
    });
    setRepoPage(meta);
    if (meta.status === "DENIED") setNotice(`GitHub did not grant this desktop session access to installation ${id} (${describePage(meta)}). No local Git operation was performed.`);
    else if (meta.status === "RATE_LIMITED") setNotice(`GitHub rate limited the repository listing for installation ${id} (${describePage(meta)}). Use Retry when the wait ends.`);
    else setNotice(`GitHub returned ${(result.repositories || []).length} repository records for installation ${id}, page ${meta.page}, ${describePage(meta)}. No local Git operation was performed.`);
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
      <button className={button} disabled={!bridge?.githubInstallations || busy || connection.state !== "CONNECTED"} onClick={() => void readInstallations(false)}><FolderGit2 size={14}/> My installations</button>
      {installationPage?.status === "PARTIAL" && installationPage.next_page && <button className={button} disabled={busy || connection.state !== "CONNECTED"} onClick={() => void readInstallations(true)}>Load more installations (page {installationPage.next_page})</button>}
      {installationPage && (installationPage.status === "RATE_LIMITED" || installationPage.status === "PARTIAL") && <button className={button} disabled={busy || connection.state !== "CONNECTED"} onClick={() => void readInstallations(false)}>Retry installations</button>}
      <button className={button} disabled={!bridge?.githubDisconnect || busy || connection.state === "DISCONNECTED" || connection.state === "NOT_CHECKED"} onClick={() => void disconnect()}><Unplug size={14}/> Disconnect</button>
      <a href="https://github.com/apps/knoux-forge-desktop/installations/new" target="_blank" rel="noreferrer" className={button}><ExternalLink size={14}/> Install GitHub App</a>
    </div>
    <p role="status" className="mt-3 rounded-lg border border-violet-400/20 bg-background/60 px-3 py-2 text-xs text-muted-foreground">{!bridge?.githubStart ? "Desktop Electron runtime required; browser-hosted preview cannot start GitHub authorization." : notice}</p>
    {installations.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{installations.map(i => <button key={i.id} className={button} disabled={busy} onClick={() => void readRepositories(i.id)}>{i.account || "Organization"} · {i.repository_selection} · #{i.id}</button>)}</div>}
    {installationPage && installations.length === 0 && installationPage.status === "COMPLETE" && <p className="text-xs text-muted-foreground">GitHub reported no installation records for this account.</p>}
    {installationPage && installations.length === 0 && installationPage.status !== "COMPLETE" && <p className="text-xs text-muted-foreground">Installation listing is incomplete: {describePage(installationPage)}.</p>}
    {selectedInstallation !== null && <div className="mt-3 grid gap-2 md:grid-cols-2">
      {repos.length ? repos.map(r=><div key={r.id} className="rounded-xl border bg-background/65 p-3 text-xs">
        <div className="flex items-center justify-between gap-2"><strong className="truncate">{r.full_name}</strong><span className="text-muted-foreground">{r.private?"Private":"Public"}</span></div>
        <div className="mt-2 flex justify-between text-muted-foreground"><span>Default branch: {r.default_branch}</span>{r.html_url && <a target="_blank" rel="noreferrer" href={r.html_url} className="underline underline-offset-2">View on GitHub</a>}</div>
      </div>) : <p className="text-xs text-muted-foreground">{repoPage?.status === "DENIED" ? "GitHub did not grant this session access to this installation." : "No accessible repository returned in this bounded request."}</p>}
    </div>}
    {selectedInstallation !== null && repoPage && (repoPage.status === "PARTIAL" || repoPage.status === "RATE_LIMITED") && <div className="mt-2 flex flex-wrap gap-2">
      {repoPage.status === "PARTIAL" && repoPage.next_page && <button className={button} disabled={busy} onClick={() => void readRepositories(selectedInstallation, true)}>Load more repositories (page {repoPage.next_page})</button>}
      <button className={button} disabled={busy} onClick={() => void readRepositories(selectedInstallation, false)}>Retry repositories</button>
    </div>}
    <p className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground"><LockKeyhole size={13}/> Account authorization does not perform Clone, Pull or Push. KForge local Git operations remain independently permission-gated.</p>
  </section>;
}

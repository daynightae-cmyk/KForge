/// <reference types="vite/client" />

interface KForgeDesktopRuntimeInfo {
  product: string;
  version: string;
  runtime: string;
  chromium: string;
  node: string;
  platform: string;
  architecture: string;
  packaged: boolean;
  signature: "UNSIGNED" | "SIGNED";
}

interface KForgeGitHubAccount {
  id: number;
  login: string;
  avatar_url?: string | null;
  html_url?: string | null;
}
interface KForgeGitHubConnection {
  state: string;
  account?: KForgeGitHubAccount | null;
  message?: string;
  remote_revocation?: string;
  disconnected?: boolean;
  detail?: string;
}
interface KForgeGitHubInstallation {
  id: number;
  account: string | null;
  target_type: string | null;
  repository_selection: string | null;
}
interface KForgeGitHubRepositories {
  installation_id: number;
  total_count: number;
  pagination: string;
  repositories: Array<{id:number;full_name:string;private:boolean;default_branch:string;html_url:string;permissions?:Record<string,string>}>;
}
interface Window {
  kforgeDesktop?: {
    getRuntimeInfo: () => Promise<KForgeDesktopRuntimeInfo>;
    githubStart: () => Promise<KForgeGitHubConnection>;
    githubStatus: () => Promise<KForgeGitHubConnection>;
    githubDisconnect: () => Promise<KForgeGitHubConnection>;
    githubInstallations: () => Promise<{installations:KForgeGitHubInstallation[];total_count:number;pagination:string}>;
    githubRepositories: (installationId: number) => Promise<KForgeGitHubRepositories>;
  };
}

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
interface KForgeGitHubPageMeta {
  page: number;
  per_page: number;
  status: "COMPLETE" | "PARTIAL" | "RATE_LIMITED" | "DENIED";
  reason: string | null;
  next_page: number | null;
  retry_after_seconds?: number | null;
}
interface KForgeGitHubInstallations {
  installations: KForgeGitHubInstallation[];
  total_count: number | null;
  pagination: KForgeGitHubPageMeta;
}
interface KForgeGitHubRepositories {
  installation_id: number;
  total_count: number | null;
  pagination: KForgeGitHubPageMeta;
  repositories: Array<{id:number;full_name:string|null;private:boolean;default_branch:string|null;html_url:string|null;permissions?:Record<string,string>}>;
}
interface Window {
  kforgeDesktop?: {
    getRuntimeInfo: () => Promise<KForgeDesktopRuntimeInfo>;
    githubStart: () => Promise<KForgeGitHubConnection>;
    githubStatus: () => Promise<KForgeGitHubConnection>;
    githubDisconnect: () => Promise<KForgeGitHubConnection>;
    githubInstallations: (page?: number) => Promise<KForgeGitHubInstallations>;
    githubRepositories: (installationId: number, page?: number) => Promise<KForgeGitHubRepositories>;
  };
}

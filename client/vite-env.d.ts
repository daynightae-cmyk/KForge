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

interface Window {
  kforgeDesktop?: {
    getRuntimeInfo: () => Promise<KForgeDesktopRuntimeInfo>;
  };
}

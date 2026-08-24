import { defineConfig, devices } from "@playwright/test";

const windowsBrowserChannel =
  process.platform === "win32"
    ? process.env.KFORGE_PLAYWRIGHT_CHANNEL || "msedge"
    : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    ...(windowsBrowserChannel ? { channel: windowsBrowserChannel } : {}),
    trace: "on-first-retry",
    baseURL: "http://localhost:4317",
    headless: true,
  },
  projects: [
    {
      name: process.platform === "win32" ? "production-windows-browser" : "production-chromium",
      use: {},
    },
  ],
  webServer: {
    command: "node scripts/start-e2e-server.mjs",
    url: "http://localhost:4317/api/ping",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

import { expect, test } from "@playwright/test";
import { selectExplorerView } from "./helpers/workbench";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

test.describe("KForge System Control Plane 2.0", () => {
  test.setTimeout(120_000);

  test("changes only local network eligibility policy through explicit confirmed mode selection", async ({ page }) => {
    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();

    let modePosts = 0;
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === "/api/workspace/platform/mode") modePosts += 1;
      if (!LOCAL_HOSTS.has(url.hostname)) externalRequests.push(request.url());
    });

    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await selectExplorerView(page, "System", "Online / Offline");

    const center = page.getByRole("region", { name: "KForge Operating Mode Control Center", exact: true });
    await expect(center).toBeVisible();
    await expect(center).toHaveAttribute("data-platform-mode", "offline");
    await expect(center).toContainText("NO_IMPLICIT_NETWORK_CONTACT");
    await expect(center).toContainText("ALWAYS_CONFIRMATION_GATED");
    await expect(center).toContainText("Enabled means policy-eligible, not contacted");
    expect(modePosts).toBe(0);

    await center.getByRole("button", { name: "Refresh policy", exact: true }).click();
    await expect(center).toHaveAttribute("data-platform-mode", "offline");
    expect(modePosts).toBe(0);

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("does not itself contact a remote service");
      await dialog.accept();
    });
    const localFirstResponse = page.waitForResponse((response) => response.url().endsWith("/api/workspace/platform/mode") && response.request().method() === "POST");
    await center.getByRole("button", { name: "Switch to Local First", exact: true }).click();
    expect((await localFirstResponse).ok()).toBeTruthy();
    await expect(center).toHaveAttribute("data-platform-mode", "local-first");
    await expect(center.getByRole("status")).toContainText("No remote request is implied");
    await expect(center.getByRole("region", { name: "Network policy matrix", exact: true })).toContainText("ELIGIBLE");
    expect(modePosts).toBe(1);

    page.once("dialog", async (dialog) => { await dialog.accept(); });
    const offlineResponse = page.waitForResponse((response) => response.url().endsWith("/api/workspace/platform/mode") && response.request().method() === "POST");
    await center.getByRole("button", { name: "Switch to Offline", exact: true }).click();
    expect((await offlineResponse).ok()).toBeTruthy();
    await expect(center).toHaveAttribute("data-platform-mode", "offline");
    await expect(center.getByRole("region", { name: "Network policy matrix", exact: true })).toContainText("BLOCKED");
    expect(modePosts).toBe(2);
    expect(externalRequests).toEqual([]);
  });
});

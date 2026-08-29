import path from "node:path";
import { expect, test } from "@playwright/test";
import { clearProjectContext } from "./helpers/workbench";

const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

function isExternalHttpRequest(rawUrl: string) {
  const url = new URL(rawUrl);
  return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin);
}

test.describe("KForge Online Control Center in contextual workbench", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    const settings = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
    expect(settings.ok(), await settings.text()).toBeTruthy();
    const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(platform.ok(), await platform.text()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await clearProjectContext(page);
  });

  test("renders global policy/source evidence and projectless compatibility without implicit network contact", async ({ page }) => {
    const externalRequests: string[] = [];
    const apiFailures: string[] = [];
    page.on("request", (request) => { if (isExternalHttpRequest(request.url())) externalRequests.push(request.url()); });
    page.on("response", (response) => { if (response.url().includes("/api/") && response.status() >= 400) apiFailures.push(`${response.status()} ${response.url()}`); });

    const online = page.locator(".kw-activity-bar").getByRole("button", { name: "Online", exact: true });
    await online.click();
    const explorer = page.getByRole("complementary", { name: "Online Explorer", exact: true });
    await explorer.getByRole("button", { name: "Marketplace", exact: true }).click();
    await expect(page.locator(".kw-online-context")).toContainText("Online is global");
    await expect(page.locator(".kw-online-context")).toContainText("NOT_EVALUATED");
    await expect(page.locator(".kw-online-context")).toContainText("No project selected");
    await expect(page.locator(".kw-online-context")).toContainText(/offline|policy evidence loaded/i);
    await expect(page.locator(".kw-online")).toContainText("Opening this surface performs no remote catalog refresh.");

    const refresh = page.getByRole("button", { name: "Refresh local evidence", exact: true });
    const marketplaceResponse = page.waitForResponse((response) => response.url().endsWith("/api/workspace/marketplace") && response.request().method() === "GET");
    await refresh.click();
    expect((await marketplaceResponse).ok()).toBeTruthy();

    await explorer.getByRole("button", { name: "Remote Sources", exact: true }).click();
    await expect(page.locator(".kw-workbench h1")).toHaveText("Remote Sources");
    await expect(page.locator(".kw-workbench-scroll")).toContainText(/NOT_CONFIGURED|OFFLINE|No remote sources configured|remote/i);

    await explorer.getByRole("button", { name: "Providers", exact: true }).click();
    await expect(page.locator(".kw-workbench-scroll")).toContainText(/provider|adapter|configured|offline|not_configured/i);

    expect(externalRequests, `Unexpected external requests from Online Control Center:\n${externalRequests.join("\n")}`).toEqual([]);
    expect(apiFailures, `Unexpected API failures in Online Control Center:\n${apiFailures.join("\n")}`).toEqual([]);
  });
});

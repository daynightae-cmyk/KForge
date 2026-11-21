import { expect, test } from "@playwright/test";
import { clearProjectContext, openWorkbench, selectExplorerView } from "./helpers/workbench";

const PACKAGE_ID = "package:kforge:json-inspector";
const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);
const external = (raw: string) => {
  try { const url = new URL(raw); return /^https?:$/i.test(url.protocol) && !LOCAL_ORIGINS.has(url.origin); } catch { return false; }
};

/**
 * The Online domain's service directory promises real history: Downloads is
 * "the history of package operations KForge actually performed" and Activity
 * is "an audit trail of package and source activity". Both read the canonical
 * task ledger, so a failed read must state its refusal — never a fake empty
 * history — and the Control Center tile must never freeze on "Loading policy
 * evidence…" after a failed policy read. Real package operations must appear
 * as persisted evidence, created by the actual lifecycle service.
 */
test.describe("KForge Online destination truth contracts", () => {
  test.setTimeout(180_000);
  test.beforeEach(async ({ page }) => {
    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    const cleanup = await page.request.post(`/api/workspace/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/uninstall`, { data: { confirmed: true } });
    expect([200, 409]).toContain(cleanup.status());
    await openWorkbench(page);
    await clearProjectContext(page);
  });

  test("Control Center reports a failed policy read honestly and recovers on refresh", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (external(request.url())) externalRequests.push(request.url()); });
    await page.route("**/api/workspace/online/control-center", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Policy read refused for evidence test." }) }));

    await selectExplorerView(page, "Online", "Marketplace");
    const context = page.locator(".kw-online-context");
    await expect(context.getByRole("alert")).toContainText("Policy read refused for evidence test.", { timeout: 30_000 });
    await expect(context).toContainText("READ_FAILED");
    await expect(context).not.toContainText("Loading policy evidence…");
    // The catalog itself is independent evidence and must still load.
    await expect(page.locator('.kw-capability-card[data-item-id="package:kforge:json-inspector"]')).toBeVisible({ timeout: 30_000 });

    // Recovery: explicit refresh re-reads the real route and clears the refusal.
    await page.unroute("**/api/workspace/online/control-center");
    await page.getByRole("button", { name: "Refresh local evidence", exact: true }).click();
    await expect(context.getByRole("alert")).toHaveCount(0, { timeout: 15_000 });
    await expect(context).toContainText("Policy evidence loaded");
    await expect(context).toContainText("OFFLINE");
    expect(externalRequests, "policy failure and recovery must not contact any remote").toEqual([]);
  });

  test("Downloads and Activity state a failed ledger read instead of an empty history, then recover", async ({ page }) => {
    await page.route("**/api/workspace/tasks", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Ledger read refused for evidence test." }) }));

    await selectExplorerView(page, "Online", "Downloads");
    const online = page.locator(".kw-online");
    await expect(online.getByRole("alert")).toContainText("Task ledger unavailable", { timeout: 30_000 });
    await expect(online.getByRole("alert")).toContainText("Ledger read refused for evidence test.");
    await expect(online.getByRole("alert")).toContainText("does not treat a failed read as an empty history");
    await expect(online).not.toContainText("No persisted package operations");

    await selectExplorerView(page, "Online", "Activity");
    await expect(online.getByRole("alert")).toContainText("Task ledger unavailable", { timeout: 15_000 });
    await expect(online).not.toContainText("No persisted Online activity");

    // Recovery through the surface's own explicit refresh action.
    await page.unroute("**/api/workspace/tasks");
    await online.getByRole("button", { name: "Refresh evidence", exact: true }).click();
    await expect(online.getByRole("alert")).toHaveCount(0, { timeout: 15_000 });
    // After a successful read the surface shows truthful content: either the
    // real persisted history or the view's own honest empty state — never the
    // refusal, and never a loading freeze. Earlier tests in this shared
    // workspace may have created real package tasks, so both outcomes are legal.
    const history = online.getByLabel("Persisted task evidence");
    const empty = online.getByRole("region", { name: "No persisted Online activity" });
    await expect(history.or(empty).first()).toBeVisible({ timeout: 15_000 });
    await expect(online).not.toContainText("Loading the persisted task ledger…");
  });

  test("a real package lifecycle creates persisted Downloads and Activity evidence", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => { if (external(request.url())) externalRequests.push(request.url()); });

    // Real confirmed operations through the canonical lifecycle service. The
    // HTTP response returns when the operation completes; the ledger task
    // finalizes one microtask later, so wait for this test's own rows to land.
    // The suite shares one workspace, so earlier tests leave real history:
    // assert the count delta of succeeded rows, never exact totals.
    const readSucceeded = async () => {
      const ledger = await page.request.get("/api/workspace/tasks?projectId=online");
      if (!ledger.ok()) return { install: -1, run: -1 };
      const { tasks } = await ledger.json() as { tasks: Array<{ kind: string; status: string }> };
      const succeeded = tasks.filter((task) => task.status === "succeeded");
      return { install: succeeded.filter((task) => task.kind === "install").length, run: succeeded.filter((task) => task.kind === "package-run").length };
    };
    const before = await readSucceeded();
    const install = await page.request.post(`/api/workspace/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/install`, { data: { confirmed: true } });
    expect(install.status(), await install.text()).toBe(200);
    const run = await page.request.post(`/api/workspace/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/run`, { data: { confirmed: true } });
    expect(run.status(), await run.text()).toBe(200);
    await expect.poll(async () => {
      const after = await readSucceeded();
      return after.install > before.install && after.run > before.run;
    }, { timeout: 15_000 }).toBe(true);

    await selectExplorerView(page, "Online", "Downloads");
    // The aria-label lives on the table wrapper, not the <table> element.
    const table = page.getByLabel("Persisted task evidence");
    await expect(table).toBeVisible({ timeout: 30_000 });
    // Suite-shared workspace: earlier lifecycle tests leave real history rows,
    // so assert this test's own operations are present, not exact counts.
    // Downloads owns download/install/update results; package execution is
    // activity, not a download, and belongs to the Activity view below.
    await expect(table.locator("tr").filter({ hasText: "install" }).first()).toBeVisible();
    await expect(table).toContainText(PACKAGE_ID);
    await expect(table).toContainText("SUCCEEDED");

    await selectExplorerView(page, "Online", "Activity");
    const activity = page.getByLabel("Persisted task evidence");
    await expect(activity).toContainText("install", { timeout: 15_000 });
    await expect(activity.locator("tr").filter({ hasText: "package-run" }).first()).toBeVisible();

    // The same history survives a fresh session: it is persisted, not memory.
    await page.reload({ waitUntil: "domcontentloaded" });
    await selectExplorerView(page, "Online", "Downloads");
    await expect(page.getByLabel("Persisted task evidence")).toContainText(PACKAGE_ID, { timeout: 30_000 });
    expect(externalRequests, "local package lifecycle must not contact any remote").toEqual([]);

    const uninstall = await page.request.post(`/api/workspace/marketplace/items/${encodeURIComponent(PACKAGE_ID)}/uninstall`, { data: { confirmed: true } });
    expect(uninstall.status(), await uninstall.text()).toBe(200);
  });
});

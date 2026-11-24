import path from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkbench, selectExplorerView, setProjectContext } from "./helpers/workbench";

const GRAPH_REFUSAL = "Graph read refused for evidence test.";
const IMPACT_REFUSAL = "Impact analysis refused for evidence test.";
const ASK_REFUSAL = "Ask analysis refused for evidence test.";
const PROFILE_REFUSAL = "Profile read refused for evidence test.";

/**
 * The Intelligence domain promises bounded local evidence. A failed read or
 * analysis must be stated as a refusal (role=alert, verbatim server error)
 * with explicit recovery — never zeroed stats posing as an empty scan, never
 * a stale result posing as the new answer, and never raw JSON as the primary
 * Ask KForge UX.
 */
test.describe("KForge Intelligence destination truth contracts", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    expect((await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } })).ok()).toBeTruthy();
    const opened = await page.request.post("/api/workspace/projects/open", { data: { path: path.resolve(process.cwd()) } });
    expect(opened.ok(), await opened.text()).toBeTruthy();
    const { project } = await opened.json() as { project: { id: string } };
    await openWorkbench(page);
    await setProjectContext(page, project.id);
  });

  test("Project Graph states a failed read instead of an empty scan, and recovers on refresh", async ({ page }) => {
    await page.route("**/graph", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: GRAPH_REFUSAL }) }));
    await selectExplorerView(page, "Intelligence", "Project Graph");
    const graph = page.getByRole("region", { name: "Project graph evidence", exact: true });
    await expect(graph).toHaveAttribute("data-graph-state", "READ_FAILED", { timeout: 30_000 });
    await expect(graph.getByRole("alert")).toContainText(GRAPH_REFUSAL);
    await expect(graph.getByRole("alert")).toContainText("does not treat a failed read as an empty scan");
    // A failed read must not render zeroed summary tiles as scan evidence.
    await expect(graph.getByRole("region", { name: "Project graph summary" })).toHaveCount(0);

    await page.unroute("**/graph");
    await graph.getByRole("button", { name: "Refresh evidence", exact: true }).click();
    await expect(graph).toHaveAttribute("data-graph-state", "LOADED", { timeout: 60_000 });
    await expect(graph.getByRole("alert")).toHaveCount(0);
    await expect(graph.getByRole("region", { name: "Project graph summary" })).toBeVisible();
    await expect(graph.locator("[data-graph-coverage]")).toContainText(/COMPLETE|LIMIT_REACHED/);
  });

  test("Code Understanding states a failed structure read honestly and recovers", async ({ page }) => {
    await page.route("**/graph", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: GRAPH_REFUSAL }) }));
    await selectExplorerView(page, "Intelligence", "Code Understanding");
    const understanding = page.getByRole("region", { name: "Code Understanding evidence", exact: true });
    await expect(understanding).toHaveAttribute("data-code-understanding-state", "UNAVAILABLE", { timeout: 30_000 });
    await expect(understanding.getByRole("alert")).toContainText(GRAPH_REFUSAL);
    await expect(understanding).not.toContainText("Files 0");

    await page.unroute("**/graph");
    await understanding.getByRole("button", { name: "Refresh evidence", exact: true }).click();
    await expect(understanding).toHaveAttribute("data-code-understanding-state", "SCANNED", { timeout: 60_000 });
    await expect(understanding.getByRole("alert")).toHaveCount(0);
    await expect(understanding.getByRole("region", { name: "Detected entry points" })).toBeVisible();
  });

  test("Impact Analysis never leaves a stale result and states a failed analysis as a refusal", async ({ page }) => {
    await selectExplorerView(page, "Intelligence", "Impact Analysis");
    const impact = page.getByRole("region", { name: "Impact Analysis evidence", exact: true });
    await impact.getByLabel("Impact target", { exact: true }).fill("client/App.tsx");
    const firstRead = page.waitForResponse((response) => response.url().includes("/graph/impact") && response.request().method() === "GET");
    await impact.getByRole("button", { name: "Analyze impact", exact: true }).click();
    expect((await firstRead).ok()).toBeTruthy();
    const result = impact.locator(".kw-impact-result");
    await expect(result).toBeVisible({ timeout: 60_000 });
    await expect(result).toContainText("client/App.tsx");

    // A second analysis that fails must clear the first result, not keep it
    // on screen as if it answered the new target.
    await page.route("**/graph/impact*", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: IMPACT_REFUSAL }) }));
    await impact.getByLabel("Impact target", { exact: true }).fill("server/index.ts");
    const failedRead = page.waitForResponse((response) => response.url().includes("/graph/impact") && response.request().method() === "GET");
    await impact.getByRole("button", { name: "Analyze impact", exact: true }).click();
    expect((await failedRead).status()).toBe(503);
    await expect(impact.getByRole("alert")).toContainText(IMPACT_REFUSAL, { timeout: 15_000 });
    await expect(impact.getByRole("alert")).toContainText("does not treat a failed analysis as zero dependents");
    await expect(result).toHaveCount(0);

    await page.unroute("**/graph/impact*");
    const recoveredRead = page.waitForResponse((response) => response.url().includes("/graph/impact") && response.request().method() === "GET");
    await impact.getByRole("button", { name: "Analyze impact", exact: true }).click();
    expect((await recoveredRead).ok()).toBeTruthy();
    await expect(impact.getByRole("alert")).toHaveCount(0, { timeout: 15_000 });
    await expect(impact.locator(".kw-impact-result")).toContainText("server/index.ts", { timeout: 60_000 });
  });

  test("Ask KForge renders structured provenance-backed evidence, and a failed analysis is never an invented answer", async ({ page }) => {
    await selectExplorerView(page, "Intelligence", "Ask KForge");
    const ask = page.getByRole("region", { name: "Ask KForge evidence", exact: true });
    await ask.getByLabel("Ask KForge question", { exact: true }).fill("What release blockers are supported by current local evidence?");
    const answerRead = page.waitForResponse((response) => response.url().includes("/ask") && response.request().method() === "POST");
    await ask.getByRole("button", { name: "Analyze project evidence", exact: true }).click();
    expect((await answerRead).ok()).toBeTruthy();
    const answer = ask.getByRole("article", { name: "Ask KForge answer" });
    await expect(answer).toBeVisible({ timeout: 120_000 });
    // Offline deterministic mode is stated truthfully with its provenance.
    await expect(answer).toContainText("RULES");
    await expect(answer).toContainText("Deterministic scan evidence — no active local model");
    await expect(answer.getByRole("region", { name: "Top evidence-backed risks" })).toBeVisible();
    await expect(answer.getByRole("region", { name: "Verification evidence" })).toBeVisible();
    await expect(answer).toContainText("Bounded context:");
    // Raw JSON lives only inside the collapsed advanced-evidence disclosure,
    // never in the primary answer body.
    await expect(answer.locator(":scope > pre")).toHaveCount(0);
    await expect(answer.locator("details.kw-advanced-evidence pre")).toHaveCount(1);
    await expect(answer.getByText("Advanced answer evidence")).toBeVisible();

    // A failed second analysis clears the previous answer and refuses honestly.
    await page.route("**/ask", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: ASK_REFUSAL }) }));
    await ask.getByLabel("Ask KForge question", { exact: true }).fill("A second question that must not reuse the first answer.");
    const failedRead = page.waitForResponse((response) => response.url().includes("/ask") && response.request().method() === "POST");
    await ask.getByRole("button", { name: "Analyze project evidence", exact: true }).click();
    expect((await failedRead).status()).toBe(503);
    await expect(ask.getByRole("alert")).toContainText(ASK_REFUSAL, { timeout: 15_000 });
    await expect(ask.getByRole("alert")).toContainText("does not invent an answer when the analysis fails");
    await expect(answer).toHaveCount(0);
  });

  test("Dependencies states a failed profile read instead of empty evidence, and recovers on refresh", async ({ page }) => {
    await page.route("**/profile", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: PROFILE_REFUSAL }) }));
    await selectExplorerView(page, "Intelligence", "Dependencies");
    const surface = page.locator(".kw-simple-surface");
    await expect(surface.getByRole("alert")).toContainText(PROFILE_REFUSAL, { timeout: 30_000 });
    await expect(surface.getByRole("alert")).toContainText("does not treat a failed read as empty evidence");
    await expect(surface.locator(".kw-evidence-list")).toHaveCount(0);

    await page.unroute("**/profile");
    await surface.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(surface.getByRole("alert")).toHaveCount(0, { timeout: 30_000 });
    await expect(surface).toContainText(/packageManager|dependencies|manifest/i, { timeout: 60_000 });
  });
});

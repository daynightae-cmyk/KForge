import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openWorkbench, selectExplorerView, setProjectContext } from "./helpers/workbench";

/**
 * Opt-in Task-01 shell identity evidence. Never runs as part of the ordinary
 * release gate:
 *
 *   KFORGE_CAPTURE_SHELL=1 npx playwright test tests/e2e/shell-identity-evidence.spec.ts --workers=1
 *
 * Captures the persistent shell at the three required viewports in both
 * themes and records real browser measurements (startup timing, theme-switch
 * latency, JS heap). Screenshots are isolated Playwright production-browser
 * evidence — NOT packaged desktop verification and NOT owner-approved visual
 * parity. Files stay under gitignored verification/.
 */
const ENABLED = process.env.KFORGE_CAPTURE_SHELL === "1";
const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;
const THEMES = ["light", "dark"] as const;
// Composed surfaces per viewport/theme, selected by KFORGE_CAPTURE_SHELL_SURFACES:
// "shell" (default) — workspace + settings; "projects" — the Projects entry
// destinations rewritten onto the canonical ProjectStartActions handler;
// "ai" — the AI Provider Studio destinations; "online" — the Online catalog
// and its honest task-history destinations; "intelligence" — the bounded
// local evidence destinations with honest read states and structured answers.
const SURFACE_SETS: Record<string, Array<{ activity: string; view: string }>> = {
  shell: [
    { activity: "Projects", view: "Workspace" },
    { activity: "System", view: "Settings" },
  ],
  projects: [
    { activity: "Projects", view: "Open Project" },
    { activity: "Projects", view: "Import Project" },
  ],
  ai: [
    { activity: "AI", view: "Providers" },
    { activity: "AI", view: "Models" },
  ],
  online: [
    { activity: "Online", view: "Marketplace" },
    { activity: "Online", view: "Downloads" },
  ],
  intelligence: [
    { activity: "Intelligence", view: "Project Graph" },
    { activity: "Intelligence", view: "Ask KForge" },
  ],
};
const SURFACES = SURFACE_SETS[process.env.KFORGE_CAPTURE_SHELL_SURFACES || "shell"] || SURFACE_SETS.shell;
// Intelligence surfaces are project-scoped; captures must show real evidence,
// never the projectless fallback.
const NEEDS_PROJECT = SURFACES.some((surface) => surface.activity === "Intelligence");

type ShellRecord = {
  theme: string;
  viewport: { width: number; height: number };
  surface: string;
  file?: string;
  status: "CAPTURED" | "ERROR";
  error?: string;
  pageErrors: string[];
};

async function setTheme(page: Page, theme: "light" | "dark") {
  const current = await page.request.get("/api/workspace/settings");
  expect(current.ok()).toBeTruthy();
  const body = await current.json() as { settings: Record<string, unknown> };
  const saved = await page.request.patch("/api/workspace/settings", {
    data: { ...body.settings, appearance: { ...(body.settings.appearance as Record<string, unknown> || {}), theme } },
  });
  expect(saved.ok()).toBeTruthy();
}

async function measureStartup(page: Page) {
  const started = Date.now();
  await openWorkbench(page);
  const shellVisibleMs = Date.now() - started;
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
    return {
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadEventMs: nav ? Math.round(nav.loadEventEnd) : null,
      usedJSHeapBytes: memory ? memory.usedJSHeapSize : null,
      totalJSHeapBytes: memory ? memory.totalJSHeapSize : null,
    };
  });
  return { shellVisibleMs, ...timing };
}

test.describe("KForge shell identity multi-viewport evidence (opt-in)", () => {
  test.skip(!ENABLED, "Opt-in only: set KFORGE_CAPTURE_SHELL=1");

  test("captures Day/Night shell at 1280x720, 1440x900, 1920x1080 with real measurements", async ({ page }) => {
    test.setTimeout(600_000);
    const root = path.join(process.cwd(), "verification", "shell-identity-evidence", String(Date.now()));
    fs.mkdirSync(root, { recursive: true });
    const records: ShellRecord[] = [];
    const measurements: Array<Record<string, unknown>> = [];
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    // Fresh isolated workspace: offline mode, no implicit remote contact.
    const mode = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
    expect(mode.ok(), "enforcing offline evidence capture").toBeTruthy();
    let captureProjectId = "";
    if (NEEDS_PROJECT) {
      const opened = await page.request.post("/api/workspace/projects/open", { data: { path: process.cwd() } });
      expect(opened.ok(), await opened.text()).toBeTruthy();
      captureProjectId = ((await opened.json()) as { project: { id: string } }).project.id;
    }

    let fatalError: string | undefined;
    try {
      for (const theme of THEMES) {
        await setTheme(page, theme);
        for (const viewport of VIEWPORTS) {
          await page.setViewportSize(viewport);
          const startup = await measureStartup(page);
          await expect(page.locator("html")).toHaveClass(new RegExp(`(^|\\s)${theme}(\\s|$)`));
          measurements.push({ kind: "startup", theme, viewport, ...startup });

          // Theme-switch latency: reload with the opposite theme already
          // saved, then measure how long until the shell reflects it.
          const other = theme === "light" ? "dark" : "light";
          await setTheme(page, other);
          const switchStart = Date.now();
          await page.reload({ waitUntil: "domcontentloaded" });
          await expect(page.locator("html")).toHaveClass(new RegExp(`(^|\\s)${other}(\\s|$)`), { timeout: 60_000 });
          measurements.push({ kind: "theme-switch", from: theme, to: other, viewport, appliedMs: Date.now() - switchStart });
          await setTheme(page, theme);
          await page.reload({ waitUntil: "domcontentloaded" });
          await expect(page.locator(".kw-topbar")).toBeVisible({ timeout: 60_000 });
          if (captureProjectId) await setProjectContext(page, captureProjectId);

          for (const surface of SURFACES) {
            const base: ShellRecord = {
              theme, viewport, surface: `${surface.activity}:${surface.view}`,
              status: "ERROR", pageErrors: [],
            };
            try {
              await selectExplorerView(page, surface.activity, surface.view);
              // Ask KForge evidence must show a real structured answer, not
              // an empty form: ask one bounded question through the real API.
              if (surface.activity === "Intelligence" && surface.view === "Ask KForge") {
                const ask = page.getByRole("region", { name: "Ask KForge evidence", exact: true });
                await ask.getByLabel("Ask KForge question", { exact: true }).fill("What release blockers are supported by current local evidence?");
                await ask.getByRole("button", { name: "Analyze project evidence", exact: true }).click();
                await expect(ask.getByRole("article", { name: "Ask KForge answer" })).toBeVisible({ timeout: 120_000 });
              }
              // Let entrance stagger and lazy surfaces settle before capture:
              // wait until no status region reports a pending load, so a shot
              // can never publish a loading skeleton as surface evidence.
              await page.waitForFunction(() => {
                const region = document.querySelector(".kw-workbench");
                if (!region) return false;
                return !Array.from(region.querySelectorAll('[role="status"]')).some((node) => /^(Loading|Reading|Contacting|Analyzing)\b/i.test((node.textContent || "").trim()));
              }, { timeout: 90_000 });
              await page.waitForTimeout(900);
              const file = path.join(root,
                `${theme}-${viewport.width}x${viewport.height}-${surface.activity.toLowerCase().replace(/[^a-z]+/g, "-")}-${surface.view.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`);
              // Finish entrance animations for the capture itself: a mid-rise
              // frame is not evidence of the settled surface. The product's
              // motion is unchanged; only the recorded frame is settled.
              await page.screenshot({ path: file, fullPage: false, animations: "disabled" });
              records.push({ ...base, status: "CAPTURED", file: path.relative(root, file), pageErrors: pageErrors.splice(0) });
            } catch (error) {
              records.push({ ...base, error: String(error).slice(0, 1200), pageErrors: pageErrors.splice(0) });
            }
          }
        }
      }

      // Reduced-motion contract: the persisted preference must kill motion.
      await setTheme(page, "light");
      const current = await (await page.request.get("/api/workspace/settings")).json() as { settings: Record<string, unknown> };
      const saved = await page.request.patch("/api/workspace/settings", {
        data: { ...current.settings, appearance: { ...(current.settings.appearance as Record<string, unknown> || {}), reducedMotion: true } },
      });
      expect(saved.ok()).toBeTruthy();
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator(".kw-topbar")).toBeVisible({ timeout: 60_000 });
      const motion = await page.evaluate(() => {
        const shell = document.querySelector(".kw-shell");
        const explorer = document.querySelector(".kw-explorer");
        const style = (node: Element | null) => node ? getComputedStyle(node) : null;
        return {
          preferenceAttr: document.documentElement.dataset.kfReducedMotion,
          shellTransition: style(shell)?.transitionDuration ?? null,
          explorerAnimation: style(explorer)?.animationDuration ?? null,
        };
      });
      measurements.push({ kind: "reduced-motion", ...motion });
      // Contract: the persisted preference must stop motion on the shell root
      // and its descendants, not just on inner elements.
      expect(motion.preferenceAttr).toBe("true");
      expect(motion.shellTransition, "shell root transitions must be killed").toMatch(/^0s(,\s*0s)*$/);
      expect(motion.explorerAnimation, "pane entrance animation must be killed").toMatch(/^0s(,\s*0s)*$/);
      await page.screenshot({ path: path.join(root, "light-reduced-motion-1440x900.png") });
    } catch (error) {
      fatalError = String(error);
    } finally {
      const captured = records.filter((entry) => entry.status === "CAPTURED");
      const issues = records.filter((entry) => entry.status !== "CAPTURED" || entry.pageErrors.length);
      const expected = THEMES.length * VIEWPORTS.length * SURFACES.length;
      const ledger = {
        source: "KForge isolated Playwright production browser — NOT packaged desktop or approved visual parity",
        generatedAt: new Date().toISOString(),
        viewports: VIEWPORTS,
        themes: THEMES,
        surfaces: SURFACES,
        screenshotCount: captured.length,
        expectedScreenshots: expected,
        issues: issues.length,
        status: fatalError ? "FAILED" : issues.length === 0 && captured.length === expected ? "CAPTURED_NOT_VISUALLY_APPROVED" : "INCOMPLETE",
        fatalError,
        measurements,
        records,
      };
      fs.writeFileSync(path.join(root, "ledger.json"), JSON.stringify(ledger, null, 2));
      console.log("[shell-identity] " + root);
      console.log(`[shell-identity] ${ledger.status} ${captured.length}/${expected} screenshots; ${issues.length} flagged`);
    }

    expect(fatalError, "fatal capture error").toBeUndefined();
    const issues = records.filter((entry) => entry.status !== "CAPTURED" || entry.pageErrors.length);
    expect(issues, "every shell capture must settle without runtime errors").toEqual([]);
    expect(records.length).toBe(THEMES.length * VIEWPORTS.length * SURFACES.length);
  });
});

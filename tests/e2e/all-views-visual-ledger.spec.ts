import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { selectActivity, setProjectContext } from "./helpers/workbench";

/**
 * Opt-in forensic capture. Never runs as part of the ordinary release gate.
 * Uses the isolated temporary workspace from scripts/start-e2e-server.mjs.
 *
 * Full Day/Night coverage:
 *   KFORGE_CAPTURE_ALL_VIEWS=1 npx playwright test tests/e2e/all-views-visual-ledger.spec.ts --workers=1
 *
 * A bounded smoke invocation (e.g., KFORGE_VISUAL_VIEW_LIMIT=2) explicitly
 * reports PARTIAL_SMOKE rather than claiming coverage of all registered views.
 * Files stay under gitignored verification/, not in public CI artifacts.
 */
const ENABLED = process.env.KFORGE_CAPTURE_ALL_VIEWS === "1";
const ACTIVITIES = [
  "Projects", "AI", "Online", "Intelligence", "Quality",
  "Developer Tools", "Remote / Git", "Release", "System",
] as const;
const REQUIRED_VIEWS = 68;
const THEMES = ["light", "dark"] as const;
const viewLimitValue = Number(process.env.KFORGE_VISUAL_VIEW_LIMIT || REQUIRED_VIEWS);
const VIEW_LIMIT = Number.isInteger(viewLimitValue) && viewLimitValue >= 1
  ? Math.min(REQUIRED_VIEWS, viewLimitValue)
  : REQUIRED_VIEWS;
const VIEWPORT = { width: 1672, height: 941 };
const STUCK_PATTERN = /^(loading|reading|contacting|analyzing|reconciling|indexing|fetching|preparing|scanning)\b/i;

type CaptureRecord = {
  activity: string;
  view: string;
  theme: "light" | "dark";
  surface: string;
  file?: string;
  width?: number;
  height?: number;
  status: "CAPTURED" | "UNSETTLED" | "ERROR";
  pending: string[];
  pageErrors: string[];
  error?: string;
};

function safeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
}

async function setTheme(page: Page, theme: "light" | "dark") {
  const current = await page.request.get("/api/workspace/settings");
  expect(current.ok(), "reading isolated test workspace settings").toBeTruthy();
  const body = await current.json() as { settings: Record<string, unknown> };
  const appearance = body.settings.appearance as Record<string, unknown> | undefined;
  const saved = await page.request.patch("/api/workspace/settings", {
    data: { ...body.settings, appearance: { ...(appearance || {}), theme } },
  });
  expect(saved.ok(), "saving isolated test workspace theme").toBeTruthy();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".kw-topbar")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("html")).toHaveClass(new RegExp("(^|\\s)" + theme + "(\\s|$)"));
}

async function prepareProject(page: Page) {
  // This server is started with a fresh temporary workspace by the existing
  // Playwright config. Never point the test at a user-owned persistent server.
  const reset = await page.request.post("/api/workspace/settings/reset", {
    data: { confirmed: true },
  });
  expect(reset.ok(), "resetting isolated test workspace").toBeTruthy();
  const mode = await page.request.post("/api/workspace/platform/mode", {
    data: { mode: "offline" },
  });
  expect(mode.ok(), "enforcing offline evidence capture").toBeTruthy();
  const opened = await page.request.post("/api/workspace/projects/open", {
    data: { path: process.cwd() },
  });
  expect(opened.ok(), "opening source project in isolated test workspace").toBeTruthy();
  const response = await opened.json() as { project: { id: string } };
  await page.goto("/workspace", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".kw-topbar")).toBeVisible({ timeout: 60_000 });
  await setProjectContext(page, response.project.id);
  return response.project.id;
}

async function waitForVisualSettle(page: Page) {
  const workbench = page.locator(".kw-workbench");
  await expect(workbench).toBeVisible();
  try {
    await page.waitForFunction((pattern) => {
      const root = document.querySelector(".kw-workbench");
      if (!root) return false;
      const matcher = new RegExp(pattern, "i");
      const pending = Array.from(root.querySelectorAll('[role="status"]'))
        .some((node) => matcher.test((node.textContent || "").trim()));
      const scroll = document.querySelector(".kw-workbench-scroll");
      const visible = Boolean(scroll) && Array.from(scroll!.children)
        .every((element) => Number(getComputedStyle(element).opacity) > 0.999);
      return !pending && visible;
    }, STUCK_PATTERN.source, { timeout: 30_000 });
  } catch {
    // Record the unresolved state; never treat a timed-out surface as accepted.
  }
  const pending = (await workbench.locator('[role="status"]').allTextContents())
    .map((text) => text.trim()).filter((text) => STUCK_PATTERN.test(text));
  const opacitySettled = await page.locator(".kw-workbench-scroll").evaluate((scroll) =>
    Array.from(scroll.children).every((child) => Number(getComputedStyle(child).opacity) > 0.999)
  ).catch(() => false);
  return { pending, opacitySettled };
}

test.describe("KForge 68-view visual evidence ledger (opt-in)", () => {
  test.skip(!ENABLED, "Opt-in only: set KFORGE_CAPTURE_ALL_VIEWS=1");

  test("records actual Day/Night viewport PNGs and an explicit coverage ledger", async ({ page }) => {
    // This is deliberately NOT a substitute for visual reference comparison,
    // semantic action testing, signed installer testing, or owner approval.
    test.setTimeout(2_400_000);
    await page.setViewportSize(VIEWPORT);
    const projectId = await prepareProject(page);
    const root = path.join(process.cwd(), "verification", "all-views-visual-evidence",
      String(Date.now()));
    fs.mkdirSync(root, { recursive: true });

    const records: CaptureRecord[] = [];
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    let registeredCount = 0;
    let checkedViews = 0;
    let fatalError: string | undefined;

    try {
      for (const theme of THEMES) {
        await setTheme(page, theme);
        await setProjectContext(page, projectId);
        let themeCount = 0;
        for (const activity of ACTIVITIES) {
          await selectActivity(page, activity);
          const explorer = page.getByRole("complementary", {
            name: activity + " Explorer", exact: true,
          });
          const views = (await explorer.getByRole("button").allTextContents())
            .map((item) => item.trim()).filter(Boolean);
          if (theme === "light") registeredCount += views.length;

          for (const view of views) {
            if (themeCount >= VIEW_LIMIT) break;
            themeCount += 1;
            const base: CaptureRecord = {
              activity, view, theme, surface: "", status: "ERROR",
              pending: [], pageErrors: [],
            };
            try {
              await explorer.getByRole("button", { name: view, exact: true }).click();
              await expect(page.locator(".kw-workbench h1")).toHaveText(view, { timeout: 30_000 });
              const settled = await waitForVisualSettle(page);
              const surface = await page.locator(".kw-workbench").getAttribute("data-workbench-surface");
              const target = path.join(root,
                theme + "-" + String(themeCount).padStart(2, "0") +
                "-" + safeName(activity) + "-" + safeName(view) + ".png");
              const image = await page.screenshot({ path: target, fullPage: false });
              const record: CaptureRecord = {
                ...base,
                surface: surface || "",
                file: path.relative(root, target),
                width: image.readUInt32BE(16),
                height: image.readUInt32BE(20),
                status: settled.pending.length === 0 && settled.opacitySettled
                  ? "CAPTURED" : "UNSETTLED",
                pending: settled.pending,
                pageErrors: pageErrors.splice(0),
              };
              records.push(record);
            } catch (error) {
              records.push({
                ...base, status: "ERROR", error: String(error).slice(0, 1200),
                pageErrors: pageErrors.splice(0),
              });
            }
            await page.keyboard.press("Escape").catch(() => {});
          }
          if (themeCount >= VIEW_LIMIT) break;
        }
        checkedViews += themeCount;
      }
    } catch (error) {
      fatalError = String(error);
    } finally {
      const captured = records.filter((entry) => entry.status === "CAPTURED");
      const issues = records.filter((entry) => entry.status !== "CAPTURED" || entry.pageErrors.length);
      const expected = VIEW_LIMIT === REQUIRED_VIEWS ? REQUIRED_VIEWS * 2 : VIEW_LIMIT * 2;
      const complete = VIEW_LIMIT === REQUIRED_VIEWS
        && registeredCount === REQUIRED_VIEWS
        && records.length === expected && issues.length === 0 && !fatalError;
      const ledger = {
        source: "KForge isolated Playwright browser — NOT packaged desktop or approved visual parity",
        generatedAt: new Date().toISOString(),
        viewport: VIEWPORT,
        themes: THEMES,
        registeredViews: registeredCount,
        targetViewsPerTheme: VIEW_LIMIT,
        recordedViews: checkedViews,
        screenshotCount: records.filter((entry) => Boolean(entry.file)).length,
        capturedWithoutDetectedRuntimeErrors: captured.length - captured.filter((entry) => entry.pageErrors.length).length,
        issues: issues.length,
        status: fatalError ? "FAILED" : complete ? "CAPTURED_NOT_VISUALLY_APPROVED"
          : VIEW_LIMIT < REQUIRED_VIEWS ? "PARTIAL_SMOKE" : "INCOMPLETE",
        fatalError,
        records,
      };
      fs.writeFileSync(path.join(root, "ledger.json"), JSON.stringify(ledger, null, 2));
      fs.writeFileSync(path.join(root, "README.md"),
        "# KForge view capture evidence\n\n" +
        "Source: isolated Playwright production browser. These screenshots are NOT owner-approved design parity, " +
        "not packaged Windows verification and not proof that each action handler works.\n\n" +
        "Status: " + ledger.status + "\n" +
        "Registered views: " + registeredCount + "\n" +
        "Screenshots: " + ledger.screenshotCount + "\n" +
        "Issues: " + issues.length + "\n");
      console.log("[visual-ledger] " + root);
      console.log("[visual-ledger] " + ledger.status + " " + ledger.screenshotCount +
        " screenshots; " + issues.length + " flagged entries");
    }

    expect(fatalError, "fatal capture error").toBeUndefined();
    if (VIEW_LIMIT === REQUIRED_VIEWS) {
      expect(registeredCount, "all canonical registered views").toBe(REQUIRED_VIEWS);
      expect(records.length, "Day/Night count").toBe(REQUIRED_VIEWS * 2);
      const issues = records.filter((entry) => entry.status !== "CAPTURED" || entry.pageErrors.length);
      expect(issues, "unsettled/error captures require visual review").toEqual([]);
    } else {
      expect(records.length, "smoke captures").toBe(VIEW_LIMIT * 2);
    }
  });
});

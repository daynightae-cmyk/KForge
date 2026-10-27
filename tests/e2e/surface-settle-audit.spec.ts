import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { clearProjectContext, selectActivity, setProjectContext } from "./helpers/workbench";

/**
 * Walks every registered activity/view pair in the running product and requires the
 * surface to leave its loading state, so a route that renders cannot pass for a route
 * that resolves. Evidence is written under verification/ (gitignored) for the audit.
 */

const ACTIVITY_LABELS = ["Projects", "AI", "Online", "Intelligence", "Quality", "Developer Tools", "Remote / Git", "Release", "System"] as const;
const EXPECTED_VIEW_COUNT = 68;
const SETTLE_TIMEOUT = 45_000;
const EVIDENCE_ROOT = path.join(process.cwd(), "verification", "settle-audit");
const FINAL_ROOT = path.join(process.cwd(), "verification", "final");

type ViewResult = {
  activity: string;
  view: string;
  surface: string;
  settled: boolean;
  stuckOn: string;
  pageErrors: string[];
};

async function prepareWorkspace(page: import("@playwright/test").Page) {
  const reset = await page.request.post("/api/workspace/settings/reset", { data: { confirmed: true } });
  expect(reset.ok(), await reset.text()).toBeTruthy();
  const platform = await page.request.post("/api/workspace/platform/mode", { data: { mode: "offline" } });
  expect(platform.ok(), await platform.text()).toBeTruthy();
  const opened = await page.request.post("/api/workspace/projects/open", { data: { path: process.cwd() } });
  expect(opened.ok(), await opened.text()).toBeTruthy();
  const { project } = await opened.json() as { project: { id: string } };
  return project.id;
}

async function setTheme(page: import("@playwright/test").Page, theme: "light" | "dark") {
  const current = await (await page.request.get("/api/workspace/settings")).json() as { settings: Record<string, unknown> };
  const next = { ...current.settings, appearance: { ...(current.settings.appearance as Record<string, unknown>), theme } };
  const saved = await (await page.request.patch("/api/workspace/settings", { data: next })).json() as { settings: { appearance: { theme: string } } };
  expect(saved.settings.appearance.theme).toBe(theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".kw-topbar")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("html")).toHaveClass(new RegExp(`(^|\\s)${theme}(\\s|$)`));
}

/** A surface is settled once no status region still reports a pending load. */
async function settleSurface(page: import("@playwright/test").Page) {
  const workbench = page.locator(".kw-workbench");
  await expect(workbench).toBeVisible();
  let stuckOn = "";
  try {
    await page.waitForFunction(() => {
      const region = document.querySelector(".kw-workbench");
      if (!region) return false;
      const pending = Array.from(region.querySelectorAll('[role="status"]')).some((node) => {
        const text = (node.textContent || "").trim();
        return /^Loading\b/i.test(text) || /^Reading\b/i.test(text) || /^Contacting\b/i.test(text) || /^Analyzing\b/i.test(text);
      });
      return !pending;
    }, { timeout: SETTLE_TIMEOUT });
  } catch {
    const pending = await workbench.locator('[role="status"]').allTextContents();
    stuckOn = pending.map((t) => t.trim()).filter(Boolean).join(" | ").slice(0, 180);
  }
  // kw-glass-rise fades each workbench child in, so a shot taken here without
  // waiting lands on a translucent surface and stops proving anything about colour.
  await page.waitForFunction(() => {
    const scroll = document.querySelector(".kw-workbench-scroll");
    if (!scroll) return false;
    return Array.from(scroll.children).every((child) => Number(getComputedStyle(child).opacity) > 0.999);
  }, { timeout: 15_000 });
  return stuckOn;
}

test.describe("KForge surface settle audit", () => {
  test.setTimeout(1_800_000);

  test("every registered view leaves its loading state and renders content", async ({ page }) => {
    fs.mkdirSync(EVIDENCE_ROOT, { recursive: true });
    const projectId = await prepareWorkspace(page);
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".kw-topbar")).toBeVisible({ timeout: 60_000 });
    await setTheme(page, "light");
    await setProjectContext(page, projectId);

    const results: ViewResult[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    let viewTotal = 0;
    for (const activity of ACTIVITY_LABELS) {
      await selectActivity(page, activity);
      const explorer = page.getByRole("complementary", { name: `${activity} Explorer`, exact: true });
      const labels = (await explorer.getByRole("button").allTextContents())
        .map((text) => text.trim())
        .filter(Boolean);
      viewTotal += labels.length;
      for (const view of labels) {
        await explorer.getByRole("button", { name: view, exact: true }).click();
        await expect(page.locator(".kw-workbench h1")).toHaveText(view, { timeout: 30_000 });
        const stuckOn = await settleSurface(page);
        const surface = await page.locator(".kw-workbench").getAttribute("data-workbench-surface") || "";
        const bodyLength = (await page.locator(".kw-workbench").innerText()).trim().length;
        results.push({ activity, view, surface, settled: !stuckOn && bodyLength > 40, stuckOn, pageErrors: errors.splice(0, errors.length) });
        // Close any dialog an action view may have opened before moving on.
        await page.keyboard.press("Escape");
      }
    }

    fs.writeFileSync(path.join(EVIDENCE_ROOT, "views.json"), JSON.stringify(results, null, 2));
    const stuck = results.filter((entry) => !entry.settled);
    console.log(`[settle-audit] views=${viewTotal} checked=${results.length} stuck=${stuck.length}`);
    for (const entry of stuck) console.log(`[settle-audit] STUCK ${entry.activity} / ${entry.view} :: ${entry.stuckOn || "empty surface"}`);

    expect(viewTotal, "the registered view count changed").toBe(EXPECTED_VIEW_COUNT);
    expect(stuck, `views that never left a loading state: ${stuck.map((s) => `${s.activity}/${s.view}`).join(", ")}`).toEqual([]);
    const errored = results.filter((entry) => entry.pageErrors.length);
    expect(errored, `views that raised uncaught page errors: ${errored.map((s) => `${s.activity}/${s.view}: ${s.pageErrors[0]}`).join(" | ")}`).toEqual([]);
  });

  const PRIORITY_MISSIONS: Array<[string, string, string]> = [
    ["Projects", "Workspace", "01-workspace"],
    ["AI", "Providers", "02-providers"],
    ["Online", "Discover", "03-discover"],
    ["Intelligence", "Project Graph", "04-project-graph"],
    ["Projects", "Project Health", "05-project-health"],
    ["AI", "Agents", "06-agents"],
    ["Remote / Git", "Git", "07-git"],
    ["Quality", "KForge Sonar", "08-sonar"],
    ["Release", "Release Gate", "09-release-gate"],
    ["System", "Settings", "10-settings"],
  ];

  test("captures settled Day and Night evidence for the ten priority missions", async ({ page }) => {
    fs.mkdirSync(FINAL_ROOT, { recursive: true });
    const projectId = await prepareWorkspace(page);
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".kw-topbar")).toBeVisible({ timeout: 60_000 });
    await setTheme(page, "light");

    await selectActivity(page, "Projects");
    await clearProjectContext(page);
    await settleSurface(page);
    await page.screenshot({ path: path.join(FINAL_ROOT, "day-01-workspace-no-project.png") });

    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      await setProjectContext(page, projectId);
      const prefix = theme === "light" ? "day" : "night";
      for (const [activity, view, file] of PRIORITY_MISSIONS) {
        await selectActivity(page, activity);
        const explorer = page.getByRole("complementary", { name: `${activity} Explorer`, exact: true });
        await explorer.getByRole("button", { name: view, exact: true }).click();
        await expect(page.locator(".kw-workbench h1")).toHaveText(view, { timeout: 30_000 });
        // The previous evidence set used fixed waits and published loading
        // skeletons, so the surface must be settled before it is shot.
        await settleSurface(page);
        // A shot of the projectless fallback proves nothing about the surface.
        await expect(page.locator(".kw-workbench"), `${view} fell back to no-project`).not.toContainText("No project selected");
        await page.screenshot({ path: path.join(FINAL_ROOT, `${prefix}-${file}.png`) });
      }
    }
  });

  test("keeps the reborn Git stat tiles readable in both themes", async ({ page }) => {
    const projectId = await prepareWorkspace(page);
    await page.goto("/workspace", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".kw-topbar")).toBeVisible({ timeout: 60_000 });

    const report: string[] = [];
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      await setProjectContext(page, projectId);
      await selectActivity(page, "Remote / Git");
      await page.getByRole("complementary", { name: "Remote / Git Explorer" }).getByRole("button", { name: "Git", exact: true }).click();
      await expect(page.locator(".kw-workbench h1")).toHaveText("Git");
      await settleSurface(page);
      await expect(page.locator(".kf-stat").first()).toBeVisible();
      const measured = await page.evaluate(() => {
        const toLinear = (value: string) => {
          const parts = value.match(/[\d.]+/g) || [];
          return parts.slice(0, 3).map((n) => {
            const c = Number(n) / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
        };
        const luminance = (rgb: number[]) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
        const ratio = (fg: string, bg: string) => {
          const a = luminance(toLinear(fg));
          const b = luminance(toLinear(bg));
          return Number(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2));
        };
        // A translucent tile would report a fine colour yet render below AA, so
        // the effective contrast is folded through the element's own opacity.
        const effectiveAlpha = (node: HTMLElement) => {
          let alpha = 1;
          for (let current: HTMLElement | null = node; current && current !== document.body; current = current.parentElement) {
            alpha *= Number(getComputedStyle(current).opacity);
          }
          return alpha;
        };
        const tile = document.querySelector(".kf-stat") as HTMLElement;
        const cardBg = getComputedStyle(tile).backgroundColor;
        const pick = (selector: string) => {
          const node = tile.querySelector(selector) as HTMLElement | null;
          if (!node) return null;
          const style = getComputedStyle(node);
          return { selector, fontSize: style.fontSize, alpha: effectiveAlpha(node), contrast: ratio(style.color, cardBg) };
        };
        return [pick(".kf-stat__label"), pick(".kf-stat__value"), pick(".kf-stat__foot")].filter(Boolean) as Array<{ selector: string; fontSize: string; alpha: number; contrast: number }>;
      });
      for (const entry of measured) {
        expect(entry.alpha, `${theme} ${entry.selector} renders translucent`).toBeGreaterThanOrEqual(0.99);
        expect(entry.contrast, `${theme} ${entry.selector} at ${entry.fontSize} fails WCAG AA`).toBeGreaterThanOrEqual(4.5);
      }
      report.push(theme, JSON.stringify(measured));
    }
    console.log(`[contrast] ${report.join(" ")}`);
  });
});

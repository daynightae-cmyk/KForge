import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("KForge CSS ownership", () => {
  it("keeps global CSS minimal and route/activity CSS owned by its surface", () => {
    const global = root("client/global.css");
    const splash = root("client/pages/KnouxForgeInstallation.css");
    const workbench = root("client/workbench/workbench.css");
    const online = root("client/workbench/online.css");
    const preview = root("client/workbench/preview.css");
    expect(global).not.toContain("Knoux Edita PRO");
    expect(global).not.toContain(".knoux-");
    expect(global).not.toContain(".kf-app");
    expect(global).not.toContain(".kf-splash");
    expect(global).not.toContain("fonts.googleapis.com");
    expect(splash).toContain(".kf-splash");
    expect(workbench).not.toContain(".kw-capability-card");
    expect(online).toContain(".kw-capability-card");
    expect(workbench).not.toContain(".kw-workbench-scroll:has(.kw-preview)");
    expect(preview).toContain(".kw-workbench-scroll:has(.kw-preview)");
  });
});

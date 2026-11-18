import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { APP_USER_MODEL_ID, createApplicationMenuTemplate } = require("./appMenu.cjs") as {
  APP_USER_MODEL_ID: string;
  createApplicationMenuTemplate: (options: {
    productName: string;
    about?: () => void;
    openDiagnostics?: () => void;
    isDevelopment?: boolean;
  }) => Array<{ role?: string; label?: string; submenu?: Array<{ role?: string; label?: string; type?: string }> }>;
};

function roles(template: ReturnType<typeof createApplicationMenuTemplate>): string[] {
  return template.flatMap((item) => [item.role, ...(item.submenu || []).map((child) => child.role)]).filter(Boolean) as string[];
}

describe("desktop application menu", () => {
  it("keeps the Windows app identity aligned with the packaged application id", () => {
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    expect(packageJson.build.appId).toBe(APP_USER_MODEL_ID);
  });

  it("does not expose reload or DevTools in a packaged production menu", () => {
    const template = createApplicationMenuTemplate({ productName: "KNOuX Forge", about: () => undefined, openDiagnostics: () => undefined });
    const values = roles(template);
    expect(values).not.toContain("reload");
    expect(values).not.toContain("toggleDevTools");
    expect(values).toContain("editMenu");
    expect(values).toContain("togglefullscreen");
    expect(template.flatMap((item) => item.submenu || []).map((item) => item.label)).toContain("About KNOuX Forge");
    expect(template.flatMap((item) => item.submenu || []).map((item) => item.label)).toContain("Open Diagnostics Folder");
  });

  it("retains developer controls only for the development runtime", () => {
    const template = createApplicationMenuTemplate({ productName: "KNOuX Forge", about: () => undefined, isDevelopment: true });
    const values = roles(template);
    expect(values).toContain("reload");
    expect(values).toContain("toggleDevTools");
  });
});

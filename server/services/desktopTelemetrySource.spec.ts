import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("packaged desktop Preview telemetry wiring", () => {
  it("uses the current one-details-object Electron console-message contract and exports the bounded recorder", () => {
    const desktop = readFileSync(new URL("../../desktop/main.cjs", import.meta.url), "utf8");
    const productionServer = readFileSync(new URL("../productionServer.ts", import.meta.url), "utf8");

    expect(desktop).toContain('webContents.on("console-message", (details) => recordDesktopConsole(details))');
    expect(desktop).toContain("productionServerModule.recordPreviewBrowserConsole");
    expect(desktop).not.toMatch(/console-message[\s\S]{0,100}\(event\s*,\s*level\s*,\s*message\s*,\s*line/);
    expect(productionServer).toContain("recordPreviewBrowserConsole");
    expect(productionServer).toContain("export { recordPreviewBrowserConsole, recordTopologyBrowserTraffic }");
  });
});

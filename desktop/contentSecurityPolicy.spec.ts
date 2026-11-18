import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KFORGE_CONTENT_SECURITY_POLICY } from "../server/httpHardening";

describe("packaged desktop security policy parity", () => {
  it("applies the exact content security policy used by the production browser runtime", async () => {
    const main = await fs.readFile(path.join(process.cwd(), "desktop", "main.cjs"), "utf8");
    // The packaged shell is the runtime that proves the built SPA works under
    // this policy. If either side changes, the standalone browser runtime and
    // the desktop app must move together.
    expect(main).toContain(`"Content-Security-Policy": ["${KFORGE_CONTENT_SECURITY_POLICY}"]`);
  });
});

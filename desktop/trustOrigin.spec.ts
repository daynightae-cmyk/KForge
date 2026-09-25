import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { isTrustedKForgeOrigin as isTrustedSharedOrigin } from "../shared/trustOrigin";

const require = createRequire(import.meta.url);
const { isTrustedKForgeOrigin, toSafeExternalHttpUrl } = require("./trustOrigin.cjs") as {
  isTrustedKForgeOrigin: (candidateUrl: unknown, serverUrl: unknown) => boolean;
  toSafeExternalHttpUrl: (candidateUrl: unknown) => string | null;
};

const serverUrl = "http://127.0.0.1:53124";

describe("packaged desktop origin trust", () => {
  it("keeps the packaged CommonJS origin check aligned with the shared TypeScript contract", () => {
    const cases: Array<[string, string, boolean]> = [
      [`${serverUrl}/workspace`, serverUrl, true],
      [`http://127.0.0.1:53124@evil.example/workspace`, serverUrl, false],
      ["http://localhost:9999/workspace", serverUrl, false],
      ["http://127.0.0.1.evil.example/workspace", serverUrl, false],
      [`file://${serverUrl}/workspace`, serverUrl, false],
      ["not-a-url", serverUrl, false],
    ];
    for (const [candidate, server, expected] of cases) {
      expect(isTrustedKForgeOrigin(candidate, server)).toBe(expected);
      expect(isTrustedSharedOrigin(candidate, server)).toBe(expected);
    }
  });

  it("opens only bounded credential-free http(s) links externally", () => {
    expect(toSafeExternalHttpUrl("https://example.com/docs")).toBe("https://example.com/docs");
    expect(toSafeExternalHttpUrl("  http://example.com/a?b=1  ")).toBe("http://example.com/a?b=1");
    expect(toSafeExternalHttpUrl("file:///C:/Windows/System32/calc.exe")).toBeNull();
    expect(toSafeExternalHttpUrl("javascript:alert(1)")).toBeNull();
    expect(toSafeExternalHttpUrl("https://user:secret@example.com/")).toBeNull();
    expect(toSafeExternalHttpUrl(`https://example.com/${"a".repeat(2100)}`)).toBeNull();
    expect(toSafeExternalHttpUrl("")).toBeNull();
    expect(toSafeExternalHttpUrl(undefined)).toBeNull();
  });
});

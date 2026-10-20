import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(new URL("./KnouxLivingMark.tsx", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

describe("KNOuX Living Mark production contract", () => {
  it("preserves the canonical brand text and has no external branding fetch", () => {
    expect(source).toContain('const word = "KNOuX"');
    expect(source).toContain('helvetiker_bold.typeface.json?raw');
    expect(source).not.toMatch(/threejs\.org|https?:\/\//i);
    expect(source).not.toContain("fontLoader.load");
  });

  it("keeps motion deterministic and supports the three official modes", () => {
    expect(source).not.toContain("Math.random");
    expect(source).toContain('"splash" | "workspace" | "idle"');
    expect(source).toContain("LETTER_PHASES");
    expect(source).toContain("LETTER_SPEEDS");
  });

  it("contains lifecycle, accessibility and lower-end GPU safeguards", () => {
    expect(source).toContain("prefers-reduced-motion: reduce");
    expect(source).toContain('document.addEventListener("visibilitychange"');
    expect(source).toContain("renderer.setAnimationLoop(null)");
    expect(source).toContain("renderer.dispose()");
    expect(source).toContain("renderer.forceContextLoss()");
    expect(source).toContain('low: { pixelRatio: 1');
    expect(source).toContain('medium: { pixelRatio: 1.35');
    expect(source).toContain('high: { pixelRatio: 1.75');
  });
});

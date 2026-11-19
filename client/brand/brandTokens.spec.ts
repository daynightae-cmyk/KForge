import { describe, expect, it } from "vitest";
import {
  BRAND_TOKEN_BY_HEX,
  KFORGE_BRAND,
  KFORGE_BRAND_TOKENS,
  KFORGE_PUBLIC_BRAND_ASSETS,
  brandToken,
  readableTextFor,
} from "./brandTokens";

describe("KForge canonical brand tokens", () => {
  it("publishes unique, valid hexadecimal tokens", () => {
    expect(KFORGE_BRAND_TOKENS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(KFORGE_BRAND_TOKENS.map((token) => token.hex.toUpperCase())).size).toBe(KFORGE_BRAND_TOKENS.length);
    expect(new Set(KFORGE_BRAND_TOKENS.map((token) => token.id)).size).toBe(KFORGE_BRAND_TOKENS.length);
    for (const token of KFORGE_BRAND_TOKENS) {
      expect(token.hex, token.id).toMatch(/^#[0-9A-F]{6}$/);
      expect(token.hsl, token.id).toMatch(/^\d{1,3} \d{1,3}% \d{1,3}%$/);
      expect(token.usage.length, token.id).toBeGreaterThan(30);
      expect(BRAND_TOKEN_BY_HEX.get(token.hex.toUpperCase())?.id).toBe(token.id);
    }
  });

  it("keeps the approved identity values and writing forms stable", () => {
    expect(KFORGE_BRAND.name).toBe("KNOuX Forge");
    expect(KFORGE_BRAND.shortName).toBe("KForge");
    expect(KFORGE_BRAND.wordmark.product).toBe("KNOuX Forge");
    expect(brandToken("forge-violet")?.hex).toBe("#8958FF");
    expect(brandToken("signal-teal")?.hex).toBe("#2AD9C8");
    expect(KFORGE_BRAND.tagline.ar).toMatch(/[\u0600-\u06FF]/);
    expect(KFORGE_BRAND.typography.latin).toContain("Inter");
  });

  it("describes only downloadable public assets that exist under /brand", () => {
    expect(KFORGE_PUBLIC_BRAND_ASSETS.length).toBeGreaterThanOrEqual(3);
    for (const asset of KFORGE_PUBLIC_BRAND_ASSETS) {
      expect(asset.src, asset.id).toMatch(/^\/brand\/[a-z0-9-]+\.svg$/);
      expect(asset.format, asset.id).toBe("SVG");
      expect(asset.downloadable, asset.id).toBe(true);
    }
  });

  it("chooses readable foregrounds for filled swatches", () => {
    expect(readableTextFor("#F7F5FF")).toBe("#07070B");
    expect(readableTextFor("#07070B")).toBe("#F7F5FF");
    expect(readableTextFor("#8958FF")).toBe("#F7F5FF");
    expect(readableTextFor("not-a-colour")).toBe("#F7F5FF");
  });
});

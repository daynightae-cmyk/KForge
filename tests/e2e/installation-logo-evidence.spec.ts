import { expect, test } from "@playwright/test";

test("KForge startup reveal uses the compact lossless WebP runtime logo", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const logo = page.getByRole("img", { name: "Knoux Forge official logo" });
  await expect(logo).toBeVisible();

  const decoded = await logo.evaluate(async (element) => {
    const image = element as HTMLImageElement;
    await image.decode();
    const response = await fetch(image.currentSrc, { cache: "no-store" });
    if (!response.ok) throw new Error(`Runtime logo request failed with ${response.status}`);
    const bytes = await response.arrayBuffer();
    return {
      src: image.currentSrc,
      bytes: bytes.byteLength,
      contentType: response.headers.get("content-type"),
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  });

  expect(new URL(decoded.src).pathname).toMatch(/knoux-forge-official-logo-.*\.webp$/);
  expect(decoded.bytes).toBeGreaterThan(0);
  expect(decoded.bytes).toBeLessThanOrEqual(700_000);
  expect(decoded.contentType).toContain("image/webp");
  expect(decoded.width).toBeGreaterThan(0);
  expect(decoded.height).toBeGreaterThan(0);
});

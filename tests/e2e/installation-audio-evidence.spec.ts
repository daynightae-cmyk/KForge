import { expect, test } from "@playwright/test";

test("KForge startup reveal uses compact Opus audio that Chromium decodes", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const support = await page.evaluate(() => document.createElement("audio").canPlayType('audio/ogg; codecs="opus"'));
  expect(support).not.toBe("");

  const decoded = await page.evaluate(async () => {
    const response = await fetch("/audio/logo-reveal-slow.ogg", { cache: "no-store" });
    if (!response.ok) throw new Error(`Reveal audio request failed with ${response.status}`);
    const bytes = await response.arrayBuffer();
    const context = new AudioContext();
    try {
      const audioBuffer = await context.decodeAudioData(bytes.slice(0));
      return {
        bytes: bytes.byteLength,
        duration: audioBuffer.duration,
        channels: audioBuffer.numberOfChannels,
        sampleRate: audioBuffer.sampleRate,
      };
    } finally {
      await context.close();
    }
  });

  expect(decoded.bytes).toBeGreaterThan(0);
  expect(decoded.bytes).toBeLessThanOrEqual(250_000);
  expect(decoded.duration).toBeGreaterThan(9);
  expect(decoded.duration).toBeLessThan(12);
  expect(decoded.channels).toBeGreaterThan(0);
  expect(decoded.sampleRate).toBeGreaterThan(0);
});

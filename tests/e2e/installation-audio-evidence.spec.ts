import { expect, test } from "@playwright/test";

test("KForge startup reveal serves compact valid Ogg Opus audio through the product media contract", async ({ page, request }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Browser evidence: the same media capability the product relies on when it creates
  // HTMLAudioElement for the startup reveal. Keep this separate from transport evidence so
  // an installed Edge build cannot turn a successful HTTP response into a zero-byte body
  // through page-fetch/media interception quirks.
  const support = await page.evaluate(() =>
    document.createElement("audio").canPlayType('audio/ogg; codecs="opus"'),
  );

  // Transport evidence: Playwright's request context reads the bytes directly from the
  // production server. This verifies the served asset deterministically while still using
  // the exact production route rather than reading a repository file from disk.
  const response = await request.get("/audio/logo-reveal-slow.ogg", {
    headers: {
      "cache-control": "no-cache",
    },
  });

  expect(response.ok(), `Reveal audio request failed with ${response.status()}`).toBe(true);

  const body = await response.body();
  const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);

  const findAscii = (needle: string) => {
    const expected = Array.from(needle, (character) => character.charCodeAt(0));
    outer: for (let index = 0; index <= bytes.length - expected.length; index += 1) {
      for (let offset = 0; offset < expected.length; offset += 1) {
        if (bytes[index + offset] !== expected[offset]) continue outer;
      }
      return index;
    }
    return -1;
  };

  const oggSignature = String.fromCharCode(...bytes.slice(0, 4));
  const opusHeadOffset = findAscii("OpusHead");
  const opusTagsOffset = findAscii("OpusTags");
  const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = opusHeadOffset >= 0 ? bytes[opusHeadOffset + 9] : 0;
  const preSkip = opusHeadOffset >= 0 ? dataView.getUint16(opusHeadOffset + 10, true) : 0;
  const inputSampleRate = opusHeadOffset >= 0 ? dataView.getUint32(opusHeadOffset + 12, true) : 0;

  let finalGranule = 0n;
  const unknownGranule = (1n << 64n) - 1n;
  for (let index = 0; index <= bytes.length - 14; index += 1) {
    if (
      bytes[index] !== 0x4f
      || bytes[index + 1] !== 0x67
      || bytes[index + 2] !== 0x67
      || bytes[index + 3] !== 0x53
    ) continue;

    let granule = 0n;
    for (let byte = 7; byte >= 0; byte -= 1) {
      granule = (granule << 8n) | BigInt(bytes[index + 6 + byte]);
    }
    if (granule !== unknownGranule && granule > finalGranule) finalGranule = granule;
  }

  const duration = finalGranule > BigInt(preSkip)
    ? Number(finalGranule - BigInt(preSkip)) / 48_000
    : 0;

  const contentType = response.headers()["content-type"] || "";

  expect(support).not.toBe("");
  expect(bytes.byteLength).toBeGreaterThan(0);
  expect(bytes.byteLength).toBeLessThanOrEqual(250_000);
  expect(oggSignature).toBe("OggS");
  expect(opusHeadOffset).toBeGreaterThanOrEqual(0);
  expect(opusTagsOffset).toBeGreaterThan(opusHeadOffset);
  expect(channels).toBeGreaterThan(0);
  expect(inputSampleRate).toBeGreaterThan(0);
  expect(duration).toBeGreaterThan(9);
  expect(duration).toBeLessThan(12);
  expect(contentType.toLowerCase()).toContain("audio");
});

import { expect, test } from "@playwright/test";

test("KForge startup reveal serves compact valid Ogg Opus audio through the product media contract", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const evidence = await page.evaluate(async () => {
    const audio = document.createElement("audio");
    const support = audio.canPlayType('audio/ogg; codecs="opus"');
    const response = await fetch("/audio/logo-reveal-slow.ogg", { cache: "no-store" });
    if (!response.ok) throw new Error(`Reveal audio request failed with ${response.status}`);

    const bytes = new Uint8Array(await response.arrayBuffer());
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

    return {
      support,
      bytes: bytes.byteLength,
      contentType: response.headers.get("content-type") || "",
      oggSignature,
      opusHeadOffset,
      opusTagsOffset,
      channels,
      inputSampleRate,
      duration,
    };
  });

  expect(evidence.support).not.toBe("");
  expect(evidence.bytes).toBeGreaterThan(0);
  expect(evidence.bytes).toBeLessThanOrEqual(250_000);
  expect(evidence.oggSignature).toBe("OggS");
  expect(evidence.opusHeadOffset).toBeGreaterThanOrEqual(0);
  expect(evidence.opusTagsOffset).toBeGreaterThan(evidence.opusHeadOffset);
  expect(evidence.channels).toBeGreaterThan(0);
  expect(evidence.inputSampleRate).toBeGreaterThan(0);
  expect(evidence.duration).toBeGreaterThan(9);
  expect(evidence.duration).toBeLessThan(12);
  expect(evidence.contentType.toLowerCase()).toContain("audio");
});
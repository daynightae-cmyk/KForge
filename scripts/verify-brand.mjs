import { promises as fs } from "fs";
import path from "path";

/**
 * Brand contract verification.
 *
 * This script proves that the brand module, the public assets, the document
 * metadata and the brand guide still describe the same identity. It never
 * claims signing, store acceptance or provider connectivity.
 */

const root = process.cwd();
const failures = [];
const notes = [];

const fail = (message) => failures.push(message);
const read = (relativePath) => fs.readFile(path.join(root, relativePath), "utf8");

const EXPECTED_TOKENS = [
  ["forge-violet", "#8958FF"],
  ["violet-deep", "#6F31EE"],
  ["violet-night", "#5122B8"],
  ["ink", "#07070B"],
  ["night-plum", "#0D0A14"],
  ["pearl", "#F7F5FF"],
  ["glass-lavender", "#F0EBF8"],
  ["luminous-lavender", "#C8AFFF"],
  ["signal-teal", "#2AD9C8"],
  ["bone", "#E6E1D2"],
];

const IDENTITY = {
  name: "KNOuX Forge",
  shortName: "KForge",
  legalName: "DAY NIGHT DELIVERY SERVICES",
  taglineEn: "Engineering a brighter tomorrow, together.",
  taglineAr: "هندسة أفضل لمستقبل أكثر إشراقًا",
};

const brandSource = await read("client/brand/brandTokens.ts");

for (const [id, hex] of EXPECTED_TOKENS) {
  const block = brandSource.match(new RegExp(`\\bid:\\s*"${id}"[\\s\\S]{0,400}?\\bhex:\\s*"([^"]+)"`));
  if (!block) {
    fail(`brand token "${id}" is missing from client/brand/brandTokens.ts`);
  } else if (block[1].toUpperCase() !== hex) {
    fail(`brand token "${id}" is ${block[1]}; expected ${hex}`);
  }
}

for (const [key, value] of Object.entries(IDENTITY)) {
  if (!brandSource.includes(value)) fail(`identity value ${key} is missing from brandTokens.ts: ${value}`);
}

if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(brandSource)) {
  fail("brandTokens.ts references a remote web font; the brand stack must stay local and fallback-based.");
}

const assetsBlock = brandSource.slice(
  brandSource.indexOf("KFORGE_PUBLIC_BRAND_ASSETS"),
  brandSource.indexOf("BRAND_TOKEN_BY_HEX"),
);
const assetPaths = [...assetsBlock.matchAll(/src:\s*"(\/brand\/[a-z0-9-]+\.svg)"/g)].map((match) => match[1]);
if (assetPaths.length < 3) fail(`KFORGE_PUBLIC_BRAND_ASSETS declares ${assetPaths.length} SVG asset(s); at least 3 are required.`);
if (new Set(assetPaths).size !== assetPaths.length) fail("KFORGE_PUBLIC_BRAND_ASSETS contains duplicate public paths.");

const assetBytes = [];
for (const assetPath of assetPaths) {
  const filePath = path.join(root, "public", ...assetPath.split("/").filter(Boolean));
  try {
    const source = await fs.readFile(filePath, "utf8");
    const bytes = Buffer.byteLength(source, "utf8");
    assetBytes.push(bytes);
    if (bytes > 40_000) fail(`${assetPath} is ${bytes} bytes; the public SVG budget is 40000 bytes.`);
    if (!/^<svg[\s>]/i.test(source.trim())) fail(`${assetPath} does not begin with an <svg> root element.`);
    if (!/\bviewBox="[^"]+"/.test(source)) fail(`${assetPath} has no viewBox and cannot scale predictably.`);
    if (!/<title[\s>]/i.test(source)) fail(`${assetPath} has no <title> for accessible naming.`);
    if (/<script[\s>]/i.test(source)) fail(`${assetPath} contains a script element; public brand assets must stay inert.`);
  } catch {
    fail(`${assetPath} is declared in the brand module but does not exist under public/.`);
  }
}

const manifest = JSON.parse(await read("public/site.webmanifest"));
if (manifest.name !== IDENTITY.name) fail(`site.webmanifest name is "${manifest.name}"; expected "${IDENTITY.name}".`);
if (manifest.short_name !== IDENTITY.shortName) fail(`site.webmanifest short_name is "${manifest.short_name}"; expected "${IDENTITY.shortName}".`);
if (manifest.start_url !== "/workspace") fail(`site.webmanifest start_url is "${manifest.start_url}"; expected "/workspace".`);
if (manifest.display !== "standalone") fail("site.webmanifest must declare display: standalone for an installed window.");
if (!EXPECTED_TOKENS.some(([, hex]) => hex === String(manifest.theme_color).toUpperCase())) {
  fail(`site.webmanifest theme_color ${manifest.theme_color} is not a canonical brand token.`);
}
if (!EXPECTED_TOKENS.some(([, hex]) => hex === String(manifest.background_color).toUpperCase())) {
  fail(`site.webmanifest background_color ${manifest.background_color} is not a canonical brand token.`);
}
const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
if (!icons.length) fail("site.webmanifest declares no icon.");
for (const icon of icons) {
  if (!assetPaths.includes(icon.src)) fail(`site.webmanifest icon ${icon.src} is not a declared public brand asset.`);
}

const index = await read("index.html");
for (const needle of ["/site.webmanifest", "/brand/favicon.svg", 'name="theme-color"', 'property="og:title"', "/brand/social-card.svg"]) {
  if (!index.includes(needle)) fail(`index.html is missing ${needle}.`);
}
if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(index)) fail("index.html references a remote web font.");

const docs = await read("docs/BRANDING.md");
for (const [id, hex] of EXPECTED_TOKENS) {
  if (!docs.includes(hex)) fail(`docs/BRANDING.md does not document ${hex} (${id}).`);
}
for (const [key, value] of Object.entries(IDENTITY)) {
  if (!docs.includes(value)) fail(`docs/BRANDING.md does not document ${key}.`);
}
for (const relativePath of ["docs/ONBOARDING.md", "docs/WORKFLOWS.md"]) {
  try {
    await fs.access(path.join(root, relativePath));
  } catch {
    fail(`${relativePath} is missing; the customization contract is incomplete.`);
  }
}

const packageJson = JSON.parse(await read("package.json"));
if (packageJson.scripts?.["verify:brand"] !== "node scripts/verify-brand.mjs") {
  fail('package.json must expose "verify:brand": "node scripts/verify-brand.mjs".');
}
const gate = await read("scripts/verify-gate.mjs");
if (!gate.includes("verify-brand.mjs")) fail("scripts/verify-gate.mjs does not execute the brand contract check.");
if (!gate.includes('"brand-contract"')) fail("scripts/verify-gate.mjs does not record the brand-contract step.");

const totalBytes = assetBytes.reduce((sum, bytes) => sum + bytes, 0);
if (totalBytes > 120_000) fail(`public brand SVGs total ${totalBytes} bytes; the combined budget is 120000 bytes.`);

if (failures.length) {
  console.error("KForge brand verification: FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`KForge brand verification: PASS (${EXPECTED_TOKENS.length} tokens, ${assetPaths.length} public SVG assets, ${totalBytes} bytes, manifest + metadata + guide aligned).`);
  for (const note of notes) console.log(`- ${note}`);
}

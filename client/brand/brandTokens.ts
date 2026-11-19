/**
 * Canonical KNOuX Forge brand tokens.
 *
 * This module is the single source of truth for product identity values that are
 * rendered in the application or copied into design work. The values are also
 * documented in `docs/BRANDING.md`; `scripts/verify-brand.mjs` fails when the
 * source, the public assets and the brand guide drift apart.
 *
 * The tokens are presentation truth only. They never claim provider
 * connectivity, signing state or runtime readiness.
 */

export type BrandTokenRole = "identity" | "surface" | "signal" | "type" | "detail";

export type BrandToken = {
  id: string;
  name: string;
  hex: string;
  hsl: string;
  role: BrandTokenRole;
  usage: string;
  /** On which product theme the token is intended to carry readable content. */
  readableOn: Array<"light" | "dark">;
};

export const KFORGE_BRAND = {
  name: "KNOuX Forge",
  shortName: "KForge",
  legalName: "DAY NIGHT DELIVERY SERVICES",
  productLine: "Local-first engineering command center",
  homepage: "https://knoux.store/",
  repository: "https://github.com/daynightae-cmyk/KForge",
  tagline: {
    en: "Engineering a brighter tomorrow, together.",
    ar: "هندسة أفضل لمستقبل أكثر إشراقًا",
  },
  /** The approved writing forms. The wordmark is mixed-case by design. */
  wordmark: {
    product: "KNOuX Forge",
    short: "KForge",
    domain: "knoux.store",
  },
  /** Brand typography stack, in fallback order. No web font is fetched. */
  typography: {
    latin: "Inter, \"SF Pro Display\", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
    arabic: "Cairo, \"Noto Naskh Arabic\", \"Segoe UI\", Tahoma, sans-serif",
    display: "Inter, \"SF Pro Display\", ui-sans-serif, system-ui, sans-serif",
    weights: [400, 500, 600, 700, 800] as const,
  },
  experience: {
    radius: "12px",
    controlRadius: "8px",
    focusRing: "2px solid #C8AFFF",
    motion: "200ms ease",
    reducedMotion: "0ms",
    density: ["compact", "comfortable"] as const,
  },
} as const;

export const KFORGE_BRAND_TOKENS: BrandToken[] = [
  {
    id: "forge-violet",
    name: "Forge Violet",
    hex: "#8958FF",
    hsl: "258 100% 67%",
    role: "identity",
    usage: "Primary identity, focus, active navigation and verified emphasis.",
    readableOn: ["dark"],
  },
  {
    id: "violet-deep",
    name: "Violet Deep",
    hex: "#6F31EE",
    hsl: "260 85% 56%",
    role: "identity",
    usage: "Primary actions, selected controls and the Deep Violet gradient stop.",
    readableOn: ["light", "dark"],
  },
  {
    id: "violet-night",
    name: "Violet Night",
    hex: "#5122B8",
    hsl: "259 69% 43%",
    role: "identity",
    usage: "Pressed states, gradient depth and high-contrast badge borders.",
    readableOn: ["light", "dark"],
  },
  {
    id: "ink",
    name: "Forge Ink",
    hex: "#07070B",
    hsl: "240 22% 4%",
    role: "surface",
    usage: "Dark product surface, reveal background and the primary dark type colour.",
    readableOn: ["light"],
  },
  {
    id: "night-plum",
    name: "Night Plum",
    hex: "#0D0A14",
    hsl: "259 30% 6%",
    role: "surface",
    usage: "Raised dark panels, splash haze and layered dark surfaces.",
    readableOn: ["light"],
  },
  {
    id: "pearl",
    name: "Pearl",
    hex: "#F7F5FF",
    hsl: "260 100% 98%",
    role: "surface",
    usage: "Light product surface, reveal light background and type on dark surfaces.",
    readableOn: ["dark"],
  },
  {
    id: "glass-lavender",
    name: "Glass Lavender",
    hex: "#F0EBF8",
    hsl: "263 46% 95%",
    role: "surface",
    usage: "Light surface wash, muted panel fill and translucent card base.",
    readableOn: ["light"],
  },
  {
    id: "luminous-lavender",
    name: "Luminous Lavender",
    hex: "#C8AFFF",
    hsl: "263 100% 84%",
    role: "signal",
    usage: "Focus rings, soft highlights and luminous outline on dark surfaces.",
    readableOn: ["dark"],
  },
  {
    id: "signal-teal",
    name: "Signal Teal",
    hex: "#2AD9C8",
    hsl: "175 70% 51%",
    role: "signal",
    usage: "Living Mark rim, verified accents and live technical evidence.",
    readableOn: ["dark"],
  },
  {
    id: "bone",
    name: "Bone",
    hex: "#E6E1D2",
    hsl: "44 30% 86%",
    role: "detail",
    usage: "Warm contrast detail in the Living Mark and premium print contexts.",
    readableOn: ["dark"],
  },
];

export type BrandAsset = {
  id: string;
  name: string;
  src: string;
  format: string;
  purpose: string;
  downloadable: boolean;
};

/** Public, cacheable brand assets served from `/public/brand`. */
export const KFORGE_PUBLIC_BRAND_ASSETS: BrandAsset[] = [
  {
    id: "app-icon",
    name: "KForge app icon",
    src: "/brand/favicon.svg",
    format: "SVG",
    purpose: "Browser favicon, app icon and compact product signature.",
    downloadable: true,
  },
  {
    id: "wordmark",
    name: "KNOuX Forge wordmark",
    src: "/brand/knoux-forge-wordmark.svg",
    format: "SVG",
    purpose: "Documentation headers, presentation title cards and dark surfaces.",
    downloadable: true,
  },
  {
    id: "social-card",
    name: "Social share card",
    src: "/brand/social-card.svg",
    format: "SVG",
    purpose: "1200x630 share artwork for repository and release notes.",
    downloadable: true,
  },
];

export const BRAND_TOKEN_BY_HEX = new Map(KFORGE_BRAND_TOKENS.map((token) => [token.hex.toUpperCase(), token]));

export function brandToken(id: string): BrandToken | undefined {
  return KFORGE_BRAND_TOKENS.find((token) => token.id === id);
}

/** Contrast-safe text colour for a filled brand swatch. */
export function readableTextFor(hex: string): "#07070B" | "#F7F5FF" {
  const value = hex.replace("#", "");
  if (value.length !== 6) return "#F7F5FF";
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance > 0.42 ? "#07070B" : "#F7F5FF";
}

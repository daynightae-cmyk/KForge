# KNOuX Forge Brand & Identity

This guide is the written companion to the canonical brand module. The module,
the public assets, the document metadata and this page are checked together by
`npm run verify:brand`; the authoritative gate runs the same check as its
`brand-contract` step.

## Canonical sources

| Concern | Source of truth |
| --- | --- |
| Identity, palette, typography, experience rules | `client/brand/brandTokens.ts` |
| Public downloadable artwork | `public/brand/*.svg` |
| Installed-app metadata | `public/site.webmanifest` |
| Document metadata | `index.html` |
| In-product guide | System → Brand & Identity (`client/workbench/BrandCenter.tsx`) |
| Contract check | `scripts/verify-brand.mjs` |

Do not copy a hex value out of a screenshot, a slide or a chat message. Copy it
from the Brand & Identity surface or from `brandTokens.ts`.

## Identity

| Field | Value |
| --- | --- |
| Product name | KNOuX Forge |
| Short form | KForge |
| Legal entity | DAY NIGHT DELIVERY SERVICES |
| Product line | Local-first engineering command center |
| Homepage | https://knoux.store/ |
| Repository | https://github.com/daynightae-cmyk/KForge |
| English tagline | Engineering a brighter tomorrow, together. |
| Arabic tagline | هندسة أفضل لمستقبل أكثر إشراقًا |

### Writing forms

- **KNOuX Forge** is the product name. The mixed case is intentional: `KNOuX`
  with a lower-case `u`, then `Forge` with a capital `F`. Do not set the name in
  all caps in body copy.
- **KForge** is the short form used in navigation, code and compact surfaces.
- **knoux.store** is the domain form. Do not add `www`.
- Keep the English and Arabic taglines exactly as written. The Arabic tagline is
  right-to-left and must be wrapped in `dir="rtl" lang="ar"` when rendered alone.

## Colour system

| Token | Hex | HSL | Role | Use |
| --- | --- | --- | --- | --- |
| Forge Violet | `#8958FF` | `258 100% 67%` | Identity | Primary identity, focus, active navigation, verified emphasis |
| Violet Deep | `#6F31EE` | `260 85% 56%` | Identity | Primary actions, selected controls, gradient stop |
| Violet Night | `#5122B8` | `259 69% 43%` | Identity | Pressed states, gradient depth, badge borders |
| Forge Ink | `#07070B` | `240 22% 4%` | Surface | Dark product surface and Night background |
| Night Plum | `#0D0A14` | `259 30% 6%` | Surface | Raised dark panels and splash haze |
| Pearl | `#F7F5FF` | `260 100% 98%` | Surface | Light product surface and type on dark |
| Glass Lavender | `#F0EBF8` | `263 46% 95%` | Surface | Light wash, muted panel fill, translucent card base |
| Luminous Lavender | `#C8AFFF` | `263 100% 84%` | Signal | Focus rings, soft highlights, luminous outline |
| Signal Teal | `#2AD9C8` | `175 70% 51%` | Signal | Living Mark rim and live technical evidence |
| Bone | `#E6E1D2` | `44 30% 86%` | Detail | Warm contrast detail and premium print |

### Colour rules

- Never place Pearl type on Forge Violet without checking contrast; the token
  module's `readableTextFor` helper returns the approved foreground for filled
  swatches.
- Signal Teal is an accent, not a status colour. Green/amber/red status badges
  keep their existing semantic colours.
- The brand layer is ambient. It never replaces a real evidence surface, and in
  the light theme it must stay transparent behind workbench content.
- The CSS custom properties are available as `--kf-forge-violet`,
  `--kf-violet-deep`, `--kf-violet-night`, `--kf-ink`, `--kf-night-plum`,
  `--kf-pearl`, `--kf-glass-lavender`, `--kf-luminous-lavender`,
  `--kf-signal-teal` and `--kf-bone`.

## Typography

| Role | Stack |
| --- | --- |
| Latin UI | `Inter, "SF Pro Display", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` |
| Arabic UI | `Cairo, "Noto Naskh Arabic", "Segoe UI", Tahoma, sans-serif` |
| Display | `Inter, "SF Pro Display", ui-sans-serif, system-ui, sans-serif` |

Approved weights: 400, 500, 600, 700, 800. No web font is fetched at runtime;
the stacks resolve against fonts already present on the machine.

## Experience rules

| Rule | Value |
| --- | --- |
| Surface radius | `12px` |
| Control radius | `8px` |
| Focus ring | `2px solid #C8AFFF` |
| Motion | `200ms ease` |
| Reduced motion | `0ms` |
| Density | `compact`, `comfortable` |

Focus, density and motion remain user preferences. The brand layer never
overrides a reduced-motion setting or forces a density.

## Public assets

| Asset | Path | Purpose |
| --- | --- | --- |
| App icon | `/brand/favicon.svg` | Browser favicon, installed-app icon, compact signature |
| Wordmark | `/brand/knoux-forge-wordmark.svg` | Documentation headers, title cards, dark surfaces |
| Social card | `/brand/social-card.svg` | 1200 × 630 share artwork for repository and release notes |

All three are plain SVG with a `<title>`, a `viewBox` and no scripts. They are
served from `public/` and are downloadable from System → Brand & Identity.

## What the brand surface does not claim

- It does not claim code signing, SmartScreen reputation or a Microsoft Store
  listing.
- It does not claim provider connectivity or a successful remote request.
- It does not claim that a downloaded asset has been reviewed by a third party.
- It describes identity only; listening state, runtime state and release
  verdicts stay on their own evidence surfaces.

## Verification

```bash
npm run verify:brand
```

The check fails when a canonical token drifts from its approved hex value, an
asset is missing or malformed, the manifest or `index.html` loses the brand
metadata, or this guide stops documenting an approved value. It also runs inside
`npm run verify:gate` and therefore inside the `KForge Verification Gate`
workflow.

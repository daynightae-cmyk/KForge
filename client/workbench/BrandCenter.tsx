import { useMemo } from "react";
import { ArrowRight, Download, ExternalLink, Palette, ShieldCheck, Type } from "lucide-react";
import type { SurfaceProps } from "./surfaceContracts";
import {
  KFORGE_BRAND,
  KFORGE_BRAND_TOKENS,
  KFORGE_PUBLIC_BRAND_ASSETS,
  readableTextFor,
} from "@/brand/brandTokens";
import { CopyValueButton } from "@/components/ui/CopyValueButton";
import { KForgeBrandLockup } from "@/components/brand/KForgeBrandLockup";
import "./brandCenter.css";

const CSS_VARIABLES = `:root {\n${KFORGE_BRAND_TOKENS.map((token) => `  --kf-${token.id}: ${token.hex};`).join("\n")}\n}`;

/**
 * Brand & Identity is the in-product brand guide. It renders the same canonical
 * tokens and public assets that the application ships, so a copy taken from
 * this surface cannot drift from the source. It describes identity only; it
 * makes no claim about signing, store presence or provider connectivity.
 */
function BrandCenter({ onNavigate }: SurfaceProps) {
  const assetCards = useMemo(() => KFORGE_PUBLIC_BRAND_ASSETS, []);

  return (
    <section className="kw-brand-center" aria-label="KNOuX Forge brand and identity">
      <header className="kw-brand-center__hero">
        <div>
          <KForgeBrandLockup size="standard" showTagline />
          <small>BRAND &amp; IDENTITY</small>
          <h2>One identity, rendered honestly.</h2>
          <p>
            Every value on this surface is read from the canonical brand module and the public assets served with
            the product. Copy the exact token, inspect the exact asset and preview the approved palette in Day and
            Night contexts.
          </p>
        </div>
        <div className="kw-brand-center__hero-actions">
          <button type="button" className="is-primary" onClick={() => onNavigate("system", "settings")}>
            <Palette size={14} />Appearance settings
          </button>
          <button type="button" onClick={() => onNavigate("projects", "getting-started")}>
            Get Started<ArrowRight size={13} />
          </button>
        </div>
      </header>

      <section className="kw-brand-center__panel" aria-label="Identity facts">
        <header><small>IDENTITY</small><h3>Approved writing forms</h3></header>
        <dl className="kw-brand-center__facts">
          <div><dt>Product</dt><dd>{KFORGE_BRAND.name}</dd></div>
          <div><dt>Short form</dt><dd>{KFORGE_BRAND.shortName}</dd></div>
          <div><dt>Legal entity</dt><dd>{KFORGE_BRAND.legalName}</dd></div>
          <div><dt>Product line</dt><dd>{KFORGE_BRAND.productLine}</dd></div>
          <div><dt>Homepage</dt><dd><a href={KFORGE_BRAND.homepage} target="_blank" rel="noreferrer">{KFORGE_BRAND.homepage}<ExternalLink size={11} /></a></dd></div>
          <div><dt>Repository</dt><dd><a href={KFORGE_BRAND.repository} target="_blank" rel="noreferrer">{KFORGE_BRAND.repository}<ExternalLink size={11} /></a></dd></div>
        </dl>
        <div className="kw-brand-center__taglines">
          <article lang="en"><small>EN</small><p>{KFORGE_BRAND.tagline.en}</p></article>
          <article lang="ar" dir="rtl"><small>AR</small><p>{KFORGE_BRAND.tagline.ar}</p></article>
        </div>
      </section>

      <section className="kw-brand-center__panel" aria-label="Colour system">
        <header>
          <div><small>COLOUR SYSTEM</small><h3>Canonical palette</h3></div>
          <CopyValueButton value={CSS_VARIABLES} label="all brand CSS variables" />
        </header>
        <div className="kw-brand-center__swatches">
          {KFORGE_BRAND_TOKENS.map((token) => {
            const foreground = readableTextFor(token.hex);
            return (
              <article key={token.id} className="kw-brand-center__swatch">
                <div className="kw-brand-center__swatch-face" style={{ background: token.hex, color: foreground }}>
                  <strong>{token.name}</strong>
                  <code>{token.hex}</code>
                  <small>on {token.readableOn.join(" / ")}</small>
                </div>
                <div className="kw-brand-center__swatch-body">
                  <span><code>hsl({token.hsl})</code><CopyValueButton value={token.hex} label={`${token.name} hex value`} compact /></span>
                  <p>{token.usage}</p>
                </div>
              </article>
            );
          })}
        </div>
        <details className="kw-advanced-evidence">
          <summary>CSS custom properties</summary>
          <pre tabIndex={0} aria-label="Brand CSS custom properties">{CSS_VARIABLES}</pre>
        </details>
      </section>

      <div className="kw-brand-center__split">
        <section className="kw-brand-center__panel" aria-label="Typography">
          <header><div><small>TYPOGRAPHY</small><h3>Type contracts</h3></div><Type size={16} aria-hidden="true" /></header>
          <div className="kw-brand-center__type-sample">
            <strong style={{ fontFamily: KFORGE_BRAND.typography.display }}>Engineering a brighter tomorrow, together.</strong>
            <p style={{ fontFamily: KFORGE_BRAND.typography.latin }}>Local-first engineering command center. Evidence before claims.</p>
            <p lang="ar" dir="rtl" style={{ fontFamily: KFORGE_BRAND.typography.arabic }}>{KFORGE_BRAND.tagline.ar}</p>
          </div>
          <dl className="kw-brand-center__facts">
            <div><dt>Latin stack</dt><dd><code>{KFORGE_BRAND.typography.latin}</code></dd></div>
            <div><dt>Arabic stack</dt><dd><code>{KFORGE_BRAND.typography.arabic}</code></dd></div>
            <div><dt>Weights</dt><dd>{KFORGE_BRAND.typography.weights.join(" · ")}</dd></div>
          </dl>
        </section>

        <section className="kw-brand-center__panel" aria-label="Experience rules">
          <header><div><small>EXPERIENCE</small><h3>Shape and motion</h3></div><ShieldCheck size={16} aria-hidden="true" /></header>
          <dl className="kw-brand-center__facts">
            <div><dt>Surface radius</dt><dd><code>{KFORGE_BRAND.experience.radius}</code></dd></div>
            <div><dt>Control radius</dt><dd><code>{KFORGE_BRAND.experience.controlRadius}</code></dd></div>
            <div><dt>Focus ring</dt><dd><code>{KFORGE_BRAND.experience.focusRing}</code></dd></div>
            <div><dt>Motion</dt><dd><code>{KFORGE_BRAND.experience.motion}</code></dd></div>
            <div><dt>Reduced motion</dt><dd><code>{KFORGE_BRAND.experience.reducedMotion}</code></dd></div>
            <div><dt>Density</dt><dd>{KFORGE_BRAND.experience.density.join(" · ")}</dd></div>
          </dl>
          <p className="kw-brand-center__note">Focus, density and motion remain user-controlled in Appearance settings. The brand layer never overrides a reduced-motion preference.</p>
        </section>
      </div>

      <section className="kw-brand-center__panel" aria-label="Brand asset library">
        <header><div><small>ASSET LIBRARY</small><h3>Public, cacheable and downloadable</h3></div><Download size={16} aria-hidden="true" /></header>
        <div className="kw-brand-center__assets">
          {assetCards.map((asset) => (
            <article key={asset.id} className="kw-brand-center__asset">
              <div className="kw-brand-center__asset-preview"><img src={asset.src} alt={`${asset.name} artwork`} /></div>
              <div className="kw-brand-center__asset-body">
                <header><strong>{asset.name}</strong><span>{asset.format}</span></header>
                <p>{asset.purpose}</p>
                <code>{asset.src}</code>
                <div className="kw-brand-center__asset-actions">
                  <CopyValueButton value={asset.src} label={`${asset.name} public path`} />
                  <a href={asset.src} download aria-label={`Download ${asset.name}`}>
                    <Download size={13} />Download
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="kw-brand-center__panel" aria-label="Day and night preview">
        <header><small>DAY / NIGHT</small><h3>The same identity on both product surfaces</h3></header>
        <div className="kw-brand-center__previews">
          <article className="is-day">
            <header><span>DAY</span><code>#F7F5FF</code></header>
            <img src="/brand/knoux-forge-wordmark.svg" alt="" aria-hidden="true" />
            <div>
              {["#8958FF", "#6F31EE", "#2AD9C8", "#E6E1D2"].map((hex) => <span key={hex} style={{ background: hex }} title={hex} />)}
            </div>
            <p>Dark artwork stays inside its own plate; the surrounding Day surface is never tinted by the brand layer.</p>
          </article>
          <article className="is-night">
            <header><span>NIGHT</span><code>#07070B</code></header>
            <img src="/brand/knoux-forge-wordmark.svg" alt="" aria-hidden="true" />
            <div>
              {["#8958FF", "#C8AFFF", "#2AD9C8", "#5122B8"].map((hex) => <span key={hex} style={{ background: hex }} title={hex} />)}
            </div>
            <p>Pearl type and Luminous Lavender focus remain readable on the Ink surface.</p>
          </article>
        </div>
      </section>

      <footer className="kw-brand-center__footer">
        <ShieldCheck size={15} aria-hidden="true" />
        <p>
          This surface describes product identity. It does not claim code signing, SmartScreen reputation, store
          listing or provider connectivity; those states are reported only where their own evidence exists.
        </p>
      </footer>
    </section>
  );
}

export default BrandCenter;

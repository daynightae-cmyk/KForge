import { KFORGE_BRAND } from "@/brand/brandTokens";
import brandSymbol from "@/assets/knoux-forge-symbol.webp";

type Props = {
  /** `compact` keeps the mark and product name only. */
  size?: "compact" | "standard";
  /** Show the localized tagline under the product name. */
  showTagline?: boolean;
  /** Render the Arabic tagline first, matching the Explorer brand footer. */
  arabicFirst?: boolean;
};

/**
 * Canonical KNOuX Forge lockup used by onboarding and brand surfaces. The
 * official symbol asset stays the single identity source; this component only
 * controls spacing, accessible naming and tagline presentation.
 */
export function KForgeBrandLockup({ size = "standard", showTagline = false, arabicFirst = false }: Props) {
  return (
    <div className="flex min-w-0 items-center gap-3" data-brand-lockup={size} aria-label={KFORGE_BRAND.name}>
      <span className={`grid shrink-0 place-items-center rounded-xl border border-primary/30 bg-card ${size === "compact" ? "h-9 w-9" : "h-12 w-12"}`} aria-hidden="true">
        <img src={brandSymbol} alt="" className={size === "compact" ? "h-6 w-6 object-contain" : "h-8 w-8 object-contain"} />
      </span>
      <span className="min-w-0">
        <strong className={`block font-semibold leading-tight tracking-tight ${size === "compact" ? "text-sm" : "text-lg"}`}>{KFORGE_BRAND.name}</strong>
        {showTagline ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            {arabicFirst ? (
              <><bdi dir="rtl" lang="ar">{KFORGE_BRAND.tagline.ar}</bdi><br /><span>{KFORGE_BRAND.tagline.en}</span></>
            ) : (
              <><span>{KFORGE_BRAND.tagline.en}</span><br /><bdi dir="rtl" lang="ar">{KFORGE_BRAND.tagline.ar}</bdi></>
            )}
          </span>
        ) : (
          <small className="block text-muted-foreground">{KFORGE_BRAND.productLine}</small>
        )}
      </span>
    </div>
  );
}

export default KForgeBrandLockup;

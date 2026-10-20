import { lazy, Suspense, useEffect, useRef, useState } from "react";
import "./LivingMarkGate.css";

// The Three.js brand scene must never enter the initial module graph. This dynamic
// import is the only reference to it, so the bundler emits a separate async chunk
// that is fetched only after first paint.
const KnouxLivingMark = lazy(() => import("./KnouxLivingMark"));

export type LivingMarkMode = "splash" | "workspace" | "idle";
export type LivingMarkDecision = "PENDING" | "WEBGL" | "STATIC_REDUCED_MOTION" | "STATIC_NO_WEBGL" | "STATIC_SUSPENDED";

type Props = {
  mode: LivingMarkMode;
  /** Persisted KForge appearance preference; when true no WebGL scene is created at all. */
  reducedMotion?: boolean;
  /** When false the scene is suspended and the static wordmark remains. */
  visible?: boolean;
};

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function webglSupported() {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!context) return false;
    const lose = (context as WebGLRenderingContext).getExtension("WEBGL_lose_context");
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function afterIdle(callback: () => void) {
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof idle === "function") return idle(callback, { timeout: 1200 });
  const timer = window.setTimeout(callback, 200);
  return () => window.clearTimeout(timer);
}

/**
 * Static, dependency-free KNOuX wordmark. This is what the user sees on first paint:
 * no WebGL, no Three.js, no layout shift, and it remains the permanent presentation
 * whenever the 3D scene is suspended, reduced-motion is requested, or WebGL is absent.
 */
function StaticWordmark({ mode, decision }: { mode: LivingMarkMode; decision: LivingMarkDecision }) {
  return (
    <div className="knoux-living-mark-fallback" data-mode={mode} data-decision={decision} aria-hidden="true">
      <svg viewBox="0 0 520 120" role="presentation" focusable="false">
        <defs>
          <linearGradient id="knouxStaticFace" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2b3134" />
            <stop offset="0.55" stopColor="#161b1d" />
            <stop offset="1" stopColor="#0d1112" />
          </linearGradient>
          <linearGradient id="knouxStaticRim" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#2ad9c8" stopOpacity="0.55" />
            <stop offset="0.5" stopColor="#1fb8ac" stopOpacity="0.12" />
            <stop offset="1" stopColor="#e6e1d2" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        <rect x="6" y="16" width="508" height="88" rx="10" fill="#050708" />
        <ellipse cx="260" cy="104" rx="190" ry="10" fill="#000" opacity="0.55" />
        <text
          x="260"
          y="78"
          textAnchor="middle"
          fontFamily="'Helvetica Neue', Helvetica, Arial, sans-serif"
          fontSize="72"
          fontWeight="700"
          letterSpacing="6"
          fill="url(#knouxStaticFace)"
          stroke="url(#knouxStaticRim)"
          strokeWidth="0.75"
        >
          KNOuX
        </text>
      </svg>
    </div>
  );
}

export default function LivingMarkGate({ mode, reducedMotion = false, visible = true }: Props) {
  const [decision, setDecision] = useState<LivingMarkDecision>("PENDING");
  const [armed, setArmed] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    if (!visible) {
      setArmed(false);
      setDecision("STATIC_SUSPENDED");
      return;
    }
    if (reducedMotion || prefersReducedMotion()) {
      setArmed(false);
      setDecision("STATIC_REDUCED_MOTION");
      return;
    }
    // Defer every capability probe and the scene download until the browser is idle so
    // the Living Mark can never compete with the workbench's critical rendering path.
    const cancel = afterIdle(() => {
      if (cancelled.current) return;
      if (!webglSupported()) {
        setDecision("STATIC_NO_WEBGL");
        return;
      }
      setDecision("WEBGL");
      setArmed(true);
    });
    return () => {
      cancelled.current = true;
      if (typeof cancel === "function") cancel();
    };
  }, [visible, reducedMotion, mode]);

  // `visible: false` must render nothing at all: an unmounted brand layer must never leave a
  // wordmark behind on unrelated capability surfaces. Hooks stay above this return.
  if (!visible) return null;
  if (decision !== "WEBGL" || !armed) return <StaticWordmark mode={mode} decision={decision} />;

  return (
    <Suspense fallback={<StaticWordmark mode={mode} decision={decision} />}>
      <KnouxLivingMark mode={mode} suspended={false} reducedMotion={reducedMotion} decision={decision} />
    </Suspense>
  );
}
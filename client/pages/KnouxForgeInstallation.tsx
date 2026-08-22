import { Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import logoAsset from "../assets/knoux-forge-official-logo.png";

type SplashStage = "reveal" | "complete" | "leaving";
type SplashTheme = "light" | "dark";

const fragmentPositions = [
  "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
];
const installationKey = "knoux-forge-installation-complete";
const fullRevealDuration = 11_200;
const returningRevealDuration = 9_200;

function isFirstLaunch() {
  try {
    return window.localStorage.getItem(installationKey) !== "true";
  } catch {
    return true;
  }
}

function rememberInstallation() {
  try {
    window.localStorage.setItem(installationKey, "true");
  } catch {
    // Storage is optional; navigation must remain available in private contexts.
  }
}

function getDashboardTheme(): SplashTheme {
  const html = document.documentElement;
  const body = document.body;
  const explicitDark = html.dataset.theme === "dark"
    || body.dataset.theme === "dark"
    || html.classList.contains("dark")
    || body.classList.contains("dark");
  return explicitDark ? "dark" : "light";
}

export default function KnouxForgeInstallation() {
  const navigate = useNavigate();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const soundEnabledRef = useRef(true);
  const navigationStarted = useRef(false);
  const [firstLaunch] = useState(isFirstLaunch);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [splashTheme, setSplashTheme] = useState<SplashTheme>(getDashboardTheme);
  const [stage, setStage] = useState<SplashStage>("reveal");
  const [soundEnabled, setSoundEnabled] = useState(true);

  const playRevealMusic = useCallback(() => {
    if (!soundEnabledRef.current || audioRef.current) return;
    const audio = new Audio("/audio/logo-reveal-slow.wav");
    audio.preload = "auto";
    audio.volume = 0.12;
    audioRef.current = audio;
    void audio.play().catch(() => {
      // Browser autoplay policy may require a user gesture; visuals continue independently.
      if (audioRef.current === audio) audioRef.current = null;
    });
  }, []);

  const enterWorkspace = useCallback(() => {
    if (navigationStarted.current) return;
    navigationStarted.current = true;
    rememberInstallation();
    audioRef.current?.pause();
    setStage("leaving");
    window.requestAnimationFrame(() => navigate("/workspace", { replace: true }));
  }, [navigate]);

  const toggleSound = () => {
    const next = !soundEnabledRef.current;
    soundEnabledRef.current = next;
    setSoundEnabled(next);
    if (!next) {
      audioRef.current?.pause();
      audioRef.current = null;
    }
    if (next && stage === "reveal" && !reducedMotion) playRevealMusic();
  };

  useEffect(() => {
    const motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
    const schemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
    const applyPreferences = () => {
      setReducedMotion(motionMedia.matches);
      setSplashTheme(getDashboardTheme());
    };
    const themeObserver = new MutationObserver(applyPreferences);
    applyPreferences();
    motionMedia.addEventListener("change", applyPreferences);
    schemeMedia.addEventListener("change", applyPreferences);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => {
      motionMedia.removeEventListener("change", applyPreferences);
      schemeMedia.removeEventListener("change", applyPreferences);
      themeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const interactive = target?.closest("button, a, input, textarea, select");
      if (event.key === "Escape" || (event.key === "Enter" && !interactive && stage === "reveal")) {
        event.preventDefault();
        enterWorkspace();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [enterWorkspace, stage]);

  useEffect(() => {
    if (stage !== "reveal") return;
    const musicCue = window.setTimeout(() => {
      if (!reducedMotion) playRevealMusic();
    }, reducedMotion ? 0 : 280);
    const nextStage = window.setTimeout(() => {
      if (firstLaunch) setStage("complete");
      else enterWorkspace();
    }, reducedMotion ? (firstLaunch ? 700 : 960) : (firstLaunch ? fullRevealDuration : returningRevealDuration));
    return () => {
      window.clearTimeout(musicCue);
      window.clearTimeout(nextStage);
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, [enterWorkspace, firstLaunch, playRevealMusic, reducedMotion, stage]);

  const soundLabel = soundEnabled ? "Disable reveal music" : "Enable reveal music";

  return (
    <main className={`kf-splash kf-splash--${splashTheme} kf-splash--${stage} ${reducedMotion ? "kf-splash--reduced" : ""}`} aria-labelledby="splash-title">
      <div className="kf-splash-void" aria-hidden="true" />
      <div className="kf-splash-grain" aria-hidden="true" />
      <div className="kf-splash-haze" aria-hidden="true" />
      <div className="kf-splash-particles" aria-hidden="true">
        {fragmentPositions.map((position) => <i className={position} key={position} />)}
      </div>

      <button className="kf-splash-sound" type="button" onClick={toggleSound} aria-label={soundLabel} title={soundLabel}>
        {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
      </button>
      {stage === "reveal" && <button className="kf-splash-skip" type="button" onClick={enterWorkspace}>Skip <span>Esc</span></button>}

      <section className="kf-splash-stage">
        <h1 id="splash-title" className="sr-only">Knoux Forge</h1>
        <div className="kf-splash-logo-wrap" aria-label="Knoux Forge official logo">
          <img className="kf-splash-logo" src={logoAsset} alt="Knoux Forge official logo" />
          <i className="kf-splash-logo-sweep" aria-hidden="true" />
          {stage === "complete" && <button className="kf-splash-logo-action" type="button" onClick={enterWorkspace}>Enter Workspace</button>}
        </div>
      </section>
    </main>
  );
}

import { Check, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import installationReference from "../assets/knoux-forge-installation-reference.png";

const particles = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];

export default function KnouxForgeInstallation() {
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const navigationStarted = useRef(false);

  const enterWorkspace = () => {
    if (navigationStarted.current) return;
    navigationStarted.current = true;
    setLeaving(true);
    window.requestAnimationFrame(() => navigate("/workspace", { replace: true }));
  };

  return (
    <main className={`kf-installation ${leaving ? "is-leaving" : ""}`} aria-labelledby="installation-title">
      <div className="kf-installation-orb" aria-hidden="true">
        <div className="kf-installation-inner" />
      </div>
      <div className="kf-installation-particles" aria-hidden="true">
        {particles.map((particle) => <i className={particle} key={particle} />)}
      </div>
      <section className="kf-installation-card">
        <div className="kf-installation-logo" aria-hidden="true">
          <img src={installationReference} alt="" />
        </div>
        <h1 id="installation-title" className="kf-installation-brand"><span>Knoux</span><strong>Forge</strong></h1>
        <p className="kf-installation-tagline">Your Project. Forged Better.</p>
        <div className="kf-installation-check" aria-label="Installation completed"><Check size={34} strokeWidth={3.4} /></div>
        <h2>Installation Complete</h2>
        <p className="kf-installation-copy">Knoux Forge is ready to understand, audit, repair, and build your projects.</p>
        <p className="kf-installation-features">Local-first <b>•</b> AI-powered <b>•</b> GitHub-ready</p>
        <button className="kf-installation-cta" type="button" onClick={enterWorkspace} disabled={leaving} aria-label="Enter Knoux Forge Workspace">
          <span className="kf-installation-cta-check"><Check size={21} strokeWidth={3.6} /></span>
          <span>{leaving ? "OPENING WORKSPACE" : "ENTER WORKSPACE"}</span>
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </section>
    </main>
  );
}

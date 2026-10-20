import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootFile = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
const capabilityMatrix = () => readFileSync(new URL("../../docs/KFORGE-CAPABILITY-MATRIX.md", import.meta.url), "utf8");

describe("repository documentation truth contract", () => {
  it("keeps documented verification commands aligned with package scripts", () => {
    const manifest = JSON.parse(rootFile("package.json")) as { scripts?: Record<string, string> };
    const scripts = manifest.scripts || {};
    const runGuide = rootFile("RUN.md");

    expect(scripts.lint).toBeTruthy();
    expect(scripts["test:e2e"]).toBeTruthy();
    expect(scripts["verify:gate"]).toBeTruthy();
    expect(runGuide).toContain("npm run lint");
    expect(runGuide).toContain("npm run test:e2e");
    expect(runGuide).toContain("npm run verify:gate");
    expect(runGuide).not.toContain("There is no repository `lint` script");
  });

  it("keeps browser acceptance and verification baselines evidence-scoped instead of regressing to stale unavailability claims", () => {
    const status = rootFile("PROJECT_STATUS.md");
    const readme = rootFile("README.md");
    const matrix = capabilityMatrix();
    const combined = `${status}\n${readme}\n${matrix}`;

    expect(status).toContain("Authoritative implementation baseline captured");
    expect(status).toMatch(/Run #\d+/);
    expect(status).toMatch(/SHA `[0-9a-f]{40}`/);
    expect(status).toContain("This file is a dated evidence snapshot");
    expect(readme).toContain("Reference verification baseline");
    expect(readme).toContain("Playwright browser acceptance");
    expect(matrix).toContain("Axe browser analysis");

    for (const staleClaim of [
      "live visual/browser automation is unavailable",
      "The current environment has no browser automation bridge",
      "Live visual and keyboard acceptance requires an available browser automation bridge or external deployment",
    ]) {
      expect(combined).not.toContain(staleClaim);
    }
  });

  it("does not regress the dependency baseline to vulnerabilities already cleared by the authoritative gate", () => {
    const status = rootFile("PROJECT_STATUS.md");
    const matrix = capabilityMatrix();
    const dependencyAudit = rootFile("docs/verification/DEPENDENCY_AND_TOOLCHAIN_AUDIT.md");
    const combined = `${status}\n${matrix}`;

    expect(status).toMatch(/npm audit.*0 vulnerabilities/i);
    expect(matrix).toMatch(/npm audit.*0 vulnerabilities/i);
    expect(dependencyAudit).toContain("Run #271");
    expect(dependencyAudit).toContain("0 vulnerabilities");
    expect(combined).not.toContain("dependency audit still reports 2 moderate-severity vulnerabilities");
    expect(combined).not.toContain("these are not marked fixed");
  });

  it("keeps the verified Preview console boundary and closed client chunk warning aligned with Run #271", () => {
    const status = rootFile("PROJECT_STATUS.md");
    const matrix = capabilityMatrix();
    const dependencyAudit = rootFile("docs/verification/DEPENDENCY_AND_TOOLCHAIN_AUDIT.md");
    const combined = `${status}\n${matrix}\n${dependencyAudit}`;

    expect(status).toContain("Run #271");
    expect(status).toContain("a7464f3d3f1758b1a9725304719e0ebaacb79f3b");
    expect(status).toContain("487.85 kB");
    expect(matrix).toContain("browser-console capture attributed to the active KForge-owned loopback Preview");
    expect(dependencyAudit).toContain("query vendor chunk 26.69 kB");
    expect(combined).not.toContain("Full target-application browser-console telemetry is not inferred");
    expect(combined).not.toContain("production client build emits a non-gating chunk-size warning");
    expect(combined).not.toContain("حزمة التطبيق الرئيسية تتجاوز حد Vite الافتراضي البالغ 500 kB");
  });

  it("enforces a pinned install-script allowlist under strict npm policy without erasing historical audit evidence", () => {
    const manifest = JSON.parse(rootFile("package.json")) as { allowScripts?: Record<string, boolean> };
    const npmrc = rootFile(".npmrc");
    const status = rootFile("PROJECT_STATUS.md");
    const matrix = capabilityMatrix();
    const dependencyAudit = rootFile("docs/verification/DEPENDENCY_AND_TOOLCHAIN_AUDIT.md");
    const activeDocs = `${status}\n${matrix}`;

    expect(manifest.allowScripts).toEqual({
      "@swc/core@1.16.18": true,
      "esbuild@0.25.4": true,
      "esbuild@0.28.2": true,
      "fsevents@2.3.2": true,
    });
    expect(npmrc).toContain("strict-allow-scripts=true");
    expect(npmrc).not.toContain("dangerously-allow-all-scripts=true");
    expect(status).toContain("Run #271");
    expect(matrix).toContain("Dependency install-script policy");
    expect(dependencyAudit).toContain("strict-allow-scripts=true");
    expect(dependencyAudit).toContain("pending install-script review");
    expect(dependencyAudit).toContain("مغلقة للـlockfile الحالي");
    expect(activeDocs).not.toContain("pending install-script review");
    expect(activeDocs).not.toContain("approval is not inferred");
  });

  it("keeps current branch topology and dependency pruning aligned with Run #271", () => {
    const manifest = JSON.parse(rootFile("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const status = rootFile("PROJECT_STATUS.md");
    const readme = rootFile("README.md");
    const matrix = capabilityMatrix();
    const activeDocs = `${status}\n${readme}\n${matrix}`;

    expect(status).toContain("Run #271");
    expect(status).toContain("691 packages");
    expect(status).toContain("692 packages");
    expect(readme).toContain("Run #271");
    expect(readme).toContain("strict-allow-scripts=true");
    expect(activeDocs).not.toContain("wip/codex-workbench-handoff");
    expect(readme).not.toContain("pending install-script review");
    expect(readme).not.toContain("does not claim target-application browser-console");

    for (const name of ["@react-three/drei", "@react-three/fiber", "@types/three", "framer-motion"]) {
      expect(manifest.dependencies?.[name]).toBeUndefined();
      expect(manifest.devDependencies?.[name]).toBeUndefined();
      expect(manifest.optionalDependencies?.[name]).toBeUndefined();
      expect(manifest.peerDependencies?.[name]).toBeUndefined();
    }
  });

  it("keeps the approved Living Mark dependency exact-pinned and free of supply-chain risk", () => {
    const manifest = JSON.parse(rootFile("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const lock = JSON.parse(rootFile("package-lock.json")) as {
      packages?: Record<string, { version?: string; dev?: boolean; hasInstallScript?: boolean; dependencies?: Record<string, string> }>;
    };

    // Exact pin: an uncontrolled caret range would let a future Three.js release enter the
    // shipped runtime without a new review of this contract.
    expect(manifest.dependencies?.three).toBe("0.186.1");

    const entry = lock.packages?.["node_modules/three"];
    expect(entry).toBeTruthy();
    expect(entry?.version).toBe("0.186.1");
    // Three.js must stay a runtime dependency of the brand scene but must never run install
    // scripts or drag in a transitive graph that could widen the audit surface. npm omits the
    // `dev` flag entirely for production entries, so assert it is not flagged dev-only.
    expect(entry?.dev).not.toBe(true);
    expect(entry?.hasInstallScript).toBeFalsy();
    expect(entry?.dependencies ?? {}).toEqual({});
  });

  it("keeps Three.js out of the initial client graph and behind an idle, accessibility-aware gate", () => {
    const workbench = rootFile("client/workbench/KForgeWorkbench.tsx");
    const gate = rootFile("client/components/brand/LivingMarkGate.tsx");

    // The workbench shell must not statically import the scene, or Three.js would be pulled
    // into the startup graph and defeat the entire code-splitting contract.
    expect(workbench).not.toMatch(/from\s+"three"/);
    expect(workbench).not.toMatch(/import\s+KnouxLivingMark\b/);
    expect(workbench).toContain('import LivingMarkGate from "@/components/brand/LivingMarkGate"');

    // The single permitted reference is a dynamic import inside the lazy boundary.
    expect(gate).toContain('lazy(() => import("./KnouxLivingMark"))');
    expect(gate).not.toMatch(/^\s*import\s+.*\sfrom\s+"three"/m);

    // Capability probing and the scene download must be deferred until the browser is idle,
    // so the brand can never compete with the workbench's critical rendering path.
    expect(gate).toContain("requestIdleCallback");
    expect(gate).toMatch(/afterIdle\(\(\) => \{/);

    // A zero-JavaScript static wordmark must be what paints first.
    expect(gate).toContain("StaticWordmark");
    expect(gate).toContain("<svg");

    // Accessibility and low-end paths must avoid creating a WebGL context at all.
    expect(gate).toContain("STATIC_REDUCED_MOTION");
    expect(gate).toContain("STATIC_NO_WEBGL");
    expect(gate).toContain("prefers-reduced-motion: reduce");
  });

  it("keeps the Living Mark scene free of idle polling and explicit about GPU cleanup", () => {
    const scene = rootFile("client/components/brand/KnouxLivingMark.tsx");

    // A permanent polling timer would keep a wake-up alive for the whole session even while
    // the scene is suspended, so suspension must be driven declaratively from props.
    expect(scene).not.toContain("setInterval");
    expect(scene).not.toContain("suspendedPoll");

    expect(scene).toContain("document.addEventListener(\"visibilitychange\"");
    expect(scene).toContain("renderer.setAnimationLoop(null)");
    expect(scene).toContain("renderer.dispose()");
    expect(scene).toContain("renderer.forceContextLoss()");
    expect(scene).toContain("environmentTarget.dispose()");

    // Deterministic motion only; no Math.random anywhere in the brand animation.
    expect(scene).not.toContain("Math.random");
  });

});

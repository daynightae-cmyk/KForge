import { useEffect, useRef } from "react";
import * as THREE from "three";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import fontJson from "@/assets/helvetiker_bold.typeface.json?raw";
import "./KnouxLivingMark.css";

export type KnouxLivingMarkMode = "splash" | "workspace" | "idle";
export type KnouxLivingMarkTier = "auto" | "low" | "medium" | "high";

type Props = {
  mode: KnouxLivingMarkMode;
  suspended?: boolean;
  performanceTier?: KnouxLivingMarkTier;
  className?: string;
};

type TierConfig = {
  pixelRatio: number;
  curveSegments: number;
  bevelSegments: number;
  targetFps: number;
  shadows: boolean;
};

const TIER_CONFIG: Record<Exclude<KnouxLivingMarkTier, "auto">, TierConfig> = {
  low: { pixelRatio: 1, curveSegments: 4, bevelSegments: 2, targetFps: 30, shadows: false },
  medium: { pixelRatio: 1.35, curveSegments: 6, bevelSegments: 3, targetFps: 45, shadows: false },
  high: { pixelRatio: 1.75, curveSegments: 8, bevelSegments: 5, targetFps: 60, shadows: true },
};

const LETTER_PHASES = [0.35, 1.45, 2.55, 3.65, 4.75] as const;
const LETTER_SPEEDS = [0.162, 0.174, 0.186, 0.198, 0.21] as const;
const LETTER_DEPTHS = [-0.018, 0.012, -0.006, 0.021, -0.011] as const;

function detectTier(): Exclude<KnouxLivingMarkTier, "auto"> {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency || 4;
  if (cores <= 4 || memory <= 4) return "low";
  if (cores <= 8 || memory <= 8) return "medium";
  return "high";
}

function makeGradientTexture(kind: "vignette" | "shadow" | "environment") {
  const size = kind === "environment" ? 256 : 512;
  const canvas = document.createElement("canvas");
  canvas.width = kind === "environment" ? size * 2 : size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("KNOuX Living Mark canvas context unavailable.");

  if (kind === "environment") {
    const gradient = context.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, "#0d1112");
    gradient.addColorStop(0.45, "#1a2022");
    gradient.addColorStop(0.55, "#123333");
    gradient.addColorStop(1, "#050607");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(230,225,210,0.15)";
    context.fillRect(0, size * 0.38, canvas.width, size * 0.06);
  } else {
    const radius = kind === "vignette" ? 0.72 : 0.5;
    const gradient = context.createRadialGradient(size / 2, size / 2, size * 0.02, size / 2, size / 2, size * radius);
    if (kind === "vignette") {
      gradient.addColorStop(0, "rgba(10,14,15,0)");
      gradient.addColorStop(0.55, "rgba(4,6,7,0.35)");
      gradient.addColorStop(1, "rgba(0,0,0,0.9)");
    } else {
      gradient.addColorStop(0, "rgba(0,0,0,0.55)");
      gradient.addColorStop(0.35, "rgba(0,0,0,0.38)");
      gradient.addColorStop(0.7, "rgba(0,0,0,0.14)");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
    }
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export default function KnouxLivingMark({ mode, suspended = false, performanceTier = "auto", className = "" }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const modeRef = useRef(mode);
  const suspendedRef = useRef(suspended);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { suspendedRef.current = suspended; }, [suspended]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const tierName = performanceTier === "auto" ? detectTier() : performanceTier;
    const tier = TIER_CONFIG[tierName];
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = reducedMotionQuery.matches;
    let disposed = false;
    let animationRunning = false;
    let elapsed = 0;
    let lastFrame = 0;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x030404);
    scene.fog = new THREE.FogExp2(0x030404, 0.045);

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0, 16);

    const renderer = new THREE.WebGLRenderer({ antialias: tierName !== "low", alpha: true, powerPreference: tierName === "high" ? "high-performance" : "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.pixelRatio));
    renderer.shadowMap.enabled = tier.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(80, 45), new THREE.MeshBasicMaterial({ color: 0x050708 }));
    backdrop.position.z = -8;
    scene.add(backdrop);

    const vignetteTexture = makeGradientTexture("vignette");
    const vignetteMaterial = new THREE.MeshBasicMaterial({ map: vignetteTexture, transparent: true, depthWrite: false });
    const vignette = new THREE.Mesh(new THREE.PlaneGeometry(80, 45), vignetteMaterial);
    vignette.position.z = -6;
    scene.add(vignette);

    scene.add(new THREE.AmbientLight(0x1a2022, 0.55));
    const keyLight = new THREE.DirectionalLight(0xf3ede1, 1.1);
    keyLight.position.set(3.5, 4.5, 8);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xcfd8d8, 0.35);
    fillLight.position.set(-5, -2, 5);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0x2ad9c8, 1.3);
    rimLight.position.set(-6, 2, -6);
    scene.add(rimLight);
    const tealFill = new THREE.PointLight(0x1fb8ac, 6, 30, 2);
    tealFill.position.set(0, -4, 3);
    scene.add(tealFill);
    const topLight = new THREE.DirectionalLight(0xffffff, 0.4);
    topLight.position.set(0, 6, 4);
    scene.add(topLight);

    const shadowTexture = makeGradientTexture("shadow");
    const shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, opacity: 0.75 });
    const contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(11, 4.2), shadowMaterial);
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.set(0, -2.35, 0.3);
    scene.add(contactShadow);

    const wordGroup = new THREE.Group();
    scene.add(wordGroup);
    const letterMeshes: THREE.Mesh<TextGeometry, THREE.MeshPhysicalMaterial>[] = [];

    const font = new FontLoader().parse(JSON.parse(fontJson));
    const word = "KNOuX";
    const size = 2.2;
    const depth = 0.62;
    const gap = 0.06;
    const letterGeometries = [...word].map((character) => {
      const geometry = new TextGeometry(character, {
        font, size, depth, curveSegments: tier.curveSegments,
        bevelEnabled: true, bevelThickness: 0.045, bevelSize: 0.03,
        bevelOffset: 0, bevelSegments: tier.bevelSegments,
      });
      geometry.computeBoundingBox();
      const width = geometry.boundingBox ? geometry.boundingBox.max.x - geometry.boundingBox.min.x : 0;
      return { character, geometry, width };
    });
    const totalWidth = letterGeometries.reduce((sum, entry) => sum + entry.width + gap, -gap);
    let cursor = -totalWidth / 2;

    letterGeometries.forEach((entry, index) => {
      const material = new THREE.MeshPhysicalMaterial({
        color: 0x1c1f22, metalness: 0.78, roughness: 0.38,
        clearcoat: 0.35, clearcoatRoughness: 0.5, reflectivity: 0.5,
        envMapIntensity: 1,
      });
      const mesh = new THREE.Mesh(entry.geometry, material);
      mesh.castShadow = tier.shadows;
      mesh.receiveShadow = tier.shadows;
      mesh.position.set(cursor, -size * 0.35, 0);
      mesh.userData.baseY = mesh.position.y;
      mesh.userData.baseZ = 0;
      mesh.userData.index = index;
      cursor += entry.width + gap;
      wordGroup.add(mesh);
      letterMeshes.push(mesh);
    });

    const box = new THREE.Box3().setFromObject(wordGroup);
    const center = box.getCenter(new THREE.Vector3());
    wordGroup.position.x -= center.x;
    wordGroup.position.y -= center.y;

    const environmentSource = makeGradientTexture("environment");
    environmentSource.mapping = THREE.EquirectangularReflectionMapping;
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const environmentTarget = pmremGenerator.fromEquirectangular(environmentSource);
    scene.environment = environmentTarget.texture;
    environmentSource.dispose();
    pmremGenerator.dispose();

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderer.render(scene, camera);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    const renderFrame = (timeMs: number) => {
      if (disposed || suspendedRef.current || document.hidden) return;
      const frameInterval = 1000 / tier.targetFps;
      if (timeMs - lastFrame < frameInterval) return;
      const delta = Math.min(0.05, (timeMs - lastFrame) / 1000 || 0);
      lastFrame = timeMs;
      elapsed += delta;

      const activeMode = modeRef.current;
      const motionScale = reducedMotion ? 0 : activeMode === "splash" ? 1 : activeMode === "idle" ? 0.72 : 0.3;
      const visualScale = activeMode === "workspace" ? 0.78 : 1;
      wordGroup.scale.setScalar(visualScale);

      wordGroup.rotation.y = Math.sin(elapsed * 0.09) * 0.055 * motionScale;
      wordGroup.rotation.x = Math.sin(elapsed * 0.07 + 1.2) * 0.03 * motionScale;
      wordGroup.position.y = Math.sin(elapsed * 0.12) * 0.08 * motionScale;
      wordGroup.position.z = Math.sin(elapsed * 0.05 + 0.5) * 0.15 * motionScale;
      camera.position.x = Math.sin(elapsed * 0.06) * 0.4 * motionScale;
      camera.position.y = Math.cos(elapsed * 0.05) * 0.22 * motionScale;
      camera.lookAt(0, 0, 0);

      contactShadow.position.y = -2.35 + wordGroup.position.y * 0.35;
      const shadowBreathe = (Math.sin(elapsed * 0.12 + 0.4) + 1) * 0.5;
      shadowMaterial.opacity = (0.68 + shadowBreathe * 0.12) * (activeMode === "workspace" ? 0.55 : 1);
      const shadowScale = 1 + Math.sin(elapsed * 0.09) * 0.015 * motionScale;
      contactShadow.scale.set(shadowScale, shadowScale, 1);

      letterMeshes.forEach((mesh, index) => {
        const phase = LETTER_PHASES[index] ?? 0;
        const speed = LETTER_SPEEDS[index] ?? 0.18;
        mesh.position.z = mesh.userData.baseZ + (Math.sin(elapsed * speed + phase) * 0.05 + (LETTER_DEPTHS[index] ?? 0)) * motionScale;
        mesh.position.y = mesh.userData.baseY + Math.sin(elapsed * speed * 0.8 + phase * 1.5) * 0.02 * motionScale;
        mesh.rotation.y = Math.sin(elapsed * speed * 0.6 + phase) * 0.015 * motionScale;
        const breathe = (Math.sin(elapsed * 0.18 + index * 0.6) + 1) * 0.5;
        mesh.material.roughness = 0.32 + breathe * 0.12;
        mesh.material.clearcoat = 0.25 + breathe * 0.2;
        mesh.material.emissive.setRGB(0, (0.02 + breathe * 0.03) * 0.6, 0.02 + breathe * 0.03);
      });

      rimLight.intensity = (1.15 + Math.sin(elapsed * 0.22) * 0.2) * (activeMode === "workspace" ? 0.55 : 1);
      tealFill.intensity = (5.2 + Math.sin(elapsed * 0.17 + 2) * 1.2) * (activeMode === "workspace" ? 0.5 : 1);
      keyLight.intensity = 1.05 + Math.sin(elapsed * 0.13 + 0.8) * 0.08;
      renderer.render(scene, camera);
    };

    const stop = () => {
      if (!animationRunning) return;
      renderer.setAnimationLoop(null);
      animationRunning = false;
    };

    const start = () => {
      if (animationRunning || disposed || suspendedRef.current || document.hidden) return;
      animationRunning = true;
      if (reducedMotion) {
        renderFrame(performance.now());
        stop();
      } else renderer.setAnimationLoop(renderFrame);
    };

    const visibilityChanged = () => document.hidden ? stop() : start();
    const reducedMotionChanged = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      stop();
      renderFrame(performance.now());
      if (!reducedMotion) start();
    };

    document.addEventListener("visibilitychange", visibilityChanged);
    reducedMotionQuery.addEventListener("change", reducedMotionChanged);
    start();

    const suspendedPoll = window.setInterval(() => {
      if (suspendedRef.current) stop();
      else start();
    }, 500);

    return () => {
      disposed = true;
      window.clearInterval(suspendedPoll);
      stop();
      document.removeEventListener("visibilitychange", visibilityChanged);
      reducedMotionQuery.removeEventListener("change", reducedMotionChanged);
      resizeObserver.disconnect();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        materials.forEach((material) => {
          const candidate = material as THREE.Material & Record<string, unknown>;
          Object.values(candidate).forEach((value) => { if (value instanceof THREE.Texture) (value as THREE.Texture).dispose(); });
          material.dispose();
        });
      });
      environmentTarget.dispose();
      vignetteTexture.dispose();
      shadowTexture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      scene.clear();
    };
  }, [performanceTier]);

  return <div ref={mountRef} className={`knoux-living-mark ${className}`} data-mode={mode} data-suspended={String(suspended)} aria-hidden="true" />;
}

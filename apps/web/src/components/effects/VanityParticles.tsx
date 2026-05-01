import { useEffect, useMemo, useState } from "react";

import Particles, { initParticlesEngine } from "@tsparticles/react";

import styles from "./VanityEffect.module.css";

import type { VanitySize } from "./VanityEffect";
import type { VanityTierId } from "../../utils/vanityTier";
import type { ISourceOptions } from "@tsparticles/engine";

/**
 * Per-tier particle config for the high-rarity tiers (lightning+). Lower
 * tiers use pure CSS in `VanityEffect.module.css` and never render this
 * component.
 *
 * Each preset is hand-tuned to compose with the matching CSS border so
 * the two layers reinforce each other (e.g. the inferno border's flicker
 * matches the ember plume rising out of the bottom).
 */

let engineReady: Promise<void> | null = null;

/**
 * Lazy-initialise the tsparticles engine exactly once across the page.
 * Each tier registers its own preset bundle on first use; the engine
 * itself is shared. Subsequent `<VanityParticles>` mounts await the same
 * promise, so we never double-load presets.
 */
async function ensureEngine(tierId: VanityTierId): Promise<void> {
  if (!engineReady) {
    engineReady = initParticlesEngine(async (engine) => {
      // The "slim" bundle isn't needed — the preset packages each pull in
      // exactly the movers / shapers / interactions they require. We just
      // load the presets we'll potentially use; that's roughly equivalent
      // to ~20 plugins total but they're tree-shaken into separate
      // chunks via dynamic import.
      const { loadFirePreset } = await import("@tsparticles/preset-fire");
      const { loadStarsPreset } = await import("@tsparticles/preset-stars");
      await loadFirePreset(engine);
      await loadStarsPreset(engine);
    });
  }
  await engineReady;
  // Per-tier additional loaders could be plumbed here. For now, the
  // hand-rolled configs (lightning, obsidian, singularity) reuse the
  // generic shapes/movers already pulled in by the fire/stars presets,
  // so no further loading is needed.
  void tierId;
}

/**
 * Only the particle-rendering tier ids accepted by `configFor`. Lower
 * tiers are CSS-only and never reach this component (the parent
 * `<VanityEffect>` short-circuits on `tier.effect === "css" | "none"`).
 */
export type ParticleTierId =
  | "lightning"
  | "inferno"
  | "obsidian"
  | "cosmic"
  | "singularity";

interface Props {
  tierId: VanityTierId;
  size: VanitySize;
}

function isParticleTier(id: VanityTierId): id is ParticleTierId {
  return (
    id === "lightning"
    || id === "inferno"
    || id === "obsidian"
    || id === "cosmic"
    || id === "singularity"
  );
}

function configFor(tierId: ParticleTierId, size: VanitySize): ISourceOptions {
  // Density scales with the visual size of the wrapper. Smaller wrappers
  // get fewer particles so a homepage row of icon-sized chips doesn't end
  // up with hundreds of emitters.
  const densityScale
    = size === "icon" ? 0.4
      : size === "row" ? 0.7
        : size === "card" ? 0.9
          : size === "button" ? 0.85
            : 1; // hero

  // Common base — transparent background, no FPS limit (lets the browser
  // throttle naturally), no full-screen takeover (we want it confined to
  // the wrapper).
  const base: ISourceOptions = {
    fullScreen: { enable: false },
    background: { color: "transparent" },
    detectRetina: true,
    fpsLimit: 60,
    pauseOnBlur: true,
    pauseOnOutsideViewport: true,
  };

  if (tierId === "lightning") {
    return {
      ...base,
      particles: {
        number: { value: Math.round(20 * densityScale) },
        color: { value: ["#6ed8ff", "#ffffff", "#a8e8ff"] },
        shape: { type: "circle" },
        opacity: {
          value: { min: 0.4, max: 1 },
          animation: { enable: true, speed: 4, sync: false },
        },
        size: { value: { min: 0.5, max: 2 } },
        move: {
          enable: true,
          speed: { min: 1, max: 3 },
          direction: "none",
          random: true,
          straight: false,
          outModes: { default: "out" },
        },
        links: {
          enable: true,
          distance: 60,
          color: "#6ed8ff",
          opacity: 0.6,
          width: 1,
          triangles: { enable: false },
        },
      },
    };
  }

  if (tierId === "inferno") {
    return {
      ...base,
      preset: "fire",
      particles: {
        number: { value: Math.round(40 * densityScale) },
        move: {
          speed: { min: 1, max: 3 },
        },
      },
    };
  }

  if (tierId === "obsidian") {
    return {
      ...base,
      particles: {
        number: { value: Math.round(30 * densityScale) },
        color: { value: ["#ffffff", "#c0c0e0", "#e0e0ff"] },
        shape: { type: "circle" },
        opacity: {
          value: { min: 0, max: 0.85 },
          animation: { enable: true, speed: 1.5, sync: false, startValue: "min" },
        },
        size: { value: { min: 0.3, max: 1.4 } },
        move: {
          enable: true,
          speed: { min: 0.2, max: 0.7 },
          direction: "none",
          random: true,
          outModes: { default: "out" },
        },
      },
    };
  }

  if (tierId === "cosmic") {
    return {
      ...base,
      preset: "stars",
      particles: {
        number: { value: Math.round(80 * densityScale) },
        color: { value: ["#b66dff", "#4dc8ff", "#ff61b6", "#ffffff"] },
        size: { value: { min: 0.5, max: 1.6 } },
        move: { speed: { min: 0.1, max: 0.5 } },
      },
    };
  }

  // singularity: vortex pulling particles toward the center
  return {
    ...base,
    particles: {
      number: { value: Math.round(60 * densityScale) },
      color: { value: ["#ffffff", "#ff61b6", "#b66dff", "#4dc8ff", "#ffd24d"] },
      shape: { type: "circle" },
      opacity: {
        value: { min: 0.4, max: 1 },
        animation: { enable: true, speed: 2, sync: false },
      },
      size: { value: { min: 0.4, max: 2 } },
      move: {
        enable: true,
        speed: { min: 1, max: 4 },
        direction: "none",
        random: false,
        straight: false,
        outModes: { default: "destroy" },
        attract: {
          enable: true,
          distance: 200,
          rotate: { x: 600, y: 1200 },
        },
      },
    },
    emitters: [
      {
        position: { x: 50, y: 50 },
        rate: { delay: 0.1, quantity: 2 },
        size: { width: 100, height: 100, mode: "percent" },
        particles: {
          move: {
            angle: { value: 360, offset: 0 },
            direction: "none",
          },
        },
      },
    ],
  };
}

export default function VanityParticles({ tierId, size }: Props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ensureEngine(tierId).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [tierId]);

  const particleTier = isParticleTier(tierId) ? tierId : null;
  const options = useMemo(
    () => (particleTier ? configFor(particleTier, size) : null),
    [particleTier, size],
  );

  if (!ready || !options) return null;

  return (
    <Particles
      id={`vanity-${tierId}-${size}`}
      className={styles.particleOverlay}
      options={options}
    />
  );
}

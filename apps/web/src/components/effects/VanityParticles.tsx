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
 * the two layers reinforce each other (e.g. the inferno border's
 * flicker matches the ember plume rising out of the bottom).
 *
 * Particles are confined to the wrapper via `fullScreen.enable: false`
 * + `position: absolute; inset: 0` on the host element. The `Particles`
 * component creates its own canvas inside that overlay, sized to the
 * wrapper's bounding box.
 */

let engineReady: Promise<void> | null = null;

/**
 * Lazy-initialise the tsparticles engine exactly once across the page.
 *
 * We deliberately use the `slim` bundle (not `basic`) because our
 * custom configs use features the fire/stars *presets* don't pull in
 * by themselves: particle-links (lightning), particle-attract
 * (singularity), the life updater (inferno + singularity destroy
 * timers), and the bounce out-mode (lightning ricochet). On top of
 * slim we add the emitters plugin so the inferno bottom-up plume and
 * the singularity vortex emitter work. The fire / stars preset
 * configs themselves are still loaded for reference / future use.
 *
 * Without slim, the relevant config keys are silently ignored —
 * particles render a blank canvas inside the wrapper, which is what
 * users see as "only the border + glow showing".
 */
async function ensureEngine(tierId: VanityTierId): Promise<void> {
  if (!engineReady) {
    engineReady = initParticlesEngine(async (engine) => {
      const { loadSlim } = await import("@tsparticles/slim");
      const { loadEmittersPlugin } = await import(
        "@tsparticles/plugin-emitters"
      );
      const { loadFirePreset } = await import("@tsparticles/preset-fire");
      const { loadStarsPreset } = await import("@tsparticles/preset-stars");
      await loadSlim(engine, false);
      await loadEmittersPlugin(engine, false);
      await loadFirePreset(engine, false);
      await loadStarsPreset(engine, false);
    }).catch((err) => {
      console.error("[VanityParticles] engine init failed", err);
      throw err;
    });
  }
  await engineReady;
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
  // Particle counts scale with wrapper visual size. Smaller wrappers
  // use fewer particles so a homepage row of icon-sized chips doesn't
  // end up firing hundreds of emitters.
  const densityScale
    = size === "icon" ? 0.5
      : size === "row" ? 0.85
        : size === "card" ? 1.1
          : size === "button" ? 1
            : 1.3; // hero

  const base: ISourceOptions = {
    fullScreen: { enable: false },
    background: { color: "transparent" },
    detectRetina: true,
    fpsLimit: 60,
    // Pause when the tab loses focus. The React-level gate
    // (`showParticles && inView` in `VanityEffect`) already unmounts
    // the canvas when the element scrolls off-screen, but it stays
    // mounted while the tab is just backgrounded — so without this,
    // every visible token row's particles keep burning CPU after
    // `cmd+tab`.
    pauseOnBlur: true,
    // Belt-and-braces with our IntersectionObserver gate: if the
    // observer ever misses an off-screen transition (e.g. unusual
    // nested-scroll layouts), tsparticles' own canvas-level observer
    // catches it and pauses redundantly. Free to leave on — when the
    // React gate is doing its job this option is a no-op.
    pauseOnOutsideViewport: true,
  };

  if (tierId === "lightning") {
    // Bright cyan sparks ricocheting around with thin links between
    // close particles, giving an "arcing electricity" feel. Higher
    // particle count + stronger link visibility than the previous
    // tuning so the effect shows up clearly even on a small chip.
    return {
      ...base,
      particles: {
        number: { value: Math.round(35 * densityScale) },
        color: { value: ["#6ed8ff", "#ffffff", "#a8e8ff", "#cdf2ff"] },
        shape: { type: "circle" },
        opacity: {
          value: { min: 0.6, max: 1 },
          animation: { enable: true, speed: 4, sync: false },
        },
        size: { value: { min: 1, max: 3 } },
        move: {
          enable: true,
          speed: { min: 1.5, max: 4 },
          direction: "none",
          random: true,
          straight: false,
          outModes: { default: "bounce" },
        },
        links: {
          enable: true,
          distance: 80,
          color: "#6ed8ff",
          opacity: 0.85,
          width: 1.2,
          triangles: { enable: false },
        },
      },
    };
  }

  if (tierId === "inferno") {
    // Bottom-up ember plume. Hand-rolled rather than relying on the
    // `preset: "fire"` config alone, because the preset assumes a
    // full-screen container — overriding number / movement /
    // emitter explicitly so the plume scales sensibly down to row
    // size.
    return {
      ...base,
      particles: {
        number: { value: 0 }, // emitter populates
        color: { value: ["#ffd24d", "#ff7a3a", "#ff3a00", "#ffffff"] },
        shape: { type: "circle" },
        opacity: {
          value: { min: 0.3, max: 0.95 },
          animation: { enable: true, speed: 1.5, sync: false, startValue: "max", destroy: "min" },
        },
        size: {
          value: { min: 1, max: 4 },
          animation: { enable: true, speed: 4, startValue: "max", destroy: "min", sync: false },
        },
        move: {
          enable: true,
          speed: { min: 2, max: 5 },
          direction: "top",
          random: false,
          straight: false,
          outModes: { default: "destroy" },
        },
        life: {
          duration: { value: { min: 0.6, max: 1.4 } },
          count: 1,
        },
      },
      emitters: [
        {
          position: { x: 50, y: 100 },
          rate: { delay: 0.08, quantity: Math.max(2, Math.round(3 * densityScale)) },
          size: { width: 70, height: 0, mode: "percent" },
        },
      ],
    };
  }

  if (tierId === "obsidian") {
    // Slow, sparse white motes drifting against the dark border.
    // Bright contrast so they show up against any background.
    return {
      ...base,
      particles: {
        number: { value: Math.round(40 * densityScale) },
        color: { value: ["#ffffff", "#d8d8f0", "#a8a8d0"] },
        shape: { type: "circle" },
        opacity: {
          value: { min: 0.1, max: 0.95 },
          animation: { enable: true, speed: 1.2, sync: false, startValue: "min" },
        },
        size: { value: { min: 0.6, max: 2 } },
        move: {
          enable: true,
          speed: { min: 0.3, max: 1 },
          direction: "none",
          random: true,
          straight: false,
          outModes: { default: "out" },
        },
      },
    };
  }

  if (tierId === "cosmic") {
    // Dense violet/cyan/magenta star field, slowly drifting. The
    // pulsing-opacity animation effectively gives a "twinkle" without
    // needing the separate twinkle plugin.
    return {
      ...base,
      particles: {
        number: { value: Math.round(120 * densityScale) },
        color: { value: ["#b66dff", "#4dc8ff", "#ff61b6", "#ffffff", "#ffd24d"] },
        shape: { type: "circle" },
        opacity: {
          value: { min: 0.15, max: 1 },
          animation: {
            enable: true,
            speed: 2.5,
            sync: false,
            startValue: "random",
          },
        },
        size: { value: { min: 0.5, max: 2.2 } },
        move: {
          enable: true,
          speed: { min: 0.1, max: 0.6 },
          direction: "none",
          random: true,
          outModes: { default: "out" },
        },
      },
    };
  }

  // Singularity: vortex pulling particles toward the centre, with
  // colourful trails being consumed.
  return {
    ...base,
    particles: {
      number: { value: 0 },
      color: { value: ["#ffffff", "#ff61b6", "#b66dff", "#4dc8ff", "#ffd24d", "#ff7a3a"] },
      shape: { type: "circle" },
      opacity: {
        value: { min: 0.5, max: 1 },
        animation: { enable: true, speed: 2, sync: false },
      },
      size: {
        value: { min: 0.6, max: 2.4 },
        animation: { enable: true, speed: 3, startValue: "max", destroy: "min", sync: false },
      },
      move: {
        enable: true,
        speed: { min: 1.5, max: 4 },
        direction: "none",
        random: false,
        straight: false,
        outModes: { default: "destroy" },
        attract: {
          enable: true,
          distance: 250,
          rotate: { x: 700, y: 1400 },
        },
      },
      life: {
        duration: { value: { min: 1.2, max: 2.4 } },
        count: 1,
      },
    },
    emitters: [
      {
        position: { x: 50, y: 50 },
        rate: { delay: 0.05, quantity: Math.max(2, Math.round(3 * densityScale)) },
        size: { width: 100, height: 100, mode: "percent" },
      },
    ],
  };
}

export default function VanityParticles({ tierId, size }: Props) {
  const [ready, setReady] = useState(false);
  // Stable per-instance id so multiple tier wrappers on the same page
  // (e.g. the dev showcase, where one tier renders four times across
  // row/hero/icon/button) don't collide on the tsparticles container
  // id.
  const [instanceId] = useState(() =>
    Math.random().toString(36).slice(2, 10),
  );

  useEffect(() => {
    let cancelled = false;
    ensureEngine(tierId)
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        // Engine init failure is logged inside `ensureEngine`. Border +
        // glow CSS still applies; particles are graceful-degradation.
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
      id={`vanity-${tierId}-${size}-${instanceId}`}
      className={styles.particleOverlay}
      options={options}
    />
  );
}

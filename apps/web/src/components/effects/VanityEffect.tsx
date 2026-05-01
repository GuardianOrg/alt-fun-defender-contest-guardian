import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import styles from "./VanityEffect.module.css";
import { tierFor, tierForZeros, type VanityTier } from "../../utils/vanityTier";

import type { Address } from "viem";

/**
 * Lazy-loaded particle renderer. Only loaded on demand when a tier ≥
 * lightning enters the viewport, so the homepage doesn't pull tsparticles
 * into the critical path.
 */
const VanityParticles = lazy(() => import("./VanityParticles"));

export type VanitySize = "icon" | "row" | "card" | "hero" | "button";

interface VanityEffectProps {
  /** Pre-resolved tier. Mutually exclusive with `address` / `zeros`. */
  tier?: VanityTier;
  /** Token address. The tier is derived via `tierFor(address)`. */
  address?: Address | string | null;
  /** Total trailing-zero count. Used by the create-flow live preview. */
  zeros?: number;
  size: VanitySize;
  /** Extra class merged onto the wrapper for layout control. */
  className?: string;
  /**
   * Render-as. Defaults to `display: contents` (effect floats on the
   * child's box). Set to `inline` for inline-flex chips, `block` for
   * standalone wrappers like the launch button.
   */
  as?: "contents" | "inline" | "block";
  children: ReactNode;
}

function resolveTier(props: VanityEffectProps): VanityTier {
  if (props.tier) return props.tier;
  if (typeof props.zeros === "number") return tierForZeros(props.zeros);
  if (props.address) return tierFor(props.address);
  return tierForZeros(0);
}

/**
 * Hook: returns true whenever the wrapped element is at least partially
 * in the viewport. Used to gate expensive particle effects so a
 * 50-token homepage list doesn't fire 50 emitters off-screen.
 */
/**
 * Returns whether the wrapped element is currently in (or near) the
 * viewport. Defaults to `true` so high-tier effects render
 * immediately on mount; the observer only flips it to `false` if the
 * element is later confirmed to be off-screen.
 *
 * Why default-true: a strict default-false races against the
 * IntersectionObserver's first callback, and on layouts with a
 * scrolling parent (e.g. our showcase page wraps everything in
 * `.layout { overflow-y: auto }`) the observer's default
 * `root: viewport` may never fire `isIntersecting` for elements
 * inside that scroll container at all. Leaning toward "show" with
 * downward correction is both more correct and visibly snappier.
 */
function useInView(ref: React.RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setInView(entry.isIntersecting);
        }
      },
      { rootMargin: "100px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}

/**
 * Hook: returns true if the user has requested reduced motion at the OS
 * level. Higher-tier effects (animated borders, particle emitters) drop
 * to a static glow when this is true.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mql.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return reduced;
}

/**
 * Wraps `children` with a tier-appropriate visual effect. CSS-only tiers
 * (bronze → diamond) apply a `::before` border and `::after` glow via
 * module-scoped classes; particle tiers (lightning+) compose the same
 * border on top of a lazy-loaded `<VanityParticles>` overlay.
 *
 * The wrapper is `display: contents` by default so it doesn't affect
 * layout — the effect anchors to the child's bounding box. Use
 * `as="inline"` or `as="block"` when the child is something the wrapper
 * needs to size itself (e.g. the launch button).
 */
export default function VanityEffect(props: VanityEffectProps) {
  const tier = resolveTier(props);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const reducedMotion = usePrefersReducedMotion();

  /**
   * Mirror the child's computed `border-radius` onto the wrapper so the
   * tier border (`::before`, which uses `border-radius: inherit`) hugs
   * the child precisely. Without this, every consumer would have to
   * remember to set a matching radius on the wrapper.
   *
   * Using a callback ref so the radius is applied synchronously on
   * mount — no first-frame flash with square corners on a rounded
   * child.
   */
  const setRef = useCallback((el: HTMLDivElement | null) => {
    ref.current = el;
    if (!el) return;
    const child = el.firstElementChild as HTMLElement | null;
    if (!child) return;
    const radius = window.getComputedStyle(child).borderRadius;
    if (radius && radius !== "0px") {
      el.style.borderRadius = radius;
    }
  }, []);

  const showParticles
    = tier.effect === "particles" && inView && !reducedMotion;

  // None tier is the common case; render children verbatim with no
  // wrapper at all to avoid DOM bloat across hundreds of token rows.
  if (tier.id === "none") {
    return <>{props.children}</>;
  }

  const wrapperBase
    = props.as === "inline"
      ? styles.wrapperInline
      : props.as === "block"
        ? styles.wrapperBlock
        : styles.wrapper;

  // `display: contents` means we can't use ::before / ::after on the
  // wrapper itself (they'd have nowhere to render). For those modes we
  // rely on the child carrying the tier class via a sibling
  // pseudo-wrapper — but the simpler approach is to require `inline` /
  // `block` whenever a CSS-tier effect needs to render. We default to
  // block when a tier with effects is used, since `display: contents`
  // would silently skip them.
  const effectiveAs
    = props.as ?? (tier.effect === "none" ? "contents" : "block");
  const effectiveBase
    = effectiveAs === "inline"
      ? styles.wrapperInline
      : effectiveAs === "block"
        ? styles.wrapperBlock
        : wrapperBase;

  const className = [effectiveBase, styles[tier.id], styles[props.size]]
    .concat(props.className ?? [])
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={setRef} className={className}>
      {props.children}
      {showParticles && (
        <Suspense fallback={null}>
          <VanityParticles tierId={tier.id} size={props.size} />
        </Suspense>
      )}
    </div>
  );
}

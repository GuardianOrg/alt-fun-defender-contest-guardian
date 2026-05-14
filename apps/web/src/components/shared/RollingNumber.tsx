import { useEffect, useRef, useState } from "react";

import styles from "./RollingNumber.module.css";
import { cn } from "../../utils/format";

interface Props {
  /** Numeric target. `null` / `undefined` renders {@link dashFallback}. */
  value: number | null | undefined;
  /** Formatter for the displayed string (e.g. {@link formatMcapUsd}). */
  format: (n: number) => string;
  /** Tween length in ms. */
  durationMs?: number;
  /** Glow accent — `"up"` mints when value increases, `"down"` reds when it
   *  decreases, `"neutral"` skips the colour cue. Defaults to `"up"`. */
  trend?: "up" | "down" | "neutral";
  /** Sentinel for null / undefined. Defaults to `—`. */
  dashFallback?: string;
  className?: string;
  /** ARIA label for the wrapping span. */
  "aria-label"?: string;
}

const DEFAULT_DURATION_MS = 700;

/**
 * easeOutCubic — fast-start, gentle settle. Picked over linear so the
 * digits visibly decelerate as they approach the target (the "rolling
 * to a stop" feel) instead of snapping to the new value at constant speed.
 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function resolveValue(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : value;
}

/**
 * Animated counter primitive used by the token-detail mcap overlay.
 *
 * Tweens the underlying number from the previous value to the new one
 * using `requestAnimationFrame` and re-runs the supplied formatter each
 * frame, so the rendered string ticks through plausible intermediate
 * states (e.g. `$25.0K → $25.4K → $25.8K → $26.2K → …`). On the first
 * mount we skip the tween entirely and snap to the initial value — the
 * roll only kicks in for *changes*, so the page doesn't open with every
 * mcap counting up from zero.
 *
 * The wrapper picks up a transient `.flashUp` / `.flashDown` class for
 * the duration of the animation, which the stylesheet uses to drive a
 * brief mint / red glow + scale pulse. `prefers-reduced-motion` is
 * honoured by the CSS (no glow, no scale) and by skipping the tween in
 * JS (we snap directly to the new value).
 */
export default function RollingNumber({
  value,
  format,
  durationMs = DEFAULT_DURATION_MS,
  trend = "up",
  dashFallback = "—",
  className,
  "aria-label": ariaLabel,
}: Props) {
  // Currently-displayed numeric value. Updated 60×/s during a tween via
  // `setDisplayed` — React batches these into individual frames so the
  // cost is similar to driving the value through a ref + forceRender,
  // and keeping it as state means we can read it in render without
  // tripping the project's `react-hooks/refs` lint rule.
  const [displayed, setDisplayed] = useState<number | null>(() =>
    resolveValue(value),
  );
  // Drives the flashUp/flashDown className for the duration of the
  // tween. Cleared on the final frame so the CSS animation re-runs on
  // the next change rather than persisting.
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  // Animation control state. Refs because they're only ever touched
  // inside the effect / cleanup and never feed render output, which
  // also keeps the rAF loop from causing extra renders on cancellation.
  const rafRef = useRef<number | null>(null);
  // Last *target* value the effect committed to. Used to short-circuit
  // when the incoming `value` matches what we're already animating to,
  // and as the `prev` baseline for picking the flash direction. Kept
  // out of state so updating it doesn't itself schedule a render.
  const targetRef = useRef<number | null>(resolveValue(value));

  useEffect(() => {
    const next = resolveValue(value);
    const prev = targetRef.current;

    // Null transitions snap — there's nothing meaningful to tween
    // through (e.g. loading → loaded) and the count would have to
    // start from an arbitrary baseline.
    if (next === null || prev === null) {
      targetRef.current = next;
      setDisplayed(next);
      setFlash(null);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    if (next === prev) return;

    // Honour the OS reduced-motion preference: snap to the new value
    // and skip the glow. Cheap to read on every change and avoids
    // burning frames the user doesn't want.
    const reducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      targetRef.current = next;
      setDisplayed(next);
      setFlash(null);
      return;
    }

    targetRef.current = next;
    setFlash(next > prev ? "up" : "down");
    // Tween from whatever is currently rendered (mid-tween it's a
    // partial value; otherwise it equals `prev`). Falls back to `prev`
    // if `displayed` is somehow null at this point — defensive, but
    // the null branch above should keep that case from arising.
    const fromValue = displayed ?? prev;
    let startTime: number | null = null;

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    const tick = (now: number) => {
      if (startTime === null) startTime = now;
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / durationMs);
      const eased = easeOutCubic(t);
      const current = fromValue + (next - fromValue) * eased;
      if (t < 1) {
        setDisplayed(current);
        rafRef.current = requestAnimationFrame(tick);
      } else {
        // Snap to the exact target on the final frame so a long tween
        // tail can't leave a sub-pixel residue (e.g. `$24999.7` when
        // the target is `$25000`).
        setDisplayed(next);
        setFlash(null);
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    // `displayed` intentionally omitted — including it would restart
    // the tween every frame as the displayed value updates. We read it
    // synchronously above as the *starting* point and the `targetRef`
    // short-circuit covers the intended re-trigger condition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Pick the flash colour. `trend` says which direction is "good" for
  // this metric (mcap goes up → mint), and the flash direction is the
  // actual delta — so a matching pair gets the positive `flashUp`
  // class and a mismatch gets the negative `flashDown`.
  let flashClass: string | null = null;
  if (flash !== null && trend !== "neutral") {
    flashClass = flash === trend ? styles.flashUp : styles.flashDown;
  }

  return (
    <span
      className={cn(styles.root, flashClass, className)}
      aria-label={ariaLabel}
    >
      {displayed === null ? dashFallback : format(displayed)}
    </span>
  );
}

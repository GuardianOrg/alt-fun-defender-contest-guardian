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
  /** Glow accent for positive direction; `"neutral"` skips colour. */
  trend?: "up" | "down" | "neutral";
  /** Sentinel for null / undefined. Defaults to `—`. */
  dashFallback?: string;
  className?: string;
  /** ARIA label for the wrapping span. */
  "aria-label"?: string;
}

const DEFAULT_DURATION_MS = 700;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function resolveValue(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : value;
}

/** Animated counter primitive used by token-detail metrics. */
export default function RollingNumber({
  value,
  format,
  durationMs = DEFAULT_DURATION_MS,
  trend = "up",
  dashFallback = "—",
  className,
  "aria-label": ariaLabel,
}: Props) {
  // State keeps the rendered value lint-friendly during the rAF tween.
  const [displayed, setDisplayed] = useState<number | null>(() =>
    resolveValue(value),
  );
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  const rafRef = useRef<number | null>(null);
  // Last committed target, kept out of render state.
  const targetRef = useRef<number | null>(resolveValue(value));

  useEffect(() => {
    const next = resolveValue(value);
    const prev = targetRef.current;

    // Null transitions snap because there is no meaningful tween baseline.
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

    // Ignore sub-display jitter while still refreshing the numeric baseline.
    if (format(next) === format(prev)) {
      targetRef.current = next;
      setDisplayed(next);
      setFlash(null);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    // Honour reduced-motion with a snap instead of a tween/glow.
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
    // Continue from the currently rendered value if a tween is already mid-flight.
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
        // Snap to the exact target on the final frame.
        setDisplayed(next);
        setFlash(null);
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    // `displayed` would restart the tween every frame; `targetRef` guards re-triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs, format]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

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

import { useEffect, useState } from "react";

/**
 * Reactive viewport-width hook for the 768px breakpoint we standardize on
 * across the app (matches every `@media (max-width: 768px)` in the web
 * CSS modules). Returns `true` when the viewport is at or below 768px.
 *
 * SSR-safe: defaults to `false` when `window` is unavailable, then
 * resyncs on mount. The matchMedia listener keeps the value live across
 * orientation changes and devtools resize so layouts that conditionally
 * mount a component (e.g. swap an inline panel for a modal) re-render
 * cleanly when the user rotates a tablet.
 */
export function useIsMobile(maxWidthPx = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(`(max-width: ${maxWidthPx}px)`);
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [maxWidthPx]);

  return isMobile;
}

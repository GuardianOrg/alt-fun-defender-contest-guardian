import { useEffect, useRef, useState } from "react";

import { DEGRADED_EVENT } from "../services/api";

const AUTO_CLEAR_MS = 30_000;

/**
 * Hook that tracks whether the API is returning degraded data
 * (i.e., the Ponder indexer is unavailable).
 * Listens for custom events dispatched by the API fetch layer.
 * Auto-clears after 30 seconds if no new degraded signal arrives,
 * since transient indexer hiccups shouldn't persist indefinitely.
 */
export default function useDegradedState(): boolean {
  const [degraded, setDegraded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ degraded: boolean }>).detail;

      if (detail.degraded) {
        setDegraded(true);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setDegraded(false), AUTO_CLEAR_MS);
      } else {
        setDegraded(false);
        clearTimeout(timerRef.current);
      }
    };

    window.addEventListener(DEGRADED_EVENT, handler);
    return () => {
      window.removeEventListener(DEGRADED_EVENT, handler);
      clearTimeout(timerRef.current);
    };
  }, []);

  return degraded;
}

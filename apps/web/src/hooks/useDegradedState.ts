import { useEffect, useState } from "react";

import { DEGRADED_EVENT } from "../services/api";

/**
 * Hook that tracks whether the API is returning degraded data
 * (i.e., the Ponder indexer is unavailable).
 * Listens for custom events dispatched by the API fetch layer.
 */
export default function useDegradedState(): boolean {
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ degraded: boolean }>).detail;
      setDegraded(detail.degraded);
    };

    window.addEventListener(DEGRADED_EVENT, handler);
    return () => window.removeEventListener(DEGRADED_EVENT, handler);
  }, []);

  return degraded;
}

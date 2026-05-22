import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface UseFlashOnNewOptions<T> {
  /** Flash lifetime; slightly longer than the CSS animation. */
  flashMs?: number;
  /** Timestamp gate that separates live arrivals from revealed history. */
  getTimestamp: (item: T) => number | string | null | undefined;
  /** Disabled surfaces record items as seen without retroactive flashes. */
  enabled?: boolean;
}

/**
 * Highlight genuinely live arrivals. Layout effect applies the flash class
 * in the same paint cycle that introduces the row.
 */
export function useFlashOnNew<T>(
  items: T[],
  getId: (item: T) => string,
  options: UseFlashOnNewOptions<T>,
): Set<string> {
  const { getTimestamp, flashMs = 2400, enabled = true } = options;

  const [flashing, setFlashing] = useState<Set<string>>(() => new Set());

  const seenRef = useRef<Set<string> | null>(null);
  // Items at or before this timestamp are historical context, not live arrivals.
  const activeSinceRef = useRef<number | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  useLayoutEffect(() => {
    if (seenRef.current === null) seenRef.current = new Set();
    const seen = seenRef.current;

    // Disabled panels swallow current items and reset the active window.
    if (!enabled) {
      activeSinceRef.current = null;
      for (const item of items) seen.add(getId(item));
      return;
    }

    if (activeSinceRef.current === null) activeSinceRef.current = Date.now();
    const activeSince = activeSinceRef.current;

    const newIds: string[] = [];
    for (const item of items) {
      const id = getId(item);
      if (seen.has(id)) continue;
      seen.add(id);
      // Missing/unparsable or pre-enabled timestamps are historical.
      const raw = getTimestamp(item);
      if (raw === null || raw === undefined) continue;
      const ts = typeof raw === "number" ? raw : Date.parse(raw);
      if (!Number.isFinite(ts) || ts <= activeSince) continue;
      newIds.push(id);
    }

    if (newIds.length === 0) return;

    setFlashing((prev) => {
      const next = new Set(prev);
      for (const id of newIds) next.add(id);
      return next;
    });

    const timers = timersRef.current;
    for (const id of newIds) {
      const timer = setTimeout(() => {
        timers.delete(id);
        setFlashing((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, flashMs);
      timers.set(id, timer);
    }
  }, [items, getId, getTimestamp, flashMs, enabled]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  return flashing;
}

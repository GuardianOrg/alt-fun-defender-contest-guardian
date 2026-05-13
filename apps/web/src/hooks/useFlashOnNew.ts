import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface UseFlashOnNewOptions<T> {
  /** How long an item stays in the flashing state. Default 2400ms — a
   *  hair longer than the 2.2s CSS animation so the React-side timer
   *  always fires AFTER the animation has settled at its transparent
   *  end-state. That avoids a visible "snap" where removing the class
   *  mid-animation would jump the bg back to its non-animated value. */
  flashMs?: number;
  /**
   * Accessor returning the item's creation timestamp — either an
   * ISO-8601 string (parsable by `Date.parse`) or a `number` of ms
   * since epoch. Only items whose timestamp lands **after** the hook
   * last became enabled are eligible to flash; everything else (the
   * initial fetch's historical context, paginated history scrolled
   * into view, items already present when the user opened this view)
   * is silently recorded as "seen" and never flashes — even on the
   * first render that adds it to the items array.
   *
   * This is the primary mechanism for distinguishing a genuinely-live
   * arrival from a row that's merely being revealed for the first
   * time. The hook cannot make that distinction from item identity
   * alone; pagination and live arrivals both appear as "a new id in
   * the items array". The timestamp gate resolves the ambiguity.
   */
  getTimestamp: (item: T) => number | string | null | undefined;
  /**
   * When `false`, items added to the array are silently recorded as
   * "seen" without ever flashing — and the internal "active since"
   * reference is cleared so a subsequent re-enable starts a fresh
   * tracking session from the moment the user re-engaged the view.
   *
   * Use this to scope the flash to a specific tab / panel: pass
   * `true` only while the user is actually looking at the surface
   * the flash would render on. Items that arrive while the panel is
   * disabled never light up retroactively when the user comes back —
   * the "flash" signal is reserved for arrivals the user could
   * plausibly have witnessed.
   *
   * Default `true`.
   */
  enabled?: boolean;
}

/**
 * Generic "highlight items that just appeared" hook. Pass it the
 * array your component renders, a stable id accessor, and a
 * timestamp accessor; the returned `Set` contains the ids that
 * should currently render with the "newly arrived" flash class.
 *
 * Only items whose timestamp post-dates the moment the hook last
 * became enabled trigger the flash — see `getTimestamp` and
 * `enabled` JSDoc for the rationale.
 *
 * Detection runs inside a **layout** effect so the state update is
 * flushed and the flash class lands in the same paint cycle that
 * introduces the new row. With a plain `useEffect` the browser
 * would paint the un-styled row once before the class arrived on
 * the next render, producing a visible "row appears then flashes"
 * stutter; with `useLayoutEffect` React commits both renders before
 * yielding to the paint pipeline so the user only ever sees the
 * row with the bright background already on.
 *
 * Refs are only touched inside the effect (never during render) so
 * the hook complies with `react-hooks/refs` + `react-hooks/purity`
 * in the project's lint config.
 */
export function useFlashOnNew<T>(
  items: T[],
  getId: (item: T) => string,
  options: UseFlashOnNewOptions<T>,
): Set<string> {
  const { getTimestamp, flashMs = 2400, enabled = true } = options;

  const [flashing, setFlashing] = useState<Set<string>>(() => new Set());

  const seenRef = useRef<Set<string> | null>(null);
  // Wall-clock timestamp (ms) of when the hook last became enabled.
  // Items whose own timestamp is at or before this value never flash,
  // because either (a) they were already present when the user
  // started watching, or (b) they slipped into the dataset while the
  // hook was disabled and the user wasn't actually looking. Cleared
  // back to `null` whenever `enabled` flips false so the next
  // re-enable starts a fresh tracking window.
  const activeSinceRef = useRef<number | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  useLayoutEffect(() => {
    if (seenRef.current === null) seenRef.current = new Set();
    const seen = seenRef.current;

    // Disabled: swallow every current item into `seen` so a later
    // re-enable doesn't treat them as fresh arrivals, then bail out
    // before scheduling any flash. Also clear the "active since"
    // anchor so the next enabled window starts its own session
    // from `Date.now()`.
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
      // Live-arrival gate: any item whose own timestamp is at or
      // before the hook last became enabled is treated as historical
      // context (initial fetch, scrolled-in pagination, an older
      // row resurfacing in a refetch) and silently retired into
      // `seen` without flashing. Missing or unparsable timestamps
      // also fall through to "don't flash" — better to under-flash
      // than to flash spuriously.
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

  // Cancel pending timers on unmount so a late `setFlashing` never
  // fires against a torn-down consumer.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  return flashing;
}

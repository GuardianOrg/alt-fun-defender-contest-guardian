import { useCallback, useEffect, useState } from "react";

import {
  SLIPPAGE_STORAGE_KEY,
  readSlippageFromStorage,
  writeSlippageToStorage,
} from "./slippageStorage";

/**
 * Persisted slippage tolerance, shared by every trade panel on the site.
 * See `slippageStorage.ts` for the validation / accepted range. Returns
 * the same `[value, setter]` shape as `useState<number>` so it's a drop-in
 * replacement at call sites.
 *
 * Cross-tab sync is wired through the native `storage` event so changing
 * slippage in one tab is reflected in any others the user has open — without
 * it, a stale popup in tab B would re-write the old value on the next edit
 * and clobber tab A's change.
 */
export function useSlippage(): [number, (next: number) => void] {
  const [slippage, setSlippageState] = useState<number>(() =>
    readSlippageFromStorage(),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: StorageEvent) => {
      if (e.key !== SLIPPAGE_STORAGE_KEY) return;
      setSlippageState(readSlippageFromStorage());
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const setSlippage = useCallback((next: number) => {
    const persisted = writeSlippageToStorage(next);
    if (persisted === null) return;
    setSlippageState(persisted);
  }, []);

  return [slippage, setSlippage];
}

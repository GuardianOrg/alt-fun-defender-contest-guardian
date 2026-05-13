import { DEFAULT_SLIPPAGE } from "../config/constants";

/**
 * localStorage-backed cache of the user's slippage tolerance. Stored as a
 * stringified fraction (e.g. `"0.1"` for 10%) under `altfun:slippage` so the
 * user's pick survives reloads, hard refreshes, and route changes.
 *
 * The accessors below are pure — `useSlippage` wraps them with React state
 * and cross-tab `storage`-event sync. Storage failures (private mode, quota
 * exhausted, disabled storage) are swallowed so the in-memory state still
 * works; persistence just becomes a no-op.
 */
export const SLIPPAGE_STORAGE_KEY = "altfun:slippage";

/**
 * Hard cap mirrors the `<input max="50">` in `SettingsPopup` and prevents
 * an off-by-100 typo (e.g. `50` meaning 50% but parsed as `5000%`) from
 * poisoning the cache. Slippage must be strictly positive so a stored `0`
 * — which would route trades with zero tolerance and never fill — is also
 * rejected.
 */
export const MAX_SLIPPAGE = 0.5;

function clampSlippage(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  if (value <= 0 || value > MAX_SLIPPAGE) return null;
  return value;
}

export function readSlippageFromStorage(): number {
  if (typeof window === "undefined") return DEFAULT_SLIPPAGE;
  try {
    const raw = window.localStorage.getItem(SLIPPAGE_STORAGE_KEY);
    if (raw === null) return DEFAULT_SLIPPAGE;
    const parsed = parseFloat(raw);
    return clampSlippage(parsed) ?? DEFAULT_SLIPPAGE;
  } catch {
    return DEFAULT_SLIPPAGE;
  }
}

/**
 * Returns the value that was actually persisted, or `null` if the input
 * fell outside the accepted window (and therefore nothing was written).
 * Callers use the return to decide whether to update local React state —
 * keeping rejection silent at the storage layer but observable to the
 * caller.
 */
export function writeSlippageToStorage(value: number): number | null {
  const clamped = clampSlippage(value);
  if (clamped === null) return null;
  if (typeof window === "undefined") return clamped;
  try {
    window.localStorage.setItem(SLIPPAGE_STORAGE_KEY, String(clamped));
  } catch {
    // Quota / private-mode failure; persistence is best-effort.
  }
  return clamped;
}

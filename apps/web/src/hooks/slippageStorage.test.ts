import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_SLIPPAGE,
  SLIPPAGE_STORAGE_KEY,
  readSlippageFromStorage,
  writeSlippageToStorage,
} from "./slippageStorage";
import { DEFAULT_SLIPPAGE } from "../config/constants";

/**
 * Minimal in-memory `Storage` polyfill. Same pattern as `vanityStorage.test.ts`
 * — the web app's vitest config runs in the default `node` environment with
 * no jsdom, so we stub `window.localStorage` ourselves rather than pull in a
 * DOM emulation layer for the handful of methods we touch here.
 */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    key: (index: number) => {
      const keys = Array.from(map.keys());
      return index >= 0 && index < keys.length ? keys[index] : null;
    },
  } as Storage;
}

describe("slippage storage", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: createMemoryStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Fresh-user / first-visit path. `null` from `getItem` must resolve to
  // the documented default so the first render of `SettingsPopup` already
  // has the correct preset highlighted (no post-mount jump from `2%` →
  // persisted value).
  it("returns the default slippage when storage is empty", () => {
    expect(readSlippageFromStorage()).toBe(DEFAULT_SLIPPAGE);
  });

  it("round-trips a valid slippage value through write/read", () => {
    const persisted = writeSlippageToStorage(0.05);
    expect(persisted).toBe(0.05);
    expect(readSlippageFromStorage()).toBe(0.05);
  });

  // Untrusted rows (other tabs, devtools tampering, future schema bumps)
  // should never crash the trade flow. Bad strings should fall back to the
  // default and the next legit write recovers cleanly.
  it("falls back to the default when the stored value is unparseable", () => {
    window.localStorage.setItem(SLIPPAGE_STORAGE_KEY, "not-a-number");
    expect(readSlippageFromStorage()).toBe(DEFAULT_SLIPPAGE);
  });

  // Regression guard: `parseFloat("0.1abc")` returns `0.1` (it strips the
  // trailing garbage), so a tampered entry could otherwise sneak past the
  // validator. We use `Number(...)` instead, which rejects the entire
  // string if any non-numeric tail is present.
  it("rejects values with trailing non-numeric characters", () => {
    window.localStorage.setItem(SLIPPAGE_STORAGE_KEY, "0.1abc");
    expect(readSlippageFromStorage()).toBe(DEFAULT_SLIPPAGE);
  });

  // A `0` value would route trades with zero slippage and effectively make
  // every quote unfillable. `Infinity`/`NaN` are similarly degenerate. All
  // three must fall back to the default rather than be honoured.
  it("falls back to the default for non-positive or non-finite stored values", () => {
    window.localStorage.setItem(SLIPPAGE_STORAGE_KEY, "0");
    expect(readSlippageFromStorage()).toBe(DEFAULT_SLIPPAGE);

    window.localStorage.setItem(SLIPPAGE_STORAGE_KEY, "Infinity");
    expect(readSlippageFromStorage()).toBe(DEFAULT_SLIPPAGE);

    window.localStorage.setItem(SLIPPAGE_STORAGE_KEY, "-0.05");
    expect(readSlippageFromStorage()).toBe(DEFAULT_SLIPPAGE);
  });

  // Hard cap mirrors `<input max="50">` in `SettingsPopup`. The classic
  // off-by-100 bug — user types `50` thinking percent but it gets stored as
  // a fraction (`50 = 5000%`) — would otherwise poison the cache so badly
  // the user couldn't recover without devtools.
  it("rejects values above the hard cap on read", () => {
    window.localStorage.setItem(
      SLIPPAGE_STORAGE_KEY,
      String(MAX_SLIPPAGE + 0.01),
    );
    expect(readSlippageFromStorage()).toBe(DEFAULT_SLIPPAGE);
  });

  it("rejects out-of-range writes and leaves the previous value intact", () => {
    writeSlippageToStorage(0.05);
    expect(writeSlippageToStorage(50)).toBeNull();
    expect(writeSlippageToStorage(0)).toBeNull();
    expect(writeSlippageToStorage(Number.NaN)).toBeNull();
    expect(readSlippageFromStorage()).toBe(0.05);
  });

  // Boundary values: the cap is inclusive (a 50% setting is allowed; the
  // hint in the popup says "max 50%") and the lower bound is exclusive
  // (zero is rejected, see above).
  it("accepts the cap value at the boundary", () => {
    expect(writeSlippageToStorage(MAX_SLIPPAGE)).toBe(MAX_SLIPPAGE);
    expect(readSlippageFromStorage()).toBe(MAX_SLIPPAGE);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteVanityCache,
  readVanityCache,
  vanityKey,
  writeVanityCache,
  type VanityCacheEntry,
} from "./vanityStorage";

import type { Address } from "viem";

const CREATOR: Address = "0xef126Ea643fC8940D9D6634DCd07F3989963Fbe6";
const IMPL: Address = "0x9a51b0dc3545cb8e9b0382b42c91f9e39a92efd6";

const sampleEntry: VanityCacheEntry = {
  salt: "0x6d53b61fee2df837477a24741e42a87384bf104de061ed740560aa890000d274",
  address: "0x0000000000000000000000000000000000000000",
  zeros: 5,
  savedAt: Date.now(),
};

/**
 * Minimal in-memory `Storage` polyfill. The web app's vitest config
 * runs in the default `node` environment (no jsdom), so we stub
 * `window.localStorage` ourselves rather than pulling in a heavyweight
 * DOM emulation layer just for these tests. The shape mirrors only the
 * methods `vanityStorage.ts` actually consumes — `getItem`,
 * `setItem`, `removeItem`, `key`, and `length` — so the LRU eviction
 * scan has indices to walk.
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

describe("vanity cache", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: createMemoryStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The `(creator, impl, name, ticker)` tuple is the cache key. Three
  // of those feed `Bonding._mixSalt` directly; impl is what the EIP-1167
  // init code is hashed against. Stable keying matters because
  // `useCreateToken` calls `invalidateCachedSalt` with the same trimmed
  // strings to drop a colliding row.
  it("derives a stable, prefixed key from the launch tuple", () => {
    const key = vanityKey(CREATOR, IMPL, "OILBARRON", "OILBARRON");
    expect(key.startsWith("vanity:")).toBe(true);
    expect(key).toBe(vanityKey(CREATOR, IMPL, "OILBARRON", "OILBARRON"));
  });

  it("round-trips a single entry via write/read", () => {
    const key = vanityKey(CREATOR, IMPL, "Foo", "FOO");
    writeVanityCache(key, sampleEntry);
    expect(readVanityCache(key)).toEqual(sampleEntry);
  });

  // The whole reason `deleteVanityCache` exists: the predicted clone
  // address already has bytecode (the user previously launched a token
  // with the same name + ticker), so the cached salt would collide
  // again on every retry. Dropping it forces the miner back into
  // `mining` state and onto a fresh `userSalt`.
  it("removes the entry so the next read returns null", () => {
    const key = vanityKey(CREATOR, IMPL, "Foo", "FOO");
    writeVanityCache(key, sampleEntry);
    expect(readVanityCache(key)).not.toBeNull();
    deleteVanityCache(key);
    expect(readVanityCache(key)).toBeNull();
  });

  it("is a no-op for keys that don't exist", () => {
    const key = vanityKey(CREATOR, IMPL, "Bar", "BAR");
    expect(() => deleteVanityCache(key)).not.toThrow();
    expect(readVanityCache(key)).toBeNull();
  });

  // Untrusted rows (other tabs, dev-tools tampering, future schema
  // bumps) should never crash the create flow. Bad shapes get dropped
  // silently — the miner just re-mines from scratch on the next start.
  it("returns null for malformed JSON rather than throwing", () => {
    const key = vanityKey(CREATOR, IMPL, "Baz", "BAZ");
    window.localStorage.setItem(key, "not-json");
    expect(readVanityCache(key)).toBeNull();
  });
});

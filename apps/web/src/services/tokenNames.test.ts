import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PonderToken } from "./ponder";

vi.mock("./ponder", () => ({
  fetchPonderToken: vi.fn(),
}));

const { fetchPonderToken } = await import("./ponder");
const fetchPonderTokenMock = vi.mocked(fetchPonderToken);

/**
 * `tokenNames` is a module-scoped singleton (the cache and listener set
 * outlive any individual test), so we re-import it fresh for each test
 * via `vi.resetModules()`. That avoids cross-test bleed where a name
 * resolved by one test would short-circuit `prefetchTokenName` in
 * another. The top-level `vi.mock("./ponder")` carries through the
 * reset, so the freshly-imported module still binds the mocked
 * `fetchPonderToken`.
 */
async function loadTokenNames() {
  vi.resetModules();
  return await import("./tokenNames");
}

const TOKEN_ADDR = "0x4DFB6bebbdF9d5ea76123729E0b3a823f9c3ecC0";

function makePonderToken(overrides: Partial<PonderToken> = {}): PonderToken {
  return {
    address: TOKEN_ADDR,
    name: "Test Token",
    symbol: "TST",
    creator: "0x0000000000000000000000000000000000000000",
    ltToken: "0x0000000000000000000000000000000000000001",
    k: "0",
    curveSupply: "0",
    ltReserve: "0",
    graduated: false,
    graduatedAt: null,
    bondingPair: null,
    hyperswapPair: null,
    blockNumber: "0",
    timestamp: "0",
    ...overrides,
  };
}

describe("tokenNames", () => {
  beforeEach(() => {
    fetchPonderTokenMock.mockReset();
  });

  describe("resolveTokenName + prefetchTokenName", () => {
    it("returns the truncated address fallback before the prefetch resolves", async () => {
      const { resolveTokenName } = await loadTokenNames();
      expect(resolveTokenName(TOKEN_ADDR)).toBe("0x4DFB…ecC0");
    });

    it("returns the resolved symbol after prefetchTokenName completes", async () => {
      const { resolveTokenName, prefetchTokenName } = await loadTokenNames();
      fetchPonderTokenMock.mockResolvedValueOnce(makePonderToken({ symbol: "TST" }));

      await prefetchTokenName(TOKEN_ADDR);

      expect(resolveTokenName(TOKEN_ADDR)).toBe("TST");
    });

    it("falls back to the token's name when symbol is empty", async () => {
      const { resolveTokenName, prefetchTokenName } = await loadTokenNames();
      fetchPonderTokenMock.mockResolvedValueOnce(
        makePonderToken({ symbol: "", name: "Test Token" }),
      );

      await prefetchTokenName(TOKEN_ADDR);

      expect(resolveTokenName(TOKEN_ADDR)).toBe("Test Token");
    });

    it("treats a payload with both symbol and name blank as unresolved", async () => {
      const { hasResolvedTokenName, prefetchTokenName, resolveTokenName, subscribeTokenName } =
        await loadTokenNames();
      // Indexer briefly returns a row with no labels — caching the empty
      // string would freeze the row on a blank `tokenName` because the
      // fallback in `resolveTokenName` only kicks in on cache miss.
      fetchPonderTokenMock.mockResolvedValueOnce(
        makePonderToken({ symbol: "", name: "" }),
      );
      const listener = vi.fn();
      subscribeTokenName(listener);

      await prefetchTokenName(TOKEN_ADDR);

      expect(hasResolvedTokenName(TOKEN_ADDR)).toBe(false);
      expect(resolveTokenName(TOKEN_ADDR)).toBe("0x4DFB…ecC0");
      expect(listener).not.toHaveBeenCalled();
    });

    it("trims whitespace-only symbol+name pairs and keeps the cache empty", async () => {
      const { hasResolvedTokenName, prefetchTokenName } = await loadTokenNames();
      // Defensive: an indexer that returns whitespace-only labels would
      // otherwise pass the `||` chain. The trim guard keeps the cache
      // open for a real retry.
      fetchPonderTokenMock.mockResolvedValueOnce(
        makePonderToken({ symbol: "   ", name: "\t" }),
      );

      await prefetchTokenName(TOKEN_ADDR);

      expect(hasResolvedTokenName(TOKEN_ADDR)).toBe(false);
    });

    it("falls back to the trimmed name when symbol is whitespace-only", async () => {
      const { hasResolvedTokenName, prefetchTokenName, resolveTokenName } =
        await loadTokenNames();
      // Each field must be trimmed independently — naive
      // `symbol || name` would treat a whitespace `symbol` as truthy and
      // skip a perfectly valid `name`. This regression-tests that path.
      fetchPonderTokenMock.mockResolvedValueOnce(
        makePonderToken({ symbol: "   ", name: "  Test Token  " }),
      );

      await prefetchTokenName(TOKEN_ADDR);

      expect(hasResolvedTokenName(TOKEN_ADDR)).toBe(true);
      expect(resolveTokenName(TOKEN_ADDR)).toBe("Test Token");
    });

    it("leaves the cache empty when the fetch returns null so subsequent calls retry", async () => {
      const { hasResolvedTokenName, prefetchTokenName } = await loadTokenNames();
      // First call: token not yet indexed.
      fetchPonderTokenMock.mockResolvedValueOnce(null);
      // Second call: indexer has caught up.
      fetchPonderTokenMock.mockResolvedValueOnce(makePonderToken({ symbol: "LATE" }));

      await prefetchTokenName(TOKEN_ADDR);
      expect(hasResolvedTokenName(TOKEN_ADDR)).toBe(false);

      await prefetchTokenName(TOKEN_ADDR);
      expect(hasResolvedTokenName(TOKEN_ADDR)).toBe(true);
      expect(fetchPonderTokenMock).toHaveBeenCalledTimes(2);
    });

    it("dedupes concurrent prefetches for the same address", async () => {
      const { prefetchTokenName } = await loadTokenNames();
      fetchPonderTokenMock.mockResolvedValueOnce(makePonderToken({ symbol: "DEDUP" }));

      await Promise.all([
        prefetchTokenName(TOKEN_ADDR),
        prefetchTokenName(TOKEN_ADDR),
        prefetchTokenName(TOKEN_ADDR),
      ]);

      expect(fetchPonderTokenMock).toHaveBeenCalledTimes(1);
    });

    it("swallows fetch errors but allows a retry afterwards", async () => {
      const { hasResolvedTokenName, prefetchTokenName } = await loadTokenNames();
      fetchPonderTokenMock.mockRejectedValueOnce(new Error("boom"));
      fetchPonderTokenMock.mockResolvedValueOnce(makePonderToken({ symbol: "RETRY" }));

      await expect(prefetchTokenName(TOKEN_ADDR)).resolves.toBeUndefined();
      expect(hasResolvedTokenName(TOKEN_ADDR)).toBe(false);

      await prefetchTokenName(TOKEN_ADDR);
      expect(hasResolvedTokenName(TOKEN_ADDR)).toBe(true);
    });
  });

  describe("subscribeTokenName", () => {
    it("notifies subscribers when a name is resolved for the first time", async () => {
      const { prefetchTokenName, subscribeTokenName } = await loadTokenNames();
      fetchPonderTokenMock.mockResolvedValueOnce(makePonderToken({ symbol: "NOTIFY" }));
      const listener = vi.fn();
      subscribeTokenName(listener);

      await prefetchTokenName(TOKEN_ADDR);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(TOKEN_ADDR.toLowerCase(), "NOTIFY");
    });

    it("does not notify subscribers when the fetch returns null", async () => {
      const { prefetchTokenName, subscribeTokenName } = await loadTokenNames();
      fetchPonderTokenMock.mockResolvedValueOnce(null);
      const listener = vi.fn();
      subscribeTokenName(listener);

      await prefetchTokenName(TOKEN_ADDR);

      expect(listener).not.toHaveBeenCalled();
    });

    it("stops notifying after unsubscribe", async () => {
      const { prefetchTokenName, subscribeTokenName } = await loadTokenNames();
      // Subscribe BEFORE the first prefetch so the unsubscribe is the
      // only reason `listener` isn't invoked — otherwise the cache
      // short-circuits the second prefetch and the listener would be
      // silent for an unrelated reason.
      const listener = vi.fn();
      const unsubscribe = subscribeTokenName(listener);
      unsubscribe();

      fetchPonderTokenMock.mockResolvedValueOnce(makePonderToken({ symbol: "GONE" }));
      await prefetchTokenName(TOKEN_ADDR);

      expect(listener).not.toHaveBeenCalled();
    });

    it("isolates a misbehaving listener from the rest", async () => {
      const { prefetchTokenName, subscribeTokenName } = await loadTokenNames();
      fetchPonderTokenMock.mockResolvedValueOnce(makePonderToken({ symbol: "ISO" }));
      // Suppress the expected warn log from the misbehaving subscriber
      // so the test output stays clean. Restored in `finally` so a
      // failing assertion doesn't leak the spy into later tests.
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const bad = vi.fn(() => {
          throw new Error("subscriber boom");
        });
        const good = vi.fn();
        subscribeTokenName(bad);
        subscribeTokenName(good);

        await prefetchTokenName(TOKEN_ADDR);

        expect(bad).toHaveBeenCalledTimes(1);
        expect(good).toHaveBeenCalledTimes(1);
        expect(good).toHaveBeenCalledWith(TOKEN_ADDR.toLowerCase(), "ISO");
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "../db/client.js";
import type {
  ChartTokenSnapshotRow,
  HolderRow,
  IndexerRouterTradeRow,
  PonderTokenOnchain,
} from "../lib/indexer-reads.js";

/**
 * Integration tests for the cached variants in `indexer-cached-reads.ts`
 * (issue #1125, solution #3). Verifies each wrapper:
 *   - delegates to the underlying fetcher on a cold miss
 *   - serves the second call inside the TTL from cache (one fetch only)
 *   - leaves error sentinels (`null` / `"unavailable"`) un-pinned so a
 *     transient Neon hiccup doesn't amplify into seconds of failures
 *
 * The underlying fetcher is mocked at the `indexer-reads.js` module
 * boundary; the cached wrappers in `indexer-cached-reads.ts` are exercised
 * for real so we cover both the memo behaviour and the per-fetcher cache-key
 * shape.
 */

const mockFetchTokenOnchain = vi.fn();
const mockFetchRouterTrades = vi.fn();
const mockFetchHolders = vi.fn();
const mockFetchTokenChartSnapshots = vi.fn();

vi.mock("../lib/indexer-reads.js", () => ({
  fetchTokenOnchain: (...args: unknown[]) => mockFetchTokenOnchain(...args),
  fetchRouterTrades: (...args: unknown[]) => mockFetchRouterTrades(...args),
  fetchHolders: (...args: unknown[]) => mockFetchHolders(...args),
  fetchTokenChartSnapshots: (...args: unknown[]) =>
    mockFetchTokenChartSnapshots(...args),
}));

const {
  _resetIndexerReadCaches,
  fetchHoldersCached,
  fetchRouterTradesCached,
  fetchTokenChartSnapshotsCached,
  fetchTokenOnchainCached,
} = await import("../lib/indexer-cached-reads.js");

const db = {} as Database;
const ADDRESS = "0xa3882D420000000000000000000000000000bEEF";

function makeTokenOnchain(): PonderTokenOnchain {
  return {
    address: ADDRESS.toLowerCase(),
    ltToken: "0x000000000000000000000000000000000000000a",
    k: "0",
    curveSupply: "0",
    ltReserve: "0",
    pendingGraduation: false,
    pendingGraduationAt: null,
    graduated: false,
    graduatedAt: null,
    bondingPair: null,
    hyperswapPair: null,
    organicUsdcRaised: "0",
    volumeUsd: "0",
    creatorFeesUsd: "0",
    protocolFeesUsd: "0",
    timestamp: "0",
  };
}

beforeEach(() => {
  _resetIndexerReadCaches();
  mockFetchTokenOnchain.mockReset();
  mockFetchRouterTrades.mockReset();
  mockFetchHolders.mockReset();
  mockFetchTokenChartSnapshots.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchTokenOnchainCached", () => {
  it("calls the underlying fetcher once for repeated address lookups", async () => {
    const token = makeTokenOnchain();
    mockFetchTokenOnchain.mockResolvedValue(token);

    expect(await fetchTokenOnchainCached(db, ADDRESS)).toEqual(token);
    expect(await fetchTokenOnchainCached(db, ADDRESS)).toEqual(token);
    expect(await fetchTokenOnchainCached(db, ADDRESS)).toEqual(token);

    expect(mockFetchTokenOnchain).toHaveBeenCalledTimes(1);
  });

  it("normalises address casing in the cache key", async () => {
    const token = makeTokenOnchain();
    mockFetchTokenOnchain.mockResolvedValue(token);

    await fetchTokenOnchainCached(db, ADDRESS.toLowerCase());
    await fetchTokenOnchainCached(db, ADDRESS.toUpperCase());

    expect(mockFetchTokenOnchain).toHaveBeenCalledTimes(1);
  });

  it("does NOT pin '\"unavailable\"' so the next call retries", async () => {
    mockFetchTokenOnchain
      .mockResolvedValueOnce("unavailable")
      .mockResolvedValueOnce(makeTokenOnchain());

    expect(await fetchTokenOnchainCached(db, ADDRESS)).toBe("unavailable");
    const second = await fetchTokenOnchainCached(db, ADDRESS);
    expect(second).not.toBe("unavailable");
    expect(mockFetchTokenOnchain).toHaveBeenCalledTimes(2);
  });

  it("caches null (token not found) — it's a legitimate result", async () => {
    mockFetchTokenOnchain.mockResolvedValue(null);

    expect(await fetchTokenOnchainCached(db, ADDRESS)).toBeNull();
    expect(await fetchTokenOnchainCached(db, ADDRESS)).toBeNull();

    expect(mockFetchTokenOnchain).toHaveBeenCalledTimes(1);
  });
});

describe("fetchRouterTradesCached", () => {
  const trade: IndexerRouterTradeRow = {
    id: "tx-1",
    tokenAddress: ADDRESS.toLowerCase(),
    trader: "0x000000000000000000000000000000000000000b",
    isBuy: true,
    usdcAmount: "1000000",
    tokenAmount: "1000000000000000000",
    blockNumber: "100",
    timestamp: "1700000000",
  };

  it("memoises by (tokenAddress, limit, offset, direction)", async () => {
    mockFetchRouterTrades.mockResolvedValue([trade]);

    await fetchRouterTradesCached(db, {
      tokenAddress: ADDRESS,
      limit: 50,
      offset: 0,
    });
    await fetchRouterTradesCached(db, {
      tokenAddress: ADDRESS,
      limit: 50,
      offset: 0,
    });
    // Different offset → different cache key, so a second fetch fires.
    await fetchRouterTradesCached(db, {
      tokenAddress: ADDRESS,
      limit: 50,
      offset: 50,
    });

    expect(mockFetchRouterTrades).toHaveBeenCalledTimes(2);
  });

  it("does NOT pin null (caught error)", async () => {
    mockFetchRouterTrades
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([trade]);

    expect(
      await fetchRouterTradesCached(db, {
        tokenAddress: ADDRESS,
        limit: 50,
        offset: 0,
      }),
    ).toBeNull();
    expect(
      await fetchRouterTradesCached(db, {
        tokenAddress: ADDRESS,
        limit: 50,
        offset: 0,
      }),
    ).toEqual([trade]);
    expect(mockFetchRouterTrades).toHaveBeenCalledTimes(2);
  });
});

describe("fetchHoldersCached", () => {
  const holder: HolderRow = {
    wallet: "0x000000000000000000000000000000000000000c",
    balance: "5000000000000000000",
  };

  it("memoises by (tokenAddress, limit, exclusion set)", async () => {
    mockFetchHolders.mockResolvedValue({ holders: [holder], totalHolders: 1 });

    await fetchHoldersCached(db, {
      tokenAddress: ADDRESS,
      limit: 20,
      excludedWallets: ["0xAaa", "0xBbb"],
    });
    // Same exclusion set in a different order — should still hit cache.
    await fetchHoldersCached(db, {
      tokenAddress: ADDRESS,
      limit: 20,
      excludedWallets: ["0xbbb", "0xaaa"],
    });
    // Different limit — distinct key.
    await fetchHoldersCached(db, {
      tokenAddress: ADDRESS,
      limit: 50,
      excludedWallets: ["0xAaa", "0xBbb"],
    });

    expect(mockFetchHolders).toHaveBeenCalledTimes(2);
  });
});

describe("fetchTokenChartSnapshotsCached", () => {
  const snapshot: ChartTokenSnapshotRow = {
    curveSupply: "1",
    ltReserve: "1",
    timestamp: "1700000000",
  };

  it("memoises by (tokenAddress, fromSec)", async () => {
    mockFetchTokenChartSnapshots.mockResolvedValue([snapshot]);

    await fetchTokenChartSnapshotsCached(db, ADDRESS, 1700000000);
    await fetchTokenChartSnapshotsCached(db, ADDRESS, 1700000000);
    // Distinct cutoff → cold miss.
    await fetchTokenChartSnapshotsCached(db, ADDRESS, 1700000060);

    expect(mockFetchTokenChartSnapshots).toHaveBeenCalledTimes(2);
  });

  it("does NOT pin null (caught error)", async () => {
    mockFetchTokenChartSnapshots
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([snapshot]);

    expect(
      await fetchTokenChartSnapshotsCached(db, ADDRESS, 1700000000),
    ).toBeNull();
    expect(
      await fetchTokenChartSnapshotsCached(db, ADDRESS, 1700000000),
    ).toEqual([snapshot]);
    expect(mockFetchTokenChartSnapshots).toHaveBeenCalledTimes(2);
  });
});

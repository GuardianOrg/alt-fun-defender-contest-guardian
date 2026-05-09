import { useMarketData } from "./useMarketData";
import { useTokenPrices } from "./useTokenPrices";

import type { MarketDataEntry } from "../services/api";

export interface TokenMarketStats {
  /** Current USD market cap. `null` while loading or when unavailable. */
  mcapUsd: number | null;
  /** 24h percent change in price. `null` while loading or when unavailable. */
  change24h: number | null;
  /**
   * 24h USD trading volume (buys + sells through `Zap`). `null` while
   * loading or when the indexer aggregation is degraded. Refreshed on
   * the same 30s `/market-data` cadence as `mcapUsd` / `change24h`; for
   * sub-30s liveness layer `useLiveTokenVolume24h` on top.
   */
  volume24hUsd: number | null;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Pure composition logic, extracted so it's unit-testable without pulling in
 * React Query / Redux test infrastructure.
 */
export function buildTokenMarketStats(
  liveMcap: number | undefined,
  marketData: MarketDataEntry | undefined,
  isLoading: boolean,
  isError: boolean,
): TokenMarketStats {
  const live = typeof liveMcap === "number" && liveMcap > 0 ? liveMcap : null;
  return {
    mcapUsd: live ?? marketData?.mcapUsd ?? null,
    change24h: marketData?.change24h ?? null,
    volume24hUsd: marketData?.volume24hUsd ?? null,
    isLoading,
    isError,
  };
}

/**
 * Single consumer-facing hook for live market stats. Combines current mcap
 * from `useTokenPrices` (Ponder state + live BounceTech LT rates) with 24h
 * change from `useMarketData` (indexer-backed historical snapshots).
 *
 * Components should render `—` while `isLoading` and on `isError`.
 */
export function useTokenMarketStats(address: string | undefined): TokenMarketStats {
  const prices = useTokenPrices();
  const marketData = useMarketData();

  const isLoading = prices.isLoading || marketData.isLoading;
  const isError = marketData.isError;

  if (!address) {
    return {
      mcapUsd: null,
      change24h: null,
      volume24hUsd: null,
      isLoading,
      isError,
    };
  }

  const key = address.toLowerCase();
  const mcap = prices.prices[key]?.mcapUsd;
  const entry = marketData.getTokenMarketData(address);
  return buildTokenMarketStats(mcap, entry, isLoading, isError);
}

/**
 * Batch variant for lists. Returns a lookup function that resolves stats for
 * any address at render time without spawning a new subscription per row.
 */
export function useTokenMarketStatsMap(): {
  getStats: (address: string) => TokenMarketStats;
  isLoading: boolean;
  isError: boolean;
} {
  const prices = useTokenPrices();
  const marketData = useMarketData();

  const isLoading = prices.isLoading || marketData.isLoading;
  const isError = marketData.isError;

  const getStats = (address: string): TokenMarketStats => {
    const key = address.toLowerCase();
    const priceMcap = prices.prices[key]?.mcapUsd;
    const entry = marketData.getTokenMarketData(address);
    return buildTokenMarketStats(priceMcap, entry, isLoading, isError);
  };

  return { getStats, isLoading, isError };
}

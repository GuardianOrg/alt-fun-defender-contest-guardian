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
 * Single-token market stats. Combines current mcap from `useTokenPrices`
 * (Ponder state + live BounceTech LT rates) with 24h change from
 * `useMarketData` (indexer-backed historical snapshots).
 *
 * Components should render `—` while `isLoading` and on `isError`.
 *
 * Address-list scope: this hook is intended for **single-token surfaces**
 * (token detail page chart heading, info strip). Pass the rendered
 * token's address — the underlying query fetches just that one token
 * from `POST /api/v1/market-data`. For list surfaces (table rows,
 * search results, portfolio) lift `useTokenMarketStatsMap(addresses)`
 * once at the parent and pass stats down — calling this per-row would
 * fan out into one React Query subscription per address.
 */
export function useTokenMarketStats(address: string | undefined): TokenMarketStats {
  const addresses = address ? [address] : [];
  const prices = useTokenPrices(addresses);
  const marketData = useMarketData(addresses);

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
 * Batch variant for lists. The parent passes the visible-page addresses
 * (token table rows, search results, portfolio held positions) and
 * receives a lookup function that resolves stats for any of those
 * addresses at render time without spawning per-row React Query
 * subscriptions.
 *
 * Pass an explicit address list — there is no longer a catalogue-wide
 * fallback. The hook normalises + dedupes + sorts internally so the
 * underlying query cache key is stable across consumer-side call-site
 * ordering.
 */
export function useTokenMarketStatsMap(addresses: readonly string[]): {
  getStats: (address: string) => TokenMarketStats;
  isLoading: boolean;
  isError: boolean;
} {
  const prices = useTokenPrices(addresses);
  const marketData = useMarketData(addresses);

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

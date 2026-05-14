import { useSyncExternalStore } from "react";

import { useMarketData } from "./useMarketData";
import {
  getTokenOverride,
  subscribeTokenOverrides,
} from "../dev/devTokenOverrides";

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
 * Single-token market stats. Reads everything off the per-page
 * `POST /api/v1/market-data` snapshot driven by `useMarketData`:
 * `mcapUsd` (live, computed from Ponder curve state + the BounceTech
 * LT rate), `change24h`, and `volume24hUsd`. The earlier split between
 * `useTokenPrices` (mcap) and `useMarketData` (24h fields) fired the
 * same upstream request twice with different React Query cache keys
 * — collapsing them removes that duplication.
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
  const marketData = useMarketData(addresses);

  // Dev-only mcap override — same shape as the curve-fill overlay used by
  // `useToken`, but applied here because `mcapUsd` is sourced from the
  // `/market-data` payload rather than the `Token` payload. The
  // `import.meta.env.DEV` gate inside the snapshot keeps the override
  // dead-code-eliminated in production builds while the bare
  // `useSyncExternalStore` call (subscribed to a no-op listener set in
  // prod) stays cheap.
  const override = useSyncExternalStore(
    subscribeTokenOverrides,
    () => (import.meta.env.DEV ? getTokenOverride(address) : undefined),
    () => undefined,
  );

  const { isLoading, isError } = marketData;

  if (!address) {
    return {
      mcapUsd: null,
      change24h: null,
      volume24hUsd: null,
      isLoading,
      isError,
    };
  }

  const entry = marketData.getTokenMarketData(address);
  // `mcapUsd` and the rest of the row come off the same backend entry,
  // so we read both off `entry` directly. `buildTokenMarketStats`
  // already collapses non-positive / nullish mcaps to the entry's own
  // `mcapUsd` (effectively a no-op when the inputs match) and falls
  // through to `null`, preserving the previous `useTokenPrices`-based
  // semantics where a missing `priceUsd` blocked the live mcap.
  const stats = buildTokenMarketStats(
    entry?.mcapUsd ?? undefined,
    entry,
    isLoading,
    isError,
  );
  if (override?.mcapUsd !== undefined) {
    return { ...stats, mcapUsd: override.mcapUsd };
  }
  return stats;
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
  const marketData = useMarketData(addresses);

  const { isLoading, isError } = marketData;

  const getStats = (address: string): TokenMarketStats => {
    const entry = marketData.getTokenMarketData(address);
    return buildTokenMarketStats(
      entry?.mcapUsd ?? undefined,
      entry,
      isLoading,
      isError,
    );
  };

  return { getStats, isLoading, isError };
}

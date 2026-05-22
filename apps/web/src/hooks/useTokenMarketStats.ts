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
  /** 24h USD trading volume. `null` while loading or degraded. */
  volume24hUsd: number | null;
  isLoading: boolean;
  isError: boolean;
}

/** Pure composition logic for unit tests. */
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

/** Single-token market stats; list surfaces should use `useTokenMarketStatsMap`. */
export function useTokenMarketStats(address: string | undefined): TokenMarketStats {
  const addresses = address ? [address] : [];
  const marketData = useMarketData(addresses);

  // Dev mcap override lives here because mcap comes from `/market-data`.
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
  // Read mcap and 24h fields from the same backend entry.
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

/** Batch variant for visible lists; avoids per-row React Query subscriptions. */
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

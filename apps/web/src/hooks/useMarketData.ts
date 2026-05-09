import { useQuery } from "@tanstack/react-query";

import { fetchMarketData } from "../services/api";

import type { MarketDataEntry, MarketDataMap } from "../services/api";

const MARKET_DATA_STALE_TIME = 30_000;
const MARKET_DATA_REFETCH_INTERVAL = 30_000;

/**
 * Fetches historical market data (mcapUsd, change24h, past24hPriceUsd) for all
 * tokens from `/api/v1/market-data`. This is the only consumer-facing source
 * of truth for 24h change.
 */
export function useMarketData() {
  const query = useQuery({
    queryKey: ["market-data"],
    queryFn: fetchMarketData,
    staleTime: MARKET_DATA_STALE_TIME,
    refetchInterval: MARKET_DATA_REFETCH_INTERVAL,
  });

  const getTokenMarketData = (
    address: string,
  ): MarketDataEntry | undefined => {
    return query.data?.[address.toLowerCase()];
  };

  return {
    data: query.data ?? ({} as MarketDataMap),
    isLoading: query.isLoading,
    isError: query.isError,
    getTokenMarketData,
    /**
     * Wall-clock ms when TanStack last filled the query (initial fetch
     * or refetch). Live overlay hooks (`useLiveTokenVolume24h`) use this
     * to decide when to drop their accumulated WS deltas — the next
     * polled snapshot already includes those trades.
     */
    dataUpdatedAt: query.dataUpdatedAt,
  };
}

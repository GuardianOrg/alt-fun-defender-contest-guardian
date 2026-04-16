import { useQuery } from "@tanstack/react-query";

import { fetchMarketData } from "../services/api";

import type { MarketDataMap, MarketDataEntry } from "../services/api";

const MARKET_DATA_STALE_TIME = 30_000;
const MARKET_DATA_REFETCH_INTERVAL = 30_000;

/**
 * Fetches market data (mcapUsd, change24h) for all tokens.
 * Returns the full map plus a helper to look up a single token.
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
  };
}

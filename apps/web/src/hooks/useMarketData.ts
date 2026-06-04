import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import { fetchMarketData } from "../services/api";

import type { MarketDataEntry, MarketDataMap } from "../services/api";

const MARKET_DATA_STALE_TIME = 30_000;
const MARKET_DATA_REFETCH_INTERVAL = 30_000;

/** Normalise, dedupe, and sort addresses for stable query keys. */
function normaliseAddresses(addresses: readonly string[]): string[] {
  const set = new Set<string>();
  for (const addr of addresses) set.add(addr.toLowerCase());
  return [...set].sort();
}

/** Bounded market-data lookup for visible token slices. */
export function useMarketData(addresses: readonly string[]) {
  // Avoid busting the query key for inline address arrays.
  const normalised = useMemo(
    () => normaliseAddresses(addresses),
    [addresses],
  );

  const query = useQuery({
    queryKey: ["market-data", normalised],
    queryFn: ({ signal }) => fetchMarketData(normalised, signal),
    staleTime: MARKET_DATA_STALE_TIME,
    refetchInterval: MARKET_DATA_REFETCH_INTERVAL,
    // Skip React Query's loading cycle for empty visible pages.
    enabled: normalised.length > 0,
  });

  const data = query.data ?? ({} as MarketDataMap);

  const getTokenMarketData = (
    address: string,
  ): MarketDataEntry | undefined => {
    return data[address.toLowerCase()];
  };

  // Missing/null values collapse to 0 so portfolio math can multiply unconditionally.
  const getPrice = (address: string): number => {
    return data[address.toLowerCase()]?.priceUsd ?? 0;
  };

  const getMcap = (address: string): number => {
    return data[address.toLowerCase()]?.mcapUsd ?? 0;
  };

  return {
    data,
    isLoading: query.isLoading,
    isError: query.isError,
    getTokenMarketData,
    getPrice,
    getMcap,
    /** Last snapshot time; live overlay hooks use it to drop included WS deltas. */
    dataUpdatedAt: query.dataUpdatedAt,
  };
}

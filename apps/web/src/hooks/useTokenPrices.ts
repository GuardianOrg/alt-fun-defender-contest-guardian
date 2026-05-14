import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import { fetchMarketData } from "../services/api";

const STALE_TIME = 30_000;
const REFETCH_INTERVAL = 30_000;

export interface TokenPriceData {
  priceUsd: number;
  mcapUsd: number;
}

export type TokenPriceMap = Record<string, TokenPriceData>;

function normaliseAddresses(addresses: readonly string[]): string[] {
  const set = new Set<string>();
  for (const addr of addresses) set.add(addr.toLowerCase());
  return [...set].sort();
}

/**
 * Build the address → { priceUsd, mcapUsd } lookup off the per-page
 * `POST /api/v1/market-data` payload. Used by `useBalances` to resolve
 * `valueUsd = amount × pricePerToken` for held positions; pass only
 * the addresses you care about so the upstream fan-out stays bounded.
 *
 * The legacy no-arg variant used to drive the home-table price column
 * (fetching the whole catalogue every 30s and on every WS trade
 * invalidation). That contract was retired alongside
 * `GET /api/v1/market-data`; new consumers pass an explicit address
 * list. Server caps the list at 200 entries per call.
 */
export function useTokenPrices(addresses: readonly string[]) {
  const normalised = useMemo(
    () => normaliseAddresses(addresses),
    [addresses],
  );

  const query = useQuery({
    queryKey: ["token-prices", normalised],
    queryFn: async (): Promise<TokenPriceMap> => {
      const market = await fetchMarketData(normalised);
      const prices: TokenPriceMap = {};
      for (const [address, entry] of Object.entries(market)) {
        if (entry.priceUsd != null && entry.mcapUsd != null) {
          // Server keys are already lowercased — defensive against
          // future shape drift.
          prices[address.toLowerCase()] = {
            priceUsd: entry.priceUsd,
            mcapUsd: entry.mcapUsd,
          };
        }
      }
      return prices;
    },
    staleTime: STALE_TIME,
    refetchInterval: REFETCH_INTERVAL,
    enabled: normalised.length > 0,
  });

  const prices = query.data ?? {};

  const getPrice = (address: string): number => {
    return prices[address.toLowerCase()]?.priceUsd ?? 0;
  };

  const getMcap = (address: string): number => {
    return prices[address.toLowerCase()]?.mcapUsd ?? 0;
  };

  return {
    prices,
    getPrice,
    getMcap,
    isLoading: query.isLoading,
  };
}

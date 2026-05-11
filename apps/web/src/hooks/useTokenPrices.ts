import { useQuery } from "@tanstack/react-query";

import { fetchMarketData } from "../services/api";

const STALE_TIME = 30_000;
const REFETCH_INTERVAL = 30_000;

export interface TokenPriceData {
  priceUsd: number;
  mcapUsd: number;
}

export type TokenPriceMap = Record<string, TokenPriceData>;

/**
 * Build the address → { priceUsd, mcapUsd } lookup off the full-catalogue
 * `/api/v1/market-data` payload. Previously this hit `/api/v1/tokens?limit=100`,
 * which silently dropped every token outside the top-100 from the price
 * map — a balance for the 137th-ranked token would render `$0` and the
 * mcap on its detail page would read `—` (issue #476). Market-data covers
 * every token in the indexer in one cached response, so the map matches
 * the actual catalogue regardless of how many tokens have launched.
 */
async function loadTokenPrices(): Promise<TokenPriceMap> {
  const market = await fetchMarketData();
  const prices: TokenPriceMap = {};
  for (const [address, entry] of Object.entries(market)) {
    if (entry.priceUsd != null && entry.mcapUsd != null) {
      // Server keys are already lowercased — `address.toLowerCase()` here
      // is defensive against future shape drift.
      prices[address.toLowerCase()] = {
        priceUsd: entry.priceUsd,
        mcapUsd: entry.mcapUsd,
      };
    }
  }
  return prices;
}

export function useTokenPrices() {
  const query = useQuery({
    queryKey: ["token-prices"],
    queryFn: loadTokenPrices,
    staleTime: STALE_TIME,
    refetchInterval: REFETCH_INTERVAL,
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

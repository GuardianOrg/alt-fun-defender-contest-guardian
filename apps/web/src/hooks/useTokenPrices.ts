import { useQuery } from "@tanstack/react-query";

import { fetchTokens } from "../services/api";

const STALE_TIME = 30_000;
const REFETCH_INTERVAL = 30_000;

export interface TokenPriceData {
  priceUsd: number;
  mcapUsd: number;
}

export type TokenPriceMap = Record<string, TokenPriceData>;

/**
 * Build the address → { priceUsd, mcapUsd } lookup straight from the
 * consolidated `/api/v1/tokens` payload. No Ponder or RPC calls on the client.
 */
async function loadTokenPrices(): Promise<TokenPriceMap> {
  const tokens = await fetchTokens(100);
  const prices: TokenPriceMap = {};
  for (const token of tokens) {
    if (token.priceUsd != null && token.mcapUsd != null) {
      prices[token.address.toLowerCase()] = {
        priceUsd: token.priceUsd,
        mcapUsd: token.mcapUsd,
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

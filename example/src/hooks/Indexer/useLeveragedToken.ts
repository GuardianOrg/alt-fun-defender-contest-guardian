import { useQuery } from "@tanstack/react-query";

import { INDEX_API } from "../../app/api";
import { REFRESH_INTERVAL } from "../../app/constants";

import type { Asset } from "../../constants/targetAssets";
import type { LeveragedTokenData } from "../../types/leverageTokenData";
import type { Address } from "viem";

interface IndexResponse {
  address: Address;
  targetLeverage: number;
  isLong: boolean;
  symbol: string;
  name: string;
  decimals: number;
  asset: Asset;
  mintPaused: boolean;
  exchangeRate: string;
  totalSupply: string;
  totalAssets: string;
}

export const useLeveragedToken = (symbol: string) => {
  return useQuery({
    queryKey: ["leveraged-tokens", symbol],
    enabled: !!symbol,
    refetchInterval: REFRESH_INTERVAL,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,

    queryFn: async (): Promise<IndexResponse> => {
      const res = await fetch(`${INDEX_API}leveraged-tokens/${symbol}`);
      const json = await res.json();

      if (json.status !== "success") {
        throw new Error(json.error ?? "Unknown error");
      }

      return json.data;
    },

    select: (data): LeveragedTokenData => {
      return {
        address: data.address,
        targetAsset: data.asset,
        targetLeverage: data.targetLeverage,
        isLong: data.isLong,
        exchangeRate: BigInt(data.exchangeRate),
        baseAssetBalance: 0n, // coming soon
        totalAssets: BigInt(data.totalAssets),
        balanceOf: BigInt(data.totalSupply),
        mintPaused: data.mintPaused,
        isStandbyMode: false, // coming soon
        symbol: data.symbol,
      };
    },
  });
};

import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import { assetService, fetchAssetCandles } from "../services/assetService";

import type { UnderlyingAsset } from "../config/constants";

export function useAssets() {
  return useQuery({
    queryKey: ["assets"],
    queryFn: () => assetService.getAssets(),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

export function useAssetChanges(): Record<string, number | undefined> {
  const { data: assets } = useAssets();
  return useMemo(() => {
    const map: Record<string, number | undefined> = {};
    if (assets) {
      for (const a of assets) {
        map[a.name] = a.change24h;
      }
    }
    return map;
  }, [assets]);
}

export function useAssetChange(asset: UnderlyingAsset): number | undefined {
  const changes = useAssetChanges();
  return changes[asset];
}

export function useAssetCandles(asset: UnderlyingAsset) {
  return useQuery({
    queryKey: ["assetCandles", asset],
    queryFn: () => fetchAssetCandles(asset),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export function usePairFilters() {
  return useQuery({
    queryKey: ["pairFilters"],
    queryFn: () => assetService.getPairFilters(),
  });
}

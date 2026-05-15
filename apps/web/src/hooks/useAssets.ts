import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import { fetchLiveMarkets } from "../services/api";
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

/**
 * Pull the BounceTech-UI-live underlying-asset set (issue #621). The API
 * recomputes this every minute against BounceTech's CDN, so a 60s
 * `staleTime` matches the cadence — refreshing more often just burns
 * cache, refreshing less risks lagging a new asset's "live" flip by a
 * full minute on every consumer.
 *
 * Returned as a `Set<string>` for O(1) `has()` checks at the call site
 * (`UNDERLYING_ASSETS.filter((a) => live.has(a))`). When the query is
 * still pending or has failed we return `undefined` so callers can
 * default to "show everything" — see the fail-open rationale in
 * `apps/api/src/lib/lt-availability.ts`.
 */
export function useLiveUnderlyings():
  | ReadonlySet<string>
  | undefined {
  const { data } = useQuery({
    queryKey: ["live-underlyings"],
    queryFn: () => fetchLiveMarkets(),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  return useMemo(
    () => (data ? new Set(data.liveUnderlyings) : undefined),
    [data],
  );
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

import { useQuery } from "@tanstack/react-query";

import { TARGET_ASSETS, type TargetAssetType } from "../constants/targetAssets";

interface TargetAssetCtx {
  markPx: string;
  dayNtlVlm: string;
  prevDayPx?: string;
  openInterest: string;
}

export interface TargetAssetsMarketData {
  symbol: string;
  price: number;
  change24h?: number;
  change24hPct?: number;
  volume24h: number;
  openInterest: number;
}

export const useFetchTargetAssetsData = () => {
  const { data } = useQuery({
    queryKey: ["fetchTargetAssetsData"],
    queryFn: async () => {
      const res = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const universe: { name: string }[] = json[0].universe || [];
      const assetCtxs: TargetAssetCtx[] = json[1] || [];

      const targetAssetData = TARGET_ASSETS.map(
        (targetAsset: TargetAssetType) => {
          const idx = universe.findIndex((u) => u.name === targetAsset.symbol);
          if (idx === -1) return null;

          const ctx = assetCtxs[idx];
          const price = parseFloat(ctx.markPx);
          const volume24h = parseFloat(ctx.dayNtlVlm);
          const change24h = ctx.prevDayPx
            ? price - parseFloat(ctx.prevDayPx)
            : undefined;
          const change24hPct = ctx.prevDayPx
            ? ((price - parseFloat(ctx.prevDayPx)) /
                parseFloat(ctx.prevDayPx)) *
              100
            : undefined;
          const openInterest = parseFloat(ctx.openInterest) * price;

          return {
            symbol: targetAsset.symbol,
            price,
            change24h,
            change24hPct,
            volume24h,
            openInterest,
          };
        },
      ).filter(Boolean) as TargetAssetsMarketData[];

      return targetAssetData;
    },
    refetchInterval: 2500,
  });

  return data;
};

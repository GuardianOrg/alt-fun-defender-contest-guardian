import { HYPERLIQUID_INFO_API } from "@launchpad/shared";

import { fetchPonderTokens } from "./ponder";
import { COLORS } from "../config/colors";

import type { Asset, PairFilter, PlatformStats } from "./types";

const TRACKED_ASSETS = ["HYPE", "ETH", "SOL", "BTC"] as const;

function formatPrice(usd: number): string {
  if (usd >= 10_000) return `$${Math.round(usd).toLocaleString()}`;
  if (usd >= 100) return `$${usd.toFixed(0)}`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}

let cachedMids: Record<string, string> | null = null;
let cacheTime = 0;
const CACHE_TTL = 5_000;

async function fetchMids(): Promise<Record<string, string>> {
  if (cachedMids && Date.now() - cacheTime < CACHE_TTL) return cachedMids;

  const res = await fetch(HYPERLIQUID_INFO_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "allMids" }),
  });
  const data = (await res.json()) as Record<string, string>;
  cachedMids = data;
  cacheTime = Date.now();
  return data;
}

export interface IAssetService {
  getAssets(): Promise<Asset[]>;
  getPlatformStats(): Promise<PlatformStats>;
  getPairFilters(): Promise<PairFilter[]>;
}

const liveAssetService: IAssetService = {
  async getAssets() {
    try {
      const mids = await fetchMids();
      return TRACKED_ASSETS.map((name) => ({
        name,
        priceUsd: formatPrice(parseFloat(mids[name] ?? "0")),
        change24h: 0,
      }));
    } catch {
      return TRACKED_ASSETS.map((name) => ({
        name,
        priceUsd: "—",
        change24h: 0,
      }));
    }
  },

  async getPlatformStats() {
    try {
      const tokens = await fetchPonderTokens(200);
      const graduated = tokens.filter((t) => t.graduated);
      const graduating = tokens.filter(
        (t) => !t.graduated,
      );

      return {
        tokensLive: tokens.length,
        graduating: graduating.length,
        volume24h: "—",
        graduatedToday: graduated.length,
        totalRaised: "—",
      };
    } catch {
      return {
        tokensLive: 0,
        graduating: 0,
        volume24h: "—",
        graduatedToday: 0,
        totalRaised: "—",
      };
    }
  },

  async getPairFilters() {
    try {
      const tokens = await fetchPonderTokens(200);
      const countMap = new Map<string, number>();
      for (const t of tokens) {
        const key = t.symbol.toLowerCase().includes("short") ? "short" : "long";
        const existing = countMap.get(key) ?? 0;
        countMap.set(key, existing + 1);
      }

      return [
        {
          asset: "HYPE" as const,
          direction: "long" as const,
          count: countMap.get("long") ?? tokens.length,
          color: COLORS.mint,
        },
      ];
    } catch {
      return [
        {
          asset: "HYPE" as const,
          direction: "long" as const,
          count: 0,
          color: COLORS.mint,
        },
      ];
    }
  },
};

export const assetService: IAssetService = liveAssetService;

import { HYPERLIQUID_INFO_API } from "@launchpad/shared";

import { API_BASE, fetchTokens } from "./api";
import { fetchPonderTokens } from "./ponder";
import { COLORS } from "../config/colors";

import type { Asset, PairFilter, PlatformStats } from "./types";

const TRACKED_ASSETS = ["HYPE", "ETH", "SOL", "BTC"] as const;

export function formatPrice(usd: number): string {
  if (usd >= 10_000) return `$${Math.round(usd).toLocaleString()}`;
  if (usd >= 100) return `$${usd.toFixed(0)}`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}

export function computeChange24h(openPrice: number, currentPrice: number): number | undefined {
  if (openPrice <= 0) return undefined;
  return parseFloat((((currentPrice - openPrice) / openPrice) * 100).toFixed(2));
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

interface CandleObject {
  t: number;
  o: string;
  c: string;
  h: string;
  l: string;
  v: string;
}

let cached24hPrices: { data: Record<string, number>; ts: number } | null = null;
const CHANGE_CACHE_TTL = 60_000;

async function fetch24hChanges(
  currentMids: Record<string, string>,
): Promise<Record<string, number>> {
  if (cached24hPrices && Date.now() - cached24hPrices.ts < CHANGE_CACHE_TTL) {
    return cached24hPrices.data;
  }

  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const changes: Record<string, number> = {};

  const requests = TRACKED_ASSETS.map(async (coin) => {
    try {
      const res = await fetch(HYPERLIQUID_INFO_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "candleSnapshot",
          req: { coin, interval: "1d", startTime: dayAgo, endTime: now },
        }),
      });
      const candles = (await res.json()) as CandleObject[];
      if (candles.length > 0) {
        const openPrice = parseFloat(candles[0].o);
        const currentPrice = parseFloat(currentMids[coin] ?? "0");
        const change = computeChange24h(openPrice, currentPrice);
        if (change != null) {
          changes[coin] = change;
        }
      }
    } catch {
      changes[coin] = 0;
    }
  });

  await Promise.all(requests);
  cached24hPrices = { data: changes, ts: now };
  return changes;
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
      const changes = await fetch24hChanges(mids);
      return TRACKED_ASSETS.map((name) => ({
        name,
        priceUsd: formatPrice(parseFloat(mids[name] ?? "0")),
        change24h: changes[name] ?? 0,
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
      const res = await fetch(`${API_BASE}/api/v1/stats`);
      const json = (await res.json()) as { data?: { tokensLive: number; tokensGraduated: number; volume24h: string } };
      const stats = json.data;
      if (!stats) throw new Error("No stats");

      const volume = Number(stats.volume24h) / 1e6;
      return {
        tokensLive: stats.tokensLive,
        graduating: 0,
        volume24h: volume >= 1000 ? `$${(volume / 1000).toFixed(1)}K` : `$${volume.toFixed(0)}`,
        graduatedToday: 0,
        totalRaised: "—",
      };
    } catch {
      try {
        const tokens = await fetchPonderTokens(200);
        const graduating = tokens.filter((t) => !t.graduated);

        return {
          tokensLive: tokens.length,
          graduating: graduating.length,
          volume24h: "—",
          graduatedToday: 0,
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
    }
  },

  async getPairFilters() {
    try {
      const tokens = await fetchTokens(200);
      const countMap = new Map<string, number>();
      for (const t of tokens) {
        const dir = t.ltDirection === "short" ? "short" : "long";
        const existing = countMap.get(dir) ?? 0;
        countMap.set(dir, existing + 1);
      }

      return [
        {
          asset: "HYPE" as const,
          direction: "long" as const,
          count: countMap.get("long") ?? 0,
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

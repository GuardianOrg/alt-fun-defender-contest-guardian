import {
  HYPERLIQUID_INFO_API,
  HYPERLIQUID_XYZ_DEX,
  SUPPORTED_UNDERLYING_ASSETS,
  getHyperliquidDex,
} from "@launchpad/shared";

import { fetchTokens } from "./api";
import { COLORS } from "../config/colors";

import type { Asset, PairFilter } from "./types";

/**
 * Markets / live tape / pair selector all read from this list. It mirrors
 * `SUPPORTED_UNDERLYING_ASSETS` (the source of truth in `@launchpad/shared`)
 * so adding a new BounceTech LT asset is a one-line change there.
 */
const TRACKED_ASSETS = SUPPORTED_UNDERLYING_ASSETS;

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

/**
 * Fetch mid prices for every tracked asset. Hyperliquid splits its asset
 * universe across two `allMids` payloads:
 *   - default (no `dex` field): spot + main perps — covers HYPE/ETH/BTC/SOL,
 *     plus crypto majors like DOGE/ZEC/kPEPE.
 *   - `dex: "xyz"`: builder-deployed equity / commodity perps — covers
 *     `xyz:SP500`, `xyz:NVDA`, `xyz:GOLD`, etc.
 *
 * We issue both requests in parallel and merge the results so downstream
 * lookups by `targetAsset` work uniformly. If the xyz feed is enabled but
 * none of our tracked assets need it, we skip the round-trip.
 */
async function fetchMids(): Promise<Record<string, string>> {
  if (cachedMids && Date.now() - cacheTime < CACHE_TTL) return cachedMids;

  const needsXyz = TRACKED_ASSETS.some((asset) => getHyperliquidDex(asset));
  const requests: Promise<Record<string, string>>[] = [
    fetch(HYPERLIQUID_INFO_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
    }).then((r) => r.json() as Promise<Record<string, string>>),
  ];
  if (needsXyz) {
    requests.push(
      fetch(HYPERLIQUID_INFO_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "allMids", dex: HYPERLIQUID_XYZ_DEX }),
      })
        .then((r) => r.json() as Promise<Record<string, string>>)
        // xyz is a builder-deployed dex and could plausibly disappear or
        // throttle independently of the main feed — degrade gracefully so
        // crypto prices keep rendering.
        .catch(() => ({}) as Record<string, string>),
    );
  }

  const results = await Promise.all(requests);
  const merged = Object.assign({}, ...results) as Record<string, string>;
  cachedMids = merged;
  cacheTime = Date.now();
  return merged;
}

interface CandleObject {
  t: number;
  o: string;
  c: string;
  h: string;
  l: string;
  v: string;
}

interface AssetChange {
  percent: number;
  dollar: number;
}

let cached24hPrices: { data: Record<string, AssetChange>; ts: number } | null =
  null;
const CHANGE_CACHE_TTL = 60_000;

async function fetch24hChanges(
  currentMids: Record<string, string>,
): Promise<Record<string, AssetChange>> {
  if (cached24hPrices && Date.now() - cached24hPrices.ts < CHANGE_CACHE_TTL) {
    return cached24hPrices.data;
  }

  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const changes: Record<string, AssetChange> = {};

  const requests = TRACKED_ASSETS.map(async (coin) => {
    const dex = getHyperliquidDex(coin);
    const req: Record<string, unknown> = {
      coin,
      interval: "1d",
      startTime: dayAgo,
      endTime: now,
    };
    if (dex) req.dex = dex;
    try {
      const res = await fetch(HYPERLIQUID_INFO_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "candleSnapshot", req }),
      });
      const candles = (await res.json()) as CandleObject[];
      if (candles.length > 0) {
        const openPrice = parseFloat(candles[0].o);
        const currentPrice = parseFloat(currentMids[coin] ?? "0");
        const percent = computeChange24h(openPrice, currentPrice);
        if (percent != null && Number.isFinite(currentPrice)) {
          changes[coin] = {
            percent,
            dollar: currentPrice - openPrice,
          };
        }
      }
    } catch {
      changes[coin] = { percent: 0, dollar: 0 };
    }
  });

  await Promise.all(requests);
  cached24hPrices = { data: changes, ts: now };
  return changes;
}

export async function fetchAssetCandles(
  coin: string,
  interval: string = "15m",
  hours: number = 24,
): Promise<number[]> {
  const now = Date.now();
  const startTime = now - hours * 60 * 60 * 1000;
  const dex = getHyperliquidDex(coin);
  const req: Record<string, unknown> = { coin, interval, startTime, endTime: now };
  if (dex) req.dex = dex;

  const res = await fetch(HYPERLIQUID_INFO_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "candleSnapshot", req }),
  });
  const candles = (await res.json()) as CandleObject[];
  return candles.map((c) => parseFloat(c.c));
}

export interface IAssetService {
  getAssets(): Promise<Asset[]>;
  getPairFilters(): Promise<PairFilter[]>;
}

const liveAssetService: IAssetService = {
  async getAssets() {
    try {
      const mids = await fetchMids();
      const changes = await fetch24hChanges(mids);
      return TRACKED_ASSETS.map((name) => {
        const mid = parseFloat(mids[name] ?? "");
        const ch = changes[name];
        return {
          name,
          // `formatPrice(NaN)` would render `$NaN` — fall back to a dash
          // for assets that are missing from both feeds (degraded xyz dex,
          // newly-added asset before our list catches up, etc.).
          priceUsd: Number.isFinite(mid) && mid > 0 ? formatPrice(mid) : "—",
          change24h: ch?.percent ?? 0,
          priceChange24h: ch?.dollar ?? 0,
        };
      });
    } catch {
      return TRACKED_ASSETS.map((name) => ({
        name,
        priceUsd: "—",
        change24h: 0,
        priceChange24h: 0,
      }));
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

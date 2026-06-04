import {
  HYPERLIQUID_INFO_API,
  getAssetDisplayName,
  getHyperliquidDex,
  isSupportedUnderlying,
} from "@launchpad/shared";

import { fetchAssets, fetchTokens } from "./api";
import { COLORS } from "../config/colors";

import type { Asset, PairFilter } from "./types";

export function formatPrice(usd: number): string {
  if (usd >= 10_000) return `$${Math.round(usd).toLocaleString()}`;
  if (usd >= 100) return `$${usd.toFixed(0)}`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}

export function computeChange24h(
  openPrice: number,
  currentPrice: number,
): number | undefined {
  if (openPrice <= 0) return undefined;
  return parseFloat(
    (((currentPrice - openPrice) / openPrice) * 100).toFixed(2),
  );
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

const ASSET_CACHE_KEY = "altfun:detected-assets:v1";
const ASSET_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let cached24hPrices: { data: Record<string, AssetChange>; ts: number } | null =
  null;
const CHANGE_CACHE_TTL = 60_000;

function compareAssetTickers(a: string, b: string): number {
  return getAssetDisplayName(a).localeCompare(getAssetDisplayName(b));
}

function sortAssetsByTicker<T extends { name: string }>(
  assets: readonly T[],
): T[] {
  return [...assets].sort((a, b) =>
    compareAssetTickers(a.name, b.name),
  );
}

interface CachedAssetsPayload {
  ts: number;
  assets: Asset[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCachedAsset(value: unknown): value is Asset {
  if (!isRecord(value)) return false;
  return (
    isSupportedUnderlying(String(value.name)) &&
    typeof value.priceUsd === "string" &&
    typeof value.change24h === "number" &&
    typeof value.priceChange24h === "number"
  );
}

export function readCachedAssets(): Asset[] | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(ASSET_CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || typeof parsed.ts !== "number") return undefined;
    if (Date.now() - parsed.ts > ASSET_CACHE_MAX_AGE_MS) return undefined;
    if (!Array.isArray(parsed.assets)) return undefined;
    const assets = parsed.assets.filter(isCachedAsset);
    return assets.length > 0 ? sortAssetsByTicker(assets) : undefined;
  } catch {
    return undefined;
  }
}

function writeCachedAssets(assets: readonly Asset[]): void {
  if (assets.length === 0) return;
  try {
    const payload: CachedAssetsPayload = {
      ts: Date.now(),
      assets: [...assets],
    };
    globalThis.localStorage?.setItem(ASSET_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Private browsing / disabled storage should not block market rendering.
  }
}

/** `true` for AbortSignal-driven cancellations; cancellation must propagate. */
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

async function fetch24hChanges(
  currentMids: Record<string, string>,
  trackedAssets: readonly string[],
  signal?: AbortSignal,
): Promise<Record<string, AssetChange>> {
  if (cached24hPrices && Date.now() - cached24hPrices.ts < CHANGE_CACHE_TTL) {
    return cached24hPrices.data;
  }

  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const changes: Record<string, AssetChange> = {};

  const requests = trackedAssets.map(async (coin) => {
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
        signal,
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
    } catch (err) {
      // Cancellations must bubble so the outer `Promise.all` rejects and
      // React Query sees the queryFn as aborted rather than as a successful
      // refresh that happens to return zeroed-out 24h deltas.
      if (isAbortError(err)) throw err;
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
  const req: Record<string, unknown> = {
    coin,
    interval,
    startTime,
    endTime: now,
  };
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
  getAssets(signal?: AbortSignal): Promise<Asset[]>;
  getPairFilters(): Promise<PairFilter[]>;
}

const liveAssetService: IAssetService = {
  async getAssets(signal?: AbortSignal) {
    try {
      const apiAssets = await fetchAssets(signal);
      const trackedAssets = apiAssets
        .map((asset) => asset.symbol)
        .filter(isSupportedUnderlying);
      const mids = Object.fromEntries(
        apiAssets.map((asset) => [asset.symbol, asset.price ?? ""]),
      );
      const changes = await fetch24hChanges(mids, trackedAssets, signal);
      const assets = [...trackedAssets].sort(compareAssetTickers).map((name) => {
        const mid = parseFloat(mids[name] ?? "");
        const ch = changes[name];
        return {
          name,
          // `formatPrice(NaN)` would render `$NaN` — fall back to a dash
          // for assets that are missing from the price feed (degraded xyz
          // dex, newly-detected LT before Hyperliquid responds, etc.).
          priceUsd: Number.isFinite(mid) && mid > 0 ? formatPrice(mid) : "—",
          change24h: ch?.percent ?? 0,
          priceChange24h: ch?.dollar ?? 0,
        };
      });
      writeCachedAssets(assets);
      return assets;
    } catch (err) {
      // Cancellation isn't a "degraded backend" — propagate it so React
      // Query treats the queryFn as aborted and doesn't poison `dataUpdatedAt`
      // / `staleTime` with a cache-shaped fallback.
      if (isAbortError(err)) throw err;
      return readCachedAssets() ?? [];
    }
  },

  async getPairFilters() {
    try {
      const tokens = await fetchTokens(200);
      const countMap = new Map<string, number>();
      for (const t of tokens) {
        const existing = countMap.get(t.ltDirection) ?? 0;
        countMap.set(t.ltDirection, existing + 1);
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

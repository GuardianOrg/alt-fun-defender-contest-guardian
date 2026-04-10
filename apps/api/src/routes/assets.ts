import { Hono } from "hono";
import {
  BOUNCE_INDEXING_API,
  HYPERLIQUID_INFO_API,
  SUPPORTED_UNDERLYING_ASSETS,
  filterSupportedLTs,
} from "@launchpad/shared";

import formatSuccess from "../utils/format-success.js";

import type { AppBindings } from "../lib/types.js";
import type { LiveLeveragedToken } from "@launchpad/shared";

let cachedMids: { data: Record<string, string>; ts: number } | null = null;
let cachedLTs: { data: LiveLeveragedToken[]; ts: number } | null = null;

const CACHE_TTL_MS = 10_000;

async function fetchMids(): Promise<Record<string, string>> {
  if (cachedMids && Date.now() - cachedMids.ts < CACHE_TTL_MS) {
    return cachedMids.data;
  }
  try {
    const res = await fetch(HYPERLIQUID_INFO_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
    });
    const data = (await res.json()) as Record<string, string>;
    cachedMids = { data, ts: Date.now() };
    return data;
  } catch {
    return cachedMids?.data ?? {};
  }
}

async function fetchLTs(): Promise<LiveLeveragedToken[]> {
  if (cachedLTs && Date.now() - cachedLTs.ts < CACHE_TTL_MS) {
    return cachedLTs.data;
  }
  try {
    const res = await fetch(`${BOUNCE_INDEXING_API}/leveraged-tokens`);
    const json = (await res.json()) as { data?: LiveLeveragedToken[] };
    const lts = filterSupportedLTs(json.data ?? []);
    cachedLTs = { data: lts, ts: Date.now() };
    return lts;
  } catch {
    return cachedLTs?.data ?? [];
  }
}

const assets = new Hono<{ Bindings: AppBindings }>();

assets.get("/", async (c) => {
  const [mids, lts] = await Promise.all([fetchMids(), fetchLTs()]);

  const underlyingAssets = SUPPORTED_UNDERLYING_ASSETS.map((symbol) => ({
    symbol,
    price: mids[symbol] ?? null,
  }));

  const leveragedTokens = lts.map((lt) => ({
    address: lt.address,
    symbol: lt.symbol,
    name: lt.name,
    targetAsset: lt.targetAsset,
    targetLeverage: lt.targetLeverage,
    isLong: lt.isLong,
    exchangeRate: lt.exchangeRate,
    mintPaused: lt.mintPaused,
  }));

  return c.json(formatSuccess({
    underlying: underlyingAssets,
    leveragedTokens,
  }));
});

export default assets;

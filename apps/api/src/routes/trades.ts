import { Hono } from "hono";
import { isAddress } from "viem";

import { createDb } from "../db/client.js";
import { edgeCacheableJsonHeader } from "../utils/cache-control.js";
import formatSuccess from "../utils/format-success.js";
import formatError from "../utils/format-error.js";
import {
  checkIndexerHealth,
  fetchRouterTrades,
  fetchTokenLabels,
} from "../lib/indexer-reads.js";
import { fetchRouterTradesCached } from "../lib/indexer-cached-reads.js";

import type { AppBindings } from "../lib/types.js";
import type { ApiTradeWithLabels } from "./../lib/ponder-types.js";

/**
 * Trade endpoints are polled hard by the frontend — the global feed at 15s
 * when the WS is connected (3s otherwise) and per-token at 15/5s — so
 * they're the single biggest contributor to the per-IP rate-limit draw for
 * shared-WiFi users (issue #549). Historical pages (`offset > 0`) are
 * stable — once a trade lands at position 50+ it never moves or disappears
 * — so caching them is a pure win and absorbs the bulk of shared-IP
 * polling traffic.
 *
 * The "live tail" (`offset === 0`) is fetched on every WS-driven poll and
 * is where the WS-vs-read-checkpoint race produces user-visible staleness
 * ("my trade flashed in the feed, then disappeared on refresh"). The
 * indexer's Zap event handler fires the broadcast HTTP POST inside the
 * same tx that inserts the `router_trade` row, then returns; the indexer
 * commits the tx (and exposes the row via the read path) afterwards. The
 * WS message therefore reaches the client *before* the trade is queryable,
 * so a cached `offset=0` response populated immediately before the trade
 * landed returns a stale window — the row the user just saw flash in the
 * feed is missing on the next refresh.
 *
 * That race is real, but a full cache bypass (the previous policy) is too
 * aggressive. With every poll hitting origin and each request doing two
 * sequential Neon HTTPS round-trips, p50 on `/api/v1/trades` ran ~5s in
 * production while local `EXPLAIN ANALYZE` shows both queries are <10ms —
 * the latency was almost entirely Neon-compute contention from the
 * uncached fan-in (issue #929). A short edge TTL absorbs >95% of the
 * polling load and shrinks the WS-vs-commit race window to at most
 * `TRADES_LIVE_TAIL_TTL_SECONDS`. The web client already dedupes WS-
 * delivered trades against the cached state (`tradeFeed.ts`'s
 * `formatWsTrade`), so the residual overlap window is handled cleanly
 * client-side; the worst-case "trade flashes then disappears for ~1s" is
 * the same window users already accept on every other polled surface.
 */
const TRADES_LIVE_TAIL_TTL_SECONDS = 1;
const TRADES_HISTORICAL_TTL_SECONDS = 5;

/**
 * TTL applied to the trades-list response for a given `offset`. The live
 * tail (`offset === 0`) uses a short window so the WS-vs-commit race
 * closes within a single poll cycle; historical pages are append-only and
 * stay at the longer historical TTL.
 */
function ttlForOffset(offset: number): number {
  return offset === 0
    ? TRADES_LIVE_TAIL_TTL_SECONDS
    : TRADES_HISTORICAL_TTL_SECONDS;
}

const trades = new Hono<{ Bindings: AppBindings }>();

function parseNonNegativeInt(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

function getCache(): Cache | undefined {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default;
}

/**
 * Strip blank-after-trim values so the client doesn't cache the empty
 * placeholder labels written by `Factory:PairCreated` before
 * `Bonding:TokenLaunched` overwrites them. Mirrors the
 * `tokenLabelOrUndefined` helper on the indexer side — kept duplicated
 * rather than shared because the indexer and API don't have a sensible
 * shared package and the function is one branch on a trimmed string.
 */
function nonBlankOrUndefined(label: string | null | undefined): string | undefined {
  if (!label) return undefined;
  const trimmed = label.trim();
  return trimmed === "" ? undefined : trimmed;
}

interface RawTrade {
  id: string;
  tokenAddress: string;
  trader: string;
  isBuy: boolean;
  usdcAmount: string;
  tokenAmount: string;
  blockNumber: string;
  timestamp: string;
}

/**
 * Enrich a list of `router_trade` rows with the corresponding token's
 * display labels (`tokenSymbol` / `tokenName`) by issuing a single
 * `SELECT … WHERE address IN (...)` against `ponder_views.token` for the
 * unique addresses in the batch.
 *
 * Failure-mode: when the label fetch fails, the trades are returned with
 * the labels left undefined — the web client falls back through its
 * existing `prefetchTokenName` healer, so a degraded label fetch never
 * blocks the trade feed.
 */
async function enrichTradesWithTokenLabels(
  rows: RawTrade[],
  db: ReturnType<typeof createDb>,
): Promise<ApiTradeWithLabels[]> {
  if (rows.length === 0) return [];

  const uniqueAddresses = Array.from(
    new Set(rows.map((r) => r.tokenAddress.toLowerCase())),
  );

  const labelMap = await fetchTokenLabels(db, uniqueAddresses);

  return rows.map<ApiTradeWithLabels>((r) => {
    const labels = labelMap?.get(r.tokenAddress.toLowerCase());
    return {
      ...r,
      tokenSymbol: nonBlankOrUndefined(labels?.symbol),
      tokenName: nonBlankOrUndefined(labels?.name),
    };
  });
}

trades.get("/", async (c) => {
  const limitParam = parseNonNegativeInt(c.req.query("limit"));
  const offsetParam = parseNonNegativeInt(c.req.query("offset"));
  if (limitParam === null || offsetParam === null) {
    return c.json(formatError("Invalid pagination parameters"), 400);
  }
  const limit = Math.min(limitParam ?? 50, 100);
  // Offset enables the home-page recent-trades list to scroll backwards
  // through history (issue #807).
  const offset = offsetParam ?? 0;

  const cache = getCache();
  const cacheKey = new Request(c.req.url, { method: "GET" });
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const db = createDb(c.env.DATABASE_URL);
  const rows = await fetchRouterTrades(db, { limit, offset });

  if (rows === null) {
    return c.json(
      formatError("Indexer unavailable — trade data cannot be loaded"),
      503,
    );
  }

  const enriched = await enrichTradesWithTokenLabels(rows, db);

  const response = c.json(formatSuccess(enriched));
  response.headers.set(
    "Cache-Control",
    edgeCacheableJsonHeader(ttlForOffset(offset)),
  );
  if (cache) {
    await cache.put(cacheKey, response.clone());
  }
  return response;
});

const INTERVAL_SECONDS: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
};

trades.get("/ohlcv/:address", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = rawAddress.toLowerCase();
  const interval = c.req.query("interval") ?? "5m";
  const bucketSize = INTERVAL_SECONDS[interval];

  if (!bucketSize) {
    return c.json(
      formatError(
        `Invalid interval. Supported: ${Object.keys(INTERVAL_SECONDS).join(", ")}`,
      ),
      400,
    );
  }

  const db = createDb(c.env.DATABASE_URL);

  // Pre-check indexer DB availability before walking the trade history so
  // the route 503s cleanly when the underlying read path is wedged.
  const healthy = await checkIndexerHealth(db);
  if (!healthy) {
    return c.json(
      formatError("Indexer unavailable — OHLCV data cannot be loaded"),
      503,
    );
  }

  // Pull the full per-token trade history in chronological order. With
  // direct SQL this is one query — no paginated 20×1000 sweep. The OHLCV
  // route is rarely hit (chart-only) and the per-token row count is bounded
  // by trading activity, so an unbounded SELECT is acceptable here. If we
  // ever index a megacap token we can cap with `LIMIT 100_000` and
  // surface a "truncated" hint — none of today's tokens come close.
  const rawTrades = await fetchRouterTrades(db, {
    tokenAddress: address,
    limit: 100_000,
    offset: 0,
    direction: "asc",
  });

  if (rawTrades === null) {
    return c.json(
      formatError("Indexer unavailable — OHLCV data cannot be loaded"),
      503,
    );
  }

  if (rawTrades.length === 0) {
    return c.json(formatSuccess([]));
  }

  const candles: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[] = [];

  const candleMap = new Map<number, typeof candles[number]>();

  for (const t of rawTrades) {
    const usdcAmount = Number(t.usdcAmount) / 1e6;
    const tokenAmount = Number(t.tokenAmount) / 1e18;
    if (tokenAmount === 0) continue;

    const price = usdcAmount / tokenAmount;
    const ts = Number(t.timestamp);
    const bucketTs = Math.floor(ts / bucketSize) * bucketSize;

    const existing = candleMap.get(bucketTs);
    if (existing) {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price;
      existing.volume += usdcAmount;
    } else {
      const candle = {
        time: bucketTs,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: usdcAmount,
      };
      candleMap.set(bucketTs, candle);
      candles.push(candle);
    }
  }

  return c.json(formatSuccess(candles));
});

trades.get("/sparkline/:address", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = rawAddress.toLowerCase();
  const points = Math.min(Number(c.req.query("points") ?? "20"), 50);

  const db = createDb(c.env.DATABASE_URL);
  const rawTrades = await fetchRouterTradesCached(db, {
    tokenAddress: address,
    limit: points * 3,
    offset: 0,
    direction: "desc",
  });

  if (rawTrades === null) {
    return c.json(formatSuccess([]));
  }

  if (rawTrades.length === 0) {
    return c.json(formatSuccess([]));
  }

  // Compute prices and sample down to `points` values, oldest-first.
  const prices: number[] = [];
  for (const t of rawTrades) {
    const tokenAmount = Number(t.tokenAmount) / 1e18;
    if (tokenAmount === 0) continue;
    const price = Number(t.usdcAmount) / 1e6 / tokenAmount;
    prices.push(price);
  }
  prices.reverse();

  if (prices.length > points) {
    const sampled: number[] = [];
    for (let i = 0; i < points; i++) {
      const idx = Math.round((i / (points - 1)) * (prices.length - 1));
      sampled.push(prices[idx]);
    }
    return c.json(formatSuccess(sampled));
  }

  return c.json(formatSuccess(prices));
});

trades.get("/:address", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = rawAddress.toLowerCase();

  const limitParam = parseNonNegativeInt(c.req.query("limit"));
  const offsetParam = parseNonNegativeInt(c.req.query("offset"));
  if (limitParam === null || offsetParam === null) {
    return c.json(formatError("Invalid pagination parameters"), 400);
  }
  const limit = Math.min(limitParam ?? 50, 100);
  const offset = offsetParam ?? 0;

  const cache = getCache();
  const cacheKey = new Request(c.req.url, { method: "GET" });
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const db = createDb(c.env.DATABASE_URL);
  // Cached variant collapses the per-token poll burst (the frontend hits
  // `/trades/:address` every 5-15s per open token) into one Postgres
  // round-trip per `(token, limit, offset, direction)` per
  // `HOT_TOKEN_READ_TTL_MS` window per PoP — issue #1125, solution #3.
  const rows = await fetchRouterTradesCached(db, {
    tokenAddress: address,
    limit,
    offset,
  });

  if (rows === null) {
    return c.json(
      formatError("Indexer unavailable — trade data cannot be loaded"),
      503,
    );
  }

  const enriched = await enrichTradesWithTokenLabels(rows, db);

  const response = c.json(formatSuccess(enriched));
  response.headers.set(
    "Cache-Control",
    edgeCacheableJsonHeader(ttlForOffset(offset)),
  );
  if (cache) {
    await cache.put(cacheKey, response.clone());
  }
  return response;
});

export default trades;

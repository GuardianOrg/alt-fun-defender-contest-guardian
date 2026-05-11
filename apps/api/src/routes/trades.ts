import { Hono } from "hono";
import { isAddress } from "viem";

import formatSuccess from "../utils/format-success.js";
import formatError from "../utils/format-error.js";
import { createPonderQuery, createPonderPaginatedQuery } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";
import type { PonderRouterTrade } from "../lib/ponder-types.js";

/**
 * Trade endpoints are polled hard by the frontend — the global feed at
 * 15s when the WS is connected (3s otherwise) and per-token at 15/5s —
 * so they're the single biggest contributor to the per-IP rate-limit
 * draw for shared-WiFi users (issue #549). The data is also the most
 * cache-friendly of all the read paths: a few seconds of staleness on
 * "latest trades" is invisible because the live WS push hands the row
 * to the UI before the next REST poll even fires. 5s mirrors the
 * `/tokens` list TTL.
 */
const TRADES_CACHE_TTL_SECONDS = 5;

const trades = new Hono<{ Bindings: AppBindings }>();

function parseNonNegativeInt(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

function getCache(): Cache | undefined {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default;
}

trades.get("/", async (c) => {
  const queryPonder = createPonderQuery(c.env.PONDER_URL);
  const limitParam = parseNonNegativeInt(c.req.query("limit"));
  if (limitParam === null) {
    return c.json(formatError("Invalid pagination parameters"), 400);
  }
  const limit = Math.min(limitParam ?? 50, 100);

  const cache = getCache();
  const cacheKey = new Request(c.req.url, { method: "GET" });
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const data = await queryPonder<{ routerTrades: { items: PonderRouterTrade[] } }>(
    `query ($limit: Int!) {
      routerTrades(limit: $limit, orderBy: "timestamp", orderDirection: "desc") {
        items {
          id
          tokenAddress
          trader
          isBuy
          usdcAmount
          tokenAmount
          blockNumber
          timestamp
        }
      }
    }`,
    { limit },
  );

  if (data === null) {
    return c.json(formatError("Indexer unavailable — trade data cannot be loaded"), 503);
  }

  const items = data.routerTrades?.items ?? [];

  const response = c.json(formatSuccess(items));
  response.headers.set("Cache-Control", `s-maxage=${TRADES_CACHE_TTL_SECONDS}`);
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
    return c.json(formatError(`Invalid interval. Supported: ${Object.keys(INTERVAL_SECONDS).join(", ")}`), 400);
  }

  // Pre-check Ponder availability before paginated query
  const queryPonder = createPonderQuery(c.env.PONDER_URL);
  const healthCheck = await queryPonder<{ __typename: string }>("{ __typename }");
  if (healthCheck === null) {
    return c.json(formatError("Indexer unavailable — OHLCV data cannot be loaded"), 503);
  }

  const queryPonderAll = createPonderPaginatedQuery(c.env.PONDER_URL);
  const { items: rawTrades } = await queryPonderAll<PonderRouterTrade>(
    `query ($address: String!, $limit: Int!, $offset: Int!) {
      routerTrades(
        where: { tokenAddress: $address }
        limit: $limit
        offset: $offset
        orderBy: "timestamp"
        orderDirection: "asc"
      ) {
        items {
          usdcAmount
          tokenAmount
          isBuy
          timestamp
        }
      }
    }`,
    "routerTrades",
    { address },
  );
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
      const candle = { time: bucketTs, open: price, high: price, low: price, close: price, volume: usdcAmount };
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

  const queryPonder = createPonderQuery(c.env.PONDER_URL);
  const data = await queryPonder<{ routerTrades: { items: PonderRouterTrade[] } }>(
    `query ($address: String!, $limit: Int!) {
      routerTrades(
        where: { tokenAddress: $address }
        limit: $limit
        orderBy: "timestamp"
        orderDirection: "desc"
      ) {
        items {
          usdcAmount
          tokenAmount
          timestamp
        }
      }
    }`,
    { address, limit: points * 3 },
  );

  const rawTrades = data?.routerTrades?.items ?? [];
  if (rawTrades.length === 0) {
    return c.json(formatSuccess([]));
  }

  // Compute prices and sample down to `points` values, oldest-first
  const prices: number[] = [];
  for (const t of rawTrades) {
    const tokenAmount = Number(t.tokenAmount) / 1e18;
    if (tokenAmount === 0) continue;
    const price = Number(t.usdcAmount) / 1e6 / tokenAmount;
    prices.push(price);
  }
  prices.reverse(); // oldest first

  // Sample evenly if we have more prices than requested points
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
  const queryPonder = createPonderQuery(c.env.PONDER_URL);
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

  const data = await queryPonder<{ routerTrades: { items: PonderRouterTrade[] } }>(
    `query ($address: String!, $limit: Int!, $offset: Int!) {
      routerTrades(
        where: { tokenAddress: $address }
        limit: $limit
        offset: $offset
        orderBy: "timestamp"
        orderDirection: "desc"
      ) {
        items {
          id
          tokenAddress
          trader
          isBuy
          usdcAmount
          tokenAmount
          blockNumber
          timestamp
        }
      }
    }`,
    { address, limit, offset },
  );

  if (data === null) {
    return c.json(formatError("Indexer unavailable — trade data cannot be loaded"), 503);
  }

  const items = data.routerTrades?.items ?? [];

  const response = c.json(formatSuccess(items));
  response.headers.set("Cache-Control", `s-maxage=${TRADES_CACHE_TTL_SECONDS}`);
  if (cache) {
    await cache.put(cacheKey, response.clone());
  }
  return response;
});

export default trades;

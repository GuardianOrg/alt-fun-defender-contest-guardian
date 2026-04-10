import { Hono } from "hono";

import formatSuccess from "../utils/format-success.js";
import formatError from "../utils/format-error.js";
import { queryPonder } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

const trades = new Hono<{ Bindings: AppBindings }>();

interface PonderRouterTrade {
  id: string;
  tokenAddress: string;
  trader: string;
  isBuy: boolean;
  usdcAmount: string;
  tokenAmount: string;
  blockNumber: string;
  timestamp: string;
}

trades.get("/", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);

  const data = await queryPonder<{ routerTrades: PonderRouterTrade[] }>(
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

  const items = (data?.routerTrades as unknown as { items: PonderRouterTrade[] })?.items ?? [];

  return c.json(formatSuccess(items));
});

trades.get("/:address", async (c) => {
  const address = c.req.param("address");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);
  const offset = Number(c.req.query("offset") ?? 0);

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

  const items = data?.routerTrades?.items ?? [];

  return c.json(formatSuccess(items));
});

const INTERVAL_SECONDS: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
};

trades.get("/ohlcv/:address", async (c) => {
  const address = c.req.param("address");
  const interval = c.req.query("interval") ?? "5m";
  const bucketSize = INTERVAL_SECONDS[interval];

  if (!bucketSize) {
    return c.json(formatError(`Invalid interval. Supported: ${Object.keys(INTERVAL_SECONDS).join(", ")}`), 400);
  }

  const data = await queryPonder<{ routerTrades: { items: PonderRouterTrade[] } }>(
    `query ($address: String!) {
      routerTrades(
        where: { tokenAddress: $address }
        limit: 1000
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
    { address },
  );

  const rawTrades = data?.routerTrades?.items ?? [];
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

export default trades;

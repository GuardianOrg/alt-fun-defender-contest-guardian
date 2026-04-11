import { Hono } from "hono";
import { isAddress } from "viem";

import formatSuccess from "../utils/format-success.js";
import formatError from "../utils/format-error.js";
import { createPonderQuery, createPonderPaginatedQuery } from "../lib/ponder-client.js";

import type { AppBindings } from "../lib/types.js";

const trades = new Hono<{ Bindings: AppBindings }>();

function safeInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

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
  const queryPonder = createPonderQuery(c.env.PONDER_URL);
  const limit = Math.min(safeInt(c.req.query("limit"), 50), 100);

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

trades.get("/:address", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = rawAddress.toLowerCase();
  const queryPonder = createPonderQuery(c.env.PONDER_URL);
  const limit = Math.min(safeInt(c.req.query("limit"), 50), 100);
  const offset = safeInt(c.req.query("offset"), 0);

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

export default trades;

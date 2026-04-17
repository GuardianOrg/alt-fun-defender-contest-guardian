import { Hono } from "hono";
import { isAddress } from "viem";

import formatSuccess from "../utils/format-success.js";
import formatError from "../utils/format-error.js";
import {
  computeMarketDataBatch,
  computeMarketDataSingle,
  type MarketDataItem,
} from "../lib/market-data.js";

import type { AppBindings } from "../lib/types.js";

export type { MarketDataItem };

const CACHE_TTL_SECONDS = 30;

const marketData = new Hono<{ Bindings: AppBindings }>();

marketData.get("/", async (c) => {
  const cachesObj = (globalThis as { caches?: { default?: Cache } }).caches;
  const cache = cachesObj?.default;
  const cacheKey = new Request(new URL(c.req.url).toString(), { method: "GET" });

  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const result = await computeMarketDataBatch(
    c.env.PONDER_URL,
    c.env.BOUNCETECH_DATABASE_URL,
  );
  if (!result.ok) {
    return c.json(formatError(result.error), result.code);
  }

  const response = c.json(formatSuccess(result.data.market));
  response.headers.set("Cache-Control", `s-maxage=${CACHE_TTL_SECONDS}`);

  if (cache) {
    await cache.put(cacheKey, response.clone());
  }

  return response;
});

marketData.get("/:address", async (c) => {
  const address = c.req.param("address");
  if (!address || !isAddress(address)) {
    return c.json(formatError("Invalid token address"), 400);
  }

  const result = await computeMarketDataSingle(
    c.env.PONDER_URL,
    c.env.BOUNCETECH_DATABASE_URL,
    address,
  );
  if (!result.ok) {
    return c.json(formatError(result.error), result.code);
  }

  return c.json(formatSuccess(result.data.market));
});

export default marketData;

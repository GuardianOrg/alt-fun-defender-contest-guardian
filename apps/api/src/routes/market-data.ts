import { Hono } from "hono";
import { isAddress } from "viem";

import {
  computeMarketDataForAddresses,
  computeMarketDataSingle,
  type MarketDataItem,
} from "../lib/market-data.js";
import { applyEdgeCacheHeaders } from "../utils/cache-control.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";

import type { AppBindings } from "../lib/types.js";

export type { MarketDataItem };

/**
 * Bounds response size and the direct indexer `WHERE address IN (...)` read.
 * 200 is above any current per-page consumer while still keeping batches finite.
 */
const MAX_ADDRESSES_PER_REQUEST = 200;

/**
 * Short per-POP cache for visible-page market data; the degraded TTL absorbs
 * outage bursts without hiding recovery for longer than a poll cycle.
 */
const MARKET_DATA_CACHE_TTL_SECONDS = 3;
const MARKET_DATA_DEGRADED_CACHE_TTL_SECONDS = 1;

const marketData = new Hono<{ Bindings: AppBindings }>();

function getCache(): Cache | undefined {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default;
}

/**
 * SHA-256 hex via Web Crypto, used to fold the POST body into the cache key.
 */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * Cloudflare does not include POST bodies in cache keys, so use a synthetic GET
 * URL keyed by the canonical address-set hash.
 */
async function buildCacheKey(
  requestUrl: string,
  canonicalAddresses: string[],
): Promise<Request> {
  const url = new URL(requestUrl);
  url.search = `?addresses=${await sha256Hex(canonicalAddresses.join(","))}`;
  return new Request(url.toString(), { method: "GET" });
}

/**
 * Per-page address-keyed market data. Missing indexer rows are omitted so the
 * client can treat those fields as unknown until indexing catches up.
 */
marketData.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(formatError("Invalid JSON body"), 400);
  }

  // `c.req.json()` accepts scalar JSON; keep malformed bodies on the 400 path.
  if (typeof body !== "object" || body === null) {
    return c.json(formatError("Invalid JSON body"), 400);
  }

  const raw = (body as { addresses?: unknown }).addresses;
  if (!Array.isArray(raw)) {
    return c.json(formatError("`addresses` must be an array"), 400);
  }
  if (raw.length === 0) {
    // Deliberately uncached: no upstream work, no useful cache entry.
    return c.json(
      formatSuccess({} as Record<string, MarketDataItem>, "live"),
    );
  }
  if (raw.length > MAX_ADDRESSES_PER_REQUEST) {
    return c.json(
      formatError(
        `Too many addresses (${raw.length} > ${MAX_ADDRESSES_PER_REQUEST})`,
      ),
      400,
    );
  }
  const addresses: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || !isAddress(entry)) {
      return c.json(formatError("Invalid token address in `addresses`"), 400);
    }
    addresses.push(entry.toLowerCase());
  }

  // Canonicalise after validation so equivalent address sets share cache.
  const canonicalAddresses = [...new Set(addresses)].sort();

  const cache = getCache();
  const cacheKey = cache
    ? await buildCacheKey(c.req.url, canonicalAddresses)
    : null;
  if (cache && cacheKey) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const result = await computeMarketDataForAddresses(
    c.env.DATABASE_URL,
    c.env.BOUNCETECH_DATABASE_URL,
    canonicalAddresses,
  );
  if (!result.ok) {
    return c.json(formatError(result.error), result.code);
  }

  const dataSource = result.dataSource ?? "live";
  const response = c.json(formatSuccess(result.data.market, dataSource));
  const ttlSeconds =
    dataSource === "live"
      ? MARKET_DATA_CACHE_TTL_SECONDS
      : MARKET_DATA_DEGRADED_CACHE_TTL_SECONDS;
  applyEdgeCacheHeaders(response, ttlSeconds);
  if (cache && cacheKey) {
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
    c.env.DATABASE_URL,
    c.env.BOUNCETECH_DATABASE_URL,
    address,
  );
  if (!result.ok) {
    return c.json(formatError(result.error), result.code);
  }

  return c.json(formatSuccess(result.data.market, result.dataSource ?? "live"));
});

export default marketData;

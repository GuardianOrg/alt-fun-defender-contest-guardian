import { Hono } from "hono";
import { isAddress } from "viem";

import {
  computeMarketDataForAddresses,
  computeMarketDataSingle,
  type MarketDataItem,
} from "../lib/market-data.js";
import { edgeCacheableJsonHeader } from "../utils/cache-control.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";

import type { AppBindings } from "../lib/types.js";

export type { MarketDataItem };

/**
 * Hard cap on `addresses[]` length per `POST /market-data` call. Bounds:
 *   - the downstream Ponder fan-out (each batch is ~25 aliased
 *     `tokenSnapshots(...)` queries — see `BATCH_SIZE` in `lib/market-data.ts`);
 *   - the response payload size on the wire;
 *   - the worst-case `WHERE address IN (...)` IN-list length.
 *
 * 200 is well above any realistic per-page consumer (home table = ~50,
 * portfolio = ~dozens, search = ~20) with margin for batching a couple of
 * pages worth of addresses in one request.
 */
const MAX_ADDRESSES_PER_REQUEST = 200;

/**
 * Per-POP edge-cache TTLs for `POST /market-data`. The frontend polls
 * this endpoint every 30s per visible token-row set (`apps/web/src/hooks/useMarketData.ts`),
 * and during the 2026-05-15 latency investigation we saw 645 calls / 30s
 * (p95 ~8.1s) all hammering the same ~5-query Neon pipeline. A 3-second
 * cache keyed on the canonicalised address set collapses that fan-out
 * to ~one origin compute per cache key per POP per TTL window — every
 * other browser polling the same hot page gets a <50ms cache hit.
 *
 * 3s on the live path is short enough that a freshly-graduated token's
 * market data resolves within one poll cycle for everyone, and is
 * invisible alongside the existing 30s frontend poll. 1s on the
 * degraded path mirrors the same constants in
 * `apps/api/src/routes/tokens/list.ts` — absorbs burst-on-outage
 * without amplifying load on already-struggling dependencies.
 */
const MARKET_DATA_CACHE_TTL_SECONDS = 3;
const MARKET_DATA_DEGRADED_CACHE_TTL_SECONDS = 1;

const marketData = new Hono<{ Bindings: AppBindings }>();

function getCache(): Cache | undefined {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default;
}

/**
 * SHA-256 hex of a string, via the Web Crypto API (available in both
 * Cloudflare Workers and Node 18+). Used to fold the request body's
 * address set into the cache key — see `buildCacheKey` below.
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
 * Build a synthetic GET-request cache key for the POST body. Cloudflare's
 * `caches.default` is keyed by `(method, url)` and does not look at the
 * request body — the only way to cache a POST response is to translate
 * the body-discriminator into a synthetic URL and store under that.
 *
 * The discriminator is a SHA-256 of the joined canonicalised address
 * list. Hashing the joined string (instead of stuffing the addresses
 * into the URL verbatim) keeps the cache key bounded at 64 hex chars
 * regardless of how many addresses the page is asking for, well below
 * any URL-length limit.
 *
 * Same pattern as the GET cache keys in
 * `apps/api/src/routes/tokens/list.ts` (which canonicalise away
 * `sort` / `dir` query params for identical responses), just adapted
 * to fold the POST body into the URL instead of dropping no-op params
 * from it.
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
 * Per-page market-data endpoint. Replaces the legacy catalogue-wide
 * `GET /market-data` dump (issue triggered by the
 * [graphql-yoga 1000-token cap](https://github.com/bounce-tech/alt-fun/pull/855)
 * and the silent 20K cap on `fetchAllTokensOnchain`) — every frontend
 * consumer reads `/market-data` as an address-keyed lookup against a
 * visible-page slice, never as a full-catalogue scan, so the API contract
 * now matches that shape.
 *
 * `addresses[]` is validated case-insensitively (lowercased for the
 * downstream Ponder query) and capped at `MAX_ADDRESSES_PER_REQUEST`
 * entries per call. Response shape is `Record<lowercasedAddress,
 * MarketDataItem>` keyed only on addresses that resolved — Ponder rows
 * that didn't exist (e.g. token launched but not yet indexed) are simply
 * absent from the map and the client treats their fields as unknown.
 *
 * Server-side cached on `caches.default` keyed by a SHA-256 of the
 * canonicalised (deduped + lowercased + sorted) address set, so two
 * browsers polling the same hot page share a single origin compute per
 * `MARKET_DATA_CACHE_TTL_SECONDS`-second window per POP. Cache hits
 * skip the downstream Neon + BounceTech pipeline entirely (the
 * `computeMarketDataForAddresses` call below) and return in <50ms.
 */
marketData.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(formatError("Invalid JSON body"), 400);
  }

  // Defensive null/non-object guard — `c.req.json()` happily parses a
  // literal `null` (or a bare number / string) as valid JSON, but
  // `body.addresses` would then throw `TypeError: Cannot read
  // properties of null` and surface as a 500 instead of the
  // user-visible 400 we want for malformed input. CodeRabbit feedback
  // on PR #872.
  if (typeof body !== "object" || body === null) {
    return c.json(formatError("Invalid JSON body"), 400);
  }

  const raw = (body as { addresses?: unknown }).addresses;
  if (!Array.isArray(raw)) {
    return c.json(formatError("`addresses` must be an array"), 400);
  }
  if (raw.length === 0) {
    // Deliberately uncached — empty body is a one-byte response with no
    // upstream work, so a cache entry would only churn cold storage we
    // never read back.
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

  // Canonicalise after validation so an invalid entry still 400s, and
  // before the cache lookup so two browsers asking for the same set in
  // different orderings / casings / dedupe-states (`[A, B]` vs
  // `[b, a, b]`) share a single cache slot. Matches the canonicalisation
  // the frontend's `useMarketData` already runs at the call site
  // (`apps/web/src/hooks/useMarketData.ts`), so the server-side
  // canonicalisation is belt-and-braces against any unconverted caller
  // shape.
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
    c.env.HYPERDRIVE.connectionString,
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
  response.headers.set("Cache-Control", edgeCacheableJsonHeader(ttlSeconds));
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
    c.env.HYPERDRIVE.connectionString,
    c.env.BOUNCETECH_DATABASE_URL,
    address,
  );
  if (!result.ok) {
    return c.json(formatError(result.error), result.code);
  }

  return c.json(formatSuccess(result.data.market, result.dataSource ?? "live"));
});

export default marketData;

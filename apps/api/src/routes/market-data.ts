import { Hono } from "hono";
import { isAddress } from "viem";

import formatSuccess from "../utils/format-success.js";
import formatError from "../utils/format-error.js";
import {
  computeMarketDataForAddresses,
  computeMarketDataSingle,
  type MarketDataItem,
} from "../lib/market-data.js";

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

const marketData = new Hono<{ Bindings: AppBindings }>();

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

  const result = await computeMarketDataForAddresses(
    c.env.DATABASE_URL,
    c.env.BOUNCETECH_DATABASE_URL,
    addresses,
  );
  if (!result.ok) {
    return c.json(formatError(result.error), result.code);
  }

  // POST responses can't be cached at the Cloudflare edge by default
  // (caching is keyed by URL + method), and the client-side React Query
  // staleTime handles the cross-render dedup we need. Skip the
  // `caches.default` write entirely — it would just churn cold storage
  // for entries we never read back.
  const dataSource = result.dataSource ?? "live";
  return c.json(formatSuccess(result.data.market, dataSource));
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

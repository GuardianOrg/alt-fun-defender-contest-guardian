import { eq, and, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { getAddress, isAddress } from "viem";
import { z } from "zod";

import { createDb } from "../../db/client.js";
import { tokens } from "../../db/schema.js";
import {
  computeMarketDataSingle,
  type MarketDataItem,
  type PonderTokenOnchain,
} from "../../lib/market-data.js";
import {
  computeCurveFilled,
  computeCurveFilledBreakdown,
  computeStatus,
  type DbToken,
  type EnrichedToken,
} from "../../lib/token-enrich.js";
import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";
import { zodValidator } from "../../utils/validation.js";

import type { AppBindings } from "../../lib/types.js";

const DETAIL_CACHE_TTL_SECONDS = 2;
// Short TTL for responses served while Ponder/BounceTech are down. Absorbs
// bursts so an outage doesn't amplify into load on the already-struggling
// dependency, while still recovering within ~1s once it comes back.
const DEGRADED_CACHE_TTL_SECONDS = 1;

const batchTokensSchema = z.object({
  addresses: z
    .array(z.string())
    .min(1, "At least one address is required")
    .max(100, "Maximum 100 addresses per batch"),
});

function enrich(
  dbToken: DbToken,
  onchain: PonderTokenOnchain | null | undefined,
  market: MarketDataItem | null | undefined,
): EnrichedToken {
  const { graduatedAt: dbGraduatedAt, createdAt, ...rest } = dbToken;
  const curveSupply = onchain?.curveSupply ?? null;
  const ltReserve = onchain?.ltReserve ?? null;
  const graduated = onchain?.graduated ?? false;
  const breakdown = computeCurveFilledBreakdown(
    curveSupply,
    ltReserve,
    onchain?.organicUsdcRaised ?? null,
    market?.ltExchangeRate ?? null,
    graduated,
  );
  const curveFilled = breakdown.total ?? computeCurveFilled(curveSupply);
  const status = computeStatus(dbToken.status, graduated, curveFilled);
  const hyperswapPair = onchain?.hyperswapPair ?? dbToken.poolAddress ?? null;

  return {
    ...rest,
    createdAt: createdAt.toISOString(),
    poolAddress: hyperswapPair,
    curveSupply,
    ltReserve,
    curveFilled,
    curveFilledOrganic: breakdown.organic,
    curveFilledLeverageBoost: breakdown.leverageBoost,
    status,
    graduated,
    graduatedAt: onchain?.graduatedAt
      ? new Date(Number(onchain.graduatedAt) * 1000).toISOString()
      : dbGraduatedAt
        ? dbGraduatedAt.toISOString()
        : null,
    bondingPair: onchain?.bondingPair ?? null,
    hyperswapPair,
    priceUsd: market?.priceUsd ?? null,
    mcapUsd: market?.mcapUsd ?? null,
    change24h: market?.change24h ?? null,
  };
}

const detailRoute = new Hono<{ Bindings: AppBindings }>();

detailRoute.post("/batch", zodValidator("json", batchTokensSchema), async (c) => {
  const { addresses } = c.req.valid("json");

  const db = createDb(c.env.DATABASE_URL);
  const results = await db
    .select()
    .from(tokens)
    .where(and(eq(tokens.isHidden, false), inArray(tokens.address, addresses)));

  return c.json(formatSuccess(results));
});

detailRoute.get("/:address", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = getAddress(rawAddress);

  const cachesObj = (globalThis as { caches?: { default?: Cache } }).caches;
  const cache = cachesObj?.default;
  const cacheKey = new Request(new URL(c.req.url).toString(), { method: "GET" });
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const db = createDb(c.env.DATABASE_URL);
  const [dbToken] = await db
    .select()
    .from(tokens)
    .where(eq(tokens.address, address))
    .limit(1);

  if (!dbToken) {
    return c.json(formatError("Token not found"), 404);
  }

  const marketResult = await computeMarketDataSingle(
    c.env.PONDER_URL,
    c.env.BOUNCETECH_DATABASE_URL,
    address,
  );

  const dataSource = marketResult.ok ? "live" : "degraded";
  const onchain = marketResult.ok ? marketResult.data.token : null;
  const market = marketResult.ok ? marketResult.data.market : null;

  const response = c.json(
    formatSuccess(enrich(dbToken, onchain, market), dataSource),
  );

  const ttl = marketResult.ok ? DETAIL_CACHE_TTL_SECONDS : DEGRADED_CACHE_TTL_SECONDS;
  response.headers.set("Cache-Control", `s-maxage=${ttl}`);
  if (cache) {
    await cache.put(cacheKey, response.clone());
  }

  return response;
});

export default detailRoute;

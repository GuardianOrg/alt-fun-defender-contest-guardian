import { eq, desc, asc, ilike, or, and, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { getAddress, isAddress } from "viem";

import { createDb } from "../../db/client.js";
import { tokens } from "../../db/schema.js";
import {
  computeMarketDataForAddresses,
  type MarketDataItem,
  type PonderTokenOnchain,
} from "../../lib/market-data.js";
import {
  computeCurveFilled,
  computeCurveFilledBreakdown,
  computeStatus,
  computeTrendingScore,
  type EnrichedToken,
} from "../../lib/token-enrich.js";
import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";

import type { AppBindings } from "../../lib/types.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const LIST_CACHE_TTL_SECONDS = 5;
// Short TTL for responses served while Ponder/BounceTech are down. Absorbs
// bursts so an outage doesn't amplify into load on the already-struggling
// dependency, while still recovering within ~1s once it comes back.
const DEGRADED_CACHE_TTL_SECONDS = 1;
// Cap on how many tokens we'll enrich + score in one trending request. The
// scoring path is O(N) in BounceTech / Ponder calls, so we don't want it to
// grow unboundedly with the catalogue. When we outgrow this, the right fix
// is a precomputed score column refreshed by a cron — not a bigger cap.
const TRENDING_POOL_SIZE = 500;

function parseNonNegativeInt(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

type DbToken = typeof tokens.$inferSelect;

function enrich(
  dbToken: DbToken,
  onchain: PonderTokenOnchain | undefined,
  market: MarketDataItem | undefined,
): EnrichedToken {
  const { graduatedAt: dbGraduatedAt, createdAt, ...rest } = dbToken;
  const curveSupply = onchain?.curveSupply ?? null;
  const ltReserve = onchain?.ltReserve ?? null;
  const graduated = onchain?.graduated ?? false;
  const breakdown = computeCurveFilledBreakdown(
    curveSupply,
    ltReserve,
    onchain?.k ?? null,
    onchain?.organicUsdcRaised ?? null,
    market?.ltExchangeRate ?? null,
    graduated,
  );
  const curveFilled = breakdown.total ?? computeCurveFilled(curveSupply);
  const status = computeStatus(dbToken.status, graduated, curveFilled);
  const hyperswapPair = onchain?.hyperswapPair ?? dbToken.poolAddress ?? null;
  const lastTradeAt =
    market?.lastTradeAtSec != null
      ? new Date(market.lastTradeAtSec * 1000).toISOString()
      : null;

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
    volume24hUsd: market?.volume24hUsd ?? null,
    lastTradeAt,
  };
}

const listRoute = new Hono<{ Bindings: AppBindings }>();

listRoute.get("/", async (c) => {
  const limitParam = parseNonNegativeInt(c.req.query("limit"));
  const offsetParam = parseNonNegativeInt(c.req.query("offset"));

  if (limitParam === null || offsetParam === null) {
    return c.json(formatError("Invalid pagination parameters"), 400);
  }

  const limit = Math.min(limitParam ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = offsetParam ?? 0;

  const conditions: SQL[] = [eq(tokens.isHidden, false)];

  const underlying = c.req.query("underlying");
  if (underlying) {
    conditions.push(eq(tokens.underlying, underlying));
  }

  const status = c.req.query("status");
  if (status && (status === "curve" || status === "graduating" || status === "graduated")) {
    conditions.push(eq(tokens.status, status));
  }

  const direction = c.req.query("direction");
  if (direction && (direction === "long" || direction === "short")) {
    conditions.push(eq(tokens.ltDirection, direction));
  }

  const leverage = c.req.query("leverage");
  if (leverage) {
    const lev = parseInt(leverage, 10);
    if ([2, 3, 5].includes(lev)) {
      conditions.push(eq(tokens.leverage, lev));
    }
  }

  const creator = c.req.query("creator");
  if (creator && isAddress(creator)) {
    conditions.push(eq(tokens.creator, getAddress(creator)));
  }

  const sort = c.req.query("sort") ?? "createdAt";
  const dir = c.req.query("dir") === "asc" ? asc : desc;

  const sortColumn =
    sort === "leverage" ? tokens.leverage :
    sort === "name" ? tokens.name :
    tokens.createdAt;

  const cachesObj = (globalThis as { caches?: { default?: Cache } }).caches;
  const cache = cachesObj?.default;
  // Canonicalise the cache key by dropping params the handler ignores for
  // this request. Prevents `?sort=trending&dir=asc` and `&dir=desc` from
  // each getting their own cache entry for identical responses (trending
  // always sorts desc by score). Add further ignored-param strips here if
  // we grow more "sort-dependent" knobs.
  const cacheUrl = new URL(c.req.url);
  if (sort === "trending") cacheUrl.searchParams.delete("dir");
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const db = createDb(c.env.DATABASE_URL);

  // Trending sort needs a full-catalogue score, so we can't push ORDER BY to
  // Postgres. Pull the most recently launched `TRENDING_POOL_SIZE` tokens
  // matching the filters, enrich + score them, sort desc by score, then
  // slice the requested page. "Most recent" is the right candidate window
  // because trending is dominated by change24h / volume / freshness — a
  // token that hasn't been touched in months is ~never trending.
  const dbTokens =
    sort === "trending"
      ? await db
          .select()
          .from(tokens)
          .where(and(...conditions))
          .orderBy(desc(tokens.createdAt))
          .limit(TRENDING_POOL_SIZE)
      : await db
          .select()
          .from(tokens)
          .where(and(...conditions))
          .orderBy(dir(sortColumn))
          .limit(limit)
          .offset(offset);

  if (dbTokens.length === 0) {
    const empty = c.json(formatSuccess([], "live"));
    empty.headers.set("Cache-Control", `s-maxage=${LIST_CACHE_TTL_SECONDS}`);
    if (cache) {
      await cache.put(cacheKey, empty.clone());
    }
    return empty;
  }

  // Only fetch market data for the addresses we'll consider, not the whole
  // catalogue. For a 50-token page (non-trending) this is ~20× less work on
  // Ponder / BounceTech than `computeMarketDataBatch`; for trending it's
  // still capped at `TRENDING_POOL_SIZE`.
  const marketResult = await computeMarketDataForAddresses(
    c.env.PONDER_URL,
    c.env.BOUNCETECH_DATABASE_URL,
    dbTokens.map((t) => t.address),
  );

  const onchainByAddress = new Map<string, PonderTokenOnchain>();
  const marketByAddress = new Map<string, MarketDataItem>();
  if (marketResult.ok) {
    for (const t of marketResult.data.tokens) {
      onchainByAddress.set(t.address.toLowerCase(), t);
    }
    for (const [addr, entry] of Object.entries(marketResult.data.market)) {
      marketByAddress.set(addr, entry);
    }
  }

  let enriched = dbTokens.map((t) =>
    enrich(
      t,
      onchainByAddress.get(t.address.toLowerCase()),
      marketByAddress.get(t.address.toLowerCase()),
    ),
  );

  if (sort === "trending") {
    const nowSec = Math.floor(Date.now() / 1000);
    const scored = enriched.map((t) => {
      const createdAtSec = Math.floor(new Date(t.createdAt).getTime() / 1000);
      const lastTradeAtSec = t.lastTradeAt
        ? Math.floor(new Date(t.lastTradeAt).getTime() / 1000)
        : null;
      const score = computeTrendingScore({
        change24h: t.change24h,
        volume24hUsd: t.volume24hUsd,
        mcapUsd: t.mcapUsd,
        createdAtSec,
        lastTradeAtSec,
        nowSec,
      });
      return { token: t, score };
    });
    // Primary: score desc. Tie-break: mcap desc (treats unknown/null as 0
    // so quiet tokens don't leapfrog priced ones on ties).
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.token.mcapUsd ?? 0) - (a.token.mcapUsd ?? 0);
    });
    enriched = scored.slice(offset, offset + limit).map((s) => s.token);
  }

  const response = c.json(
    formatSuccess(enriched, marketResult.ok ? "live" : "degraded"),
  );
  const ttl = marketResult.ok ? LIST_CACHE_TTL_SECONDS : DEGRADED_CACHE_TTL_SECONDS;
  response.headers.set("Cache-Control", `s-maxage=${ttl}`);
  if (cache) {
    await cache.put(cacheKey, response.clone());
  }
  return response;
});

listRoute.get("/search", async (c) => {
  const q = c.req.query("q");
  if (!q || q.length < 1) {
    return c.json(formatSuccess([]));
  }

  const db = createDb(c.env.DATABASE_URL);
  const pattern = `%${q}%`;
  const results = await db
    .select()
    .from(tokens)
    .where(
      and(
        eq(tokens.isHidden, false),
        or(
          ilike(tokens.name, pattern),
          ilike(tokens.ticker, pattern),
          ilike(tokens.address, pattern),
        ),
      ),
    )
    .limit(20);

  return c.json(formatSuccess(results));
});

export default listRoute;

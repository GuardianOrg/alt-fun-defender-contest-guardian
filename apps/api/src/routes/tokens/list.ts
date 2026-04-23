import { eq, desc, asc, ilike, or, and, inArray, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { getAddress, isAddress } from "viem";

import { createDb } from "../../db/client.js";
import { tokens } from "../../db/schema.js";
import {
  buildBatchFromTokens,
  computeMarketDataForAddresses,
  fetchGraduatedTokensOnchain,
  fetchGraduatingTokensOnchain,
  type MarketDataItem,
  type PonderTokenOnchain,
} from "../../lib/market-data.js";
import { getGraduationThresholdUsd } from "../../lib/protocol-config.js";
import {
  computeCurveFilled,
  computeCurveFilledBreakdown,
  computeStatus,
  computeTrendingScore,
  sortLtMovers,
  usdcRawToUsd,
  type DbToken,
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
// Cap on how many tokens we'll enrich + score in a single trending /
// lt-movers request. Both paths are O(N) in BounceTech / Ponder calls, so
// we don't want them to grow unboundedly with the catalogue. When we
// outgrow this, the right fix is a precomputed score column refreshed by a
// cron — not a bigger cap.
const TRENDING_POOL_SIZE = 500;
// Upper bound on how many graduated / graduating tokens we'll fetch from
// Ponder for the status=graduated|graduating tabs. Same reasoning as
// TRENDING_POOL_SIZE — bounded work per request, falls back to a cron-
// populated column once the catalogue outgrows it.
const STATUS_POOL_SIZE = 500;

function parseNonNegativeInt(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

function enrich(
  dbToken: DbToken,
  onchain: PonderTokenOnchain | undefined,
  market: MarketDataItem | undefined,
  graduationThresholdUsd: number,
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
    graduationThresholdUsd,
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
    ltChange24h: market?.ltChange24h ?? null,
    volume24hUsd: market?.volume24hUsd ?? null,
    // `onchain == null` ⇒ indexer unreachable for this token: return `null`
    // so clients can disambiguate from a legitimately-zero counter. When the
    // row exists but the indexer is an older build missing the `volumeUsd`
    // column, `usdcRawToUsd` returns null and we fall through to `0` — which
    // matches the documented "row exists ⇒ 0, not null" semantics.
    totalVolumeUsd:
      onchain == null ? null : (usdcRawToUsd(onchain.volumeUsd) ?? 0),
    // Same null-vs-zero semantics as `totalVolumeUsd` — see comment above.
    creatorFeesUsd:
      onchain == null ? null : (usdcRawToUsd(onchain.creatorFeesUsd) ?? 0),
    protocolFeesUsd:
      onchain == null ? null : (usdcRawToUsd(onchain.protocolFeesUsd) ?? 0),
    lastTradeAt,
  };
}

type SortMode = "createdAt" | "leverage" | "name" | "trending" | "lt-movers";
type StatusFilter = "curve" | "graduating" | "graduated";

interface ListFilters {
  underlying: string | undefined;
  direction: "long" | "short" | undefined;
  leverage: number | undefined;
  creator: `0x${string}` | undefined;
}

function matchesFilters(t: DbToken, f: ListFilters): boolean {
  if (f.underlying && t.underlying !== f.underlying) return false;
  if (f.direction && t.ltDirection !== f.direction) return false;
  if (f.leverage !== undefined && t.leverage !== f.leverage) return false;
  if (f.creator && t.creator.toLowerCase() !== f.creator.toLowerCase()) {
    return false;
  }
  return true;
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

  const underlying = c.req.query("underlying");
  const directionRaw = c.req.query("direction");
  const direction =
    directionRaw === "long" || directionRaw === "short"
      ? directionRaw
      : undefined;
  const leverageRaw = c.req.query("leverage");
  let leverage: number | undefined;
  if (leverageRaw) {
    const lev = parseInt(leverageRaw, 10);
    if ([2, 3, 5].includes(lev)) leverage = lev;
  }
  const creatorRaw = c.req.query("creator");
  const creator =
    creatorRaw && isAddress(creatorRaw) ? getAddress(creatorRaw) : undefined;

  const filters: ListFilters = {
    underlying,
    direction,
    leverage,
    creator,
  };

  const statusRaw = c.req.query("status");
  const status: StatusFilter | undefined =
    statusRaw === "curve" || statusRaw === "graduating" || statusRaw === "graduated"
      ? statusRaw
      : undefined;

  const sortRaw = c.req.query("sort") ?? "createdAt";
  const sort: SortMode =
    sortRaw === "leverage" ||
    sortRaw === "name" ||
    sortRaw === "trending" ||
    sortRaw === "lt-movers"
      ? sortRaw
      : "createdAt";
  const dir = c.req.query("dir") === "asc" ? asc : desc;

  const cachesObj = (globalThis as { caches?: { default?: Cache } }).caches;
  const cache = cachesObj?.default;
  // Canonicalise the cache key by dropping params the handler ignores for
  // a given request shape. Prevents e.g. `?sort=trending&dir=asc` and
  // `&dir=desc` from each getting their own cache entry for identical
  // responses (trending always sorts desc by score).
  const cacheUrl = new URL(c.req.url);
  if (sort === "trending" || sort === "lt-movers") {
    cacheUrl.searchParams.delete("dir");
  }
  // `status=graduated|graduating` derive their own ordering from Ponder
  // and ignore the `sort`/`dir` params entirely.
  if (status === "graduated" || status === "graduating") {
    cacheUrl.searchParams.delete("sort");
    cacheUrl.searchParams.delete("dir");
  }
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const db = createDb(c.env.DATABASE_URL);

  // ---------- Ponder-first paths: status=graduated | status=graduating ----------
  //
  // Postgres' `status` column is never flipped by the API (the indexer is
  // the source of truth for graduation). Driving these tabs off Ponder
  // keeps them accurate and keeps the ordering fields (`graduatedAt` /
  // `curveSupply`) available without extra joins.
  if (status === "graduated" || status === "graduating") {
    const onchainPage =
      status === "graduated"
        ? await fetchGraduatedTokensOnchain(
            c.env.PONDER_URL,
            STATUS_POOL_SIZE,
            0,
          )
        : await fetchGraduatingTokensOnchain(
            c.env.PONDER_URL,
            STATUS_POOL_SIZE,
            0,
          );

    if (onchainPage === null) {
      return c.json(formatError("Indexer unavailable"), 503);
    }

    if (onchainPage.length === 0) {
      const empty = c.json(formatSuccess([], "live"));
      empty.headers.set("Cache-Control", `s-maxage=${LIST_CACHE_TTL_SECONDS}`);
      if (cache) await cache.put(cacheKey, empty.clone());
      return empty;
    }

    // `tokens.address` is stored checksummed (see `create.ts` — we run
    // every insert through `getAddress`). Ponder returns addresses
    // lowercased. Checksum for the DB query, but keep the lowercased form
    // for map lookups below where we compare against Ponder strings.
    const checksummedAddresses = onchainPage.map((t) => getAddress(t.address));

    const dbRowsRaw = await db
      .select()
      .from(tokens)
      .where(and(eq(tokens.isHidden, false), inArray(tokens.address, checksummedAddresses)));

    const dbByAddress = new Map<string, DbToken>();
    for (const row of dbRowsRaw) {
      dbByAddress.set(row.address.toLowerCase(), row);
    }

    // Preserve Ponder's ordering (graduatedAt desc / curveSupply asc) and
    // drop anything hidden in the DB or not matching the user's filters.
    const orderedDbRows: DbToken[] = [];
    const orderedOnchain: PonderTokenOnchain[] = [];
    for (const onchain of onchainPage) {
      const addr = onchain.address.toLowerCase();
      const row = dbByAddress.get(addr);
      if (!row) continue;
      if (!matchesFilters(row, filters)) continue;
      orderedDbRows.push(row);
      orderedOnchain.push(onchain);
    }

    const paged = orderedDbRows.slice(offset, offset + limit);
    const pagedOnchain = orderedOnchain.slice(offset, offset + limit);

    if (paged.length === 0) {
      const empty = c.json(formatSuccess([], "live"));
      empty.headers.set("Cache-Control", `s-maxage=${LIST_CACHE_TTL_SECONDS}`);
      if (cache) await cache.put(cacheKey, empty.clone());
      return empty;
    }

    // Reuse the already-resolved Ponder tokens — saves a round-trip
    // compared to computeMarketDataForAddresses which re-fetches them.
    const marketResult = await buildBatchFromTokens(
      c.env.PONDER_URL,
      c.env.BOUNCETECH_DATABASE_URL,
      pagedOnchain,
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
    } else {
      // Degraded: still render with on-chain data we already have so the
      // UI isn't empty — just without priceUsd / mcap / change24h.
      for (const t of pagedOnchain) {
        onchainByAddress.set(t.address.toLowerCase(), t);
      }
    }

    const graduationThresholdUsd = await getGraduationThresholdUsd(
      c.env.PONDER_URL,
    );
    const enriched = paged.map((t) =>
      enrich(
        t,
        onchainByAddress.get(t.address.toLowerCase()),
        marketByAddress.get(t.address.toLowerCase()),
        graduationThresholdUsd,
      ),
    );

    const response = c.json(
      formatSuccess(enriched, marketResult.ok ? "live" : "degraded"),
    );
    const ttl = marketResult.ok ? LIST_CACHE_TTL_SECONDS : DEGRADED_CACHE_TTL_SECONDS;
    response.headers.set("Cache-Control", `s-maxage=${ttl}`);
    if (cache) await cache.put(cacheKey, response.clone());
    return response;
  }

  // ---------- DB-first path: everything else ----------

  const conditions: SQL[] = [eq(tokens.isHidden, false)];
  if (underlying) conditions.push(eq(tokens.underlying, underlying));
  if (status === "curve") conditions.push(eq(tokens.status, "curve"));
  if (direction) conditions.push(eq(tokens.ltDirection, direction));
  if (leverage !== undefined) conditions.push(eq(tokens.leverage, leverage));
  if (creator) conditions.push(eq(tokens.creator, creator));

  const sortColumn =
    sort === "leverage" ? tokens.leverage :
    sort === "name" ? tokens.name :
    tokens.createdAt;

  // Trending and lt-movers both need a full-batch score/filter pass, so we
  // can't push ORDER BY to Postgres. Pull the most recently launched
  // `TRENDING_POOL_SIZE` tokens matching the filters, enrich, then sort +
  // slice to the requested page in memory. "Most recent" is the right
  // candidate window because both views are dominated by recent activity —
  // a token that hasn't been touched in months is ~never moving.
  const isScoredSort = sort === "trending" || sort === "lt-movers";
  const dbTokens = isScoredSort
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
  // catalogue. For a 50-token page (non-scored sort) this is ~20× less
  // work on Ponder / BounceTech than `computeMarketDataBatch`; for scored
  // sorts it's still capped at `TRENDING_POOL_SIZE`.
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

  const graduationThresholdUsd = await getGraduationThresholdUsd(
    c.env.PONDER_URL,
  );
  let enriched = dbTokens.map((t) =>
    enrich(
      t,
      onchainByAddress.get(t.address.toLowerCase()),
      marketByAddress.get(t.address.toLowerCase()),
      graduationThresholdUsd,
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
  } else if (sort === "lt-movers") {
    enriched = sortLtMovers(enriched).slice(offset, offset + limit);
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

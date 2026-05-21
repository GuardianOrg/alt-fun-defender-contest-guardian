import {
  eq,
  gt,
  desc,
  asc,
  ilike,
  or,
  and,
  inArray,
  notInArray,
  type SQL,
} from "drizzle-orm";
import { Hono } from "hono";
import { getAddress, isAddress } from "viem";

import {
  EXCLUDED_UNDERLYING_ASSETS,
  isExcludedUnderlying,
} from "@launchpad/shared";

import { createDb } from "../../db/client.js";
import { tokens } from "../../db/schema.js";
import { tryApiDbRead } from "../../lib/api-db-reads.js";
import {
  getLiveLtAvailability,
  type LtAvailability,
} from "../../lib/lt-availability.js";
import {
  buildBatchFromTokens,
  computeMarketDataForAddresses,
  fetchGraduatedTokensOnchain,
  fetchNonGraduatedTokensOnchain,
  fetchTrendingCandidatesByVolume,
  type MarketDataItem,
  type PonderTokenOnchain,
} from "../../lib/market-data.js";
import { getGraduationThresholdUsd } from "../../lib/protocol-config.js";
import {
  computeCurveFilled,
  computeCurveFilledBreakdown,
  computeStatus,
  usdcRawToUsd,
  type DbToken,
  type EnrichedToken,
} from "../../lib/token-enrich.js";
import { edgeCacheableJsonHeader } from "../../utils/cache-control.js";
import formatError from "../../utils/format-error.js";
import formatSuccess from "../../utils/format-success.js";
import { isRevalidationRequest, putWithSwr } from "../../utils/swr-cache.js";

import type { AppBindings } from "../../lib/types.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const LIST_CACHE_TTL_SECONDS = 5;
// Short TTL for responses served while Ponder/BounceTech are down. Absorbs
// bursts so an outage doesn't amplify into load on the already-struggling
// dependency, while still recovering within ~1s once it comes back.
const DEGRADED_CACHE_TTL_SECONDS = 1;
// How many candidate addresses to pull from the indexer's
// `token_hourly_metrics` 24h-volume aggregate. Trending is a pure
// `ORDER BY SUM(volume_usd) DESC LIMIT K` against the per-token hourly
// bucket table — anti-spam by construction (a token nobody trades has no
// rows in the window), so the pool size is bounded purely for response
// payload / pagination depth. 500 is enough to back the page-100 slot
// with margin and matches the budget the GRADUATING / GRADUATED tabs use.
const TRENDING_POOL_SIZE = 500;
// Trending sums hourly buckets back to this cutoff. Mirrors the
// platform-wide /stats scan: we round down to the current hour-start
// before subtracting 24h so the window is always at least 24h wide
// regardless of where in the hour the request lands (matches
// `fetchPlatformStats` semantics — the extra bucket gives the rolling
// window full coverage).
const TRENDING_WINDOW_SEC = 86_400;
const SECONDS_PER_HOUR = 3_600;
// Upper bound on how many graduated / graduating tokens we'll fetch from
// Ponder for the status=graduated|graduating tabs. Same reasoning as
// TRENDING_POOL_SIZE — bounded work per request, falls back to a cron-
// populated column once the catalogue outgrows it.
const STATUS_POOL_SIZE = 500;
/**
 * Curve-fill percentage at which a token starts appearing in the
 * GRADUATING tab. The tab is a *progress* surface ("close to
 * graduation") — distinct from the on-chain `status === "graduating"`
 * field, which means "phase 1 has fired, trading is frozen" and
 * continues to drive the GRADUATING pill / trade-panel overlay
 * regardless of this threshold.
 *
 * 75% picks the closing-stretch slice: gives users a clear "shortlist
 * of tokens about to graduate" without diluting the tab with
 * mid-curve tokens that haven't earned the spotlight yet. Centralised
 * here so the route + tests + any future docs share the constant.
 */
const GRADUATING_TAB_MIN_CURVE_FILLED = 75;

function parseNonNegativeInt(
  value: string | undefined,
): number | undefined | null {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

/**
 * Parse a `createdAfter` query parameter as an ISO-8601 timestamp.
 *
 * Returns:
 *   - `undefined` when the param is absent (no filter applied).
 *   - `null` when the param is present but malformed (handler emits 400).
 *   - a `Date` when the param is a well-formed ISO-8601 string.
 *
 * The leading `YYYY-MM-DD` shape guard rejects English-style inputs like
 * `"tomorrow"`, bare years (`"2024"`), and the empty string — all of which
 * `new Date(...)` would either accept or silently coerce. Anything that
 * passes the shape check still has its `getTime()` checked so the Date
 * constructor's lenient fallback to `Invalid Date` doesn't slip through.
 */
function parseCreatedAfter(value: string | undefined): Date | undefined | null {
  if (value === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
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
  const pendingGraduation = onchain?.pendingGraduation ?? false;
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
  const status = computeStatus(graduated, pendingGraduation);
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
    curveRaisedUsd: breakdown.raisedUsd,
    status,
    graduated,
    graduatedAt: onchain?.graduatedAt
      ? new Date(Number(onchain.graduatedAt) * 1000).toISOString()
      : dbGraduatedAt
        ? dbGraduatedAt.toISOString()
        : null,
    pendingGraduation,
    pendingGraduationAt: onchain?.pendingGraduationAt
      ? new Date(Number(onchain.pendingGraduationAt) * 1000).toISOString()
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

/**
 * Comparator factory shared by the scored-sort paths (trending +
 * graduated). Keeps the three sort flavours in one place so the
 * trending branch and the graduated branch can't drift apart on
 * tie-break or null-handling semantics — both call this with the same
 * set of accessors and get back a `(a, b) => number` ready to hand to
 * `Array.prototype.sort`.
 *
 * Null handling differs by sort:
 *   - `mcap` / `trending` use `?? 0` for their primary accessor
 *     inputs — those metrics are always ≥ 0 so a null falls cleanly
 *     to the bottom of a desc sort with no special-casing.
 *   - `change24h` uses an explicit null check (not a sentinel) because
 *     percentage change can be negative: `change24h ?? 0` would pull
 *     degraded "we don't know" rows up above every legitimate loser,
 *     surfacing nulls in the middle of the list which is the wrong
 *     signal. We instead route nulls to the bottom of the desc sort
 *     directly in the comparator. (`Number.NEGATIVE_INFINITY` would
 *     also work but produces `NaN` when both rows are null — using a
 *     branch keeps the comparator total/well-behaved on every input.)
 */
function buildScoredComparator(
  sort: "trending" | "mcap" | "change24h",
  volume24hOf: (t: EnrichedToken) => number,
  mcapOf: (t: EnrichedToken) => number,
): (a: EnrichedToken, b: EnrichedToken) => number {
  if (sort === "mcap") {
    return (a, b) => {
      const m = mcapOf(b) - mcapOf(a);
      if (m !== 0) return m;
      return volume24hOf(b) - volume24hOf(a);
    };
  }
  if (sort === "change24h") {
    return (a, b) => {
      const ca = a.change24h;
      const cb = b.change24h;
      // Null sinks to the bottom — see the docstring above for why we
      // can't use a `?? 0` or `?? -Infinity` sentinel here.
      if (ca === null && cb === null) {
        return mcapOf(b) - mcapOf(a);
      }
      if (ca === null) return 1;
      if (cb === null) return -1;
      if (cb !== ca) return cb - ca;
      return mcapOf(b) - mcapOf(a);
    };
  }
  // sort === "trending": 24h volume desc, mcap tie-break.
  return (a, b) => {
    const v = volume24hOf(b) - volume24hOf(a);
    if (v !== 0) return v;
    return mcapOf(b) - mcapOf(a);
  };
}

/**
 * Sort modes accepted on `/api/v1/tokens?sort=…`.
 *
 * The first three (`createdAt` / `leverage` / `name`) are simple SQL
 * `ORDER BY` modes used by the DB-first path. The last three are
 * "scored" sorts that re-rank the trending candidate pool (top‑N by
 * rolling 24h volume) — when any of these is selected, the route
 * fetches the volume-ranked candidate pool from the indexer and then
 * reorders the hydrated rows in memory.
 *
 *   - `trending`   — 24h gross USDC volume desc (mcap tie-break).
 *                    The TRENDING-tab default.
 *   - `mcap`       — market cap desc (24h volume tie-break: equal
 *                    mcap rows surface the more-active token first).
 *   - `change24h`  — 24h percentage change desc (mcap tie-break;
 *                    null sinks to the bottom — see the comparator).
 *
 * For `status=graduated` requests the same three scored sorts are
 * accepted: they re-rank the graduated cohort (top‑N by `graduatedAt
 * desc` from the indexer) by the same key. `trending` on a graduated
 * cohort means "most-traded graduated tokens this week" — legitimate
 * lens, though the frontend's TRENDING tab won't surface that combo.
 * For `status=graduating` the sort param is ignored (curveFilled desc
 * is the only meaningful order for that tab — see the in-memory sort
 * a few hundred lines below).
 */
type SortMode =
  | "createdAt"
  | "leverage"
  | "name"
  | "trending"
  | "mcap"
  | "change24h";
type StatusFilter = "curve" | "graduating" | "graduated";

interface ListFilters {
  underlying: string | undefined;
  direction: "long" | "short" | undefined;
  leverage: number | undefined;
  creator: `0x${string}` | undefined;
}

function matchesFilters(t: DbToken, f: ListFilters): boolean {
  // Drop tokens whose underlying is retired from the Alt Fun UI (e.g.
  // PAXG, issue #639). Applied before user-supplied filters so an
  // explicit `?underlying=PAXG` query also returns nothing instead of
  // smuggling the hidden market back into the response.
  if (isExcludedUnderlying(t.underlying)) return false;
  if (f.underlying && t.underlying !== f.underlying) return false;
  if (f.direction && t.ltDirection !== f.direction) return false;
  if (f.leverage !== undefined && t.leverage !== f.leverage) return false;
  if (f.creator && t.creator.toLowerCase() !== f.creator.toLowerCase()) {
    return false;
  }
  return true;
}

/**
 * Drizzle's `notInArray` rejects an empty input set (Postgres `NOT IN ()`
 * is a syntax error). Return the predicate only when there's at least
 * one excluded underlying to filter against, so the list route stays
 * a no-op when `EXCLUDED_UNDERLYING_ASSETS` is later emptied.
 *
 * The widening `readonly string[]` cast is intentional: without it TS
 * narrows the tuple's `length` to its current literal value (`1` while
 * PAXG ships) and flags the `=== 0` branch as unreachable. Casting
 * preserves the runtime guard so a later "PAXG is back" change just
 * empties the list rather than dragging the API route along with it.
 */
function excludedUnderlyingCondition(): SQL | undefined {
  const excluded = EXCLUDED_UNDERLYING_ASSETS as readonly string[];
  if (excluded.length === 0) return undefined;
  return notInArray(tokens.underlying, [...excluded]);
}

/**
 * Drop tokens whose backing LT is no longer present in BounceTech's
 * `/leveraged-tokens` directory. Originally added in issue #621 to keep
 * tokens backed by half-tested LTs (in the indexing API but no logo yet)
 * out of the home-page list; the filter has since been narrowed to the
 * directory-membership signal so that creator-launched tokens stay
 * visible while BounceTech catches up on the per-LT logo upload. See the
 * docstring on `LtAvailability.directoryAddresses` in
 * `lib/lt-availability.ts` for the full asymmetry rationale (the stricter
 * `liveAddresses` view still gates `/api/v1/assets`, so the pair selector
 * doesn't expose users to creating against not-yet-public LTs).
 *
 * When the directory signal is unavailable (BounceTech indexing API down
 * during the very first request after a cold start, before any refresh
 * succeeded) we fall back to "show everything" — the alternative would
 * blank the home page during transient BounceTech outages, which is a
 * worse failure mode than a brief listing of yet-to-be-published LTs.
 */
function filterByLiveLt(
  rows: DbToken[],
  availability: LtAvailability | null,
): DbToken[] {
  if (availability === null || !availability.fresh) return rows;
  if (availability.directoryAddresses.size === 0) return rows;
  return rows.filter((row) =>
    availability.directoryAddresses.has(row.ltPair.toLowerCase()),
  );
}

/**
 * Normalise a snapshot's address set into the checksummed form Postgres
 * stores. Drops anything that doesn't parse as a 20-byte hex address so
 * a single malformed entry coming back from BounceTech's directory can't
 * throw out of `getAddress` and 500 the whole request. Mirrors the
 * `isAddress` → `getAddress` guard used by `lib/admin-allowlist.ts`,
 * `lib/market-data.ts`, and the moderation routes — keeps the
 * external-data-trust boundary consistent across the codebase.
 */
function checksumDirectoryAddresses(
  directoryAddresses: ReadonlySet<string>,
): `0x${string}`[] {
  const out: `0x${string}`[] = [];
  for (const addr of directoryAddresses) {
    if (!isAddress(addr)) continue;
    out.push(getAddress(addr));
  }
  return out;
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

  // Strictly-greater-than filter on `createdAt`. Cursor-style backfill
  // pattern: a consumer tracking the latest `createdAt` it's processed
  // can ask for "everything newer than that" without re-receiving the
  // boundary row. Naming mirrors the public contract — `createdAfter`
  // reads as exclusive, and that's what we implement.
  const createdAfter = parseCreatedAfter(c.req.query("createdAfter"));
  if (createdAfter === null) {
    return c.json(formatError("Invalid createdAfter parameter"), 400);
  }

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
    statusRaw === "curve" ||
    statusRaw === "graduating" ||
    statusRaw === "graduated"
      ? statusRaw
      : undefined;

  const sortRaw = c.req.query("sort") ?? "createdAt";
  const sort: SortMode =
    sortRaw === "leverage" ||
    sortRaw === "name" ||
    sortRaw === "trending" ||
    sortRaw === "mcap" ||
    sortRaw === "change24h"
      ? sortRaw
      : "createdAt";
  // Every scored sort is desc-only — `dir` is ignored by the handler for
  // any sort in this set. Used both for cache-key canonicalisation
  // (collapse `&dir=asc` / `&dir=desc` into the same entry) and to
  // gate the candidate-pool branch a few hundred lines below.
  const isScoredSort =
    sort === "trending" || sort === "mcap" || sort === "change24h";
  const dir = c.req.query("dir") === "asc" ? asc : desc;

  const cachesObj = (globalThis as { caches?: { default?: Cache } }).caches;
  const cache = cachesObj?.default;
  // Canonicalise the cache key by dropping params the handler ignores for
  // a given request shape. Prevents e.g. `?sort=trending&dir=asc` and
  // `&dir=desc` from each getting their own cache entry for identical
  // responses (every scored sort is desc-only).
  const cacheUrl = new URL(c.req.url);
  if (isScoredSort) {
    cacheUrl.searchParams.delete("dir");
  }
  if (status === "graduating") {
    // GRADUATING tab's ordering is fixed (curveFilled desc) — the sort
    // param is ignored regardless of value, so it shouldn't fragment
    // the cache.
    cacheUrl.searchParams.delete("sort");
    cacheUrl.searchParams.delete("dir");
  }
  if (status === "graduated" && !isScoredSort) {
    // GRADUATED with no explicit sort: keeps the default `graduatedAt
    // desc` ordering from Ponder, so `?sort=createdAt` / `?sort=name` /
    // missing-sort all hit the same cache entry. When a scored sort
    // (mcap / change24h / trending) IS supplied, we re-rank the
    // cohort by that key — keep `sort` in the key so each re-ranking
    // gets its own entry. See the GRADUATED branch below.
    cacheUrl.searchParams.delete("sort");
    cacheUrl.searchParams.delete("dir");
  }
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  // The {@link serveFromEdgeCache} middleware already handles the
  // canonical-key hit + stale-while-revalidate path before this route
  // is invoked. We retain a defensive primary-key lookup here for two
  // narrow cases:
  //   - SWR refresh self-fetches bypass the middleware to force a cold
  //     path. They MUST NOT short-circuit on the existing primary
  //     entry — otherwise the stale-fallback copy never gets rewritten
  //     and the SWR window collapses. The `isRevalidationRequest`
  //     guard skips this lookup on those requests.
  //   - A future caller that mounts the route without the middleware
  //     (e.g. internal RPC, mis-wired test app) still gets the basic
  //     caching behaviour.
  if (cache && !isRevalidationRequest(c)) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const db = createDb(c.env.DATABASE_URL);

  // ---------- Ponder-first path: status=graduated ----------
  //
  // Postgres' `status` column is never flipped by the API (the indexer is
  // the source of truth for graduation). Driving this tab off Ponder
  // keeps it accurate and keeps the ordering field (`graduatedAt`)
  // available without an extra join.
  if (status === "graduated") {
    const onchainPage = await fetchGraduatedTokensOnchain(
      c.env.DATABASE_URL,
      STATUS_POOL_SIZE,
      0,
    );

    if (onchainPage === null) {
      return c.json(formatError("Indexer unavailable"), 503);
    }

    if (onchainPage.length === 0) {
      const empty = c.json(formatSuccess([], "live"));
      empty.headers.set(
        "Cache-Control",
        edgeCacheableJsonHeader(LIST_CACHE_TTL_SECONDS),
      );
      if (cache) await putWithSwr(cache, cacheKey, empty);
      return empty;
    }

    // `tokens.address` is stored checksummed (see `create.ts` — we run
    // every insert through `getAddress`). Ponder returns addresses
    // lowercased. Checksum for the DB query, but keep the lowercased form
    // for map lookups below where we compare against Ponder strings.
    const checksummedAddresses = onchainPage.map((t) => getAddress(t.address));

    const excluded = excludedUnderlyingCondition();
    const dbRowsRaw = await tryApiDbRead(
      "api_db.tokens_list_graduated_hydrate",
      () =>
        db
          .select()
          .from(tokens)
          .where(
            and(
              eq(tokens.isHidden, false),
              inArray(tokens.address, checksummedAddresses),
              ...(excluded ? [excluded] : []),
            ),
          ),
      { addressCount: checksummedAddresses.length },
    );
    if (dbRowsRaw === null) {
      return c.json(formatError("Token metadata unavailable"), 503);
    }

    // Pull the live-LT snapshot in parallel with everything else above —
    // see `lib/lt-availability.ts`. We pass the rows through the filter
    // before pagination so `offset` / `limit` reference the visible slice
    // and we don't end up with short pages.
    const availability = await getLiveLtAvailability({
      databaseUrl: c.env.DATABASE_URL,
    }).catch(() => null);
    const liveFiltered = filterByLiveLt(dbRowsRaw, availability);

    const dbByAddress = new Map<string, DbToken>();
    for (const row of liveFiltered) {
      dbByAddress.set(row.address.toLowerCase(), row);
    }

    // Preserve Ponder's `graduatedAt desc` ordering and drop anything
    // hidden in the DB or not matching the user's filters.
    // `createdAfter` is enforced here (rather than in the SQL `where`)
    // because the Ponder-first path's row selection is driven by the
    // indexer page, not by a `tokens.createdAt` predicate — keeping the
    // filter in one place keeps semantics identical across branches.
    const createdAfterMs = createdAfter?.getTime();
    const orderedDbRows: DbToken[] = [];
    const orderedOnchain: PonderTokenOnchain[] = [];
    for (const onchain of onchainPage) {
      const addr = onchain.address.toLowerCase();
      const row = dbByAddress.get(addr);
      if (!row) continue;
      if (!matchesFilters(row, filters)) continue;
      if (
        createdAfterMs !== undefined &&
        row.createdAt.getTime() <= createdAfterMs
      ) {
        continue;
      }
      orderedDbRows.push(row);
      orderedOnchain.push(onchain);
    }

    if (orderedDbRows.length === 0) {
      const empty = c.json(formatSuccess([], "live"));
      empty.headers.set(
        "Cache-Control",
        edgeCacheableJsonHeader(LIST_CACHE_TTL_SECONDS),
      );
      if (cache) await putWithSwr(cache, cacheKey, empty);
      return empty;
    }

    // Pagination differs by sort. The default (`graduatedAt desc` from
    // Ponder) is what `orderedDbRows` already gives us, so we can
    // paginate *before* fetching market data — the cheap path. A scored
    // sort (mcap / change24h / trending) needs market data for the
    // whole filtered pool to compute the final ordering, because the
    // sort keys (mcap, change24h) are USD-denominated and come from
    // BounceTech, not Ponder — so we enrich the pool, sort, and
    // paginate at the end. Trades a wider BounceTech batch for honest
    // ordering across the visible page.
    const scoredSort = isScoredSort
      ? (sort as "trending" | "mcap" | "change24h")
      : null;

    const enrichInputDbRows = scoredSort
      ? orderedDbRows
      : orderedDbRows.slice(offset, offset + limit);
    const enrichInputOnchain = scoredSort
      ? orderedOnchain
      : orderedOnchain.slice(offset, offset + limit);

    // Reuse the already-resolved indexer tokens — saves a round-trip
    // compared to computeMarketDataForAddresses which re-fetches them.
    const marketResult = await buildBatchFromTokens(
      c.env.DATABASE_URL,
      c.env.BOUNCETECH_DATABASE_URL,
      enrichInputOnchain,
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
      for (const t of enrichInputOnchain) {
        onchainByAddress.set(t.address.toLowerCase(), t);
      }
    }

    const graduationThresholdUsd = await getGraduationThresholdUsd(c.env);
    let enriched = enrichInputDbRows.map((t) =>
      enrich(
        t,
        onchainByAddress.get(t.address.toLowerCase()),
        marketByAddress.get(t.address.toLowerCase()),
        graduationThresholdUsd,
      ),
    );

    if (scoredSort) {
      // Re-rank the full enriched pool by the selected key and paginate
      // at the end. Accessors mirror the trending branch's logic — see
      // `buildScoredComparator` for tie-break + null handling notes.
      // `volume24hOf` falls back to `volume24hUsd ?? 0` (no trending
      // candidate map on this branch — we didn't fetch one), which is
      // the right thing for graduated tokens: `volume24hUsd` here is
      // post-graduation Zap volume, fully comparable to the
      // pre-graduation candidate-map values used on the trending tab.
      const volume24hOf = (t: EnrichedToken) => t.volume24hUsd ?? 0;
      const mcapOf = (t: EnrichedToken) => t.mcapUsd ?? 0;
      enriched = [...enriched]
        .sort(buildScoredComparator(scoredSort, volume24hOf, mcapOf))
        .slice(offset, offset + limit);
    }

    const response = c.json(
      formatSuccess(enriched, marketResult.ok ? "live" : "degraded"),
    );
    const ttl = marketResult.ok
      ? LIST_CACHE_TTL_SECONDS
      : DEGRADED_CACHE_TTL_SECONDS;
    response.headers.set("Cache-Control", edgeCacheableJsonHeader(ttl));
    if (cache) await putWithSwr(cache, cacheKey, response);
    return response;
  }

  // ---------- Ponder-first path: status=graduating ----------
  //
  // The GRADUATING tab is a *progress* surface — it lists every
  // non-graduated token whose enriched `curveFilled` is
  // `≥ GRADUATING_TAB_MIN_CURVE_FILLED`, sorted by `curveFilled desc`.
  // Distinct from the per-token `status === "graduating"` field, which
  // marks the contract-frozen phase-1 window and continues to drive the
  // GRADUATING pill + trade-panel overlay regardless of this tab's
  // filter. See `lib/market-data.ts` and `lib/token-enrich.ts` for the
  // rationale.
  //
  // We can't push the threshold gate or the curveFilled sort into the Ponder
  // query because `curveFilled` is USD-denominated (`realLt × rate /
  // threshold × 100`) and depends on the BounceTech LT exchange rate,
  // which Ponder doesn't have. We instead fetch a bounded pool ordered
  // by `curveSupply asc` (closest-to-sold-out first; strong proxy for
  // high curveFilled — see `fetchNonGraduatedTokensOnchain`), enrich the
  // pool to recover the real `curveFilled` per token, then filter +
  // sort + paginate in memory.
  if (status === "graduating") {
    const onchainPage = await fetchNonGraduatedTokensOnchain(
      c.env.DATABASE_URL,
      STATUS_POOL_SIZE,
      0,
    );

    if (onchainPage === null) {
      return c.json(formatError("Indexer unavailable"), 503);
    }

    if (onchainPage.length === 0) {
      const empty = c.json(formatSuccess([], "live"));
      empty.headers.set(
        "Cache-Control",
        edgeCacheableJsonHeader(LIST_CACHE_TTL_SECONDS),
      );
      if (cache) await putWithSwr(cache, cacheKey, empty);
      return empty;
    }

    // `tokens.address` is stored checksummed (see `create.ts` — we run
    // every insert through `getAddress`). Ponder returns addresses
    // lowercased. Checksum for the DB query, but keep the lowercased form
    // for map lookups below where we compare against Ponder strings.
    const checksummedAddresses = onchainPage.map((t) => getAddress(t.address));

    const excluded = excludedUnderlyingCondition();
    const dbRowsRaw = await tryApiDbRead(
      "api_db.tokens_list_graduating_hydrate",
      () =>
        db
          .select()
          .from(tokens)
          .where(
            and(
              eq(tokens.isHidden, false),
              inArray(tokens.address, checksummedAddresses),
              ...(excluded ? [excluded] : []),
            ),
          ),
      { addressCount: checksummedAddresses.length },
    );
    if (dbRowsRaw === null) {
      return c.json(formatError("Token metadata unavailable"), 503);
    }

    const availability = await getLiveLtAvailability({
      databaseUrl: c.env.DATABASE_URL,
    }).catch(() => null);
    const liveFiltered = filterByLiveLt(dbRowsRaw, availability);

    const dbByAddress = new Map<string, DbToken>();
    for (const row of liveFiltered) {
      dbByAddress.set(row.address.toLowerCase(), row);
    }

    // Match each Ponder candidate against its DB row, dropping anything
    // hidden or filtered out by the user's `underlying` / `direction` /
    // etc. clauses. We hold on to both the DB row AND the Ponder row
    // because `buildBatchFromTokens` below needs the already-fetched
    // onchain set to avoid a redundant Ponder round-trip.
    //
    // `createdAfter` is enforced in this in-memory loop (rather than in
    // the SQL `where` above) for the same reason the graduated branch
    // does it: row selection is driven by the indexer page, not by a
    // `tokens.createdAt` predicate, so keeping the filter co-located
    // with the other in-memory rejects (`matchesFilters`) makes the
    // semantics symmetric across both Ponder-first branches.
    const graduatingCreatedAfterMs = createdAfter?.getTime();
    const candidatesDb: DbToken[] = [];
    const candidatesOnchain: PonderTokenOnchain[] = [];
    for (const onchain of onchainPage) {
      const addr = onchain.address.toLowerCase();
      const row = dbByAddress.get(addr);
      if (!row) continue;
      if (!matchesFilters(row, filters)) continue;
      if (
        graduatingCreatedAfterMs !== undefined &&
        row.createdAt.getTime() <= graduatingCreatedAfterMs
      ) {
        continue;
      }
      candidatesDb.push(row);
      candidatesOnchain.push(onchain);
    }

    if (candidatesDb.length === 0) {
      const empty = c.json(formatSuccess([], "live"));
      empty.headers.set(
        "Cache-Control",
        edgeCacheableJsonHeader(LIST_CACHE_TTL_SECONDS),
      );
      if (cache) await putWithSwr(cache, cacheKey, empty);
      return empty;
    }

    // Resolve market data for the *full* candidate pool — not just the
    // paginated slice. We need every candidate's `curveFilled` to
    // evaluate the threshold gate and the `curveFilled desc` sort *before*
    // applying `offset` / `limit`, otherwise pagination would reference
    // unfiltered positions and produce short / wrong pages. The pool is
    // capped at `STATUS_POOL_SIZE`, matching the per-request work budget
    // the trending-sort path already shoulders.
    const marketResult = await buildBatchFromTokens(
      c.env.DATABASE_URL,
      c.env.BOUNCETECH_DATABASE_URL,
      candidatesOnchain,
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
      // Degraded: enrich without market data. `curveFilled` falls back
      // to supplyFilled (driven purely by `curveSupply`), which is still
      // enough to evaluate the threshold gate for the overwhelming majority of
      // tokens (USD progress lags supply progress at typical LT-rate
      // ranges — see `computeCurveFilledBreakdown` docstring). Better
      // than blanking the tab while BounceTech is down.
      for (const t of candidatesOnchain) {
        onchainByAddress.set(t.address.toLowerCase(), t);
      }
    }

    const graduationThresholdUsd = await getGraduationThresholdUsd(c.env);
    const enrichedAll = candidatesDb.map((t) =>
      enrich(
        t,
        onchainByAddress.get(t.address.toLowerCase()),
        marketByAddress.get(t.address.toLowerCase()),
        graduationThresholdUsd,
      ),
    );

    // Gate + sort. `graduated` is double-checked here defensively — the
    // Ponder query already filtered on `graduated: false`, but a token
    // whose `Bonding:TokenGraduated` event landed between the Ponder
    // fetch and the enrich (or whose `enrich` short-circuited
    // `curveFilled` to 100 via the graduated branch of
    // `computeCurveFilledBreakdown`) should never leak into this tab.
    const gated = enrichedAll.filter(
      (t) =>
        !t.graduated &&
        t.curveFilled !== null &&
        t.curveFilled >= GRADUATING_TAB_MIN_CURVE_FILLED,
    );

    // Primary: curveFilled desc. Tie-break: mcap desc (treats
    // unknown/null as 0 so quiet tokens don't leapfrog priced ones on
    // ties) — matches the trending sort's tie-break choice for
    // consistency across in-memory-sorted tabs.
    gated.sort((a, b) => {
      const aFilled = a.curveFilled ?? 0;
      const bFilled = b.curveFilled ?? 0;
      if (bFilled !== aFilled) return bFilled - aFilled;
      return (b.mcapUsd ?? 0) - (a.mcapUsd ?? 0);
    });

    const paged = gated.slice(offset, offset + limit);

    const response = c.json(
      formatSuccess(paged, marketResult.ok ? "live" : "degraded"),
    );
    const ttl = marketResult.ok
      ? LIST_CACHE_TTL_SECONDS
      : DEGRADED_CACHE_TTL_SECONDS;
    response.headers.set("Cache-Control", edgeCacheableJsonHeader(ttl));
    if (cache) await putWithSwr(cache, cacheKey, response);
    return response;
  }

  // ---------- DB-first path: everything else ----------

  // Pull the live-LT availability snapshot before building the SQL — when
  // it's fresh we push an `lt_pair IN (...)` filter into the WHERE clause
  // (directory-membership only — see the `filterByLiveLt` JSDoc) so
  // pagination math (`LIMIT`/`OFFSET`) lines up with the visible window.
  // Doing this in memory after the DB query would produce short pages
  // whenever a slice contained any LT that BounceTech retired. See
  // `lib/lt-availability.ts` for the cache + HEAD-check semantics and the
  // fail-open rationale.
  const availability = await getLiveLtAvailability({
    databaseUrl: c.env.DATABASE_URL,
  }).catch(() => null);

  const conditions: SQL[] = [eq(tokens.isHidden, false)];
  // Hide retired markets (issue #639) from every DB-first response.
  // Pushed before the user-supplied `underlying` clause so an explicit
  // `?underlying=PAXG` request returns an empty page instead of leaking
  // a market we've hard-coded out of the UI.
  const excludedUnderlying = excludedUnderlyingCondition();
  if (excludedUnderlying) conditions.push(excludedUnderlying);
  if (underlying) conditions.push(eq(tokens.underlying, underlying));
  if (status === "curve") conditions.push(eq(tokens.status, "curve"));
  if (direction) conditions.push(eq(tokens.ltDirection, direction));
  if (leverage !== undefined) conditions.push(eq(tokens.leverage, leverage));
  if (creator) conditions.push(eq(tokens.creator, creator));
  if (createdAfter) conditions.push(gt(tokens.createdAt, createdAfter));
  if (
    availability &&
    availability.fresh &&
    availability.directoryAddresses.size > 0
  ) {
    // `tokens.ltPair` is stored checksummed (see `lib/token-registration.ts`,
    // which runs every insert through `getAddress`). The directory snapshot
    // is lowercased — checksum each entry (via `isAddress` guard, so a
    // malformed BounceTech entry can't throw out of `getAddress` and 500
    // the response) for the SQL `IN (...)` comparison. Listing uses
    // `directoryAddresses` (rather than the stricter `liveAddresses`) so
    // a token whose LT is provisioned at BounceTech but hasn't yet had its
    // logo PNG published doesn't disappear from /tokens — see the comment
    // thread on this hook in `filterByLiveLt`. Only push the clause when
    // there's at least one valid address left: drizzle's `inArray()` won't
    // accept an empty array (Postgres `NOT IN ()` is a syntax error and the
    // empty `IN ()` would just be dead weight on the planner).
    const checksummedDirectory = checksumDirectoryAddresses(
      availability.directoryAddresses,
    );
    if (checksummedDirectory.length > 0) {
      conditions.push(inArray(tokens.ltPair, checksummedDirectory));
    }
  }

  const sortColumn =
    sort === "leverage"
      ? tokens.leverage
      : sort === "name"
        ? tokens.name
        : tokens.createdAt;

  // Scored sorts (trending / mcap / change24h) all use the same
  // candidate pool — rolling 24h gross USDC volume desc, top‑N from
  // `token_hourly_metrics`. Two-stage flow:
  //
  //   1. Sum the `token_hourly_metrics` buckets over the last 24h per
  //      token, `ORDER BY SUM(volume_usd) DESC LIMIT POOL`. The ranking
  //      IS the candidate list — no per-request re-score, no precomputed
  //      score column, no boost system. Anti-spam by construction: a
  //      token nobody trades simply has no rows in the window and so
  //      never appears in the ranking.
  //   2. Hydrate the matching rows from Postgres with the user's filters
  //      applied (`status`, `underlying`, `direction`, etc.). The user's
  //      selected sort decides the *final ordering* over the pool (see
  //      the comparator block far below) — but the pool itself is
  //      always volume-driven. So `sort=mcap` means "top mcap among
  //      tokens that traded in the last 24h", NOT "top mcap globally"
  //      (the latter would lose the anti-spam property and surface
  //      stale tokens no one is engaging with). Same logic for
  //      `change24h`.
  //
  // Failure mode: if the indexer is unreachable we fall back to a
  // createdAt-DESC slice so the tab keeps rendering. Tagged `dataSource:
  // "degraded"` below; the brief loss of volume ordering is preferable
  // to a 503 on the home-page tab.
  let trendingDegraded = false;
  // Map from lowercased address → 24h volume (USD). Populated for the
  // happy path so the final sort can use the same numbers the candidate
  // query ranked on — keeps the API-visible ordering an exact mirror of
  // the SQL `ORDER BY` (and means the response never re-disagrees with
  // itself if a few of the hydrated `volume24hUsd` values come back null
  // due to a transient indexer aggregation failure on the second query).
  let trendingVolumeByAddress: Map<string, number> | null = null;
  let dbTokens: DbToken[];
  if (isScoredSort) {
    const nowSecForCandidates = Math.floor(Date.now() / 1000);
    // Round down to the current hour-start before subtracting the
    // window so we always include at least 24 full buckets — same
    // semantics as `fetchPlatformStats`. The extra (current) hour
    // guarantees the window is ≥24h regardless of where in the hour
    // the request lands.
    const currentHourStart =
      Math.floor(nowSecForCandidates / SECONDS_PER_HOUR) * SECONDS_PER_HOUR;
    const cutoffHourStart = currentHourStart - TRENDING_WINDOW_SEC;
    const candidates = await fetchTrendingCandidatesByVolume(
      c.env.DATABASE_URL,
      TRENDING_POOL_SIZE,
      cutoffHourStart,
    );
    if (candidates !== null) {
      if (candidates.length === 0) {
        // Indexer is up but no tokens have traded in the last 24h —
        // legitimately-empty trending tab. Skip the DB roundtrip.
        dbTokens = [];
        trendingVolumeByAddress = new Map();
      } else {
        // `tokens.address` is stored checksummed (`getAddress(...)` at
        // insert time in `lib/token-registration.ts`); the indexer
        // returns lowercased — checksum each for the SQL `IN (...)`.
        const checksummed = candidates.map((c) => getAddress(c.tokenAddress));
        const filteredRows = await tryApiDbRead(
          "api_db.tokens_list_trending_hydrate",
          () =>
            db
              .select()
              .from(tokens)
              .where(and(...conditions, inArray(tokens.address, checksummed))),
          { candidateCount: checksummed.length, sort },
        );
        if (filteredRows === null) {
          return c.json(formatError("Token metadata unavailable"), 503);
        }
        trendingVolumeByAddress = new Map(
          candidates.map((c) => [c.tokenAddress, c.volume24hUsd]),
        );
        // For `sort=trending` we can paginate BEFORE market-data
        // enrichment: candidates come back sorted `SUM(volume_usd)
        // DESC, token_address ASC` from the indexer, so reordering
        // filter-passing rows to match that order and slicing the
        // `[offset, offset+limit]` window upfront caps the downstream
        // `computeMarketDataForAddresses` call (and its BounceTech
        // LATERAL scans) at page-size instead of the full
        // `TRENDING_POOL_SIZE` — the dominant cost on cold cache.
        //
        // `sort=mcap` / `sort=change24h` re-rank the same volume-
        // ordered pool by a key that isn't known until enrichment, so
        // they MUST keep the full pool through enrichment and slice
        // after the comparator runs — otherwise the highest-mcap
        // token in the pool can fall outside the volume-ordered slice
        // and never reach the page.
        const rowsByAddr = new Map(
          filteredRows.map((r) => [r.address.toLowerCase(), r]),
        );
        const orderedByVolume: DbToken[] = [];
        for (const cand of candidates) {
          const row = rowsByAddr.get(cand.tokenAddress);
          if (row) orderedByVolume.push(row);
        }
        dbTokens =
          sort === "trending"
            ? orderedByVolume.slice(offset, offset + limit)
            : orderedByVolume;
      }
    } else {
      // Indexer down — fall back to the legacy createdAt-DESC pool so
      // the tab keeps rendering. Tagged `dataSource: "degraded"` below;
      // the brief loss of volume ordering is preferable to a 503.
      //
      // For `sort=trending` the in-memory comparator can only re-rank
      // by row-local `volume24hUsd`, which is the same axis SQL would
      // sort on — so we push pagination into SQL and skip the
      // post-enrich slice (matches the live trending path; prevents
      // an oversized page from leaking under outage — CodeRabbit on
      // PR #995). For mcap / change24h we need the full pool in
      // memory so the comparator can pick the true top-N by the
      // requested key before the post-enrich slice paginates.
      trendingDegraded = true;
      if (sort === "trending") {
        const fallbackRows = await tryApiDbRead(
          "api_db.tokens_list_trending_fallback_page",
          () =>
            db
              .select()
              .from(tokens)
              .where(and(...conditions))
              .orderBy(desc(tokens.createdAt))
              .limit(limit)
              .offset(offset),
          { limit, offset, sort },
        );
        if (fallbackRows === null) {
          return c.json(formatError("Token metadata unavailable"), 503);
        }
        dbTokens = fallbackRows;
      } else {
        const fallbackPool = await tryApiDbRead(
          "api_db.tokens_list_trending_fallback_pool",
          () =>
            db
              .select()
              .from(tokens)
              .where(and(...conditions))
              .orderBy(desc(tokens.createdAt))
              .limit(TRENDING_POOL_SIZE),
          { poolSize: TRENDING_POOL_SIZE, sort },
        );
        if (fallbackPool === null) {
          return c.json(formatError("Token metadata unavailable"), 503);
        }
        dbTokens = fallbackPool;
      }
    }
  } else {
    const pageRows = await tryApiDbRead(
      "api_db.tokens_list_default",
      () =>
        db
          .select()
          .from(tokens)
          .where(and(...conditions))
          .orderBy(dir(sortColumn))
          .limit(limit)
          .offset(offset),
      { limit, offset, sort, status: status ?? null },
    );
    if (pageRows === null) {
      return c.json(formatError("Token metadata unavailable"), 503);
    }
    dbTokens = pageRows;
  }

  if (dbTokens.length === 0) {
    // `trendingDegraded` propagates through the empty-rows short-circuit
    // so a trending tab that's empty *because the candidate query
    // failed* (indexer down → createdAt-DESC fallback returned no
    // hidden/excluded rows) is still tagged `dataSource: "degraded"` and
    // gets the shorter cache TTL. Without this guard the response would
    // claim `"live"` and the edge would cache the wrong status for a
    // full `LIST_CACHE_TTL_SECONDS` window. CodeRabbit feedback on
    // PR #946.
    const emptyIsLive = !trendingDegraded;
    const empty = c.json(formatSuccess([], emptyIsLive ? "live" : "degraded"));
    const emptyTtl = emptyIsLive
      ? LIST_CACHE_TTL_SECONDS
      : DEGRADED_CACHE_TTL_SECONDS;
    empty.headers.set("Cache-Control", edgeCacheableJsonHeader(emptyTtl));
    if (cache) {
      await putWithSwr(cache, cacheKey, empty);
    }
    return empty;
  }

  // Only fetch market data for the addresses we'll consider, not the whole
  // catalogue. Page size for a non-scored sort caps per-request work at
  // `limit` (≤100); scored sorts cap at `TRENDING_POOL_SIZE`.
  const marketResult = await computeMarketDataForAddresses(
    c.env.DATABASE_URL,
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

  const graduationThresholdUsd = await getGraduationThresholdUsd(c.env);
  let enriched = dbTokens.map((t) =>
    enrich(
      t,
      onchainByAddress.get(t.address.toLowerCase()),
      marketByAddress.get(t.address.toLowerCase()),
      graduationThresholdUsd,
    ),
  );

  if (isScoredSort) {
    // Final ordering over the trending candidate pool, picked by the
    // user's selected `sort`. The pool itself (top‑N by 24h gross
    // USDC volume) is the same for every scored sort — see the
    // candidate-pool comment further up. This block decides what to
    // re-rank the hydrated rows by.
    //
    // `volume24hOf` reads from the same `SUM(volume_usd)` the
    // candidate query ranked on (`trendingVolumeByAddress`) so the
    // ordering for `sort=trending` is an exact mirror of the SQL.
    // Falls back to the row's own `volume24hUsd` when the candidate
    // map is unavailable — that's the `trendingDegraded` createdAt-
    // DESC fallback path, where preserving *some* volume signal is
    // still better than arbitrary `createdAt` order.
    //
    // Tie-breaks (per sort):
    //   - trending / change24h → mcap desc
    //   - mcap → 24h volume desc (equal-mcap rows surface the more-
    //     active token first)
    // For `sort=trending`, `dbTokens` was already sliced to the page
    // upstream (volume-ordered), so the comparator's mcap tie-break
    // only reshuffles ties *within the page* — the post-sort slice
    // below is skipped to avoid double-paginating. For mcap /
    // change24h the pool is still 500 tokens here and the comparator
    // picks the true top-N before the post-sort slice paginates.
    const volume24hOf = (t: EnrichedToken): number => {
      const addr = t.address.toLowerCase();
      const mapped = trendingVolumeByAddress?.get(addr);
      if (mapped !== undefined) return mapped;
      return t.volume24hUsd ?? 0;
    };
    const mcapOf = (t: EnrichedToken) => t.mcapUsd ?? 0;
    const sorted = [...enriched].sort(
      buildScoredComparator(sort, volume24hOf, mcapOf),
    );
    enriched =
      sort === "trending" ? sorted : sorted.slice(offset, offset + limit);
  }

  const isLive = marketResult.ok && !trendingDegraded;
  const response = c.json(
    formatSuccess(enriched, isLive ? "live" : "degraded"),
  );
  const ttl = isLive ? LIST_CACHE_TTL_SECONDS : DEGRADED_CACHE_TTL_SECONDS;
  response.headers.set("Cache-Control", edgeCacheableJsonHeader(ttl));
  if (cache) {
    await putWithSwr(cache, cacheKey, response);
  }
  return response;
});

listRoute.get("/search", async (c) => {
  const q = c.req.query("q")?.trim();
  if (!q) {
    return c.json(formatSuccess([]));
  }

  // Address column is only matched when the query *looks* like an address
  // fragment — i.e. the user has typed/pasted a `0x`-prefixed string (any
  // non-empty hex tail counts; users routinely paste just a prefix). The
  // previous implementation substring-matched the address for every query,
  // which made even single-character searches like `1` return the full
  // catalogue: virtually every EVM address contains the digit `1`
  // somewhere in its 40-char hex body. Restricting address matches to the
  // `0x` prefix mirrors the explorer/DEX-search convention and eliminates
  // the "search box is broken" UX regression (issue #528).
  const isAddressQuery = /^0x[0-9a-f]*$/i.test(q);
  const conditions = [
    ilike(tokens.name, `%${q}%`),
    ilike(tokens.ticker, `%${q}%`),
  ];
  if (isAddressQuery) {
    // Prefix match (not substring) — a paste of `0xabc…` should locate the
    // address that *starts* with those bytes, not any address that happens
    // to contain that substring further along.
    conditions.push(ilike(tokens.address, `${q}%`));
  }

  // Mirror the listing endpoint's directory-membership filter — search
  // results otherwise leak tokens whose backing LT BounceTech has retired
  // (originally issue #621; relaxed from logo-presence to directory
  // membership so creator-launched tokens stay searchable while
  // BounceTech catches up on logo uploads — see `filterByLiveLt` JSDoc).
  // Fail-open on degraded availability for the same reason as the list
  // path, and skip the clause entirely if `checksumDirectoryAddresses`
  // filtered every entry out (malformed directory payload) so a 500 from
  // `inArray([])` / `getAddress("not-an-address")` can't take down search.
  const availability = await getLiveLtAvailability({
    databaseUrl: c.env.DATABASE_URL,
  }).catch(() => null);
  const checksummedDirectory =
    availability &&
    availability.fresh &&
    availability.directoryAddresses.size > 0
      ? checksumDirectoryAddresses(availability.directoryAddresses)
      : [];
  const liveLtFilter: SQL | undefined =
    checksummedDirectory.length > 0
      ? inArray(tokens.ltPair, checksummedDirectory)
      : undefined;

  // Same `EXCLUDED_UNDERLYING_ASSETS` filter as the list path (issue
  // #639): if we hid a market from the home feed, the search box must
  // hide it too — otherwise users still find PAXG tokens via the
  // suggestion list. `undefined` when nothing is excluded so the
  // generated WHERE stays minimal.
  const excludedUnderlying = excludedUnderlyingCondition();

  const db = createDb(c.env.DATABASE_URL);
  const results = await tryApiDbRead(
    "api_db.tokens_search",
    () =>
      db
        .select()
        .from(tokens)
        .where(
          and(
            eq(tokens.isHidden, false),
            or(...conditions),
            liveLtFilter,
            excludedUnderlying,
          ),
        )
        .limit(20),
    { isAddressQuery, queryLength: q.length },
  );

  if (results === null) {
    return c.json(formatError("Token metadata unavailable"), 503);
  }

  return c.json(formatSuccess(results));
});

export default listRoute;

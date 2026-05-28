import { sql } from "drizzle-orm";

import { describeError } from "./log-error.js";

import type { Database } from "../db/client.js";

/**
 * Read helpers backing the analytics dashboards mounted at
 * `/api/v1/analytics/*`. Mirrors the convention of `indexer-reads.ts`
 * — every helper returns `null` on caught error so the route handler can
 * fan a single null check into a 503, never partially succeeds, and logs
 * a structured event so Cloudflare tail / Logpush can pivot on it.
 *
 * All aggregations are **read-only over existing indexer tables** —
 * `ponder_views.router_trade`, `ponder_views.fee_accrual`,
 * `ponder_views.hourly_volume`, `ponder_views.token`,
 * `ponder_views.graduation`, plus the API-owned `public.tokens`. No
 * indexer-side schema changes ship with these endpoints (issue: keeps
 * the indexer hot path frozen while we surface business-insight data).
 *
 * Time-bucketing convention: every "bucket size" is expressed as a
 * `bucketSec` argument (e.g. `86_400` for daily, `3_600` for hourly,
 * `604_800` for weekly) and Postgres floors trade timestamps to that
 * bucket via `floor(timestamp / bucket) * bucket`. Epoch second 0 is
 * UTC midnight, so daily buckets align to UTC days; weekly buckets
 * align to Thursday-start weeks (epoch 0 was Thursday Jan 1 1970)
 * which we document on the route surface rather than try to fix in
 * SQL — admins reading weekly charts will see consistent week
 * boundaries regardless of where in the week they query.
 *
 * **`timestamp` casts in `WHERE` clauses defeat the index** —
 * `ponder_views.router_trade.timestamp` is `numeric(78,0)` and is
 * indexed by `router_trade_timestamp_index`. Writing
 * `WHERE timestamp::bigint >= $cutoff` casts the indexed column into
 * a function call, which forces Postgres to fall back to a parallel
 * seq scan with `Filter:` instead of an index range scan with
 * `Index Cond:`. For a selective 24h window that's ~40× slower
 * (24 ms vs 0.6 ms in `EXPLAIN ANALYZE`). Always compare bare —
 * `WHERE timestamp >= $cutoff` — and let Postgres implicit-cast the
 * integer parameter to numeric. The `FLOOR(timestamp::bigint /
 * $bucket)` bucket expression in the projection is fine to keep:
 * casts in `SELECT` don't affect index selection, only casts in
 * `WHERE`/`JOIN` predicates do. PR #1168 perf review.
 *
 * **`fee_accrual.timestamp` is indexed.** Mirrors the equivalent
 * `routerTrade.timestampIdx` so the windowed revenue queries
 * (`fetchRevenueBuckets`, `fetchWindowedFees`) hit
 * `Index Scan` with `Index Cond:` instead of seq-scanning the full
 * ~250K-row table — keeps selective cutoffs sub-ms. Added in the
 * same PR after a perf review against the live read replica
 * (`apps/indexer/ponder.schema.ts → feeAccrual.timestampIdx`).
 *
 * **Three perf follow-ups tracked as issues, not blocking:**
 *
 *   - #1171 — lowercase `public.tokens.address` at write time so the
 *     `LOWER(t.address)` hash join in `fetchBreakdown` / `fetchTopTokens`
 *     can use the equality index. ~1.5 ms today at 6.4K rows; becomes
 *     dominant past ~50K.
 *   - #1172 — `SET LOCAL work_mem = '64MB'` for the 30d bucket queries
 *     to avoid disk-spill sorts (~200 ms cold vs ~80 ms in-memory).
 *     Absorbed by the edge cache today; only matters if polling cadence
 *     exceeds the cache TTL.
 *   - #1173 — daily pre-aggregate tables mirroring `hourly_volume` for
 *     the daily/weekly chart queries. Long-term shape; makes the
 *     `work_mem` and `LOWER(...)` items moot.
 *
 * Amounts are USDC 6dp throughout. Helpers return raw decimal strings
 * (never JS numbers) so callers can decide whether to format as USD
 * float (`usdcRawToUsd`) or pass through verbatim.
 */

/** Floored 30s bucket size for trailing-24h window cutoffs. */
const TRAILING_24H_BUCKET_SEC = 30;

/**
 * Strip Drizzle's `Failed query: <SQL>\nparams: <values>` decoration so
 * the `error.message` log field stays grep-able. Mirrors the equivalent
 * sanitiser in `indexer-reads.ts` — see that module's docstring for the
 * full rationale (issue #974).
 */
function stripQueryBloat(message: string): string {
  return message.split("\n", 1)[0];
}

function logAnalyticsReadFailure(
  event: string,
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  console.log(
    JSON.stringify({
      ...context,
      level: "error",
      event,
      error: describeError(error, stripQueryBloat),
      timestamp: new Date().toISOString(),
    }),
  );
}

/**
 * Bucket size for the trailing-24h cutoff parameter used by the
 * snapshot windows below. Same rationale as
 * `quantizeTrailing24hCutoffSec` in `indexer-reads.ts`: floor to a
 * 30s bucket so the Postgres prepared-plan cache reuses across the
 * window. Admin dashboards aren't on the hot path, but the SQL is
 * identical and the cost of locking the plan is zero.
 */
export function quantizeWindowCutoff(nowSec: number, windowSec: number): number {
  const raw = nowSec - windowSec;
  return Math.floor(raw / TRAILING_24H_BUCKET_SEC) * TRAILING_24H_BUCKET_SEC;
}

// ---------------------------------------------------------------------------
// Bucketed time series — volume, fees, net inflow, active users, graduations.
// ---------------------------------------------------------------------------

export interface VolumeBucketRow {
  /** Unix seconds at the bucket start. */
  bucket: number;
  /** Raw USDC 6dp summed across this bucket. */
  volumeUsdcRaw: string;
}

/**
 * Platform-wide trading volume bucketed by `bucketSec` (USDC 6dp).
 * Reads from `ponder_views.hourly_volume` when `bucketSec >= 3600`
 * (the indexer's source-of-truth pre-aggregation, capped at ~25 rows
 * per day) and falls back to `router_trade` for sub-hour bucketing
 * (admin dashboards rarely need this, but the surface is uniform).
 *
 * The two sources are guaranteed consistent by the indexer — every
 * `Zap.Buy` / `Zap.Sell` bumps both `hourly_volume` and writes the
 * underlying `router_trade` row in the same handler, so summing
 * either yields the same total.
 */
export async function fetchVolumeBuckets(
  db: Database,
  opts: { bucketSec: number; sinceSec: number },
): Promise<VolumeBucketRow[] | null> {
  const { bucketSec, sinceSec } = opts;
  try {
    if (bucketSec >= 3600) {
      const result = await db.execute(sql`
        SELECT
          (FLOOR(hour_start::bigint / ${bucketSec}) * ${bucketSec})::text AS bucket,
          SUM(volume_usd)::text AS volume_usd
        FROM ponder_views.hourly_volume
        WHERE hour_start::bigint >= ${sinceSec}
        GROUP BY bucket
        ORDER BY bucket ASC
      `);
      const rows = result.rows as unknown as Array<{
        bucket: string;
        volume_usd: string;
      }>;
      return rows.map((r) => ({
        bucket: Number(r.bucket),
        volumeUsdcRaw: r.volume_usd ?? "0",
      }));
    }

    const result = await db.execute(sql`
      SELECT
        (FLOOR(timestamp::bigint / ${bucketSec}) * ${bucketSec})::text AS bucket,
        SUM(usdc_amount)::text AS volume_usd
      FROM ponder_views.router_trade
      WHERE timestamp >= ${sinceSec}
      GROUP BY bucket
      ORDER BY bucket ASC
    `);
    const rows = result.rows as unknown as Array<{
      bucket: string;
      volume_usd: string;
    }>;
    return rows.map((r) => ({
      bucket: Number(r.bucket),
      volumeUsdcRaw: r.volume_usd ?? "0",
    }));
  } catch (error) {
    logAnalyticsReadFailure("analytics.fetchVolumeBuckets_failed", error, {
      bucketSec,
      sinceSec,
    });
    return null;
  }
}

export interface RevenueBucketRow {
  bucket: number;
  /** Sum of protocol-side USDC fees in this bucket (6dp). */
  protocolFeesUsdcRaw: string;
  /** Sum of creator-side USDC fees in this bucket (6dp). */
  creatorFeesUsdcRaw: string;
  /** Number of fee accruals contributing to this bucket. */
  feeEvents: number;
}

/**
 * Per-bucket revenue, split by recipient. Sourced from
 * `ponder_views.fee_accrual` which is the canonical per-event log
 * (every router buy/sell + every seed buy emits a `FeeAccrued`).
 *
 * Both columns are USDC 6dp. `protocolFees` is the figure the dashboard
 * cares about for "company revenue"; `creatorFees` is the symmetric
 * payout that goes to token creators (~0.25% of trade notional vs the
 * protocol's ~0.5%). See `packages/contracts/script/Deploy.s.sol` for
 * the bps split.
 */
export async function fetchRevenueBuckets(
  db: Database,
  opts: { bucketSec: number; sinceSec: number },
): Promise<RevenueBucketRow[] | null> {
  const { bucketSec, sinceSec } = opts;
  try {
    const result = await db.execute(sql`
      SELECT
        (FLOOR(timestamp::bigint / ${bucketSec}) * ${bucketSec})::text AS bucket,
        SUM(protocol_amount)::text AS protocol_amount,
        SUM(creator_amount)::text AS creator_amount,
        COUNT(*)::int AS fee_events
      FROM ponder_views.fee_accrual
      WHERE timestamp >= ${sinceSec}
      GROUP BY bucket
      ORDER BY bucket ASC
    `);
    const rows = result.rows as unknown as Array<{
      bucket: string;
      protocol_amount: string;
      creator_amount: string;
      fee_events: number;
    }>;
    return rows.map((r) => ({
      bucket: Number(r.bucket),
      protocolFeesUsdcRaw: r.protocol_amount ?? "0",
      creatorFeesUsdcRaw: r.creator_amount ?? "0",
      feeEvents: Number(r.fee_events ?? 0),
    }));
  } catch (error) {
    logAnalyticsReadFailure("analytics.fetchRevenueBuckets_failed", error, {
      bucketSec,
      sinceSec,
    });
    return null;
  }
}

export interface NetInflowBucketRow {
  bucket: number;
  /** Net USDC flowed in this bucket (buys minus sells, can be negative), 6dp. */
  netInflowUsdcRaw: string;
  /** Gross USDC traded in this bucket (buys + sells), 6dp. */
  grossVolumeUsdcRaw: string;
}

/**
 * Per-bucket net USDC inflow — `sum(buy_usdc) − sum(sell_usdc)`. Unlike
 * `token.organicUsdcRaised` (per-token floor at 0), this is unfloored
 * and can go negative inside a bucket. Used to build the "value in
 * system over time" chart where summing the deltas plus a baseline
 * gives the cumulative liquid USDC stored across all tokens.
 *
 * Excludes virtual reserves by construction — we only count real
 * USDC that traversed the Zap router (per the user spec: "negate the
 * virtual reserves… newly created coins have a market cap of `$3K`").
 * A freshly-launched token with no trades after the seed buy
 * contributes exactly the seed-buy USDC, not the synthetic ~`$3K`
 * mcap, because that's all that's in `router_trade`.
 */
export async function fetchNetInflowBuckets(
  db: Database,
  opts: { bucketSec: number; sinceSec: number },
): Promise<NetInflowBucketRow[] | null> {
  const { bucketSec, sinceSec } = opts;
  try {
    const result = await db.execute(sql`
      SELECT
        (FLOOR(timestamp::bigint / ${bucketSec}) * ${bucketSec})::text AS bucket,
        SUM(CASE WHEN is_buy THEN usdc_amount ELSE -usdc_amount END)::text AS net_inflow,
        SUM(usdc_amount)::text AS gross_volume
      FROM ponder_views.router_trade
      WHERE timestamp >= ${sinceSec}
      GROUP BY bucket
      ORDER BY bucket ASC
    `);
    const rows = result.rows as unknown as Array<{
      bucket: string;
      net_inflow: string;
      gross_volume: string;
    }>;
    return rows.map((r) => ({
      bucket: Number(r.bucket),
      netInflowUsdcRaw: r.net_inflow ?? "0",
      grossVolumeUsdcRaw: r.gross_volume ?? "0",
    }));
  } catch (error) {
    logAnalyticsReadFailure("analytics.fetchNetInflowBuckets_failed", error, {
      bucketSec,
      sinceSec,
    });
    return null;
  }
}

/**
 * Baseline net inflow strictly **before** `cutoffSec`. Used to seed the
 * cumulative running total when the chart's lookback window doesn't
 * start at protocol genesis — without this, the chart would start at
 * zero each request and admins would see implausibly low TVL early in
 * the window.
 */
export async function fetchNetInflowBaseline(
  db: Database,
  cutoffSec: number,
): Promise<string | null> {
  try {
    if (cutoffSec <= 0) return "0";
    const result = await db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN is_buy THEN usdc_amount ELSE -usdc_amount END), 0)::text AS net_inflow
      FROM ponder_views.router_trade
      WHERE timestamp < ${cutoffSec}
    `);
    const rows = result.rows as unknown as Array<{ net_inflow: string }>;
    return rows[0]?.net_inflow ?? "0";
  } catch (error) {
    logAnalyticsReadFailure(
      "analytics.fetchNetInflowBaseline_failed",
      error,
      { cutoffSec },
    );
    return null;
  }
}

export interface ActiveUserBucketRow {
  bucket: number;
  /** Total unique traders in this bucket (any positive volume). */
  uniqueTraders: number;
  /** Unique traders whose bucket-volume met or exceeded `thresholdUsdcRaw`. */
  qualifiedTraders: number;
  /** Sum of all USDC traded in this bucket, 6dp. */
  bucketVolumeUsdcRaw: string;
}

/**
 * Active users per bucket. Two cohorts surfaced in one query:
 *
 *   1. **uniqueTraders** — any trader with a positive bucket volume.
 *      This is the raw DAU/WAU figure.
 *   2. **qualifiedTraders** — traders whose bucket volume cleared
 *      `thresholdUsdcRaw`. The dashboard wants this set to `$500`
 *      USDC = `500_000_000` raw, so a "real" active user means
 *      they actually used the protocol meaningfully on that day.
 *
 * Implementation note: the inner subquery groups by `(bucket, trader)`
 * so a trader with five `$50` trades on the same day registers as one
 * unique trader with bucket volume `$250` — not five separate trader
 * rows. The aggregator then counts the per-bucket distinct traders.
 *
 * Cost: one full pass over `router_trade` within the cutoff. The
 * `router_trade_timestamp_index` keeps the window scan cheap, and the
 * `trader` index doesn't help here (no equality predicate) but the
 * GROUP BY hashes on a (bucket, trader) tuple so the planner avoids a
 * sort spill at our typical row counts.
 */
export async function fetchActiveUserBuckets(
  db: Database,
  opts: { bucketSec: number; sinceSec: number; thresholdUsdcRaw: string },
): Promise<ActiveUserBucketRow[] | null> {
  const { bucketSec, sinceSec, thresholdUsdcRaw } = opts;
  try {
    const result = await db.execute(sql`
      WITH per_trader AS (
        SELECT
          (FLOOR(timestamp::bigint / ${bucketSec}) * ${bucketSec}) AS bucket,
          trader,
          SUM(usdc_amount) AS trader_volume
        FROM ponder_views.router_trade
        WHERE timestamp >= ${sinceSec}
        GROUP BY bucket, trader
      )
      SELECT
        bucket::text AS bucket,
        COUNT(*)::int AS unique_traders,
        COUNT(*) FILTER (WHERE trader_volume >= ${thresholdUsdcRaw}::numeric)::int AS qualified_traders,
        COALESCE(SUM(trader_volume), 0)::text AS bucket_volume
      FROM per_trader
      GROUP BY bucket
      ORDER BY bucket ASC
    `);
    const rows = result.rows as unknown as Array<{
      bucket: string;
      unique_traders: number;
      qualified_traders: number;
      bucket_volume: string;
    }>;
    return rows.map((r) => ({
      bucket: Number(r.bucket),
      uniqueTraders: Number(r.unique_traders ?? 0),
      qualifiedTraders: Number(r.qualified_traders ?? 0),
      bucketVolumeUsdcRaw: r.bucket_volume ?? "0",
    }));
  } catch (error) {
    logAnalyticsReadFailure(
      "analytics.fetchActiveUserBuckets_failed",
      error,
      { bucketSec, sinceSec },
    );
    return null;
  }
}

export interface UniqueTraderCount {
  uniqueTraders: number;
  qualifiedTraders: number;
}

/**
 * Unique trader count over a single window (no bucketing). Backs the
 * snapshot endpoints (DAU/WAU/MAU). `thresholdUsdcRaw = "0"` returns
 * raw unique-trader count.
 *
 * The "qualified" cohort counts traders whose **window-wide** volume
 * meets the threshold. This is intentionally distinct from the
 * bucket-wise definition in `fetchActiveUserBuckets` — for snapshots
 * the question is "how many users do we have", not "how many of them
 * cleared the bar on at least one day".
 */
export async function fetchUniqueTraderCount(
  db: Database,
  opts: { sinceSec: number; thresholdUsdcRaw: string },
): Promise<UniqueTraderCount | null> {
  const { sinceSec, thresholdUsdcRaw } = opts;
  try {
    const result = await db.execute(sql`
      WITH per_trader AS (
        SELECT
          trader,
          SUM(usdc_amount) AS trader_volume
        FROM ponder_views.router_trade
        WHERE timestamp >= ${sinceSec}
        GROUP BY trader
      )
      SELECT
        COUNT(*)::int AS unique_traders,
        COUNT(*) FILTER (WHERE trader_volume >= ${thresholdUsdcRaw}::numeric)::int AS qualified_traders
      FROM per_trader
    `);
    const rows = result.rows as unknown as Array<{
      unique_traders: number;
      qualified_traders: number;
    }>;
    if (rows.length === 0) {
      return { uniqueTraders: 0, qualifiedTraders: 0 };
    }
    return {
      uniqueTraders: Number(rows[0].unique_traders ?? 0),
      qualifiedTraders: Number(rows[0].qualified_traders ?? 0),
    };
  } catch (error) {
    logAnalyticsReadFailure(
      "analytics.fetchUniqueTraderCount_failed",
      error,
      { sinceSec },
    );
    return null;
  }
}

export interface GraduationBucketRow {
  bucket: number;
  graduations: number;
}

/**
 * Graduation count per bucket. `ponder_views.graduation` is one row
 * per token (PK on `token_address`) so this is a straight bucket-count
 * — no de-dup needed.
 */
export async function fetchGraduationBuckets(
  db: Database,
  opts: { bucketSec: number; sinceSec: number },
): Promise<GraduationBucketRow[] | null> {
  const { bucketSec, sinceSec } = opts;
  try {
    const result = await db.execute(sql`
      SELECT
        (FLOOR(timestamp::bigint / ${bucketSec}) * ${bucketSec})::text AS bucket,
        COUNT(*)::int AS graduations
      FROM ponder_views.graduation
      WHERE timestamp >= ${sinceSec}
      GROUP BY bucket
      ORDER BY bucket ASC
    `);
    const rows = result.rows as unknown as Array<{
      bucket: string;
      graduations: number;
    }>;
    return rows.map((r) => ({
      bucket: Number(r.bucket),
      graduations: Number(r.graduations ?? 0),
    }));
  } catch (error) {
    logAnalyticsReadFailure(
      "analytics.fetchGraduationBuckets_failed",
      error,
      { bucketSec, sinceSec },
    );
    return null;
  }
}

export interface GraduationFunnelStats {
  totalLaunched: number;
  totalGraduated: number;
  totalPendingGraduation: number;
  graduationRatePct: number;
  /** Median seconds from launch → graduation, across graduated tokens. */
  medianTimeToGraduateSec: number | null;
  /** Mean seconds from launch → graduation, across graduated tokens. */
  meanTimeToGraduateSec: number | null;
}

/**
 * Aggregate graduation funnel — total launches vs graduations vs the
 * in-flight `pendingGraduation = true` cohort, plus time-to-graduate
 * distributions. Time-to-graduate is computed by joining each
 * `graduation` row against the launch timestamp on `token`.
 */
export async function fetchGraduationFunnelStats(
  db: Database,
): Promise<GraduationFunnelStats | null> {
  try {
    const [countsRows, timingRows] = await Promise.all([
      db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM ponder_views.token)::int AS total_launched,
          (SELECT COUNT(*) FROM ponder_views.token WHERE graduated = true)::int AS total_graduated,
          (SELECT COUNT(*) FROM ponder_views.token WHERE pending_graduation = true AND graduated = false)::int AS total_pending
      `),
      db.execute(sql`
        SELECT
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY (g.timestamp::bigint - t.timestamp::bigint)
          )::text AS median_sec,
          AVG(g.timestamp::bigint - t.timestamp::bigint)::text AS mean_sec
        FROM ponder_views.graduation g
        JOIN ponder_views.token t ON t.address = g.token_address
      `),
    ]);
    const countsRow = (countsRows.rows as unknown as Array<{
      total_launched: number;
      total_graduated: number;
      total_pending: number;
    }>)[0];
    const timingRow = (timingRows.rows as unknown as Array<{
      median_sec: string | null;
      mean_sec: string | null;
    }>)[0];

    const totalLaunched = Number(countsRow?.total_launched ?? 0);
    const totalGraduated = Number(countsRow?.total_graduated ?? 0);
    const totalPendingGraduation = Number(countsRow?.total_pending ?? 0);
    const graduationRatePct =
      totalLaunched > 0 ? (totalGraduated / totalLaunched) * 100 : 0;
    const medianStr = timingRow?.median_sec;
    const meanStr = timingRow?.mean_sec;
    const medianTimeToGraduateSec =
      medianStr === null || medianStr === undefined ? null : Number(medianStr);
    const meanTimeToGraduateSec =
      meanStr === null || meanStr === undefined ? null : Number(meanStr);

    return {
      totalLaunched,
      totalGraduated,
      totalPendingGraduation,
      graduationRatePct,
      medianTimeToGraduateSec,
      meanTimeToGraduateSec,
    };
  } catch (error) {
    logAnalyticsReadFailure(
      "analytics.fetchGraduationFunnelStats_failed",
      error,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Snapshots — single-row aggregates used by `/overview` and snapshot windows.
// ---------------------------------------------------------------------------

export interface PlatformAggregates {
  /** Sum of `protocol_amount` across every fee accrual ever. USDC 6dp. */
  lifetimeProtocolFeesUsdcRaw: string;
  /** Sum of `creator_amount` across every fee accrual ever. USDC 6dp. */
  lifetimeCreatorFeesUsdcRaw: string;
  /** Current `SUM(organic_usdc_raised)` across every indexed token. USDC 6dp. */
  totalValueLockedUsdcRaw: string;
  /** Cumulative gross volume (= `globalStats.total_volume_usd`). USDC 6dp. */
  lifetimeGrossVolumeUsdcRaw: string;
  /** Cumulative net USDC inflow (`sum(buys) − sum(sells)`). USDC 6dp. */
  cumulativeNetInflowUsdcRaw: string;
  /** Unique traders ever (one trade lifetime). */
  uniqueTradersAllTime: number;
  /** Unique creators (distinct `creator` on `ponder_views.token`). */
  uniqueCreatorsAllTime: number;
}

/**
 * Single-shot platform-wide aggregates. All five queries are POSTed in
 * parallel since they're independent — total wall-clock matches the
 * slowest of the five (the trader-count subquery against `router_trade`
 * is typically the bottleneck).
 *
 * The "TVL" figure here is the floored-at-zero `organic_usdc_raised`
 * sum, which is what the curve-fill bar already uses for graduation
 * progress. The "net inflow" figure is the true `buys − sells` sum
 * which can be lower on tokens that have gone net-negative via direct
 * transfers. Both surface so the dashboard can pick.
 */
export async function fetchPlatformAggregates(
  db: Database,
): Promise<PlatformAggregates | null> {
  try {
    const [
      feeRows,
      tokenRows,
      globalStatsRows,
      netInflowRows,
      traderCountRows,
    ] = await Promise.all([
      db.execute(sql`
        SELECT
          COALESCE(SUM(protocol_amount), 0)::text AS protocol_fees,
          COALESCE(SUM(creator_amount), 0)::text AS creator_fees
        FROM ponder_views.fee_accrual
      `),
      db.execute(sql`
        SELECT
          COALESCE(SUM(organic_usdc_raised), 0)::text AS tvl,
          COUNT(DISTINCT creator)::int AS unique_creators
        FROM ponder_views.token
      `),
      db.execute(sql`
        SELECT COALESCE(total_volume_usd, 0)::text AS lifetime_volume
        FROM ponder_views.global_stats
        WHERE id = 'global'
        LIMIT 1
      `),
      db.execute(sql`
        SELECT
          COALESCE(SUM(CASE WHEN is_buy THEN usdc_amount ELSE -usdc_amount END), 0)::text AS net_inflow
        FROM ponder_views.router_trade
      `),
      db.execute(sql`
        SELECT COUNT(DISTINCT trader)::int AS unique_traders
        FROM ponder_views.router_trade
      `),
    ]);

    const fee = (feeRows.rows as unknown as Array<{
      protocol_fees: string;
      creator_fees: string;
    }>)[0];
    const tokenRow = (tokenRows.rows as unknown as Array<{
      tvl: string;
      unique_creators: number;
    }>)[0];
    const globalStats = (globalStatsRows.rows as unknown as Array<{
      lifetime_volume: string;
    }>)[0];
    const netInflow = (netInflowRows.rows as unknown as Array<{
      net_inflow: string;
    }>)[0];
    const traderCount = (traderCountRows.rows as unknown as Array<{
      unique_traders: number;
    }>)[0];

    return {
      lifetimeProtocolFeesUsdcRaw: fee?.protocol_fees ?? "0",
      lifetimeCreatorFeesUsdcRaw: fee?.creator_fees ?? "0",
      totalValueLockedUsdcRaw: tokenRow?.tvl ?? "0",
      lifetimeGrossVolumeUsdcRaw: globalStats?.lifetime_volume ?? "0",
      cumulativeNetInflowUsdcRaw: netInflow?.net_inflow ?? "0",
      uniqueTradersAllTime: Number(traderCount?.unique_traders ?? 0),
      uniqueCreatorsAllTime: Number(tokenRow?.unique_creators ?? 0),
    };
  } catch (error) {
    logAnalyticsReadFailure("analytics.fetchPlatformAggregates_failed", error);
    return null;
  }
}

export interface WindowedFeesRow {
  protocolFeesUsdcRaw: string;
  creatorFeesUsdcRaw: string;
  feeEvents: number;
}

/**
 * Fee totals over an arbitrary window. Backs the "last 24h / 7d / 30d"
 * windows in `/overview` and is the primitive `revenue-forecast` runs
 * for each forecast horizon.
 */
export async function fetchWindowedFees(
  db: Database,
  sinceSec: number,
): Promise<WindowedFeesRow | null> {
  try {
    const result = await db.execute(sql`
      SELECT
        COALESCE(SUM(protocol_amount), 0)::text AS protocol_amount,
        COALESCE(SUM(creator_amount), 0)::text AS creator_amount,
        COUNT(*)::int AS fee_events
      FROM ponder_views.fee_accrual
      WHERE timestamp >= ${sinceSec}
    `);
    const rows = result.rows as unknown as Array<{
      protocol_amount: string;
      creator_amount: string;
      fee_events: number;
    }>;
    const row = rows[0];
    return {
      protocolFeesUsdcRaw: row?.protocol_amount ?? "0",
      creatorFeesUsdcRaw: row?.creator_amount ?? "0",
      feeEvents: Number(row?.fee_events ?? 0),
    };
  } catch (error) {
    logAnalyticsReadFailure("analytics.fetchWindowedFees_failed", error, {
      sinceSec,
    });
    return null;
  }
}

export interface WindowedVolumeRow {
  grossVolumeUsdcRaw: string;
  netInflowUsdcRaw: string;
  tradeCount: number;
}

/** Volume + inflow over a single window. Powers snapshot blocks. */
export async function fetchWindowedVolume(
  db: Database,
  sinceSec: number,
): Promise<WindowedVolumeRow | null> {
  try {
    const result = await db.execute(sql`
      SELECT
        COALESCE(SUM(usdc_amount), 0)::text AS gross_volume,
        COALESCE(SUM(CASE WHEN is_buy THEN usdc_amount ELSE -usdc_amount END), 0)::text AS net_inflow,
        COUNT(*)::int AS trade_count
      FROM ponder_views.router_trade
      WHERE timestamp >= ${sinceSec}
    `);
    const rows = result.rows as unknown as Array<{
      gross_volume: string;
      net_inflow: string;
      trade_count: number;
    }>;
    const row = rows[0];
    return {
      grossVolumeUsdcRaw: row?.gross_volume ?? "0",
      netInflowUsdcRaw: row?.net_inflow ?? "0",
      tradeCount: Number(row?.trade_count ?? 0),
    };
  } catch (error) {
    logAnalyticsReadFailure("analytics.fetchWindowedVolume_failed", error, {
      sinceSec,
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Breakdowns — composition of the launched-token set by an off-chain facet
// (leverage / direction / underlying / lt_pair). Joins `public.tokens` (off-
// chain metadata) against `ponder_views.token` (on-chain counters) so each
// row can report `token_count`, `lifetime_volume_usd`, fees, and graduation
// progress in one query.
// ---------------------------------------------------------------------------

export type BreakdownDimension =
  | "leverage"
  | "direction"
  | "underlying"
  | "lt_pair";

export interface BreakdownRow {
  /** The dimension value (e.g. `2`, `3`, `5` for leverage; `long`/`short` for direction). */
  key: string;
  tokenCount: number;
  graduatedCount: number;
  /** Sum of `volume_usd` across this dimension's tokens. USDC 6dp. */
  lifetimeVolumeUsdcRaw: string;
  /** Sum of `protocol_fees_usd` across this dimension's tokens. USDC 6dp. */
  protocolFeesUsdcRaw: string;
  /** Sum of `creator_fees_usd` across this dimension's tokens. USDC 6dp. */
  creatorFeesUsdcRaw: string;
  /** Sum of `organic_usdc_raised` across this dimension's tokens. USDC 6dp. */
  totalRaisedUsdcRaw: string;
}

/**
 * Token-set composition broken out by an off-chain facet. Hidden
 * tokens are excluded (`is_hidden = false`) to mirror the public lens
 * the rest of the API uses — admin moderation actions should propagate
 * into the leverage / underlying breakdown too, not just the listings.
 *
 * `lt_pair` is the LT contract address (varchar(42), checksummed in
 * `public.tokens`). For human-readable display the route layer
 * should join with `lt_directory.symbol` post-aggregation; the
 * helper deliberately returns the address as-is so the SQL stays
 * a single table-group GROUP BY.
 */
export async function fetchBreakdown(
  db: Database,
  dimension: BreakdownDimension,
): Promise<BreakdownRow[] | null> {
  const groupCol = ((): string => {
    switch (dimension) {
      case "leverage":
        return "leverage::text";
      case "direction":
        return "lt_direction";
      case "underlying":
        return "underlying";
      case "lt_pair":
        return "LOWER(lt_pair)";
    }
  })();

  try {
    // Inlined `groupCol` is constructed from a closed set above —
    // never user-controlled — so the dynamic SQL is safe. Drizzle's
    // `sql.raw` is the documented escape hatch for this exact pattern
    // (column identifiers that can't be parameterised).
    // Postgres rejects `ORDER BY <alias>::numeric DESC` when the alias
    // is sourced from a `COALESCE(SUM(...), 0)::text` projection — the
    // cast on the alias parses as ambiguous against the GROUP BY scope.
    // Repeat the underlying expression in ORDER BY to keep the planner
    // happy and avoid re-projecting the alias as numeric.
    const result = await db.execute(sql`
      SELECT
        ${sql.raw(groupCol)} AS dim_key,
        COUNT(*)::int AS token_count,
        COUNT(*) FILTER (WHERE pt.graduated)::int AS graduated_count,
        COALESCE(SUM(pt.volume_usd), 0)::text AS lifetime_volume,
        COALESCE(SUM(pt.protocol_fees_usd), 0)::text AS protocol_fees,
        COALESCE(SUM(pt.creator_fees_usd), 0)::text AS creator_fees,
        COALESCE(SUM(pt.organic_usdc_raised), 0)::text AS total_raised
      FROM public.tokens t
      JOIN ponder_views.token pt ON pt.address = LOWER(t.address)
      WHERE t.is_hidden = false
      GROUP BY dim_key
      ORDER BY COALESCE(SUM(pt.volume_usd), 0) DESC NULLS LAST
    `);
    const rows = result.rows as unknown as Array<{
      dim_key: string | number | null;
      token_count: number;
      graduated_count: number;
      lifetime_volume: string;
      protocol_fees: string;
      creator_fees: string;
      total_raised: string;
    }>;
    return rows.map((r) => ({
      key: r.dim_key === null || r.dim_key === undefined ? "unknown" : String(r.dim_key),
      tokenCount: Number(r.token_count ?? 0),
      graduatedCount: Number(r.graduated_count ?? 0),
      lifetimeVolumeUsdcRaw: r.lifetime_volume ?? "0",
      protocolFeesUsdcRaw: r.protocol_fees ?? "0",
      creatorFeesUsdcRaw: r.creator_fees ?? "0",
      totalRaisedUsdcRaw: r.total_raised ?? "0",
    }));
  } catch (error) {
    logAnalyticsReadFailure("analytics.fetchBreakdown_failed", error, {
      dimension,
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Top-tokens leaderboard.
// ---------------------------------------------------------------------------

export type TopTokensSort =
  | "volume_lifetime"
  | "protocol_fees_lifetime"
  | "creator_fees_lifetime"
  | "raised_lifetime";

export interface TopTokenRow {
  address: string;
  name: string;
  symbol: string;
  creator: string;
  graduated: boolean;
  lifetimeVolumeUsdcRaw: string;
  protocolFeesUsdcRaw: string;
  creatorFeesUsdcRaw: string;
  organicUsdcRaisedUsdcRaw: string;
}

/**
 * Top-K tokens by any of the lifetime counters maintained on
 * `ponder_views.token` (`volume_usd` / `protocol_fees_usd` /
 * `creator_fees_usd` / `organic_usdc_raised`). Single ordered scan
 * over the indexer's `token` table — cheap regardless of the catalog
 * size because the counters are pre-aggregated per-token.
 *
 * Hidden tokens are filtered out via a LEFT JOIN on `public.tokens`
 * so admin moderation propagates here too. Tokens that aren't in
 * `public.tokens` (cron backfill yet to register) are included.
 */
export async function fetchTopTokens(
  db: Database,
  opts: { sort: TopTokensSort; limit: number },
): Promise<TopTokenRow[] | null> {
  const sortCol = ((): string => {
    switch (opts.sort) {
      case "volume_lifetime":
        return "pt.volume_usd";
      case "protocol_fees_lifetime":
        return "pt.protocol_fees_usd";
      case "creator_fees_lifetime":
        return "pt.creator_fees_usd";
      case "raised_lifetime":
        return "pt.organic_usdc_raised";
    }
  })();

  try {
    const result = await db.execute(sql`
      SELECT
        pt.address AS address,
        pt.name AS name,
        pt.symbol AS symbol,
        pt.creator AS creator,
        pt.graduated AS graduated,
        pt.volume_usd::text AS volume_usd,
        pt.protocol_fees_usd::text AS protocol_fees_usd,
        pt.creator_fees_usd::text AS creator_fees_usd,
        pt.organic_usdc_raised::text AS organic_usdc_raised
      FROM ponder_views.token pt
      LEFT JOIN public.tokens t ON LOWER(t.address) = pt.address
      WHERE COALESCE(t.is_hidden, false) = false
      ORDER BY ${sql.raw(sortCol)} DESC NULLS LAST
      LIMIT ${opts.limit}
    `);
    const rows = result.rows as unknown as Array<{
      address: string;
      name: string;
      symbol: string;
      creator: string;
      graduated: boolean;
      volume_usd: string;
      protocol_fees_usd: string;
      creator_fees_usd: string;
      organic_usdc_raised: string;
    }>;
    return rows.map((r) => ({
      address: r.address,
      name: r.name,
      symbol: r.symbol,
      creator: r.creator,
      graduated: Boolean(r.graduated),
      lifetimeVolumeUsdcRaw: r.volume_usd ?? "0",
      protocolFeesUsdcRaw: r.protocol_fees_usd ?? "0",
      creatorFeesUsdcRaw: r.creator_fees_usd ?? "0",
      organicUsdcRaisedUsdcRaw: r.organic_usdc_raised ?? "0",
    }));
  } catch (error) {
    logAnalyticsReadFailure("analytics.fetchTopTokens_failed", error, {
      sort: opts.sort,
      limit: opts.limit,
    });
    return null;
  }
}


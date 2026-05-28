import { Hono } from "hono";

import { createDb } from "../db/client.js";
import formatError from "../utils/format-error.js";
import formatSuccess from "../utils/format-success.js";
import { usdcRawToUsd } from "../lib/token-enrich.js";
import {
  fetchActiveUserBuckets,
  fetchBreakdown,
  fetchGraduationBuckets,
  fetchGraduationFunnelStats,
  fetchNetInflowBaseline,
  fetchNetInflowBuckets,
  fetchPlatformAggregates,
  fetchRevenueBuckets,
  fetchTopTokens,
  fetchUniqueTraderCount,
  fetchVolumeBuckets,
  fetchWindowedFees,
  fetchWindowedVolume,
  quantizeWindowCutoff,
} from "../lib/analytics-reads.js";

import type { AppBindings } from "../lib/types.js";
import type {
  BreakdownDimension,
  TopTokensSort,
} from "../lib/analytics-reads.js";

const analytics = new Hono<{ Bindings: AppBindings }>();

/**
 * Analytics endpoints (`/api/v1/analytics/*`). Surface business-insight
 * aggregates from the existing indexer-side tables (`router_trade`,
 * `fee_accrual`, `hourly_volume`, `token`, `graduation`) — no indexer
 * schema changes were needed to land these.
 *
 * Auth: lives under `/api/v1/*` so it inherits the standard `apiKeyAuth`
 * middleware (same as every other public read route). Not gated behind
 * `adminAuth`: the data here (volume, revenue, DAU, leverage breakdown,
 * token leaderboards) is the same business-state the protocol already
 * exposes implicitly via `/stats`, `/tokens`, `/creators/:address/earnings`
 * etc. — pulling it into one analytics surface for an internal dashboard
 * doesn't change the sensitivity.
 *
 * Caching: every endpoint sets `Cache-Control: public, s-maxage=…,
 * stale-while-revalidate=…` (see `setAnalyticsCacheHeader`) so the
 * Cloudflare edge absorbs concurrent dashboard polls and Neon never
 * sees more than ~1 request per region per cache window. TTLs are
 * tuned per endpoint — chart series at 60s (numbers move per trade
 * but daily/hourly buckets render the same for ~minutes), breakdowns
 * + revenue-forecast at 5 minutes (slower-moving aggregates over the
 * full token catalogue), `/overview` at 30s (most-polled). The
 * trade-off is acceptable for an internal dashboard: 60s of staleness
 * on a 7-day chart is imperceptible, and the cache cost saves the
 * heavier CTE / EWMA queries from hammering Neon under a misbehaving
 * polling client (issue raised by CodeRabbit on the move-out-of-admin
 * commit — see PR #1168 discussion).
 *
 * Common query params:
 *   - `interval` — `hour` / `day` / `week`. Default `day`.
 *   - `lookback` — number of intervals to scan back. Default depends
 *     on interval (24h / 30d / 26w). Capped per route to keep
 *     queries bounded.
 *
 * Common response envelope (chart routes):
 *
 *   ```
 *   {
 *     interval: "day",
 *     intervalSec: 86400,
 *     bucketStartSec: 1700000000,
 *     bucketEndSec: 1702592000,
 *     series: [{ t: 1700000000, ... }, ...],
 *     windows: {
 *       last24h: { ... },
 *       last7d: { ... },
 *       last30d: { ... },
 *       allTime: { ... },
 *     }
 *   }
 *   ```
 *
 * USDC amounts ride out as raw 6dp decimal strings on the `*UsdcRaw`
 * fields, plus a parallel `*Usd` float for direct charting. The dual
 * shape matches the convention `/creators/:address/earnings` already
 * uses so the dashboard frontend can pick whichever it prefers
 * without re-parsing.
 */

const SECONDS_PER_HOUR = 3_600;
const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_WEEK = 7 * SECONDS_PER_DAY;

type Interval = "hour" | "day" | "week";

const INTERVAL_SECONDS: Record<Interval, number> = {
  hour: SECONDS_PER_HOUR,
  day: SECONDS_PER_DAY,
  week: SECONDS_PER_WEEK,
};

const DEFAULT_LOOKBACK: Record<Interval, number> = {
  hour: 24,
  day: 30,
  week: 26,
};

const MAX_LOOKBACK: Record<Interval, number> = {
  hour: 24 * 7, // 1 week of hourly buckets
  day: 365,
  week: 156, // ~3 years
};

const DEFAULT_DAU_THRESHOLD_USD = 500;
const MAX_DAU_THRESHOLD_USD = 1_000_000;

const DEFAULT_TOP_TOKENS_LIMIT = 20;
const MAX_TOP_TOKENS_LIMIT = 100;

/**
 * Per-endpoint edge-cache TTLs. Tuned for the dashboard polling shape:
 *
 *   - `/overview` is the landing page header — polled most aggressively.
 *     Lower TTL keeps the 24h-rolling numbers fresh.
 *   - Chart series (`/volume`, `/revenue`, `/value-locked`, `/active-users`,
 *     `/graduations`) render the same bucket totals for ~minutes between
 *     trades; 60s is invisible to a chart consumer.
 *   - `/breakdown` aggregates the entire token catalogue grouped by an
 *     off-chain facet — changes only on token-create / token-hide /
 *     trade events that shift the group totals. 5 min is generous.
 *   - `/revenue-forecast` is the most expensive query in the file (120
 *     days of fee history + three EWMA passes). 5 min cuts the worst
 *     case from ~12 reqs/min/dashboard to ~12 reqs/hr.
 *   - `/top-tokens` reorders only when a token crosses another on the
 *     selected metric — 60s is plenty.
 *
 * Every TTL pairs with a 2× `stale-while-revalidate` window so the
 * Cloudflare edge serves stale-but-cached responses while it refreshes
 * in the background. Same `Cache-Control` shape as `/stats` /
 * `/creators/:address/earnings`.
 */
const CACHE_TTL_SEC = {
  overview: 30,
  chart: 60,
  topTokens: 60,
  breakdown: 300,
  forecast: 300,
} as const;

function setAnalyticsCacheHeader(
  c: { header: (k: string, v: string) => void },
  ttlSec: number,
): void {
  c.header(
    "Cache-Control",
    `public, s-maxage=${ttlSec}, stale-while-revalidate=${ttlSec * 2}`,
  );
}

/**
 * Resolve `interval` / `lookback` query params and bucket cutoff. The
 * `lookback` arg counts in `interval` units (e.g. `interval=day&lookback=30`
 * = 30 days). We anchor the cutoff at the **start** of the current bucket
 * so the series is full-bucket only — the in-progress trailing bucket is
 * included as the rightmost data point but its `t` is the bucket-start,
 * not the request time, keeping the bucket math consistent with how the
 * indexer keys `hourly_volume`.
 */
function resolveWindow(c: {
  req: { query: (k: string) => string | undefined };
}): { interval: Interval; intervalSec: number; lookback: number; sinceSec: number; nowSec: number } | null {
  const rawInterval = (c.req.query("interval") ?? "day").toLowerCase();
  if (rawInterval !== "hour" && rawInterval !== "day" && rawInterval !== "week") {
    return null;
  }
  const interval = rawInterval as Interval;
  const intervalSec = INTERVAL_SECONDS[interval];
  const rawLookback = c.req.query("lookback");
  let lookback = rawLookback ? Number(rawLookback) : DEFAULT_LOOKBACK[interval];
  if (!Number.isFinite(lookback) || lookback <= 0) {
    lookback = DEFAULT_LOOKBACK[interval];
  }
  lookback = Math.min(Math.max(1, Math.floor(lookback)), MAX_LOOKBACK[interval]);
  const nowSec = Math.floor(Date.now() / 1000);
  const currentBucketStart = Math.floor(nowSec / intervalSec) * intervalSec;
  // `lookback - 1` so the returned series contains exactly `lookback`
  // buckets including the in-progress trailing one. A caller asking
  // for `lookback=7&interval=day` wants today + 6 prior days.
  const sinceSec = currentBucketStart - (lookback - 1) * intervalSec;
  return { interval, intervalSec, lookback, sinceSec, nowSec };
}

/** USDC raw → display USD with `null` on missing input (mirrors `usdcRawToUsd`). */
function fmtUsd(raw: string | null | undefined): number {
  return usdcRawToUsd(raw) ?? 0;
}

// ---------------------------------------------------------------------------
// /overview — single composite snapshot for the dashboard landing.
// ---------------------------------------------------------------------------

/**
 * Composite snapshot: every "current state" figure the dashboard's
 * top strip wants, in one round-trip. Layers:
 *
 *   - Lifetime aggregates (total fees, TVL, gross volume, unique
 *     creators & traders) from `fetchPlatformAggregates`.
 *   - Windowed volume + revenue for 24h / 7d / 30d horizons.
 *   - Unique-trader counts for the same horizons (raw + `$500`-volume
 *     qualified).
 *
 * If any individual query fails the route still ships the partial set
 * with `dataSource: "degraded"` and zeros for the missing branches —
 * the dashboard prefers a partial render to a hard 503 because the
 * lifetime aggregates rarely fail together (each is independent).
 */
analytics.get("/overview", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const nowSec = Math.floor(Date.now() / 1000);
  const w24h = quantizeWindowCutoff(nowSec, SECONDS_PER_DAY);
  const w7d = quantizeWindowCutoff(nowSec, 7 * SECONDS_PER_DAY);
  const w30d = quantizeWindowCutoff(nowSec, 30 * SECONDS_PER_DAY);

  const [
    aggregates,
    vol24h,
    vol7d,
    vol30d,
    fee24h,
    fee7d,
    fee30d,
    dau,
    wau,
    mau,
    graduation,
  ] = await Promise.all([
    fetchPlatformAggregates(db),
    fetchWindowedVolume(db, w24h),
    fetchWindowedVolume(db, w7d),
    fetchWindowedVolume(db, w30d),
    fetchWindowedFees(db, w24h),
    fetchWindowedFees(db, w7d),
    fetchWindowedFees(db, w30d),
    fetchUniqueTraderCount(db, {
      sinceSec: w24h,
      thresholdUsdcRaw: String(DEFAULT_DAU_THRESHOLD_USD * 1_000_000),
    }),
    fetchUniqueTraderCount(db, {
      sinceSec: w7d,
      thresholdUsdcRaw: String(DEFAULT_DAU_THRESHOLD_USD * 1_000_000),
    }),
    fetchUniqueTraderCount(db, {
      sinceSec: w30d,
      thresholdUsdcRaw: String(DEFAULT_DAU_THRESHOLD_USD * 1_000_000),
    }),
    fetchGraduationFunnelStats(db),
  ]);

  const dataSource = [
    aggregates,
    vol24h,
    vol7d,
    vol30d,
    fee24h,
    fee7d,
    fee30d,
    dau,
    wau,
    mau,
    graduation,
  ].some((r) => r === null)
    ? "degraded"
    : "live";

  setAnalyticsCacheHeader(c, CACHE_TTL_SEC.overview);
  return c.json(
    formatSuccess(
      {
        nowSec,
        lifetime: {
          totalValueLockedUsdcRaw:
            aggregates?.totalValueLockedUsdcRaw ?? "0",
          totalValueLockedUsd: fmtUsd(aggregates?.totalValueLockedUsdcRaw),
          cumulativeNetInflowUsdcRaw:
            aggregates?.cumulativeNetInflowUsdcRaw ?? "0",
          cumulativeNetInflowUsd: fmtUsd(
            aggregates?.cumulativeNetInflowUsdcRaw,
          ),
          lifetimeGrossVolumeUsdcRaw:
            aggregates?.lifetimeGrossVolumeUsdcRaw ?? "0",
          lifetimeGrossVolumeUsd: fmtUsd(
            aggregates?.lifetimeGrossVolumeUsdcRaw,
          ),
          lifetimeProtocolFeesUsdcRaw:
            aggregates?.lifetimeProtocolFeesUsdcRaw ?? "0",
          lifetimeProtocolFeesUsd: fmtUsd(
            aggregates?.lifetimeProtocolFeesUsdcRaw,
          ),
          lifetimeCreatorFeesUsdcRaw:
            aggregates?.lifetimeCreatorFeesUsdcRaw ?? "0",
          lifetimeCreatorFeesUsd: fmtUsd(
            aggregates?.lifetimeCreatorFeesUsdcRaw,
          ),
          uniqueTradersAllTime: aggregates?.uniqueTradersAllTime ?? 0,
          uniqueCreatorsAllTime: aggregates?.uniqueCreatorsAllTime ?? 0,
        },
        graduation: {
          totalLaunched: graduation?.totalLaunched ?? 0,
          totalGraduated: graduation?.totalGraduated ?? 0,
          totalPendingGraduation: graduation?.totalPendingGraduation ?? 0,
          graduationRatePct: graduation?.graduationRatePct ?? 0,
          medianTimeToGraduateSec: graduation?.medianTimeToGraduateSec ?? null,
          meanTimeToGraduateSec: graduation?.meanTimeToGraduateSec ?? null,
        },
        windows: {
          last24h: buildWindowSnapshot(vol24h, fee24h, dau),
          last7d: buildWindowSnapshot(vol7d, fee7d, wau),
          last30d: buildWindowSnapshot(vol30d, fee30d, mau),
        },
        // Highlight the `$500` threshold being applied for the
        // qualified-trader cohort so the dashboard can label the
        // figure correctly without hard-coding.
        qualifiedTraderThresholdUsd: DEFAULT_DAU_THRESHOLD_USD,
      },
      dataSource,
    ),
  );
});

function buildWindowSnapshot(
  vol: Awaited<ReturnType<typeof fetchWindowedVolume>>,
  fee: Awaited<ReturnType<typeof fetchWindowedFees>>,
  trader: Awaited<ReturnType<typeof fetchUniqueTraderCount>>,
) {
  return {
    grossVolumeUsdcRaw: vol?.grossVolumeUsdcRaw ?? "0",
    grossVolumeUsd: fmtUsd(vol?.grossVolumeUsdcRaw),
    netInflowUsdcRaw: vol?.netInflowUsdcRaw ?? "0",
    netInflowUsd: fmtUsd(vol?.netInflowUsdcRaw),
    tradeCount: vol?.tradeCount ?? 0,
    protocolFeesUsdcRaw: fee?.protocolFeesUsdcRaw ?? "0",
    protocolFeesUsd: fmtUsd(fee?.protocolFeesUsdcRaw),
    creatorFeesUsdcRaw: fee?.creatorFeesUsdcRaw ?? "0",
    creatorFeesUsd: fmtUsd(fee?.creatorFeesUsdcRaw),
    uniqueTraders: trader?.uniqueTraders ?? 0,
    qualifiedTraders: trader?.qualifiedTraders ?? 0,
  };
}

// ---------------------------------------------------------------------------
// /volume — gross trading volume time series + snapshot windows.
// ---------------------------------------------------------------------------

analytics.get("/volume", async (c) => {
  const window = resolveWindow(c);
  if (!window) return c.json(formatError("Invalid `interval`"), 400);
  const db = createDb(c.env.DATABASE_URL);

  const nowSec = window.nowSec;
  const [buckets, vol24h, vol7d, vol30d] = await Promise.all([
    fetchVolumeBuckets(db, {
      bucketSec: window.intervalSec,
      sinceSec: window.sinceSec,
    }),
    fetchWindowedVolume(db, quantizeWindowCutoff(nowSec, SECONDS_PER_DAY)),
    fetchWindowedVolume(db, quantizeWindowCutoff(nowSec, 7 * SECONDS_PER_DAY)),
    fetchWindowedVolume(db, quantizeWindowCutoff(nowSec, 30 * SECONDS_PER_DAY)),
  ]);
  if (buckets === null) {
    return c.json(formatError("Indexer unavailable"), 503);
  }
  const series = fillEmptyBuckets(
    buckets,
    window,
    (r) => ({
      t: r.bucket,
      volumeUsdcRaw: r.volumeUsdcRaw,
      volumeUsd: fmtUsd(r.volumeUsdcRaw),
    }),
    (t) => ({ t, volumeUsdcRaw: "0", volumeUsd: 0 }),
  );
  setAnalyticsCacheHeader(c, CACHE_TTL_SEC.chart);
  return c.json(
    formatSuccess({
      interval: window.interval,
      intervalSec: window.intervalSec,
      lookback: window.lookback,
      series,
      windows: {
        last24h: snapVolume(vol24h),
        last7d: snapVolume(vol7d),
        last30d: snapVolume(vol30d),
      },
    }),
  );
});

function snapVolume(vol: Awaited<ReturnType<typeof fetchWindowedVolume>>) {
  return {
    grossVolumeUsdcRaw: vol?.grossVolumeUsdcRaw ?? "0",
    grossVolumeUsd: fmtUsd(vol?.grossVolumeUsdcRaw),
    tradeCount: vol?.tradeCount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// /revenue — protocol revenue (post creator-split). Time series + windows.
// ---------------------------------------------------------------------------

analytics.get("/revenue", async (c) => {
  const window = resolveWindow(c);
  if (!window) return c.json(formatError("Invalid `interval`"), 400);
  const db = createDb(c.env.DATABASE_URL);

  const nowSec = window.nowSec;
  const [buckets, fee24h, fee7d, fee30d, feeAll] = await Promise.all([
    fetchRevenueBuckets(db, {
      bucketSec: window.intervalSec,
      sinceSec: window.sinceSec,
    }),
    fetchWindowedFees(db, quantizeWindowCutoff(nowSec, SECONDS_PER_DAY)),
    fetchWindowedFees(db, quantizeWindowCutoff(nowSec, 7 * SECONDS_PER_DAY)),
    fetchWindowedFees(db, quantizeWindowCutoff(nowSec, 30 * SECONDS_PER_DAY)),
    fetchWindowedFees(db, 0),
  ]);
  if (buckets === null) {
    return c.json(formatError("Indexer unavailable"), 503);
  }

  const series = fillEmptyBuckets(
    buckets,
    window,
    (r) => ({
      t: r.bucket,
      protocolFeesUsdcRaw: r.protocolFeesUsdcRaw,
      protocolFeesUsd: fmtUsd(r.protocolFeesUsdcRaw),
      creatorFeesUsdcRaw: r.creatorFeesUsdcRaw,
      creatorFeesUsd: fmtUsd(r.creatorFeesUsdcRaw),
      feeEvents: r.feeEvents,
    }),
    (t) => ({
      t,
      protocolFeesUsdcRaw: "0",
      protocolFeesUsd: 0,
      creatorFeesUsdcRaw: "0",
      creatorFeesUsd: 0,
      feeEvents: 0,
    }),
  );

  setAnalyticsCacheHeader(c, CACHE_TTL_SEC.chart);
  return c.json(
    formatSuccess({
      interval: window.interval,
      intervalSec: window.intervalSec,
      lookback: window.lookback,
      series,
      windows: {
        last24h: snapFees(fee24h),
        last7d: snapFees(fee7d),
        last30d: snapFees(fee30d),
        allTime: snapFees(feeAll),
      },
    }),
  );
});

function snapFees(fee: Awaited<ReturnType<typeof fetchWindowedFees>>) {
  return {
    protocolFeesUsdcRaw: fee?.protocolFeesUsdcRaw ?? "0",
    protocolFeesUsd: fmtUsd(fee?.protocolFeesUsdcRaw),
    creatorFeesUsdcRaw: fee?.creatorFeesUsdcRaw ?? "0",
    creatorFeesUsd: fmtUsd(fee?.creatorFeesUsdcRaw),
    feeEvents: fee?.feeEvents ?? 0,
  };
}

// ---------------------------------------------------------------------------
// /value-locked — cumulative net USDC inflow chart + TVL snapshot.
// ---------------------------------------------------------------------------

/**
 * "Value in the system" over time. Each series point is `(t, cumulativeNetInflow)`
 * — running sum of `buys − sells` from protocol genesis up to that bucket. The
 * pre-window baseline is fetched separately so the chart starts at the true
 * cumulative value, not zero. Excludes virtual reserves entirely (only counts
 * real USDC that traversed `Zap`).
 *
 * Snapshot returns both:
 *   - `totalValueLockedUsdcRaw` — `SUM(token.organic_usdc_raised)` floored
 *     at 0 per-token. Matches the curve-fill bar's denominator.
 *   - `cumulativeNetInflowUsdcRaw` — true net (`sum(buys) − sum(sells)`),
 *     can differ slightly from TVL when tokens have gone net-negative via
 *     direct transfers.
 */
analytics.get("/value-locked", async (c) => {
  const window = resolveWindow(c);
  if (!window) return c.json(formatError("Invalid `interval`"), 400);
  const db = createDb(c.env.DATABASE_URL);

  const [buckets, baseline, aggregates] = await Promise.all([
    fetchNetInflowBuckets(db, {
      bucketSec: window.intervalSec,
      sinceSec: window.sinceSec,
    }),
    fetchNetInflowBaseline(db, window.sinceSec),
    fetchPlatformAggregates(db),
  ]);

  if (buckets === null || baseline === null) {
    return c.json(formatError("Indexer unavailable"), 503);
  }

  let running = BigInt(baseline);
  const filled = fillEmptyBuckets(
    buckets,
    window,
    (r) => ({
      t: r.bucket,
      netInflowUsdcRaw: r.netInflowUsdcRaw,
      grossVolumeUsdcRaw: r.grossVolumeUsdcRaw,
    }),
    (t) => ({ t, netInflowUsdcRaw: "0", grossVolumeUsdcRaw: "0" }),
  );
  const series = filled.map((r) => {
    running += BigInt(r.netInflowUsdcRaw);
    return {
      t: r.t,
      netInflowUsdcRaw: r.netInflowUsdcRaw,
      netInflowUsd: fmtUsd(r.netInflowUsdcRaw),
      grossVolumeUsdcRaw: r.grossVolumeUsdcRaw,
      grossVolumeUsd: fmtUsd(r.grossVolumeUsdcRaw),
      cumulativeNetInflowUsdcRaw: running.toString(),
      cumulativeNetInflowUsd: fmtUsd(running.toString()),
    };
  });

  setAnalyticsCacheHeader(c, CACHE_TTL_SEC.chart);
  return c.json(
    formatSuccess({
      interval: window.interval,
      intervalSec: window.intervalSec,
      lookback: window.lookback,
      baselineUsdcRaw: baseline,
      baselineUsd: fmtUsd(baseline),
      series,
      snapshot: {
        totalValueLockedUsdcRaw:
          aggregates?.totalValueLockedUsdcRaw ?? "0",
        totalValueLockedUsd: fmtUsd(aggregates?.totalValueLockedUsdcRaw),
        cumulativeNetInflowUsdcRaw:
          aggregates?.cumulativeNetInflowUsdcRaw ?? "0",
        cumulativeNetInflowUsd: fmtUsd(
          aggregates?.cumulativeNetInflowUsdcRaw,
        ),
      },
    }),
  );
});

// ---------------------------------------------------------------------------
// /active-users — DAU/WAU/MAU with $-threshold filtering.
// ---------------------------------------------------------------------------

analytics.get("/active-users", async (c) => {
  const window = resolveWindow(c);
  if (!window) return c.json(formatError("Invalid `interval`"), 400);
  const db = createDb(c.env.DATABASE_URL);

  const rawThreshold = c.req.query("threshold");
  let thresholdUsd = rawThreshold ? Number(rawThreshold) : DEFAULT_DAU_THRESHOLD_USD;
  if (!Number.isFinite(thresholdUsd) || thresholdUsd < 0) {
    thresholdUsd = DEFAULT_DAU_THRESHOLD_USD;
  }
  thresholdUsd = Math.min(thresholdUsd, MAX_DAU_THRESHOLD_USD);
  const thresholdUsdcRaw = String(Math.floor(thresholdUsd * 1_000_000));

  const nowSec = window.nowSec;
  const [buckets, dau, wau, mau] = await Promise.all([
    fetchActiveUserBuckets(db, {
      bucketSec: window.intervalSec,
      sinceSec: window.sinceSec,
      thresholdUsdcRaw,
    }),
    fetchUniqueTraderCount(db, {
      sinceSec: quantizeWindowCutoff(nowSec, SECONDS_PER_DAY),
      thresholdUsdcRaw,
    }),
    fetchUniqueTraderCount(db, {
      sinceSec: quantizeWindowCutoff(nowSec, 7 * SECONDS_PER_DAY),
      thresholdUsdcRaw,
    }),
    fetchUniqueTraderCount(db, {
      sinceSec: quantizeWindowCutoff(nowSec, 30 * SECONDS_PER_DAY),
      thresholdUsdcRaw,
    }),
  ]);
  if (buckets === null) {
    return c.json(formatError("Indexer unavailable"), 503);
  }
  const series = fillEmptyBuckets(
    buckets,
    window,
    (r) => ({
      t: r.bucket,
      uniqueTraders: r.uniqueTraders,
      qualifiedTraders: r.qualifiedTraders,
      bucketVolumeUsdcRaw: r.bucketVolumeUsdcRaw,
      bucketVolumeUsd: fmtUsd(r.bucketVolumeUsdcRaw),
    }),
    (t) => ({
      t,
      uniqueTraders: 0,
      qualifiedTraders: 0,
      bucketVolumeUsdcRaw: "0",
      bucketVolumeUsd: 0,
    }),
  );

  setAnalyticsCacheHeader(c, CACHE_TTL_SEC.chart);
  return c.json(
    formatSuccess({
      interval: window.interval,
      intervalSec: window.intervalSec,
      lookback: window.lookback,
      thresholdUsd,
      series,
      windows: {
        last24h: dau ?? { uniqueTraders: 0, qualifiedTraders: 0 },
        last7d: wau ?? { uniqueTraders: 0, qualifiedTraders: 0 },
        last30d: mau ?? { uniqueTraders: 0, qualifiedTraders: 0 },
      },
    }),
  );
});

// ---------------------------------------------------------------------------
// /breakdown — composition by leverage / direction / underlying / lt_pair.
// ---------------------------------------------------------------------------

const VALID_BREAKDOWN_DIMENSIONS: ReadonlySet<BreakdownDimension> = new Set([
  "leverage",
  "direction",
  "underlying",
  "lt_pair",
]);

analytics.get("/breakdown", async (c) => {
  const by = (c.req.query("by") ?? "leverage").toLowerCase() as BreakdownDimension;
  if (!VALID_BREAKDOWN_DIMENSIONS.has(by)) {
    return c.json(
      formatError(
        "Invalid `by`. Allowed: leverage, direction, underlying, lt_pair",
      ),
      400,
    );
  }
  const db = createDb(c.env.DATABASE_URL);
  const rows = await fetchBreakdown(db, by);
  if (rows === null) {
    return c.json(formatError("Indexer unavailable"), 503);
  }
  const decorated = rows.map((r) => ({
    ...r,
    lifetimeVolumeUsd: fmtUsd(r.lifetimeVolumeUsdcRaw),
    protocolFeesUsd: fmtUsd(r.protocolFeesUsdcRaw),
    creatorFeesUsd: fmtUsd(r.creatorFeesUsdcRaw),
    totalRaisedUsd: fmtUsd(r.totalRaisedUsdcRaw),
  }));

  setAnalyticsCacheHeader(c, CACHE_TTL_SEC.breakdown);
  return c.json(formatSuccess({ dimension: by, rows: decorated }));
});

// ---------------------------------------------------------------------------
// /revenue-forecast — multi-window annualised projections + EWMA.
// ---------------------------------------------------------------------------

/**
 * Annualised revenue projections from per-day protocol fees. Surfaces
 * multiple horizons because the user spec'd "fees are highly volatile,
 * so we might need multiple endpoints? Or weight recent data more?" —
 * the answer here is "both": flat extrapolation across canonical
 * windows (1d, 3d, 7d, 30d, 90d) for the raw view, plus EWMA estimates
 * with 7d / 14d / 30d half-lives for the recency-weighted view.
 *
 * Method:
 *   1. Pull `MAX(90, halfLife*4)` days of bucketed protocol fees.
 *   2. For each window, compute average daily fee in that window
 *      and multiply by 365 → flat annualised estimate.
 *   3. For each EWMA half-life, weight each daily fee by
 *      `2^(−age_days / halfLife)` (so a fee from `halfLife` days ago
 *      counts half as much as today's). Sum weighted divided by sum
 *      of weights → recency-weighted daily mean, × 365 → annualised.
 *   4. Compute the std-dev within each window so the dashboard can
 *      render a confidence band ("this estimate is `$X` ± `$Y` based
 *      on the last N days").
 *
 * Snapshot also returns the underlying daily series so the dashboard
 * can sanity-check the forecasts visually without a second request.
 */
analytics.get("/revenue-forecast", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const nowSec = Math.floor(Date.now() / 1000);
  // 120 days of history is enough to evaluate every forecast window
  // (the longest is 90d) plus headroom for the 30-day EWMA half-life
  // to weight back to ~6% per the half-life formula.
  const HISTORY_DAYS = 120;
  const cutoff =
    Math.floor(nowSec / SECONDS_PER_DAY) * SECONDS_PER_DAY -
    (HISTORY_DAYS - 1) * SECONDS_PER_DAY;
  const buckets = await fetchRevenueBuckets(db, {
    bucketSec: SECONDS_PER_DAY,
    sinceSec: cutoff,
  });
  if (buckets === null) {
    return c.json(formatError("Indexer unavailable"), 503);
  }

  // Build a continuous daily series so missing days count as zero
  // revenue (not skipped). The flat-window means need a denominator
  // of `N days`, not `N non-zero days`, otherwise a quiet weekend
  // would silently inflate the per-day mean.
  const todayBucketStart = Math.floor(nowSec / SECONDS_PER_DAY) * SECONDS_PER_DAY;
  const dailyMap = new Map(buckets.map((b) => [b.bucket, b.protocolFeesUsdcRaw]));
  const series: Array<{ t: number; protocolFeesUsd: number }> = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const t = todayBucketStart - i * SECONDS_PER_DAY;
    const raw = dailyMap.get(t) ?? "0";
    series.push({ t, protocolFeesUsd: fmtUsd(raw) });
  }

  const todayIdx = series.length - 1;
  const flatWindows = [
    { label: "last1d", days: 1 },
    { label: "last3d", days: 3 },
    { label: "last7d", days: 7 },
    { label: "last30d", days: 30 },
    { label: "last90d", days: 90 },
  ];
  const extrapolations: Record<string, ForecastEstimate> = {};
  for (const w of flatWindows) {
    const slice = series.slice(todayIdx - w.days + 1, todayIdx + 1);
    extrapolations[w.label] = forecastFromSlice(slice, w.days);
  }

  const halfLives = [7, 14, 30];
  const ewma: Record<string, ForecastEstimate> = {};
  for (const halfLife of halfLives) {
    ewma[`halfLife${halfLife}d`] = forecastEwma(series, halfLife);
  }

  // Lifetime sanity-check figure — total fees ÷ days since first
  // recorded fee × 365. Lower-bound on what the protocol has ever
  // earned per day on average. Useful for spotting "this last-day
  // estimate is 50x the lifetime average — marketing campaign?"
  //
  // Denominator is `days since the first non-zero day INSIDE the
  // 120-day window`, not `count of non-zero days` — a quiet weekend
  // after the protocol started earning is legitimately a $0 day and
  // belongs in the denominator, otherwise the per-day mean is
  // upward-biased. The whole series is bounded at 120 days so this
  // is conservative for protocols older than that (it under-counts
  // historical activity); that's fine because the metric is the
  // "current run-rate average", not an all-time figure.
  const liveDailyTotalUsd = series.reduce(
    (sum, day) => sum + day.protocolFeesUsd,
    0,
  );
  const firstNonZeroIdx = series.findIndex((d) => d.protocolFeesUsd > 0);
  const daysSinceFirstFee =
    firstNonZeroIdx === -1 ? 0 : series.length - firstNonZeroIdx;
  const lifetimeAverage =
    daysSinceFirstFee > 0
      ? {
          dailyAverageUsd: liveDailyTotalUsd / daysSinceFirstFee,
          annualisedUsd: (liveDailyTotalUsd / daysSinceFirstFee) * 365,
          windowDays: daysSinceFirstFee,
          stdDevUsd: standardDeviation(series.map((d) => d.protocolFeesUsd)),
        }
      : {
          dailyAverageUsd: 0,
          annualisedUsd: 0,
          windowDays: 0,
          stdDevUsd: 0,
        };

  setAnalyticsCacheHeader(c, CACHE_TTL_SEC.forecast);
  return c.json(
    formatSuccess({
      nowSec,
      historyDays: HISTORY_DAYS,
      flat: extrapolations,
      ewma,
      lifetimeAverage,
      series,
    }),
  );
});

interface ForecastEstimate {
  dailyAverageUsd: number;
  annualisedUsd: number;
  windowDays: number;
  /** Sample standard deviation of daily protocol fees inside the window. */
  stdDevUsd: number;
}

function forecastFromSlice(
  slice: Array<{ protocolFeesUsd: number }>,
  windowDays: number,
): ForecastEstimate {
  const total = slice.reduce((sum, d) => sum + d.protocolFeesUsd, 0);
  const dailyAverageUsd = slice.length > 0 ? total / slice.length : 0;
  return {
    dailyAverageUsd,
    annualisedUsd: dailyAverageUsd * 365,
    windowDays,
    stdDevUsd: standardDeviation(slice.map((d) => d.protocolFeesUsd)),
  };
}

function forecastEwma(
  series: Array<{ protocolFeesUsd: number }>,
  halfLifeDays: number,
): ForecastEstimate {
  if (series.length === 0) {
    return {
      dailyAverageUsd: 0,
      annualisedUsd: 0,
      windowDays: 0,
      stdDevUsd: 0,
    };
  }
  // `series` is ordered oldest → newest; the *last* element is "today",
  // so age in days is `(series.length - 1) - i`. Half-life formulation:
  //   weight = 2 ** (-age / halfLife)
  // Today's weight = 1; the value `halfLife` days ago has weight 0.5.
  const lastIdx = series.length - 1;
  let weighted = 0;
  let weightSum = 0;
  for (let i = 0; i < series.length; i++) {
    const age = lastIdx - i;
    const weight = Math.pow(2, -age / halfLifeDays);
    weighted += series[i].protocolFeesUsd * weight;
    weightSum += weight;
  }
  const dailyAverageUsd = weightSum > 0 ? weighted / weightSum : 0;
  return {
    dailyAverageUsd,
    annualisedUsd: dailyAverageUsd * 365,
    windowDays: series.length,
    stdDevUsd: standardDeviation(series.map((d) => d.protocolFeesUsd)),
  };
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// ---------------------------------------------------------------------------
// /graduations — graduation funnel + time series.
// ---------------------------------------------------------------------------

analytics.get("/graduations", async (c) => {
  const window = resolveWindow(c);
  if (!window) return c.json(formatError("Invalid `interval`"), 400);
  const db = createDb(c.env.DATABASE_URL);
  const [buckets, funnel] = await Promise.all([
    fetchGraduationBuckets(db, {
      bucketSec: window.intervalSec,
      sinceSec: window.sinceSec,
    }),
    fetchGraduationFunnelStats(db),
  ]);
  if (buckets === null) {
    return c.json(formatError("Indexer unavailable"), 503);
  }
  const series = fillEmptyBuckets(
    buckets,
    window,
    (r) => ({ t: r.bucket, graduations: r.graduations }),
    (t) => ({ t, graduations: 0 }),
  );
  setAnalyticsCacheHeader(c, CACHE_TTL_SEC.chart);
  return c.json(
    formatSuccess({
      interval: window.interval,
      intervalSec: window.intervalSec,
      lookback: window.lookback,
      series,
      funnel: funnel ?? {
        totalLaunched: 0,
        totalGraduated: 0,
        totalPendingGraduation: 0,
        graduationRatePct: 0,
        medianTimeToGraduateSec: null,
        meanTimeToGraduateSec: null,
      },
    }),
  );
});

// ---------------------------------------------------------------------------
// /top-tokens — leaderboard sortable by any lifetime counter.
// ---------------------------------------------------------------------------

const VALID_TOP_TOKEN_SORTS: ReadonlySet<TopTokensSort> = new Set([
  "volume_lifetime",
  "protocol_fees_lifetime",
  "creator_fees_lifetime",
  "raised_lifetime",
]);

analytics.get("/top-tokens", async (c) => {
  const sort = (c.req.query("sort") ?? "volume_lifetime") as TopTokensSort;
  if (!VALID_TOP_TOKEN_SORTS.has(sort)) {
    return c.json(formatError("Invalid `sort` field"), 400);
  }
  let limit = Number(c.req.query("limit") ?? DEFAULT_TOP_TOKENS_LIMIT);
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_TOP_TOKENS_LIMIT;
  limit = Math.min(Math.max(1, Math.floor(limit)), MAX_TOP_TOKENS_LIMIT);

  const db = createDb(c.env.DATABASE_URL);
  const rows = await fetchTopTokens(db, { sort, limit });
  if (rows === null) {
    return c.json(formatError("Indexer unavailable"), 503);
  }

  const decorated = rows.map((r) => ({
    ...r,
    lifetimeVolumeUsd: fmtUsd(r.lifetimeVolumeUsdcRaw),
    protocolFeesUsd: fmtUsd(r.protocolFeesUsdcRaw),
    creatorFeesUsd: fmtUsd(r.creatorFeesUsdcRaw),
    organicUsdcRaisedUsd: fmtUsd(r.organicUsdcRaisedUsdcRaw),
  }));
  setAnalyticsCacheHeader(c, CACHE_TTL_SEC.topTokens);
  return c.json(formatSuccess({ sort, limit, rows: decorated }));
});

// ---------------------------------------------------------------------------
// Helpers — bucket-filling. Sparse SQL output → dense series.
// ---------------------------------------------------------------------------

/**
 * Postgres only emits a row per bucket that actually has data. For
 * chart consumers that's a footgun — a quiet day disappears entirely
 * instead of rendering as a zero. Walk the requested window and inject
 * zero rows where the SQL output skipped a bucket. The supplied
 * `makeEmpty` factory builds the zero row in the shape the caller
 * cares about; the present-bucket transform `fromRow` adapts the SQL
 * row into the same shape so the two paths can be merged into one
 * stable series.
 *
 * Outputs are returned oldest → newest, matching the SQL `ORDER BY
 * bucket ASC` so the bucket-fill walks in lock-step.
 */
function fillEmptyBuckets<T extends { bucket: number }, R extends { t: number }>(
  rows: T[],
  window: { intervalSec: number; lookback: number; sinceSec: number },
  fromRow: (row: T) => R,
  makeEmpty: (bucketStart: number) => R,
): R[] {
  const lookup = new Map<number, T>();
  for (const r of rows) lookup.set(r.bucket, r);
  const out: R[] = [];
  for (let i = 0; i < window.lookback; i++) {
    const t = window.sinceSec + i * window.intervalSec;
    const row = lookup.get(t);
    out.push(row ? fromRow(row) : makeEmpty(t));
  }
  return out;
}

export default analytics;

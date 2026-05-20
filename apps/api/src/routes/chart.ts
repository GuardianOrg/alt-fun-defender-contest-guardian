import { Hono } from "hono";
import { getAddress, isAddress } from "viem";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";

import formatSuccess from "../utils/format-success.js";
import formatError from "../utils/format-error.js";
import { edgeCacheableJsonHeader } from "../utils/cache-control.js";
import { createDb } from "../db/client.js";
import { tokens } from "../db/schema.js";
import { tryApiDbRead } from "../lib/api-db-reads.js";
import {
  checkIndexerHealth,
  fetchTokenChartContext,
  fetchTokenChartSnapshots,
} from "../lib/indexer-reads.js";

import type { ChartTokenSnapshotRow } from "../lib/indexer-reads.js";
import type { AppBindings } from "../lib/types.js";

export const VALID_TIMEFRAMES = ["1d", "5d", "1m"] as const;
export type Timeframe = (typeof VALID_TIMEFRAMES)[number];

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1d": 86_400,
  "5d": 432_000,
  "1m": 2_592_000,
};

export const DEFAULT_CANDLE_SECONDS: Record<Timeframe, number> = {
  "1d": 300,
  "5d": 1_800,
  "1m": 14_400,
};

// Allowed candle-width values (seconds) for interval-mode requests.
// Must stay in sync with CHART_INTERVAL_SECONDS in
// `apps/web/src/services/api.ts`.
export const VALID_INTERVAL_SECONDS = new Set<number>([
  5, // 5s
  15, // 15s
  30, // 30s
  60, // 1m
  300, // 5m
  900, // 15m
  1_800, // 30m
  3_600, // 1h
  14_400, // 4h
  21_600, // 6h
  43_200, // 12h
  86_400, // 1D
]);

export const MIN_CANDLE_SECONDS = 5;
export const MAX_CANDLES = 500;

/**
 * Per-POP edge-cache TTL for `GET /chart/:address`. The chart route's
 * cost is dominated by the BounceTech `generate_series` LT-rate scan and
 * the indexer-side snapshot fetch — both bounded but each round-trips
 * Neon, so concurrent viewers of the same `(token, interval/timeframe)`
 * pair multiply origin compute and Neon-HTTP load.
 *
 * **1 second** matches `TRADES_LIVE_TAIL_TTL_SECONDS` in `routes/trades.ts`
 * (the existing project convention for live-feed endpoints) and is
 * deliberately the smallest meaningful unit on this stack:
 *
 *   - HyperEVM block time is 1 s → a cached chart is at most one
 *     block stale, which is the freshness floor of any read against
 *     the chain.
 *   - `LtTicker` DO broadcasts on the `price` channel every 1 s
 *     (matched to BounceTech's `token_snapshots_v1` write cadence),
 *     so the WS-driven live overlay refreshes at the same cadence
 *     the cache could go stale at. By the time anyone could observe
 *     a 1 s cache miss, the live overlay has already moved on.
 *
 * 1 s still collapses bursts of concurrent miss-traffic for the same
 * canonical URL into one origin compute per POP per window — chart
 * compute runs ~600-1000 ms per origin call so even sub-second TTLs
 * absorb the bulk of a thundering-herd reload (issue #973).
 *
 * Why not 3 s (the issue's original suggestion): the chart's REST
 * response feeds the frontend's in-progress-candle anchor
 * (`useChartData.ts` → `ratioRef` / `exchangeRateRef`). Tabs already
 * open are unaffected by any TTL — every `trade` WS event resets
 * `ratioRef` to the fresh post-trade value. But a fresh chart load
 * landing on a cached entry inherits a `currentRatio` that's up to
 * TTL seconds behind the live state, and stays that way until the
 * next `trade` WS event fires. On a viral pump that's milliseconds;
 * on a quiet token it doesn't matter. Either way, holding the
 * worst-case window to 1 s matches the trades live-tail and keeps
 * the chart "lively" by the same metric the rest of the live-feed
 * surfaces use.
 *
 * Set on every 200 response from this route. Error returns (400 / 404 /
 * 503 / 500) are uncached — temporary upstream failures must not pin
 * a bad response in the edge for the TTL window. See issue #973.
 */
export const CHART_CACHE_TTL_SECONDS = 1;

// Maximum number of historical candles the API will hydrate per request.
// The frontend defaults its visible viewport to a much smaller window (120
// candles for interval mode, the timeframe window for timeframe mode) but
// loads everything below so users can zoom/scroll left without re-fetching.
// Caps the LT-rate `generate_series` row count at `MAX_HISTORY_CANDLES × 3`
// (see `sampleSec` below) regardless of how far back the token launched.
//
// Sized at 4× the largest viewport (`INTERVAL_MODE_BAR_COUNT = 120`, see
// `apps/web/src/services/api.ts`) so users can scroll/zoom left over a
// generous margin without re-fetching, while keeping the direct-Postgres
// snapshot scan and the LT-rate `generate_series` row count bounded. Was
// 1500 in the GraphQL-paginated era (PR #951 cutover) where the cost was
// `MAX_PAGES`-bounded rather than row-count proportional. See issue #977.
export const MAX_HISTORY_CANDLES = 500;

export interface RatioSnapshot {
  timestamp: number;
  ratio: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface LtSnapshotRow {
  ts: string;
  exchange_rate: string;
}

/**
 * Virtual `reserve0` at launch (= `Pair.mint`'s `TOTAL_SUPPLY`, 1B × 1e18).
 * The AMM constant-product invariant is `k = reserve0 × reserve1`, so the
 * launch-time virtual LT reserve is `k / reserve0_initial = k / 1B × 1e18`.
 * Used as the denominator when seeding the ratio timeline before the first
 * indexed trade snapshot — using the "real curve supply" (750M) here would
 * undershoot the launch price by ~78% and produce a phantom green candle on
 * fresh tokens.
 */
export const CURVE_RESERVE0_AT_LAUNCH = 1_000_000_000n * 10n ** 18n;
const RATIO_PRECISION = 10n ** 18n;

function bigintRatio(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  return Number((numerator * RATIO_PRECISION) / denominator) / 1e18;
}

export function buildRatioTimeline(
  k: bigint,
  launchTimestamp: number,
  snapshots: ChartTokenSnapshotRow[],
): RatioSnapshot[] {
  // `k` from `Pair.mint` is `reserve0 × reserve1` with NO fixed-point
  // factor (`packages/contracts/src/Pair.sol`), so the launch-time virtual
  // LT reserve is plain integer division. `bigintRatio` already applies
  // `RATIO_PRECISION` internally — pre-scaling here inflates the anchor
  // ratio by 1e18 and produces a phantom price spike at launch.
  const initialLtReserve = k / CURVE_RESERVE0_AT_LAUNCH;
  const initialRatio = bigintRatio(initialLtReserve, CURVE_RESERVE0_AT_LAUNCH);

  const out: RatioSnapshot[] = [
    { timestamp: launchTimestamp, ratio: initialRatio },
  ];

  for (const t of snapshots) {
    const curveSupply = BigInt(t.curveSupply);
    const ltReserve = BigInt(t.ltReserve);
    if (curveSupply === 0n) continue;

    out.push({
      timestamp: Number(t.timestamp),
      ratio: bigintRatio(ltReserve, curveSupply),
    });
  }

  return out;
}

export function buildCandles(
  prices: { ts: number; price: number }[],
  candleSec: number,
): Candle[] {
  if (prices.length === 0) return [];

  const candleMap = new Map<number, Candle>();
  const candles: Candle[] = [];

  for (const p of prices) {
    const bucketTs = Math.floor(p.ts / candleSec) * candleSec;

    const existing = candleMap.get(bucketTs);
    if (existing) {
      existing.high = Math.max(existing.high, p.price);
      existing.low = Math.min(existing.low, p.price);
      existing.close = p.price;
    } else {
      const candle: Candle = {
        time: bucketTs,
        open: p.price,
        high: p.price,
        low: p.price,
        close: p.price,
      };
      candleMap.set(bucketTs, candle);
      candles.push(candle);
    }
  }

  return candles;
}

/**
 * Build the raw price timeline from the two source streams:
 *
 *   - `ltRows`: BounceTech LT exchange-rate samples taken at fixed
 *     `sampleSec` intervals across `[fromSec, nowSec]`.
 *   - `ratioTimeline`: curve-ratio snapshots — one per indexed
 *     `Bonding.Trade` (curve phase) and `HyperSwapPair.Sync` (post-grad),
 *     plus the synthetic launch anchor at `launchTimestamp`.
 *
 * Every event from BOTH streams produces a price tick (`ratio × rate`) at
 * its actual timestamp. This is the fix for issue #599 ("Candles not
 * showing in full"): the previous implementation only iterated `ltRows`,
 * so a trade landing strictly between two LT samples (e.g. a buy at
 * t=12:34:55 with samples at 12:34:40 and 12:35:00) was invisible to the
 * bucket containing it. The bucket showed all-pre-buy prices (flat
 * doji), the next bucket opened at the post-buy price, and the chart
 * rendered a tiny horizontal line followed by a discontinuous jump.
 *
 * Injecting the ratio timestamps as their own price ticks closes that
 * gap — every trade lands in its own bucket regardless of where the LT
 * sampling grid happens to align. The exchange rate used for an injected
 * ratio tick is the most recent LT sample at or before that timestamp
 * (matches the SQL `tick_timestamp <= s.t` semantic used to build
 * `ltRows`); ratio ticks before the first LT sample are skipped because
 * we have no rate to multiply against.
 *
 * Additionally, whenever event iteration crosses into a new candle
 * bucket and the first event in that bucket is NOT at the bucket
 * boundary, a synthetic carry-forward tick is emitted at the bucket
 * boundary using the most recent known ratio × exchange rate. This
 * makes the server-rebuilt timeline behave like the live aggregator
 * (which initialises each new bucket from the ~1 s LT WebSocket tick
 * that crosses the boundary). Without it, a trade landing in the first
 * `sampleSec` seconds of a bucket — before any LT sample of that bucket
 * — would set `open = post-trade price`, leaving the previous bucket's
 * close at the pre-trade price and the chart rendering as two flat
 * lines with a vertical gap instead of a candle body. The issue #599
 * fix injected trade timestamps as ticks but didn't cover this
 * trade-before-first-LT-sample alignment case.
 *
 * Exported for unit testing.
 */
export function buildPriceTimeline(
  ltRows: LtSnapshotRow[],
  ratioTimeline: RatioSnapshot[],
  candleSec: number,
): { ts: number; price: number }[] {
  if (ltRows.length === 0 || ratioTimeline.length === 0) return [];

  type Event =
    | { kind: "lt"; ts: number; rate: number }
    | { kind: "ratio"; ts: number };

  const events: Event[] = [];
  for (const row of ltRows) {
    events.push({
      kind: "lt",
      ts: Number(row.ts),
      rate: Number(row.exchange_rate) / 1e18,
    });
  }
  for (const r of ratioTimeline) {
    events.push({ kind: "ratio", ts: r.timestamp });
  }
  // Stable sort by timestamp; on ties, LT events first so a coincident
  // ratio change picks up the freshest exchange rate (and the ratio's
  // higher/lower price becomes the bucket's close, matching trade-then-
  // settle ordering of an on-chain block).
  events.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    if (a.kind !== b.kind) return a.kind === "lt" ? -1 : 1;
    return 0;
  });

  const out: { ts: number; price: number }[] = [];
  let ratioIdx = 0;
  let exchangeRate = 0;
  // Bucket of the last emitted real tick; -1 before any event has been
  // emitted. Used to detect when we cross into a new bucket and need to
  // inject a carry-forward boundary tick. Tracking emitted (rather than
  // observed) buckets ensures pre-rate ratio events that get skipped
  // don't suppress the boundary tick for the first real bucket.
  let lastEmittedBucketTs = -1;

  for (const e of events) {
    const bucketTs = Math.floor(e.ts / candleSec) * candleSec;

    // Crossing into a new bucket: inject a synthetic carry-forward tick
    // at the boundary so the new bucket's `open` is the most recent
    // known price, not whatever the first in-bucket real event happens
    // to be. Uses the state BEFORE this event is applied — the boundary
    // tick reflects the state at `bucketTs`, the new event's effects
    // appear at `e.ts`.
    //
    // Suppressed in one case: when the event is an LT sample exactly at
    // the boundary (`e.kind === "lt" && e.ts === bucketTs`). That event
    // is itself the bucket's first real tick — it carries the current
    // (pre-event) ratio against an updated rate, which is exactly the
    // right "open" for the new bucket; a synthetic tick at the same
    // timestamp would just duplicate it. For a ratio event at the
    // boundary (a trade whose timestamp happens to coincide with a
    // candle edge — ~20% of integer-second trades on 5s candles, ~1.7%
    // on 60s) we DO emit the synthetic. Otherwise the trade tick is the
    // bucket's first event and `open` collapses to the post-trade price,
    // producing the same gap-with-no-body that issue #599 + the prior
    // fix were meant to eliminate.
    if (
      lastEmittedBucketTs >= 0 &&
      bucketTs > lastEmittedBucketTs &&
      (e.ts > bucketTs || e.kind === "ratio") &&
      exchangeRate > 0 &&
      ratioTimeline[ratioIdx].timestamp <= bucketTs
    ) {
      out.push({
        ts: bucketTs,
        price: ratioTimeline[ratioIdx].ratio * exchangeRate,
      });
      lastEmittedBucketTs = bucketTs;
    }

    if (e.kind === "lt") {
      exchangeRate = e.rate;
    }
    while (
      ratioIdx + 1 < ratioTimeline.length &&
      ratioTimeline[ratioIdx + 1].timestamp <= e.ts
    ) {
      ratioIdx++;
    }
    if (ratioTimeline[ratioIdx].timestamp > e.ts) continue;
    if (exchangeRate <= 0) continue;
    out.push({ ts: e.ts, price: ratioTimeline[ratioIdx].ratio * exchangeRate });
    lastEmittedBucketTs = bucketTs;
  }

  return out;
}

/**
 * Candle snapshot for a token. Reads the chart's two source streams
 * directly from Postgres:
 *
 *   - `ponder_views.token` for the launch context (`k`, `ltToken`,
 *     `timestamp`) — needed to seed the ratio timeline anchor.
 *   - `ponder_views.token_snapshot` for the per-trade curve state
 *     (`curveSupply`, `ltReserve`, `timestamp`). The same table is
 *     written on every `Bonding.Trade` (curve phase) and every
 *     `HyperSwapPair.Sync` (post-graduation), so one query covers both
 *     phases with no special-casing.
 *   - BounceTech's `token_snapshots_v1` for the LT-rate stream
 *     (`generate_series` × `LATERAL` forward-fill).
 *
 * Predecessor design (retired by [issue]/PR cut-over): the chart route
 * resolved the same data via the Ponder GraphQL hop:
 *
 *   1. Up-front Ponder health probe (`{ __typename }`).
 *   2. Per-token `token { k, ltToken, graduated, graduatedAt, timestamp }`.
 *   3. Paginated `tokenSnapshots(where: { tokenAddress, timestamp_gte: … })`
 *      capped at `MAX_PAGES × 1000 = 20,000` rows — anything wider returned
 *      a 503 "Trade history too large to build accurate chart", which the
 *      frontend swallowed as an empty canvas.
 *   4. Standalone pre-window anchor `tokenSnapshots(timestamp_lt: …, limit: 1)`.
 *
 * The cut-over replaces all four with two helpers in `lib/indexer-reads.ts`
 * (`fetchTokenChartContext` + `fetchTokenChartSnapshots`) and the existing
 * `checkIndexerHealth` probe. The 20K row cap is gone — Postgres returns
 * every row in one shot, no `truncated` branch needed. Direct-Postgres
 * latency is bounded by the BounceTech `generate_series` query (which is
 * unchanged — that side was already direct SQL); the GraphQL hop overhead
 * disappears from cold paths, where the legacy route's tail latency could
 * stretch past 25 seconds when the Ponder Node process was cold or
 * saturated.
 *
 * Side-by-side parity (139/140 byte-identical responses; 1 transient live
 * data drift) was verified on prod before this cut-over.
 */
const chart = new Hono<{ Bindings: AppBindings }>();

/**
 * Resolve the Worker's Cache API binding, or `undefined` in environments
 * (some tests, `wrangler dev` without cache emulation) where the global
 * isn't present. Same pattern as `routes/market-data.ts` and
 * `routes/trades.ts` — kept inline so the route file stays a single
 * import surface.
 */
function getCache(): Cache | undefined {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default;
}

/**
 * Shape of every 200-success response from this route, used by the
 * `respondWithEdgeCache` helper to keep `c.json(body)` from triggering
 * TS2589 ("type instantiation is excessively deep") via Hono's full
 * generic `c.json` signature. The three real success branches all
 * resolve to this shape via `formatSuccess`.
 */
type ChartSuccessBody = {
  readonly status: "success";
  readonly data: {
    candles: Candle[];
    currentRatio: number;
    currentExchangeRate: number;
  };
  readonly error: null;
};

chart.get("/:address", async (c) => {
  /**
   * Build a 200-success response, stamp the edge-cache directive, and
   * (best-effort) admit the response to `caches.default` under the
   * canonical request URL so subsequent same-URL requests inside the
   * TTL window short-circuit at the pre-auth `serveFromEdgeCache`
   * middleware. Only used on success paths — error returns (400 / 404 /
   * 503 / 500) bypass this helper so transient upstream failures never
   * get pinned in the edge for the TTL window. See issue #973.
   *
   * The cache key matches the read key the middleware uses
   * (`new Request(c.req.url, { method: "GET" })`), so writes here are
   * picked up verbatim on the next request. `response.clone()` is
   * required because a `Response` body can only be consumed once and the
   * original is about to be returned to the caller.
   */
  const respondWithEdgeCache = async (body: ChartSuccessBody) => {
    const response = c.json(body);
    response.headers.set(
      "Cache-Control",
      edgeCacheableJsonHeader(CHART_CACHE_TTL_SECONDS),
    );
    const cache = getCache();
    if (cache) {
      // Best-effort write — a `cache.put` rejection (e.g. response
      // body exceeding the per-entry size limit, or a transient
      // Cache API hiccup) must NOT turn a perfectly good 200 into a
      // 500. Swallow the rejection, log structured for ops triage,
      // and return the response anyway. CodeRabbit feedback on PR
      // #984.
      await cache
        .put(new Request(c.req.url, { method: "GET" }), response.clone())
        .catch((err: unknown) => {
          console.log(
            JSON.stringify({
              level: "warn",
              event: "chart_cache_put_failed",
              error: err instanceof Error ? err.message : String(err),
              url: c.req.url,
              timestamp: new Date().toISOString(),
            }),
          );
        });
    }
    return response;
  };

  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = rawAddress.toLowerCase();

  // Two request shapes are supported:
  //   - `?timeframe=1d|5d|1m` (+ optional `?interval=<sec>` override) — candle
  //     width defaults per-timeframe.
  //   - `?interval=<sec>` alone — candle width is picked by the client.
  // Defaults to `interval=60` (1m) when neither is provided. The data range
  // we return is independent of these knobs (see `historySec` below) — they
  // only control the candle bucket size; the viewport is a frontend concern.
  const rawTimeframe = c.req.query("timeframe");
  const rawInterval = c.req.query("interval");

  let candleSec: number;

  // Strict integer parser — rejects partial-numeric values like "60abc"
  // (which `parseInt` would otherwise accept) and non-finite inputs.
  const parseStrictInt = (raw: string): number | null => {
    if (!/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isInteger(n) ? n : null;
  };

  if (rawTimeframe === undefined && rawInterval !== undefined) {
    const parsed = parseStrictInt(rawInterval);
    if (parsed === null || !VALID_INTERVAL_SECONDS.has(parsed)) {
      return c.json(
        formatError(
          `Invalid interval. Supported (seconds): ${Array.from(VALID_INTERVAL_SECONDS).join(", ")}`,
        ),
        400,
      );
    }
    candleSec = parsed;
  } else if (rawTimeframe !== undefined) {
    const timeframe = rawTimeframe;
    if (!VALID_TIMEFRAMES.includes(timeframe as Timeframe)) {
      return c.json(
        formatError(
          `Invalid timeframe. Supported: ${VALID_TIMEFRAMES.join(", ")}`,
        ),
        400,
      );
    }

    const tf = timeframe as Timeframe;
    const windowSec = TIMEFRAME_SECONDS[tf];
    candleSec = DEFAULT_CANDLE_SECONDS[tf];
    if (rawInterval) {
      const parsed = parseStrictInt(rawInterval);
      if (parsed !== null && parsed >= MIN_CANDLE_SECONDS) {
        candleSec = Math.max(parsed, Math.ceil(windowSec / MAX_CANDLES));
      }
    }
  } else {
    // Neither knob — default candle width is 1m (matches the frontend's
    // default `ChartMode` of `{ kind: "interval", seconds: 60 }`).
    candleSec = 60;
  }

  // ~3 LT-rate samples per candle is enough to capture intra-candle high/low
  // without flooding the BounceTech `generate_series` query. `Math.ceil`
  // (not `floor`) so 5s candles use sampleSec=2 (3 samples per candle) — a
  // floor here would yield sampleSec=1 and double the row count from
  // `MAX_HISTORY_CANDLES × 3` (~1500) to `× 5` (~2500). Floor of 1s preserves
  // monotonic step size for the 5s case (otherwise ceil(5/3) is already 2).
  const sampleSec = Math.max(1, Math.ceil(candleSec / 3));

  const db = createDb(c.env.DATABASE_URL);

  // Fan out the three indexer-side reads (DB token row, indexer health
  // probe, chart context) in parallel — only the rare `tokenInfo?.ltToken`
  // fallback below cares about ordering. Shaves ~2 round-trips off the
  // chart's wall-clock latency. See issue #485 for the original parallel
  // fan-out rationale; the helpers behind it changed from Ponder GraphQL
  // to direct-Postgres in the cut-over.
  const [dbTokenResult, indexerHealthy, chartContext] = await Promise.all([
    tryApiDbRead(
      "api_db.chart_token_lookup",
      () =>
        db
          .select({ ltPair: tokens.ltPair })
          .from(tokens)
          .where(eq(tokens.address, getAddress(rawAddress)))
          .limit(1),
      { address: rawAddress },
    ),
    checkIndexerHealth(db),
    fetchTokenChartContext(db, address),
  ]);

  if (!indexerHealthy) {
    return c.json(
      formatError("Indexer unavailable — chart data cannot be loaded"),
      503,
    );
  }

  if (chartContext === "unavailable") {
    return c.json(
      formatError("Indexer unavailable — chart data cannot be loaded"),
      503,
    );
  }

  if (dbTokenResult === null) {
    return c.json(
      formatError("Token metadata unavailable — chart data cannot be loaded"),
      503,
    );
  }

  const [dbToken] = dbTokenResult;

  const ltAddress = dbToken?.ltPair ?? chartContext?.ltToken;

  if (!ltAddress) {
    return c.json(
      formatError("Token not found or LT address unavailable"),
      404,
    );
  }

  const k = chartContext?.k ? BigInt(chartContext.k) : null;
  const launchTimestamp = chartContext?.timestamp
    ? Number(chartContext.timestamp)
    : 0;

  const nowSec = Math.floor(Date.now() / 1000);
  // Hydrate the full history the client needs for free zoom/scroll, capped at
  // `MAX_HISTORY_CANDLES × candleSec` so the LT-rate query doesn't fan out for
  // old tokens on fine intervals. The viewport window is purely a frontend
  // concern — see `apps/web/src/hooks/useChart.ts` setVisibleRange.
  const historySec = candleSec * MAX_HISTORY_CANDLES;
  const earliestFromSec = nowSec - historySec;
  const fromSec =
    launchTimestamp > 0
      ? Math.max(earliestFromSec, launchTimestamp)
      : earliestFromSec;

  const checksummedLt = getAddress(ltAddress);

  if (!c.env.BOUNCETECH_DATABASE_URL) {
    // Log the specific binding name server-side for ops triage, but
    // return a generic error to the client — the binding name is an
    // internal deployment detail (see project rule: never expose
    // internal error details to clients).
    console.error(
      "chart route misconfigured: BOUNCETECH_DATABASE_URL binding is missing",
    );
    return c.json(formatError("Internal server error"), 500);
  }
  const btSql = neon(c.env.BOUNCETECH_DATABASE_URL);

  const [ltRows, snapshotItems] = await Promise.all([
    btSql`
      SELECT
        extract(epoch from s.t)::bigint AS ts,
        t.exchange_rate::text AS exchange_rate
      FROM generate_series(
        to_timestamp(${fromSec}),
        to_timestamp(${nowSec}),
        make_interval(secs => ${sampleSec})
      ) AS s(t)
      CROSS JOIN LATERAL (
        SELECT exchange_rate
        FROM token_snapshots_v1
        WHERE token_address = ${checksummedLt}
          AND tick_timestamp <= s.t
        ORDER BY tick_timestamp DESC
        LIMIT 1
      ) t
      ORDER BY s.t
    ` as unknown as Promise<LtSnapshotRow[]>,
    fetchTokenChartSnapshots(db, address, fromSec),
  ]);

  if (ltRows.length === 0) {
    return respondWithEdgeCache(
      formatSuccess({
        candles: [],
        currentRatio: 0,
        currentExchangeRate: 0,
      }),
    );
  }

  // `fetchTokenChartSnapshots` returns `null` only on caught error (the
  // indexer DB became unreachable between the up-front health probe and
  // this query). Bubble it up as 503 so the client retries instead of
  // rendering against an empty ratio timeline.
  if (snapshotItems === null) {
    return c.json(
      formatError("Indexer unavailable — chart data cannot be loaded"),
      503,
    );
  }

  const ratioTimeline =
    k && k > 0n
      ? buildRatioTimeline(k, launchTimestamp, snapshotItems)
      : snapshotItems.length > 0
        ? buildRatioTimeline(0n, launchTimestamp, snapshotItems).slice(1)
        : [];

  if (ratioTimeline.length === 0) {
    const latestExchangeRate =
      Number(ltRows[ltRows.length - 1].exchange_rate) / 1e18;
    return respondWithEdgeCache(
      formatSuccess({
        candles: [],
        currentRatio: 0,
        currentExchangeRate: latestExchangeRate,
      }),
    );
  }

  const rawPrices = buildPriceTimeline(ltRows, ratioTimeline, candleSec);

  const candles = buildCandles(rawPrices, candleSec);

  // The client uses these to seed its live aggregator: on WS ticks it
  // recomputes `price = currentRatio × currentExchangeRate` and updates the
  // in-progress candle. Matches the formula in `@launchpad/shared`.
  const currentRatio = ratioTimeline[ratioTimeline.length - 1].ratio;
  const currentExchangeRate =
    Number(ltRows[ltRows.length - 1].exchange_rate) / 1e18;

  return respondWithEdgeCache(
    formatSuccess({
      candles,
      currentRatio,
      currentExchangeRate,
    }),
  );
});

export default chart;

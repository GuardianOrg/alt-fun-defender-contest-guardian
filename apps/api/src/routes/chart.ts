import { Hono } from "hono";
import { getAddress, isAddress } from "viem";
import { neon } from "@neondatabase/serverless";

import formatSuccess from "../utils/format-success.js";
import formatError from "../utils/format-error.js";
import {
  createPonderQuery,
  createPonderPaginatedQuery,
} from "../lib/ponder-client.js";
import { createDb } from "../db/client.js";
import { tokens } from "../db/schema.js";
import { eq } from "drizzle-orm";

import type { AppBindings } from "../lib/types.js";

const VALID_TIMEFRAMES = ["1d", "5d", "1m"] as const;
type Timeframe = (typeof VALID_TIMEFRAMES)[number];

const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1d": 86_400,
  "5d": 432_000,
  "1m": 2_592_000,
};

const DEFAULT_CANDLE_SECONDS: Record<Timeframe, number> = {
  "1d": 300,
  "5d": 1_800,
  "1m": 14_400,
};

// Allowed candle-width values (seconds) for interval-mode requests.
// Must stay in sync with CHART_INTERVAL_SECONDS in
// `apps/web/src/services/api.ts`.
const VALID_INTERVAL_SECONDS = new Set<number>([
  5,        // 5s
  15,       // 15s
  30,       // 30s
  60,       // 1m
  300,      // 5m
  900,      // 15m
  1_800,    // 30m
  3_600,    // 1h
  14_400,   // 4h
  21_600,   // 6h
  43_200,   // 12h
  86_400,   // 1D
]);

const MIN_CANDLE_SECONDS = 5;
const MAX_CANDLES = 500;

// Maximum number of historical candles the API will hydrate per request.
// The frontend defaults its visible viewport to a much smaller window (120
// candles for interval mode, the timeframe window for timeframe mode) but
// loads everything below so users can zoom/scroll left without re-fetching.
// Caps the LT-rate `generate_series` row count at `MAX_HISTORY_CANDLES × 3`
// (see `sampleSec` below) regardless of how far back the token launched.
const MAX_HISTORY_CANDLES = 1_500;

interface PonderTokenSnapshot {
  curveSupply: string;
  ltReserve: string;
  timestamp: string;
}

interface PonderTokenInfo {
  k: string;
  ltToken: string;
  graduated: boolean;
  graduatedAt: string | null;
  timestamp: string;
}

interface RatioSnapshot {
  timestamp: number;
  ratio: number;
}

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface LtSnapshotRow {
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
const CURVE_RESERVE0_AT_LAUNCH = 1_000_000_000n * 10n ** 18n;
const RATIO_PRECISION = 10n ** 18n;

function bigintRatio(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  return Number((numerator * RATIO_PRECISION) / denominator) / 1e18;
}

function buildRatioTimeline(
  k: bigint,
  launchTimestamp: number,
  snapshots: PonderTokenSnapshot[],
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

function buildCandles(
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

const chart = new Hono<{ Bindings: AppBindings }>();

chart.get("/:address", async (c) => {
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
  // `MAX_HISTORY_CANDLES × 3` (~4500) to `× 5` (~7500). Floor of 1s preserves
  // monotonic step size for the 5s case (otherwise ceil(5/3) is already 2).
  const sampleSec = Math.max(1, Math.ceil(candleSec / 3));

  const db = createDb(c.env.DATABASE_URL);
  const queryPonder = createPonderQuery(c.env.PONDER_URL);

  // These three calls have no real interdependency for the common case (DB
  // token row exists). Only the rare `tokenInfo?.ltToken` fallback below cares
  // about ordering, so fan them out in parallel and reconcile afterwards —
  // shaves ~2 round-trips off the chart's wall-clock latency. See issue #485.
  const [dbTokenResult, healthCheck, ponderToken] = await Promise.all([
    db
      .select({ ltPair: tokens.ltPair })
      .from(tokens)
      .where(eq(tokens.address, getAddress(rawAddress)))
      .limit(1),
    queryPonder<{ __typename: string }>("{ __typename }"),
    queryPonder<{ token: PonderTokenInfo | null }>(
      `query ($address: String!) {
        token(address: $address) {
          k
          ltToken
          graduated
          graduatedAt
          timestamp
        }
      }`,
      { address },
    ),
  ]);

  if (healthCheck === null) {
    return c.json(formatError("Indexer unavailable — chart data cannot be loaded"), 503);
  }

  const [dbToken] = dbTokenResult;

  const tokenInfo = ponderToken?.token;
  const ltAddress = dbToken?.ltPair ?? tokenInfo?.ltToken;

  if (!ltAddress) {
    return c.json(
      formatError("Token not found or LT address unavailable"),
      404,
    );
  }

  const k = tokenInfo?.k ? BigInt(tokenInfo.k) : null;
  const launchTimestamp = tokenInfo?.timestamp
    ? Number(tokenInfo.timestamp)
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
    return c.json(formatError("BOUNCETECH_DATABASE_URL is not configured"), 500);
  }
  const btSql = neon(c.env.BOUNCETECH_DATABASE_URL);

  const [ltRows, snapshotsResult] = await Promise.all([
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
    // Pulls from `tokenSnapshot`, which is written on every `Bonding.Trade`
    // (curve phase) AND every `HyperSwapPair.Sync` (post-graduation). One
    // query covers both phases so a graduated token's chart keeps moving
    // with HyperSwap reserve changes — see `apps/indexer/src/hyperswap.ts`.
    //
    // Filters by `timestamp_gte: fromSec` so we only paginate the slice the
    // chart actually consumes — without this, mature tokens with months of
    // trade history fan out to up to `MAX_PAGES × PAGE_SIZE` (20K) sequential
    // GraphQL rows even when the visible window is the last hour. The
    // anchor-before-window query that runs in parallel preserves the ratio
    // baseline so the first in-window LT-rate sample still has a price to
    // multiply against (no phantom green candle at `fromSec`).
    (async () => {
      const queryPonderAll = createPonderPaginatedQuery(c.env.PONDER_URL);
      const [windowResult, anchor] = await Promise.all([
        queryPonderAll<PonderTokenSnapshot>(
          `query ($address: String!, $fromSec: BigInt!, $limit: Int!, $offset: Int!) {
            tokenSnapshots(
              where: { tokenAddress: $address, timestamp_gte: $fromSec }
              limit: $limit
              offset: $offset
              orderBy: "timestamp"
              orderDirection: "asc"
            ) {
              items {
                curveSupply
                ltReserve
                timestamp
              }
            }
          }`,
          "tokenSnapshots",
          { address, fromSec: String(fromSec) },
        ),
        queryPonder<{
          tokenSnapshots: { items: PonderTokenSnapshot[] } | null;
        }>(
          `query ($address: String!, $fromSec: BigInt!) {
            tokenSnapshots(
              where: { tokenAddress: $address, timestamp_lt: $fromSec }
              orderBy: "timestamp"
              orderDirection: "desc"
              limit: 1
            ) {
              items {
                curveSupply
                ltReserve
                timestamp
              }
            }
          }`,
          { address, fromSec: String(fromSec) },
        ),
      ]);

      // Distinguish the three anchor outcomes:
      //   (a) `anchor === null` → `queryPonder` returned null (transient
      //       Ponder failure mid-request, after the up-front health check
      //       passed). Silently falling back to "no prior snapshot" would
      //       recreate the phantom-opening-candle bug this query exists to
      //       prevent — a token with real trades between launch and
      //       `fromSec` would price the early window against the launch
      //       anchor instead of its most recent pre-window snapshot. Bubble
      //       it up as `truncated` so the existing 503 handler signals
      //       degraded indexer data instead of rendering a wrong chart.
      //   (b) `anchor.tokenSnapshots.items === []` → genuinely no snapshot
      //       before `fromSec` (e.g. token launched inside the window or
      //       has had zero indexed trades pre-window). Safe to proceed —
      //       the launch anchor inside `buildRatioTimeline` is the right
      //       baseline.
      //   (c) `anchor.tokenSnapshots.items.length > 0` → prepend the single
      //       pre-window snapshot so the timeline has a ratio at `fromSec`.
      if (anchor === null) {
        return { items: windowResult.items, truncated: true };
      }
      const anchorItems = anchor.tokenSnapshots?.items ?? [];
      return {
        items: [...anchorItems, ...windowResult.items],
        truncated: windowResult.truncated,
      };
    })(),
  ]);

  if (ltRows.length === 0) {
    return c.json(
      formatSuccess({
        candles: [],
        currentRatio: 0,
        currentExchangeRate: 0,
      }),
    );
  }

  if (snapshotsResult.truncated) {
    return c.json(
      formatError("Trade history too large to build accurate chart"),
      503,
    );
  }

  const snapshots = snapshotsResult.items;
  const ratioTimeline =
    k && k > 0n
      ? buildRatioTimeline(k, launchTimestamp, snapshots)
      : snapshots.length > 0
        ? buildRatioTimeline(0n, launchTimestamp, snapshots).slice(1)
        : [];

  if (ratioTimeline.length === 0) {
    const latestExchangeRate =
      Number(ltRows[ltRows.length - 1].exchange_rate) / 1e18;
    return c.json(
      formatSuccess({
        candles: [],
        currentRatio: 0,
        currentExchangeRate: latestExchangeRate,
      }),
    );
  }

  const rawPrices: { ts: number; price: number }[] = [];
  let ratioIdx = 0;

  for (const row of ltRows) {
    const ts = Number(row.ts);

    while (
      ratioIdx + 1 < ratioTimeline.length &&
      ratioTimeline[ratioIdx + 1].timestamp <= ts
    ) {
      ratioIdx++;
    }

    if (ratioTimeline[ratioIdx].timestamp > ts) continue;

    const exchangeRate = Number(row.exchange_rate) / 1e18;
    rawPrices.push({ ts, price: ratioTimeline[ratioIdx].ratio * exchangeRate });
  }

  const candles = buildCandles(rawPrices, candleSec);

  // The client uses these to seed its live aggregator: on WS ticks it
  // recomputes `price = currentRatio × currentExchangeRate` and updates the
  // in-progress candle. Matches the formula in `@launchpad/shared`.
  const currentRatio = ratioTimeline[ratioTimeline.length - 1].ratio;
  const currentExchangeRate =
    Number(ltRows[ltRows.length - 1].exchange_rate) / 1e18;

  return c.json(
    formatSuccess({
      candles,
      currentRatio,
      currentExchangeRate,
    }),
  );
});

export default chart;

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
  60,       // 1m
  180,      // 3m
  300,      // 5m
  900,      // 15m
  3_600,    // 1h
  7_200,    // 2h
  14_400,   // 4h
  28_800,   // 8h
  43_200,   // 12h
  86_400,   // 1D
  259_200,  // 3D
  604_800,  // 1W
]);

// Number of candle buckets rendered when the client picks an interval without
// a timeframe. 120 keeps the wall of bars reasonable on a typical chart
// viewport (and well under MAX_CANDLES for the largest interval).
const INTERVAL_MODE_BAR_COUNT = 120;

const MIN_CANDLE_SECONDS = 60;
const MAX_CANDLES = 500;

interface PonderBondingTrade {
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

const CURVE_SUPPLY_INITIAL = 750_000_000n * 10n ** 18n;
const RATIO_PRECISION = 10n ** 18n;

function bigintRatio(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  return Number((numerator * RATIO_PRECISION) / denominator) / 1e18;
}

function buildRatioTimeline(
  k: bigint,
  launchTimestamp: number,
  trades: PonderBondingTrade[],
): RatioSnapshot[] {
  const initialLtReserve = (k * RATIO_PRECISION) / CURVE_SUPPLY_INITIAL;
  const initialRatio = bigintRatio(initialLtReserve, CURVE_SUPPLY_INITIAL);

  const snapshots: RatioSnapshot[] = [
    { timestamp: launchTimestamp, ratio: initialRatio },
  ];

  for (const t of trades) {
    const curveSupply = BigInt(t.curveSupply);
    const ltReserve = BigInt(t.ltReserve);
    if (curveSupply === 0n) continue;

    snapshots.push({
      timestamp: Number(t.timestamp),
      ratio: bigintRatio(ltReserve, curveSupply),
    });
  }

  return snapshots;
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
  //   - `?timeframe=1d|5d|1m` (+ optional `?interval=<sec>` override) — window
  //     is fixed by the timeframe, candle width defaults per-timeframe.
  //   - `?interval=<sec>` alone — candle width is picked by the client, window
  //     auto-sizes to INTERVAL_MODE_BAR_COUNT buckets so the chart has a
  //     sensible default viewport.
  // Defaults to `timeframe=1d` when neither is provided, matching the
  // pre-interval-selector behaviour.
  const rawTimeframe = c.req.query("timeframe");
  const rawInterval = c.req.query("interval");

  let windowSec: number;
  let candleSec: number;

  if (rawTimeframe === undefined && rawInterval !== undefined) {
    const parsed = parseInt(rawInterval, 10);
    if (Number.isNaN(parsed) || !VALID_INTERVAL_SECONDS.has(parsed)) {
      return c.json(
        formatError(
          `Invalid interval. Supported (seconds): ${Array.from(VALID_INTERVAL_SECONDS).join(", ")}`,
        ),
        400,
      );
    }
    candleSec = parsed;
    windowSec = candleSec * INTERVAL_MODE_BAR_COUNT;
  } else {
    const timeframe = (rawTimeframe ?? "1d") as string;
    if (!VALID_TIMEFRAMES.includes(timeframe as Timeframe)) {
      return c.json(
        formatError(
          `Invalid timeframe. Supported: ${VALID_TIMEFRAMES.join(", ")}`,
        ),
        400,
      );
    }

    const tf = timeframe as Timeframe;
    windowSec = TIMEFRAME_SECONDS[tf];
    candleSec = DEFAULT_CANDLE_SECONDS[tf];
    if (rawInterval) {
      const parsed = parseInt(rawInterval, 10);
      if (!Number.isNaN(parsed) && parsed >= MIN_CANDLE_SECONDS) {
        candleSec = Math.max(parsed, Math.ceil(windowSec / MAX_CANDLES));
      }
    }
  }

  const sampleSec = Math.max(10, Math.floor(candleSec / 10));

  const db = createDb(c.env.DATABASE_URL);
  const [dbToken] = await db
    .select({ ltPair: tokens.ltPair })
    .from(tokens)
    .where(eq(tokens.address, getAddress(rawAddress)))
    .limit(1);

  const queryPonder = createPonderQuery(c.env.PONDER_URL);
  const healthCheck = await queryPonder<{ __typename: string }>("{ __typename }");
  if (healthCheck === null) {
    return c.json(formatError("Indexer unavailable — chart data cannot be loaded"), 503);
  }

  const ponderToken = await queryPonder<{ token: PonderTokenInfo | null }>(
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
  );

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
  const fromSec = nowSec - windowSec;

  const checksummedLt = getAddress(ltAddress);

  if (!c.env.BOUNCETECH_DATABASE_URL) {
    return c.json(formatError("BOUNCETECH_DATABASE_URL is not configured"), 500);
  }
  const btSql = neon(c.env.BOUNCETECH_DATABASE_URL);

  const [ltRows, tradesResult] = await Promise.all([
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
    (async () => {
      const queryPonderAll = createPonderPaginatedQuery(c.env.PONDER_URL);
      return queryPonderAll<PonderBondingTrade>(
        `query ($address: String!, $limit: Int!, $offset: Int!) {
          trades(
            where: { tokenAddress: $address }
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
        "trades",
        { address },
      );
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

  if (tradesResult.truncated) {
    return c.json(
      formatError("Trade history too large to build accurate chart"),
      503,
    );
  }

  const trades = tradesResult.items;
  const ratioTimeline =
    k && k > 0n
      ? buildRatioTimeline(k, launchTimestamp, trades)
      : trades.length > 0
        ? buildRatioTimeline(0n, launchTimestamp, trades).slice(1)
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

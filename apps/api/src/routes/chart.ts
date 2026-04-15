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

function buildRatioTimeline(
  k: bigint,
  launchTimestamp: number,
  trades: PonderBondingTrade[],
): RatioSnapshot[] {
  const initialLtReserve = (k * 10n ** 18n) / CURVE_SUPPLY_INITIAL;
  const initialRatio =
    Number(initialLtReserve) / Number(CURVE_SUPPLY_INITIAL);

  const snapshots: RatioSnapshot[] = [
    { timestamp: launchTimestamp, ratio: initialRatio },
  ];

  for (const t of trades) {
    const curveSupply = BigInt(t.curveSupply);
    const ltReserve = BigInt(t.ltReserve);
    if (curveSupply === 0n) continue;

    snapshots.push({
      timestamp: Number(t.timestamp),
      ratio: Number(ltReserve) / Number(curveSupply),
    });
  }

  return snapshots;
}

function findRatioAtTime(
  snapshots: RatioSnapshot[],
  timestampSec: number,
): number | null {
  let best: RatioSnapshot | null = null;
  for (const s of snapshots) {
    if (s.timestamp <= timestampSec) {
      best = s;
    } else {
      break;
    }
  }
  return best?.ratio ?? null;
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
  const timeframe = (c.req.query("timeframe") ?? "1d") as string;

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

  const rawInterval = c.req.query("interval");
  let candleSec = DEFAULT_CANDLE_SECONDS[tf];
  if (rawInterval) {
    const parsed = parseInt(rawInterval, 10);
    if (!Number.isNaN(parsed) && parsed >= MIN_CANDLE_SECONDS) {
      candleSec = Math.max(parsed, Math.ceil(windowSec / MAX_CANDLES));
    }
  }

  const sampleSec = Math.max(1, Math.floor(candleSec / 15));

  const db = createDb(c.env.DATABASE_URL);
  const [dbToken] = await db
    .select({ ltPair: tokens.ltPair })
    .from(tokens)
    .where(eq(tokens.address, getAddress(rawAddress)))
    .limit(1);

  const queryPonder = createPonderQuery(c.env.PONDER_URL);

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
  const btSql = neon(c.env.BOUNCETECH_DATABASE_URL);

  const [ltRows, tradesResult] = await Promise.all([
    btSql`
      SELECT
        extract(epoch from tick_timestamp)::bigint AS ts,
        exchange_rate::text AS exchange_rate
      FROM token_snapshots_v1
      WHERE token_address = ${checksummedLt}
        AND tick_timestamp >= to_timestamp(${fromSec})
        AND tick_timestamp < to_timestamp(${nowSec})
        AND extract(epoch from tick_timestamp)::bigint % ${sampleSec} = 0
      ORDER BY tick_timestamp ASC
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
    return c.json(formatSuccess([]));
  }

  const trades = tradesResult.items;
  const ratioTimeline =
    k && k > 0n
      ? buildRatioTimeline(k, launchTimestamp, trades)
      : trades.length > 0
        ? buildRatioTimeline(0n, launchTimestamp, trades).slice(1)
        : [];

  if (ratioTimeline.length === 0) {
    return c.json(formatSuccess([]));
  }

  const rawPrices: { ts: number; price: number }[] = [];

  for (const row of ltRows) {
    const ts = Number(row.ts);
    const exchangeRate = Number(row.exchange_rate) / 1e18;
    const ratio = findRatioAtTime(ratioTimeline, ts);
    if (ratio === null) continue;

    rawPrices.push({ ts, price: ratio * exchangeRate });
  }

  const candles = buildCandles(rawPrices, candleSec);

  return c.json(formatSuccess(candles));
});

export default chart;

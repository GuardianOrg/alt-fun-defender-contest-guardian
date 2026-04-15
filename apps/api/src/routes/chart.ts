import { Hono } from "hono";
import { getAddress, isAddress } from "viem";

import formatSuccess from "../utils/format-success.js";
import formatError from "../utils/format-error.js";
import { createPonderQuery, createPonderPaginatedQuery } from "../lib/ponder-client.js";
import { createDb } from "../db/client.js";
import { tokens } from "../db/schema.js";
import { eq } from "drizzle-orm";

import type { AppBindings } from "../lib/types.js";

const BOUNCETECH_API = "https://api.bounce.tech";

const VALID_TIMEFRAMES = ["24h", "7d", "14d", "1m"] as const;
type Timeframe = (typeof VALID_TIMEFRAMES)[number];

interface BouncePricePoint {
  timestamp: number;
  price: number;
}

interface BouncePriceResponse {
  status: string;
  data: {
    token: string;
    timeframe: string;
    prices: BouncePricePoint[];
  };
  error: string | null;
}

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

const CURVE_SUPPLY_INITIAL = 750_000_000n * 10n ** 18n; // 75% of 1B

const ltPriceCache = new Map<string, { data: BouncePricePoint[]; ts: number }>();
const LT_CACHE_TTL: Record<Timeframe, number> = {
  "24h": 60_000,
  "7d": 300_000,
  "14d": 600_000,
  "1m": 600_000,
};

async function fetchLtPrices(
  ltAddress: string,
  timeframe: Timeframe,
): Promise<BouncePricePoint[]> {
  const cacheKey = `${ltAddress}:${timeframe}`;
  const cached = ltPriceCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < LT_CACHE_TTL[timeframe]) {
    return cached.data;
  }

  const checksummed = getAddress(ltAddress);
  const res = await fetch(
    `${BOUNCETECH_API}/token-prices/${checksummed}?timeframe=${timeframe}`,
  );
  if (!res.ok) {
    return cached?.data ?? [];
  }

  const json = (await res.json()) as BouncePriceResponse;
  const prices = json.data?.prices ?? [];

  ltPriceCache.set(cacheKey, { data: prices, ts: Date.now() });
  return prices;
}

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

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const CANDLE_SECONDS: Record<Timeframe, number> = {
  "24h": 900,      // 15min candles → ~96 candles
  "7d": 7_200,     // 2h candles   → ~84 candles
  "14d": 14_400,   // 4h candles   → ~84 candles
  "1m": 28_800,    // 8h candles   → ~90 candles
};

function buildCandles(
  prices: { timestamp: number; price: number }[],
  bucketMs: number,
): Candle[] {
  if (prices.length === 0) return [];

  const candleMap = new Map<number, Candle>();
  const candles: Candle[] = [];

  for (const p of prices) {
    const bucketTs = Math.floor(p.timestamp / bucketMs) * (bucketMs / 1000);

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
  const timeframe = (c.req.query("timeframe") ?? "24h") as string;

  if (!VALID_TIMEFRAMES.includes(timeframe as Timeframe)) {
    return c.json(
      formatError(
        `Invalid timeframe. Supported: ${VALID_TIMEFRAMES.join(", ")}`,
      ),
      400,
    );
  }

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
    return c.json(formatError("Token not found or LT address unavailable"), 404);
  }

  const k = tokenInfo?.k ? BigInt(tokenInfo.k) : null;
  const launchTimestamp = tokenInfo?.timestamp
    ? Number(tokenInfo.timestamp)
    : 0;

  const [ltPrices, tradesResult] = await Promise.all([
    fetchLtPrices(ltAddress, timeframe as Timeframe),
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

  if (ltPrices.length === 0) {
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

  const rawPrices: { timestamp: number; price: number }[] = [];

  for (const point of ltPrices) {
    const timestampSec = Math.floor(point.timestamp / 1000);
    const ratio = findRatioAtTime(ratioTimeline, timestampSec);
    if (ratio === null) continue;

    rawPrices.push({
      timestamp: point.timestamp,
      price: ratio * point.price,
    });
  }

  const bucketMs = CANDLE_SECONDS[timeframe as Timeframe] * 1000;
  const candles = buildCandles(rawPrices, bucketMs);

  return c.json(formatSuccess(candles));
});

export default chart;

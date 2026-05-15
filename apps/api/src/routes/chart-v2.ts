import { Hono } from "hono";
import { getAddress, isAddress } from "viem";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";

import formatSuccess from "../utils/format-success.js";
import formatError from "../utils/format-error.js";
import {
  buildCandles,
  buildPriceTimeline,
  buildRatioTimeline,
  DEFAULT_CANDLE_SECONDS,
  MAX_CANDLES,
  MAX_HISTORY_CANDLES,
  MIN_CANDLE_SECONDS,
  TIMEFRAME_SECONDS,
  VALID_INTERVAL_SECONDS,
  VALID_TIMEFRAMES,
} from "./chart.js";
import {
  checkIndexerHealth,
  fetchTokenChartContext,
  fetchTokenChartSnapshots,
} from "../lib/indexer-reads.js";
import { createDb } from "../db/client.js";
import { tokens } from "../db/schema.js";

import type { LtSnapshotRow, Timeframe } from "./chart.js";
import type { AppBindings } from "../lib/types.js";

/**
 * Direct-Postgres twin of `/api/v1/chart/:address` (`routes/chart.ts`).
 *
 * The legacy route resolves the four indexer-side data points it needs via
 * the Ponder GraphQL hop:
 *
 *   1. Up-front Ponder health probe (`{ __typename }`).
 *   2. Per-token `token { k, ltToken, graduated, graduatedAt, timestamp }`.
 *   3. Paginated `tokenSnapshots(where: { tokenAddress, timestamp_gte: … })`
 *      in-window snapshots (capped at `MAX_PAGES × 1000` rows with a
 *      `truncated` fallback to 503).
 *   4. Standalone pre-window anchor `tokenSnapshots(timestamp_lt: …, limit: 1)`
 *      so the first in-window LT-rate sample has a price baseline.
 *
 * This v2 route serves the same chart payload by reading the same fields
 * straight from `ponder_views.token` and `ponder_views.token_snapshot` over
 * Drizzle/Neon (see `lib/indexer-reads.ts → fetchTokenChartContext` and
 * `fetchTokenChartSnapshots`). The BounceTech LT-rate `generate_series`
 * query against `token_snapshots_v1` is unchanged — that side of the join
 * was already direct Postgres.
 *
 * The route exists as a **side-by-side companion** to the legacy endpoint,
 * not a switch: a follow-up PR will compare the two responses on prod
 * traffic and only then cut `/api/v1/chart` over. Keeping them as separate
 * mounts (`/chart` ↔ `/chart-v2`) makes the comparison trivial — fetch
 * both with identical query params, diff the JSON — and rolls back to
 * "delete the v2 mount" if the comparison surfaces a regression.
 *
 * Issue #931 retired the GraphQL hop for `/health`; this is the last
 * route still on it after the aggregate routes (#397) and the listing
 * tabs were migrated. See `apps/api/AGENTS.md` → *Aggregate routes* for
 * the broader migration pattern and `lib/indexer-reads.ts` for the
 * direct-SQL replacement contract.
 */
const chartV2 = new Hono<{ Bindings: AppBindings }>();

chartV2.get("/:address", async (c) => {
  const rawAddress = c.req.param("address");
  if (!isAddress(rawAddress)) {
    return c.json(formatError("Invalid address"), 400);
  }
  const address = rawAddress.toLowerCase();

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
    candleSec = 60;
  }

  const sampleSec = Math.max(1, Math.ceil(candleSec / 3));

  const db = createDb(c.env.DATABASE_URL);

  // Fan out the three indexer-side reads (DB token row, health probe,
  // chart context) in parallel — same shape as the legacy route. The
  // health probe was the GraphQL `{ __typename }` round-trip; here it
  // touches the indexer tables on Neon directly via `checkIndexerHealth`,
  // matching what `/health` does post-#931.
  const [dbTokenResult, indexerHealthy, chartContext] = await Promise.all([
    db
      .select({ ltPair: tokens.ltPair })
      .from(tokens)
      .where(eq(tokens.address, getAddress(rawAddress)))
      .limit(1),
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
  const historySec = candleSec * MAX_HISTORY_CANDLES;
  const earliestFromSec = nowSec - historySec;
  const fromSec =
    launchTimestamp > 0
      ? Math.max(earliestFromSec, launchTimestamp)
      : earliestFromSec;

  const checksummedLt = getAddress(ltAddress);

  if (!c.env.BOUNCETECH_DATABASE_URL) {
    console.error(
      "chart-v2 route misconfigured: BOUNCETECH_DATABASE_URL binding is missing",
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
    return c.json(
      formatSuccess({
        candles: [],
        currentRatio: 0,
        currentExchangeRate: 0,
      }),
    );
  }

  // `fetchTokenChartSnapshots` returns null only on caught error (the
  // indexer DB became unreachable between the up-front health probe and
  // this query). Bubble it up as 503 so the client retries instead of
  // rendering against an empty ratio timeline — matches the legacy
  // route's anchor-failed branch.
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
    return c.json(
      formatSuccess({
        candles: [],
        currentRatio: 0,
        currentExchangeRate: latestExchangeRate,
      }),
    );
  }

  const rawPrices = buildPriceTimeline(ltRows, ratioTimeline, candleSec);

  const candles = buildCandles(rawPrices, candleSec);

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

export default chartV2;

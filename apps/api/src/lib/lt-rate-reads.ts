/**
 * BounceTech LT exchange-rate reads for `GET /chart/:address`.
 *
 * The chart multiplies a curve ratio (from the indexer) by the LT's USD
 * exchange rate (from BounceTech's `token_snapshots_v1`) to get a price.
 * The rate side is read in two pieces:
 *
 *   - {@link fetchLtRateSeriesCached} — the historical sampling grid. This
 *     is the expensive half and the whole reason this module exists: its
 *     window is snapped onto a fixed lattice so the read is memoisable.
 *   - {@link fetchLatestLtRate} — a single newest-tick seek, so pinning
 *     the grid's far end to a lattice boundary doesn't stale the rate the
 *     frontend anchors its in-progress candle to.
 *
 * Both read the same table, so the grid and the tail never disagree about
 * what the rate was.
 */
import { neon } from "@neondatabase/serverless";

import { createIsolateTtlCache } from "../utils/isolate-ttl-cache.js";
import { describeError } from "./log-error.js";

/** One LT exchange-rate sample: unix seconds, plus the raw 18dp rate. */
export interface LtRateSample {
  ts: string;
  exchange_rate: string;
}

function logLtRateReadFailure(
  helper: string,
  error: unknown,
  context: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      level: "error",
      event: "lt_rate_read_failed",
      helper,
      ...context,
      error: describeError(error),
      timestamp: new Date().toISOString(),
    }),
  );
}

/**
 * Snap `sec` down onto a fixed `step`-second lattice. Anchored at the unix
 * epoch, not at the caller, so two requests a second apart resolve to the
 * same window and can share one cached read.
 */
export function quantiseDown(sec: number, step: number): number {
  return Math.floor(sec / step) * step;
}

/**
 * How long a resolved grid stays memoised per isolate.
 *
 * Correctness doesn't depend on this number. The key pins both ends of
 * the window and BounceTech only appends to `token_snapshots_v1`, so a
 * hit returns the rows a fresh read would. The TTL only bounds how long
 * a grid lingers in memory after `toSec` has advanced past it.
 */
const LT_RATE_SERIES_TTL_MS = 30_000;

// Flushed between test cases through the registry in
// `utils/isolate-ttl-cache.ts`, so no reset hook is needed here.
const ltRateSeriesCache = createIsolateTtlCache<LtRateSample[] | null>({
  ttlMs: LT_RATE_SERIES_TTL_MS,
  shouldCache: (value) => value !== null,
});

/**
 * Forward-filled LT exchange rate every `sampleSec` seconds across
 * `[fromSec, toSec]` — one `generate_series` row per sample, each resolved
 * by a `LATERAL` seek for the newest tick at or before it.
 *
 * The chart's dominant cost, and it scales with window width rather than
 * sample count: the seeks spread across the window, so a wide one leaves
 * most of them missing the page cache. Measured against production, a
 * 1,500-sample grid costs ~0.1 ms per sample reaching back minutes and
 * ~1.6 ms reaching back weeks — 0.3 s against 2.4 s for the same rows.
 *
 * `null` on a caught read error, matching the `indexer-reads.ts` contract
 * so the route can answer 503 rather than leaking a 500.
 */
export async function fetchLtRateSeries(
  databaseUrl: string,
  ltAddress: string,
  fromSec: number,
  toSec: number,
  sampleSec: number,
): Promise<LtRateSample[] | null> {
  const sql = neon(databaseUrl);
  try {
    return (await sql`
      SELECT
        extract(epoch from s.t)::bigint AS ts,
        t.exchange_rate::text AS exchange_rate
      FROM generate_series(
        to_timestamp(${fromSec}),
        to_timestamp(${toSec}),
        make_interval(secs => ${sampleSec})
      ) AS s(t)
      CROSS JOIN LATERAL (
        SELECT exchange_rate
        FROM token_snapshots_v1
        WHERE token_address = ${ltAddress}
          AND tick_timestamp <= s.t
        ORDER BY tick_timestamp DESC
        LIMIT 1
      ) t
      ORDER BY s.t
    `) as unknown as LtRateSample[];
  } catch (error) {
    logLtRateReadFailure("fetchLtRateSeries", error, {
      ltAddress,
      fromSec,
      toSec,
      sampleSec,
    });
    return null;
  }
}

/**
 * Memoised {@link fetchLtRateSeries}. Callers must pass a window whose
 * ends sit on a `sampleSec` lattice (see {@link quantiseDown}) — that's
 * what makes the key stable long enough to be worth caching. A window
 * ending at an unrounded "now" mints a new key every second and the memo
 * never hits.
 *
 * A failed read is not stored, so a transient database failure doesn't
 * pin an error for the TTL window.
 */
export function fetchLtRateSeriesCached(
  databaseUrl: string,
  ltAddress: string,
  fromSec: number,
  toSec: number,
  sampleSec: number,
): Promise<LtRateSample[] | null> {
  const key = `${ltAddress.toLowerCase()}|${fromSec}|${toSec}|${sampleSec}`;
  return ltRateSeriesCache.getOrFetch(key, () =>
    fetchLtRateSeries(databaseUrl, ltAddress, fromSec, toSec, sampleSec),
  );
}

/**
 * Newest LT exchange-rate tick, with no upper time bound. Deliberately
 * uncached and unbounded: this is the value the frontend folds with the
 * live `price` WebSocket feed, so it has to reflect the latest write. One
 * index seek against the table's newest page, so it costs a fraction of a
 * single grid sample.
 *
 * `null` means the LT genuinely has no ticks; `"unavailable"` means the
 * read failed. Kept distinct — the first is a legitimate empty chart, the
 * second is a 503 — matching how `fetchTokenChartContext` splits the two.
 */
export async function fetchLatestLtRate(
  databaseUrl: string,
  ltAddress: string,
): Promise<LtRateSample | null | "unavailable"> {
  const sql = neon(databaseUrl);
  try {
    const rows = (await sql`
      SELECT
        extract(epoch from tick_timestamp)::bigint AS ts,
        exchange_rate::text AS exchange_rate
      FROM token_snapshots_v1
      WHERE token_address = ${ltAddress}
      ORDER BY tick_timestamp DESC
      LIMIT 1
    `) as unknown as LtRateSample[];
    return rows[0] ?? null;
  } catch (error) {
    logLtRateReadFailure("fetchLatestLtRate", error, { ltAddress });
    return "unavailable";
  }
}

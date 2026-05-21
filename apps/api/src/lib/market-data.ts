import { getAddress } from "viem";
import { neon } from "@neondatabase/serverless";
import { computeTokenPrice } from "@launchpad/shared";

import { createDb } from "../db/client.js";
import {
  fetchGraduatedTokensOnchain as readGraduatedTokensOnchain,
  fetchHistoricalCurveSnapshots as readHistoricalCurveSnapshots,
  fetchNonGraduatedTokensOnchain as readNonGraduatedTokensOnchain,
  fetchRouterTradeActivity as readRouterTradeActivity,
  fetchTokensOnchainByAddresses as readTokensOnchainByAddresses,
  fetchTrendingCandidatesByVolume as readTrendingCandidatesByVolume,
  quantizeTrailing24hCutoffSec,
  type TrendingVolumeCandidate,
} from "./indexer-reads.js";
import { fetchTokenOnchainCached as readTokenOnchainCached } from "./indexer-cached-reads.js";
import { readLiveLtRates } from "./lt-directory-reads.js";

/** Fixed launch supply (1B × 1e18) used for mcap calculations. */
export const TOKEN_SUPPLY = 1_000_000_000;

/**
 * Raw total supply (1B × 1e18) in bigint. Matches the virtual `reserve0`
 * initialised in `Pair.mint` at launch. Used to analytically reconstruct a
 * freshly-launched token's curve state (before any trades have produced a
 * snapshot) when computing "since-launch" price change for tokens younger
 * than 24h.
 */
const TOTAL_SUPPLY_RAW = 1_000_000_000n * 10n ** 18n;

export interface PonderTokenOnchain {
  address: string;
  ltToken: string;
  /**
   * Per-token constant-product invariant set at launch:
   *   k = TOTAL_SUPPLY_RAW * virtualLtReserveAtLaunch
   * Needed to recover the virtual LT component at read time so we can subtract
   * it from `ltReserve` to get the real USD raised. See
   * `computeCurveFilledBreakdown` in `lib/token-enrich.ts`.
   */
  k: string;
  /**
   * Virtual AMM reserve0 (the value the pair's constant-product math uses).
   * Initialised to TOTAL_SUPPLY (1B × 1e18) and floors at LP_RESERVE_RAW
   * (250M × 1e18) at full sellout — not [0, 750M]. Callers that want "real
   * remaining curve supply" must subtract LP_RESERVE_RAW.
   */
  curveSupply: string;
  /**
   * Virtual AMM reserve1. Starts at `virtualLtReserveAtLaunch = $3K / rate`
   * and grows with buys / shrinks with sells. Callers that want "real LT
   * raised" (== `IPair.assetBalance()` on-chain) must subtract
   * `virtualLtReserveAtLaunch = k / TOTAL_SUPPLY_RAW`.
   */
  ltReserve: string;
  /**
   * Phase 1 of graduation has fired (`Bonding.TokenGraduating`) but
   * `finalizeGraduation` hasn't yet — the token is contract-frozen, no
   * buys/sells will land. The keeper is processing it; expected resolution
   * within ~2 minutes. Surfaced to the frontend as the `"graduating"`
   * status, which renders the "Token is graduating, no buys or sells
   * allowed during this period" overlay over the trade panel.
   */
  pendingGraduation: boolean;
  /** Block timestamp (sec) when phase 1 fired. Null if not currently in phase 1. */
  pendingGraduationAt: string | null;
  graduated: boolean;
  graduatedAt: string | null;
  bondingPair: string | null;
  hyperswapPair: string | null;
  /**
   * Cumulative net USDC (6dp) routed through Zap for this token
   * (buys minus sells, floored at 0). Used to split the graduation progress
   * bar into "organic buys" vs "LT price appreciation".
   */
  organicUsdcRaised: string;
  /**
   * Cumulative **gross** USDC (6dp) routed through Zap for this
   * token (buys + sells, never subtracts). Surfaced as `totalVolumeUsd` on
   * the API — lifetime trading-volume figure for the hero card and creator
   * rewards summary. Contrast with `organicUsdcRaised` (net, floored).
   */
  volumeUsd: string;
  /**
   * Cumulative USDC (6dp) accrued to this token's creator via
   * `FeeVault:FeeAccrued`. Surfaced as `ApiToken.creatorFeesUsd` for the
   * Rewards-tab "earned" column. Lifetime counter — never decreases when
   * the creator claims (claims pool across every token they've launched
   * and reset the vault's `creatorBalance`, not this per-token counter).
   */
  creatorFeesUsd: string;
  /**
   * Mirror counter for the protocol cut. Same lifetime semantics as
   * `creatorFeesUsd`. Surfaced for symmetry with the admin dashboard.
   */
  protocolFeesUsd: string;
  timestamp: string;
}

interface PonderTokenSnapshot {
  curveSupply: string;
  ltReserve: string;
  timestamp: string;
}

interface BounceHistoricalRow {
  token_address: string;
  exchange_rate: string;
}

export interface MarketDataItem {
  priceUsd: number | null;
  mcapUsd: number | null;
  change24h: number | null;
  past24hPriceUsd: number | null;
  /**
   * Current LT exchange rate (USD per LT). Needed by `token-enrich` to turn
   * the curve's `ltReserve` into "USD raised" for the graduation progress
   * bar split. Null when the rate is unknown or zero.
   */
  ltExchangeRate: number | null;
  /**
   * 24h percentage change of the backing LT's exchange rate (independent
   * of any curve activity). Null when BounceTech has no rate at either
   * end of the window.
   */
  ltChange24h: number | null;
  /**
   * Total USD routed through `Zap` for this token in the last
   * 24h (buys + sells, nominal). `null` when the indexer can't be reached;
   * `0` when the token simply had no trades in the window. See
   * `fetchRouterTradeActivity`.
   */
  volume24hUsd: number | null;
  /**
   * Unix seconds of the most recent router trade within the 24h window, or
   * `null` when none / indexer unavailable. Used by the trending score's
   * recency bonus + dead-token penalty.
   */
  lastTradeAtSec: number | null;
}

/**
 * TTL for the per-isolate `fetchLiveLtRates` cache. 5s threads the needle:
 *
 * - The realtime path is `LtTicker` DO (samples LT rates at 1Hz and
 *   broadcasts on the WS `price` channel) — market-data responses don't
 *   need to compete with that for freshness.
 * - The frontend polls `/market-data` at 30s, so any rate sourced inside
 *   a single response is at most 5s stale — finer-grained than the poll
 *   cadence anyway.
 * - Eliminates ~95% of `lt_directory` mirror reads under the production
 *   tail (~22 market-data req/s × 30s window).
 *
 * 2-10s is all defensible; if you change this, leave a note here.
 */
const LIVE_LT_RATES_TTL_MS = 5_000;

let liveLtRatesCache: {
  map: Map<string, number>;
  expiresAt: number;
} | null = null;
let liveLtRatesInflight: Promise<Map<string, number> | null> | null = null;

/** Reset hook for tests. Mirrors `_resetLtAvailabilityCache`. */
export function _resetLiveLtRatesCache(): void {
  liveLtRatesCache = null;
  liveLtRatesInflight = null;
}

/**
 * Build a `Map<lt-address-lowercased, exchangeRate (USD per LT)>` from
 * the local `lt_directory` Postgres mirror (`readLiveLtRates`). Cached
 * per isolate for `LIVE_LT_RATES_TTL_MS`.
 *
 * Coalescing: concurrent callers during a refresh share a single
 * in-flight read via the Promise lock.
 *
 * Fail-open trade-off: when the DB read fails **and** we have a stale
 * cached entry, we return the stale map instead of `null`. A transient
 * mirror outage would otherwise cascade into 503s on every market-data
 * response (the entire `/market-data` surface returns `ok: false` when
 * this is `null`); serving rates that are at most a few extra seconds
 * stale is strictly better than blanking the price feed for every
 * connected client. The first failure with no cache (cold start during
 * a mirror outage) still returns `null` so the route can surface the
 * upstream outage honestly.
 */
export async function fetchLiveLtRates(
  databaseUrl: string,
): Promise<Map<string, number> | null> {
  const now = Date.now();
  if (liveLtRatesCache && liveLtRatesCache.expiresAt > now) {
    return liveLtRatesCache.map;
  }
  if (liveLtRatesInflight) return liveLtRatesInflight;

  liveLtRatesInflight = (async () => {
    try {
      const map = await readLiveLtRates(databaseUrl);
      if (map === null) return liveLtRatesCache?.map ?? null;
      liveLtRatesCache = { map, expiresAt: Date.now() + LIVE_LT_RATES_TTL_MS };
      return map;
    } catch {
      return liveLtRatesCache?.map ?? null;
    } finally {
      liveLtRatesInflight = null;
    }
  })();

  return liveLtRatesInflight;
}

/**
 * Fetch on-chain state for a specific set of token addresses. Returns `null`
 * when Postgres throws (Neon pool exhausted, transient connection error).
 * Addresses not present in the indexer's `token` table are simply omitted
 * from the result.
 *
 * Reads `ponder_views.token` directly — see `lib/indexer-reads.ts` for the
 * underlying SQL. The legacy GraphQL paginator this used to fan out to is
 * gone; every read is a single Postgres round-trip.
 */
export async function fetchTokensOnchainByAddresses(
  databaseUrl: string,
  addresses: string[],
): Promise<PonderTokenOnchain[] | null> {
  return readTokensOnchainByAddresses(createDb(databaseUrl), addresses);
}

// The GRADUATING tab is a *progress* surface, not a *contract-state*
// surface: it lists every non-graduated token whose enriched
// `curveFilled` (USD-headline progress, see `lib/token-enrich.ts`) is
// `≥ GRADUATING_TAB_MIN_CURVE_FILLED` percent. Sorted by
// `curveFilled desc`. The "contract-frozen" state — phase 1 has fired,
// `finalizeGraduation` is pending — remains modeled by the per-token
// `pendingGraduation` flag and the `status === "graduating"` field, which
// drive the GRADUATING pill + trade-panel overlay. The two concepts are
// deliberately decoupled: a token at 92% curveFilled but not yet
// contract-frozen belongs in the tab (it's close to graduating) but
// does not show the pill or block trades.
//
// We drive the tab off Ponder rather than the Postgres `status` column
// because that column is never flipped by the API (the indexer is source
// of truth for `pendingGraduation` / `graduated`), and because curveFilled
// is a derived quantity that lives in this layer.

/**
 * Fetch graduated tokens ordered by `graduatedAt desc`, paginated. Used by
 * the GRADUATED tab: Postgres' `status` column on `public.tokens` is never
 * flipped to "graduated" (the indexer is source of truth), so we drive the
 * list off `ponder_views.token` and batch-lookup the metadata rows from the
 * API's own DB.
 */
export async function fetchGraduatedTokensOnchain(
  databaseUrl: string,
  limit: number,
  offset: number,
): Promise<PonderTokenOnchain[] | null> {
  return readGraduatedTokensOnchain(createDb(databaseUrl), limit, offset);
}

/**
 * Fetch a candidate pool of non-graduated tokens ordered by
 * `curveSupply asc` — i.e. closest-to-sold-out first. Used by the
 * GRADUATING tab: the route enriches each candidate, computes
 * `curveFilled`, filters to `≥ GRADUATING_TAB_MIN_CURVE_FILLED`, and
 * sorts by `curveFilled desc` before paginating.
 *
 * Sort rationale: `curveFilled` is USD-denominated (`realLt × rate /
 * threshold × 100`) and we can't compute it inside the Ponder query —
 * Ponder doesn't have the LT exchange rate. `supplyFilled` (driven
 * purely by `curveSupply`) is a strong proxy: under the constant-product
 * AMM with the production `VIRTUAL_LIQUIDITY_USD : graduationThresholdUsd`
 * ratio, supply-% leads USD-% throughout most of the curve, so the
 * highest-supplyFilled tokens contain the highest-curveFilled set with
 * room to spare. Picking the closest-to-sold-out slice as the candidate
 * pool keeps the per-request work bounded (see `STATUS_POOL_SIZE` in
 * the route handler) without missing graduating-tab candidates.
 *
 * `pendingGraduation: true` tokens (phase 1 has fired) are included by
 * the `graduated: false` filter — their `curveSupply` reflects the
 * threshold-crossing buy's post-trade state (≥75% supplyFilled by
 * definition, since the trigger fired), so they naturally rank first
 * under the `curveSupply asc` ordering and pass the 75% gate.
 */
/**
 * Top-K trending candidates ranked by **rolling 24h gross USDC volume**.
 * Sole source of truth for the trending tab — there's no per-request
 * re-score on top, no precomputed score column, no boost system. Powered
 * by `ponder_views.token_hourly_metrics` (one row per (token, hour) bucket;
 * see `indexer-reads.ts → fetchTrendingCandidatesByVolume`).
 *
 * `cutoffHourStartSec` is the earliest `hour_start` to include — callers
 * pass `floor((now - 86400) / 3600) * 3600` for a trailing 24h window.
 *
 * Returns `(lowercased address, 24h volume in USD)` pairs ordered by
 * volume desc. The route hydrates the slice with token metadata + on-chain
 * state + live market data, then preserves the volume ordering through
 * pagination (tie-break on mcap).
 */
export async function fetchTrendingCandidatesByVolume(
  databaseUrl: string,
  limit: number,
  cutoffHourStartSec: number,
): Promise<TrendingVolumeCandidate[] | null> {
  return readTrendingCandidatesByVolume(
    createDb(databaseUrl),
    limit,
    cutoffHourStartSec,
  );
}

export type { TrendingVolumeCandidate };

/**
 * Page of non-graduated tokens ordered by `curveSupply asc` (closest to
 * sold-out first). Used by the GRADUATING tab to derive a bounded candidate
 * pool before the route applies the USD-denominated `curveFilled >= 75%`
 * gate in memory.
 */
export async function fetchNonGraduatedTokensOnchain(
  databaseUrl: string,
  limit: number,
  offset: number,
): Promise<PonderTokenOnchain[] | null> {
  return readNonGraduatedTokensOnchain(createDb(databaseUrl), limit, offset);
}

export interface RouterTradeActivity {
  volume24hUsd: number;
  lastTradeAtSec: number;
}

/**
 * Aggregate `Zap` router trades over the last 24h, keyed by token address
 * (lowercased). Used to power the trending score's volume + recency terms,
 * and to expose `volume24hUsd` / `lastTradeAt` on the token list response.
 *
 * Implemented as a single `SUM ... GROUP BY` against `ponder_views.router_trade`
 * (see `indexer-reads.ts → fetchRouterTradeActivity`). There's no truncation
 * case anymore — Postgres aggregates the full window in one shot — so the
 * `null` return now strictly means "the underlying read threw". Tokens with
 * no trades in the window are simply absent from the map; callers substitute
 * `volume24hUsd = 0` / `lastTradeAt = null` for them.
 */
export async function fetchRouterTradeActivity(
  databaseUrl: string,
  addresses: string[],
  nowSec: number,
): Promise<Map<string, RouterTradeActivity> | null> {
  return readRouterTradeActivity(createDb(databaseUrl), addresses, nowSec);
}

export async function fetchTokenOnchain(
  databaseUrl: string,
  address: string,
): Promise<PonderTokenOnchain | null | "unavailable"> {
  // Per-isolate cache memoises the single-token read for a few seconds
  // (issue #1125, solution #3) so the burst of `/tokens/:addr` requests
  // for a viral token collapses to one Postgres round-trip per
  // `HOT_TOKEN_READ_TTL_MS` window per PoP. Transient transport failures
  // (`"unavailable"`) are not pinned — see `indexer-reads.ts`.
  return readTokenOnchainCached(createDb(databaseUrl), address);
}

/**
 * For each token address, fetch the latest `tokenSnapshot` ≤ cutoff. Used to
 * reconstruct the curve ratio at `cutoff` for 24h change calculation. Returns
 * `null` when the underlying read throws — every other caller of this
 * function tolerates a missing snapshot per-address (live curve state acts
 * as the fallback), so the only error mode the caller cares about is the
 * "everything failed" one.
 *
 * Replaces the legacy aliased-GraphQL batching with a single
 * `DISTINCT ON (token_address)` scan against `ponder_views.token_snapshot`.
 */
export async function fetchHistoricalCurveSnapshots(
  databaseUrl: string,
  tokenAddresses: string[],
  cutoffSec: number,
): Promise<Map<string, PonderTokenSnapshot | null> | null> {
  return readHistoricalCurveSnapshots(databaseUrl, tokenAddresses, cutoffSec);
}

/**
 * Latest BounceTech LT exchange rate ≤ cutoff per LT address. Uses a
 * `LATERAL` per-address seek on `(token_address, tick_timestamp DESC)` because
 * the `DISTINCT ON` form times out on the multi-million-row snapshot table.
 */
export async function fetchHistoricalLtRates(
  databaseUrl: string | undefined,
  ltAddresses: string[],
  cutoffSec: number,
): Promise<Map<string, number> | null> {
  if (!databaseUrl) return null;
  if (ltAddresses.length === 0) return new Map();

  const checksummed = ltAddresses.map((addr) => getAddress(addr));
  const sql = neon(databaseUrl);

  try {
    const rows = (await sql`
      SELECT a.address AS token_address, t.exchange_rate::text AS exchange_rate
      FROM unnest(${checksummed}::text[]) AS a(address)
      CROSS JOIN LATERAL (
        SELECT exchange_rate
        FROM token_snapshots_v1
        WHERE token_address = a.address
          AND tick_timestamp <= to_timestamp(${cutoffSec})
        ORDER BY tick_timestamp DESC
        LIMIT 1
      ) t
    `) as unknown as BounceHistoricalRow[];

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(
        row.token_address.toLowerCase(),
        Number(BigInt(row.exchange_rate)) / 1e18,
      );
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * Per-token BounceTech LT exchange rate ≤ launch timestamp, used to anchor
 * "since-launch" change24h for tokens younger than the 24h cutoff. We key
 * the returned map by token address (not LT address) because two tokens
 * can share the same LT but have different launch timestamps, so the
 * relevant historical rate differs per token.
 */
export async function fetchLtRatesAtLaunches(
  databaseUrl: string | undefined,
  inputs: Array<{
    /** Lowercase token address. */
    tokenAddress: string;
    /** Lowercase LT address. */
    ltAddress: string;
    /** Token launch timestamp (unix seconds). */
    launchSec: number;
  }>,
): Promise<Map<string, number> | null> {
  if (!databaseUrl) return null;
  if (inputs.length === 0) return new Map();

  const tokenAddrs = inputs.map((i) => i.tokenAddress);
  const ltAddrsChecksummed = inputs.map((i) => getAddress(i.ltAddress));
  const launchSecs = inputs.map((i) => i.launchSec);
  const sql = neon(databaseUrl);

  try {
    const rows = (await sql`
      SELECT a.token_address, t.exchange_rate::text AS exchange_rate
      FROM unnest(
        ${tokenAddrs}::text[],
        ${ltAddrsChecksummed}::text[],
        ${launchSecs}::bigint[]
      ) AS a(token_address, lt_address, launch_sec)
      CROSS JOIN LATERAL (
        SELECT exchange_rate
        FROM token_snapshots_v1
        WHERE token_address = a.lt_address
          AND tick_timestamp <= to_timestamp(a.launch_sec)
        ORDER BY tick_timestamp DESC
        LIMIT 1
      ) t
    `) as unknown as BounceHistoricalRow[];

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(
        row.token_address.toLowerCase(),
        Number(BigInt(row.exchange_rate)) / 1e18,
      );
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * Resolved price-reference inputs at the start of the change24h window.
 * For tokens older than 24h this is the curve+LT state at `cutoffSec`. For
 * tokens younger than 24h it's the curve+LT state at launch (so the UI
 * shows a since-launch delta instead of hiding the stat entirely).
 */
export interface PastPriceInputs {
  curveSupply: bigint;
  ltReserve: bigint;
  /** USD per LT. Must be > 0 for a meaningful past price. */
  ltRate: number;
}

/**
 * Decide whether the reference price for a token should be "24h ago" or
 * "at launch", and return the curve supply / LT reserve / LT rate needed
 * to price it. Returns `null` when we don't have enough inputs (e.g.
 * BounceTech has no historical rate for the LT).
 *
 * For fresh tokens we reconstruct the launch curve state analytically from
 * `k` (the AMM invariant set in `Pair.mint`) rather than querying Ponder —
 * a just-launched token has no `tokenSnapshot` rows yet, but its initial
 * state is fully determined by `(TOTAL_SUPPLY_RAW, k / TOTAL_SUPPLY_RAW)`.
 *
 * `historicalCurve` / `historicalLtRatesAtCutoff` /
 * `historicalLtRatesAtLaunch` may be `null` when the corresponding upstream
 * query failed entirely (Ponder / BounceTech outage). In that case the
 * function returns `null` for the affected branch — distinct from a
 * specific token's row being missing from a *successful* fetch, which
 * legitimately means "no curve activity since cutoff" and falls through
 * to the live curve state as the historical reference.
 */
export function buildPastPriceInputs(
  token: PonderTokenOnchain,
  cutoffSec: number,
  historicalCurve: Map<string, PonderTokenSnapshot | null> | null,
  historicalLtRatesAtCutoff: Map<string, number> | null,
  historicalLtRatesAtLaunch: Map<string, number> | null,
): PastPriceInputs | null {
  const ltAddr = token.ltToken.toLowerCase();
  const tokenAddr = token.address.toLowerCase();
  const launchTimestamp = Number(token.timestamp);
  const tokenIsTooNew = launchTimestamp > cutoffSec;

  if (tokenIsTooNew) {
    if (historicalLtRatesAtLaunch === null) return null;
    const ltRate = historicalLtRatesAtLaunch.get(tokenAddr);
    if (ltRate === undefined || ltRate <= 0) return null;

    let kRaw: bigint;
    try {
      kRaw = BigInt(token.k);
    } catch {
      return null;
    }
    if (kRaw <= 0n) return null;

    return {
      curveSupply: TOTAL_SUPPLY_RAW,
      ltReserve: kRaw / TOTAL_SUPPLY_RAW,
      ltRate,
    };
  }

  // Old token path: needs both the LT rate at cutoff and (optionally) a
  // historical curve snapshot. A missing snapshot for a *single* token in
  // a successful Ponder fetch means "no curve activity since cutoff" and
  // is correctly resolved by falling through to the live curve state. A
  // null `historicalCurve` map means the entire upstream fetch failed, so
  // we don't have that signal and must surface a null past price.
  if (historicalCurve === null || historicalLtRatesAtCutoff === null) {
    return null;
  }

  const ltRate = historicalLtRatesAtCutoff.get(ltAddr);
  if (ltRate === undefined || ltRate <= 0) return null;

  const snapshot = historicalCurve.get(tokenAddr);
  return {
    curveSupply: snapshot
      ? BigInt(snapshot.curveSupply)
      : BigInt(token.curveSupply),
    ltReserve: snapshot
      ? BigInt(snapshot.ltReserve)
      : BigInt(token.ltReserve),
    ltRate,
  };
}

export function buildMarketDataItem(
  token: PonderTokenOnchain,
  currentLtRate: number,
  past: PastPriceInputs | null,
  activity: { volume24hUsd: number | null; lastTradeAtSec: number | null },
  ltRate24hAgo: number | null,
): MarketDataItem {
  const currentCurveSupply = BigInt(token.curveSupply);
  const currentLtReserve = BigInt(token.ltReserve);

  const currentPrice = computeTokenPrice(
    currentCurveSupply,
    currentLtReserve,
    currentLtRate,
  );
  const priceUsd = currentPrice > 0 ? currentPrice : null;
  const mcapUsd = priceUsd !== null ? priceUsd * TOKEN_SUPPLY : null;

  let past24hPriceUsd: number | null = null;
  if (past !== null) {
    const p = computeTokenPrice(past.curveSupply, past.ltReserve, past.ltRate);
    if (p > 0) past24hPriceUsd = p;
  }

  const change24h =
    past24hPriceUsd !== null && past24hPriceUsd > 0 && currentPrice > 0
      ? ((currentPrice - past24hPriceUsd) / past24hPriceUsd) * 100
      : null;

  // LT 24h change is measured at the LT itself, independent of when the
  // token launched or whether it's graduated.
  const ltChange24h =
    ltRate24hAgo !== null && ltRate24hAgo > 0 && currentLtRate > 0
      ? ((currentLtRate - ltRate24hAgo) / ltRate24hAgo) * 100
      : null;

  return {
    priceUsd,
    mcapUsd,
    change24h,
    past24hPriceUsd,
    ltExchangeRate: currentLtRate > 0 ? currentLtRate : null,
    ltChange24h,
    volume24hUsd: activity.volume24hUsd,
    lastTradeAtSec: activity.lastTradeAtSec,
  };
}

export interface MarketDataBatch {
  tokens: PonderTokenOnchain[];
  market: Record<string, MarketDataItem>;
}

export type MarketDataBatchResult =
  | { ok: true; data: MarketDataBatch; dataSource?: "live" | "degraded" }
  | { ok: false; error: string; code: 503 };

/**
 * Given a resolved set of `PonderTokenOnchain` rows, fetch the current and
 * historical price inputs from BounceTech + Ponder and compute
 * `(priceUsd, mcapUsd, change24h)` keyed by lowercased token address.
 *
 * Failure-mode policy: failures in the **current**-price inputs
 * (`fetchLiveLtRates`) bubble up as `ok: false` 503, since without them
 * every `priceUsd` / `mcapUsd` would be null. Failures in the **historical**
 * inputs (`fetchHistoricalCurveSnapshots`,
 * `fetchHistoricalLtRates`, `fetchLtRatesAtLaunches`) degrade gracefully
 * instead — they only feed `past24hPriceUsd` / `change24h` / `ltChange24h`,
 * so we still emit usable price/mcap/volume rows and surface the partial
 * payload as `dataSource: "degraded"`. Previously a transient indexer
 * hiccup on the heavy aliased `tokenSnapshots` query 503'd the whole
 * route, nuking the frontend's polled price feed for every connected
 * client. Same approach `routerActivity` already takes for
 * `volume24hUsd` / `lastTradeAtSec`.
 */
export async function buildBatchFromTokens(
  databaseUrl: string,
  bouncetechDbUrl: string | undefined,
  tokens: PonderTokenOnchain[],
): Promise<MarketDataBatchResult> {
  if (tokens.length === 0) {
    return { ok: true, data: { tokens: [], market: {} }, dataSource: "live" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  // Quantised to a 30s bucket so the cutoff parameter passed to every
  // downstream query (`fetchHistoricalCurveSnapshots`,
  // `fetchHistoricalLtRates`, `fetchLtRatesAtLaunches`, the old/new
  // token partition, `buildPastPriceInputs`) is stable for the duration
  // of the bucket. Postgres re-uses the prepared plan across the bucket
  // and the same logical request hits the same SQL row set, so an
  // in-Worker cache miss still produces a deterministic payload. Drift
  // on the "24h" label is at most 30s, well inside the noise floor for
  // `change24h`. Issue #1035.
  const cutoffSec = quantizeTrailing24hCutoffSec(nowSec);

  // Partition tokens by whether they've been live for the full 24h window.
  // Old tokens use the 24h-ago reference; new tokens use their launch state
  // (reconstructed analytically from `k`) + LT rate at launch, so the UI
  // can render "since-launch" change for tokens <24h old.
  const oldTokens = tokens.filter((t) => Number(t.timestamp) <= cutoffSec);
  const newTokens = tokens.filter((t) => Number(t.timestamp) > cutoffSec);

  const oldTokenAddresses = oldTokens.map((t) => t.address.toLowerCase());
  // Fetch the 24h-ago LT rate for every LT in the batch (not just LTs of
  // tokens older than 24h). The `ltChange24h` signal on `MarketDataItem` is
  // defined against the LT's own history, independent of token age, so
  // young tokens still get a real `ltChange24h` even though their own
  // `past24hPriceUsd` is reconstructed from launch.
  const allLtAddresses = Array.from(
    new Set(tokens.map((t) => t.ltToken.toLowerCase())),
  );
  const newTokenLtInputs = newTokens.map((t) => ({
    tokenAddress: t.address.toLowerCase(),
    ltAddress: t.ltToken.toLowerCase(),
    launchSec: Number(t.timestamp),
  }));

  const allTokenAddresses = tokens.map((t) => t.address.toLowerCase());

  // Run the live LT rate fetch in parallel with the historical / activity
  // queries. The cache makes most calls cheap, but on a cold isolate the
  // mirror read is on the order of the indexer reads — letting them race
  // shaves the slowest of (mirror, indexer, BounceTech-DB) off the
  // critical path instead of paying their sum.
  const [
    liveLtRates,
    historicalCurve,
    historicalLtRatesAtCutoff,
    historicalLtRatesAtLaunch,
    routerActivity,
  ] = await Promise.all([
    fetchLiveLtRates(databaseUrl),
    fetchHistoricalCurveSnapshots(databaseUrl, oldTokenAddresses, cutoffSec),
    fetchHistoricalLtRates(bouncetechDbUrl, allLtAddresses, cutoffSec),
    fetchLtRatesAtLaunches(bouncetechDbUrl, newTokenLtInputs),
    fetchRouterTradeActivity(databaseUrl, allTokenAddresses, nowSec),
  ]);

  if (liveLtRates === null) {
    return { ok: false, error: "LT directory mirror unavailable", code: 503 };
  }

  // `buildPastPriceInputs` accepts null for each historical map and
  // collapses to `past24hPriceUsd: null` / `change24h: null` for the
  // affected tokens — same treatment `routerActivity` already gets for
  // `volume24hUsd` / `lastTradeAtSec`. We flip `dataSource` to
  // `"degraded"` whenever any of these queries failed so the frontend's
  // `apiFetch` can surface a status banner.
  const historicalDegraded =
    historicalCurve === null ||
    historicalLtRatesAtCutoff === null ||
    historicalLtRatesAtLaunch === null;

  const market: Record<string, MarketDataItem> = {};
  for (const token of tokens) {
    const addr = token.address.toLowerCase();
    const ltAddr = token.ltToken.toLowerCase();
    const currentLtRate = liveLtRates.get(ltAddr) ?? 0;
    const ltRate24hAgo = historicalLtRatesAtCutoff?.get(ltAddr) ?? null;
    const past = buildPastPriceInputs(
      token,
      cutoffSec,
      historicalCurve,
      historicalLtRatesAtCutoff,
      historicalLtRatesAtLaunch,
    );
    // `routerActivity === null` means the indexer aggregation failed. We
    // still serve market data from the other queries (price/mcap/change24h
    // don't depend on it) — volume/lastTrade surface as `null` ("unknown").
    // A token simply absent from the map had zero trades in 24h → 0 volume,
    // no lastTrade.
    let activity: { volume24hUsd: number | null; lastTradeAtSec: number | null };
    if (routerActivity === null) {
      activity = { volume24hUsd: null, lastTradeAtSec: null };
    } else {
      const a = routerActivity.get(addr);
      activity = a
        ? { volume24hUsd: a.volume24hUsd, lastTradeAtSec: a.lastTradeAtSec }
        : { volume24hUsd: 0, lastTradeAtSec: null };
    }
    market[addr] = buildMarketDataItem(
      token,
      currentLtRate,
      past,
      activity,
      ltRate24hAgo,
    );
  }

  return {
    ok: true,
    data: { tokens, market },
    dataSource:
      historicalDegraded || routerActivity === null ? "degraded" : "live",
  };
}

/**
 * Resolve `(priceUsd, mcapUsd, change24h)` for a bounded set of token
 * addresses. The only entry point into the market-data pipeline since the
 * catalogue-wide `computeMarketDataBatch` was retired — every consumer
 * (per-page `POST /market-data`, `/tokens?status=…`, internal helpers)
 * now declares the addresses it cares about up front. Avoids loading
 * every token in the indexer on each request, and lets us drop the
 * `fetchAllTokensOnchain` paginator's silent 20K-row truncation cap
 * entirely.
 */
export async function computeMarketDataForAddresses(
  databaseUrl: string,
  bouncetechDbUrl: string | undefined,
  addresses: string[],
): Promise<MarketDataBatchResult> {
  if (addresses.length === 0) {
    return { ok: true, data: { tokens: [], market: {} } };
  }
  const tokens = await fetchTokensOnchainByAddresses(databaseUrl, addresses);
  if (tokens === null) {
    return { ok: false, error: "Indexer unavailable", code: 503 };
  }
  return buildBatchFromTokens(databaseUrl, bouncetechDbUrl, tokens);
}

export type MarketDataSingleResult =
  | {
      ok: true;
      data: { token: PonderTokenOnchain; market: MarketDataItem };
      dataSource?: "live" | "degraded";
    }
  | { ok: false; error: string; code: 404 | 503 };

export async function computeMarketDataSingle(
  databaseUrl: string,
  bouncetechDbUrl: string | undefined,
  tokenAddress: string,
): Promise<MarketDataSingleResult> {
  const token = await fetchTokenOnchain(databaseUrl, tokenAddress);
  if (token === "unavailable") {
    return { ok: false, error: "Indexer unavailable", code: 503 };
  }
  if (!token) {
    return { ok: false, error: "Token not found", code: 404 };
  }

  const result = await buildBatchFromTokens(databaseUrl, bouncetechDbUrl, [
    token,
  ]);
  if (!result.ok) return result;

  const market = result.data.market[token.address.toLowerCase()];
  if (!market) {
    return { ok: false, error: "Indexer unavailable", code: 503 };
  }
  return { ok: true, data: { token, market }, dataSource: result.dataSource };
}

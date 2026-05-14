import { getAddress } from "viem";
import { neon } from "@neondatabase/serverless";
import { computeTokenPrice } from "@launchpad/shared";

import {
  createPonderQuery,
  createPonderPaginatedQuery,
} from "./ponder-client.js";

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
   * Virtual AMM reserve1. Starts at `virtualLtReserveAtLaunch = $4K / rate`
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

interface PonderSnapshotPage {
  items: PonderTokenSnapshot[];
}

interface BounceLt {
  address: string;
  exchangeRate: string;
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

export async function fetchLiveLtRates(): Promise<Map<string, number> | null> {
  try {
    const res = await fetch("https://indexing.bounce.tech/leveraged-tokens");
    if (!res.ok) return null;
    const json = (await res.json()) as { data: BounceLt[] };
    const map = new Map<string, number>();
    for (const lt of json.data) {
      map.set(lt.address.toLowerCase(), Number(BigInt(lt.exchangeRate)) / 1e18);
    }
    return map;
  } catch {
    return null;
  }
}

const BATCH_SIZE = 50;

export async function fetchAllTokensOnchain(
  ponderUrl: string | undefined,
): Promise<PonderTokenOnchain[] | null> {
  const queryPonderAll = createPonderPaginatedQuery(ponderUrl);
  try {
    const result = await queryPonderAll<PonderTokenOnchain>(
      `query ($limit: Int!, $offset: Int!) {
        tokens(limit: $limit, offset: $offset, orderBy: "timestamp", orderDirection: "desc") {
          items {
            address
            ltToken
            k
            curveSupply
            ltReserve
            pendingGraduation
            pendingGraduationAt
            graduated
            graduatedAt
            bondingPair
            hyperswapPair
            organicUsdcRaised
            volumeUsd
            creatorFeesUsd
            protocolFeesUsd
            timestamp
          }
        }
      }`,
      "tokens",
    );
    return result.items;
  } catch {
    return null;
  }
}

/**
 * Fetch on-chain state for a specific set of token addresses. Returns `null`
 * when the indexer is unreachable. Addresses not present in Ponder are simply
 * omitted from the result. Prefer this over `fetchAllTokensOnchain` when the
 * caller already has a bounded list (e.g. a paginated `/tokens` page).
 */
export async function fetchTokensOnchainByAddresses(
  ponderUrl: string | undefined,
  addresses: string[],
): Promise<PonderTokenOnchain[] | null> {
  if (addresses.length === 0) return [];
  const queryPonderAll = createPonderPaginatedQuery(ponderUrl);
  const lowered = addresses.map((a) => a.toLowerCase());
  try {
    const result = await queryPonderAll<PonderTokenOnchain>(
      `query ($addresses: [String!]!, $limit: Int!, $offset: Int!) {
        tokens(
          where: { address_in: $addresses }
          limit: $limit
          offset: $offset
          orderBy: "timestamp"
          orderDirection: "desc"
        ) {
          items {
            address
            ltToken
            k
            curveSupply
            ltReserve
            pendingGraduation
            pendingGraduationAt
            graduated
            graduatedAt
            bondingPair
            hyperswapPair
            organicUsdcRaised
            volumeUsd
            creatorFeesUsd
            protocolFeesUsd
            timestamp
          }
        }
      }`,
      "tokens",
      { addresses: lowered },
    );
    return result.items;
  } catch {
    return null;
  }
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
 * the GRADUATED tab: Postgres' `status` column is never flipped to
 * "graduated" (the indexer is source of truth), so we drive the list off
 * Ponder and batch-lookup metadata from the API's own DB.
 */
export async function fetchGraduatedTokensOnchain(
  ponderUrl: string | undefined,
  limit: number,
  offset: number,
): Promise<PonderTokenOnchain[] | null> {
  const queryPonder = createPonderQuery(ponderUrl);
  const data = await queryPonder<{
    tokens: { items: PonderTokenOnchain[] };
  }>(
    `query ($limit: Int!, $offset: Int!) {
      tokens(
        where: { graduated: true }
        limit: $limit
        offset: $offset
        orderBy: "graduatedAt"
        orderDirection: "desc"
      ) {
        items {
          address
          ltToken
          k
          curveSupply
          ltReserve
          pendingGraduation
          pendingGraduationAt
          graduated
          graduatedAt
          bondingPair
          hyperswapPair
          organicUsdcRaised
          volumeUsd
          creatorFeesUsd
          protocolFeesUsd
          timestamp
        }
      }
    }`,
    { limit, offset },
  );
  if (data === null) return null;
  return data.tokens.items;
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
 * threshold-crossing buy's post-trade state (≥85% supplyFilled by
 * definition, since the trigger fired), so they naturally rank first
 * under the `curveSupply asc` ordering and pass the 85% gate.
 */
export async function fetchNonGraduatedTokensOnchain(
  ponderUrl: string | undefined,
  limit: number,
  offset: number,
): Promise<PonderTokenOnchain[] | null> {
  const queryPonder = createPonderQuery(ponderUrl);
  const data = await queryPonder<{
    tokens: { items: PonderTokenOnchain[] };
  }>(
    `query ($limit: Int!, $offset: Int!) {
      tokens(
        where: { graduated: false }
        limit: $limit
        offset: $offset
        orderBy: "curveSupply"
        orderDirection: "asc"
      ) {
        items {
          address
          ltToken
          k
          curveSupply
          ltReserve
          pendingGraduation
          pendingGraduationAt
          graduated
          graduatedAt
          bondingPair
          hyperswapPair
          organicUsdcRaised
          volumeUsd
          creatorFeesUsd
          protocolFeesUsd
          timestamp
        }
      }
    }`,
    { limit, offset },
  );
  if (data === null) return null;
  return data.tokens.items;
}

export interface RouterTradeActivity {
  volume24hUsd: number;
  lastTradeAtSec: number;
}

/**
 * Aggregate `Zap` trades over the last 24h, keyed by token
 * address (lowercased). Used to power the trending score's volume and
 * recency components, and to expose `volume24hUsd` / `lastTradeAt` on the
 * token list response.
 *
 * Returns `null` when the signal is unreliable — either Ponder is
 * unreachable, or pagination truncated before we saw every trade in the
 * window (the paginator caps at MAX_PAGES × PAGE_SIZE; with `timestamp desc`
 * ordering truncation drops the oldest slice of the window, which would
 * silently zero out any token whose trades all fall in that tail and
 * falsely trip the trending dead-token penalty). Downstream,
 * `buildBatchFromTokens` collapses a `null` return to
 * `volume24hUsd: null, lastTradeAtSec: null` on every token — the trending
 * score then drops the volume + recency terms for this request and keeps
 * sorting on change24h / mcap / freshness, which is the honest "unknown"
 * behaviour.
 *
 * Tokens with no trades in the window are simply absent from the map;
 * callers substitute `volume24hUsd = 0` / `lastTradeAt = null` for them.
 */
export async function fetchRouterTradeActivity(
  ponderUrl: string | undefined,
  addresses: string[],
  nowSec: number,
): Promise<Map<string, RouterTradeActivity> | null> {
  if (addresses.length === 0) return new Map();
  const queryPonderAll = createPonderPaginatedQuery(ponderUrl);
  const lowered = addresses.map((a) => a.toLowerCase());
  const sinceSec = nowSec - 86_400;

  try {
    const result = await queryPonderAll<{
      tokenAddress: string;
      usdcAmount: string;
      timestamp: string;
    }>(
      `query ($addresses: [String!]!, $since: BigInt!, $limit: Int!, $offset: Int!) {
        routerTrades(
          where: { tokenAddress_in: $addresses, timestamp_gte: $since }
          limit: $limit
          offset: $offset
          orderBy: "timestamp"
          orderDirection: "desc"
        ) {
          items {
            tokenAddress
            usdcAmount
            timestamp
          }
        }
      }`,
      "routerTrades",
      { addresses: lowered, since: String(sinceSec) },
    );

    if (result.truncated) {
      console.warn(
        "[market-data] routerTrade 24h aggregation truncated; " +
          "returning null so trending falls back to unknown volume/recency. " +
          `addresses=${addresses.length} items=${result.items.length}`,
      );
      return null;
    }

    const activity = new Map<string, RouterTradeActivity>();
    for (const trade of result.items) {
      const addr = trade.tokenAddress.toLowerCase();
      const usdc = Number(BigInt(trade.usdcAmount)) / 1e6;
      const ts = Number(trade.timestamp);
      const existing = activity.get(addr);
      if (existing) {
        existing.volume24hUsd += usdc;
        if (ts > existing.lastTradeAtSec) existing.lastTradeAtSec = ts;
      } else {
        activity.set(addr, { volume24hUsd: usdc, lastTradeAtSec: ts });
      }
    }
    return activity;
  } catch {
    return null;
  }
}

export async function fetchTokenOnchain(
  ponderUrl: string | undefined,
  address: string,
): Promise<PonderTokenOnchain | null | "unavailable"> {
  const queryPonder = createPonderQuery(ponderUrl);
  const data = await queryPonder<{ token: PonderTokenOnchain | null }>(
    `query ($address: String!) {
      token(address: $address) {
        address
        ltToken
        k
        curveSupply
        ltReserve
        pendingGraduation
        pendingGraduationAt
        graduated
        graduatedAt
        bondingPair
        hyperswapPair
        organicUsdcRaised
        volumeUsd
        creatorFeesUsd
        protocolFeesUsd
        timestamp
      }
    }`,
    { address: address.toLowerCase() },
  );
  if (data === null) return "unavailable";
  return data.token;
}

/**
 * For each token address, fetch the latest `tokenSnapshot` ≤ cutoff. Used to
 * reconstruct the curve ratio at `cutoff` for 24h change calculation. Returns
 * `null` when the indexer is unreachable.
 */
export async function fetchHistoricalCurveSnapshots(
  ponderUrl: string | undefined,
  tokenAddresses: string[],
  cutoffSec: number,
): Promise<Map<string, PonderTokenSnapshot | null> | null> {
  const queryPonder = createPonderQuery(ponderUrl);
  const snapshots = new Map<string, PonderTokenSnapshot | null>();
  for (const addr of tokenAddresses) snapshots.set(addr, null);

  for (let i = 0; i < tokenAddresses.length; i += BATCH_SIZE) {
    const batch = tokenAddresses.slice(i, i + BATCH_SIZE);
    const selections = batch
      .map(
        (addr, j) =>
          `t${j}: tokenSnapshots(
            where: { tokenAddress: "${addr}", timestamp_lte: "${cutoffSec}" }
            orderBy: "timestamp"
            orderDirection: "desc"
            limit: 1
          ) { items { curveSupply, ltReserve, timestamp } }`,
      )
      .join("\n");

    const query = `query {
      ${selections}
    }`;

    const data = await queryPonder<Record<string, PonderSnapshotPage>>(query);
    if (data === null) return null;

    for (let j = 0; j < batch.length; j++) {
      const page = data[`t${j}`];
      snapshots.set(batch[j], page?.items?.[0] ?? null);
    }
  }

  return snapshots;
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
 */
export function buildPastPriceInputs(
  token: PonderTokenOnchain,
  cutoffSec: number,
  historicalCurve: Map<string, PonderTokenSnapshot | null>,
  historicalLtRatesAtCutoff: Map<string, number>,
  historicalLtRatesAtLaunch: Map<string, number>,
): PastPriceInputs | null {
  const ltAddr = token.ltToken.toLowerCase();
  const tokenAddr = token.address.toLowerCase();
  const launchTimestamp = Number(token.timestamp);
  const tokenIsTooNew = launchTimestamp > cutoffSec;

  if (tokenIsTooNew) {
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
  | { ok: true; data: MarketDataBatch }
  | { ok: false; error: string; code: 503 };

/**
 * Given a resolved set of `PonderTokenOnchain` rows, fetch the current and
 * historical price inputs from BounceTech + Ponder and compute
 * `(priceUsd, mcapUsd, change24h)` keyed by lowercased token address.
 */
export async function buildBatchFromTokens(
  ponderUrl: string | undefined,
  bouncetechDbUrl: string | undefined,
  tokens: PonderTokenOnchain[],
): Promise<MarketDataBatchResult> {
  if (tokens.length === 0) {
    return { ok: true, data: { tokens: [], market: {} } };
  }

  const liveLtRates = await fetchLiveLtRates();
  if (liveLtRates === null) {
    return { ok: false, error: "BounceTech API unavailable", code: 503 };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const cutoffSec = nowSec - 86_400;

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

  const [
    historicalCurve,
    historicalLtRatesAtCutoff,
    historicalLtRatesAtLaunch,
    routerActivity,
  ] = await Promise.all([
    fetchHistoricalCurveSnapshots(ponderUrl, oldTokenAddresses, cutoffSec),
    fetchHistoricalLtRates(bouncetechDbUrl, allLtAddresses, cutoffSec),
    fetchLtRatesAtLaunches(bouncetechDbUrl, newTokenLtInputs),
    fetchRouterTradeActivity(ponderUrl, allTokenAddresses, nowSec),
  ]);
  if (historicalCurve === null) {
    return { ok: false, error: "Indexer unavailable", code: 503 };
  }
  if (historicalLtRatesAtCutoff === null || historicalLtRatesAtLaunch === null) {
    return {
      ok: false,
      error: "BounceTech snapshot DB unavailable",
      code: 503,
    };
  }

  const market: Record<string, MarketDataItem> = {};
  for (const token of tokens) {
    const addr = token.address.toLowerCase();
    const ltAddr = token.ltToken.toLowerCase();
    const currentLtRate = liveLtRates.get(ltAddr) ?? 0;
    const ltRate24hAgo = historicalLtRatesAtCutoff.get(ltAddr) ?? null;
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

  return { ok: true, data: { tokens, market } };
}

/**
 * Fetch every token's on-chain state from Ponder + its current and historical
 * price inputs, and compute `(priceUsd, mcapUsd, change24h)` keyed by
 * lowercased token address. Used by the full-catalogue `/market-data` route.
 * Callers that only need a known subset should use
 * `computeMarketDataForAddresses` instead — it skips the full-catalogue fetch.
 */
export async function computeMarketDataBatch(
  ponderUrl: string | undefined,
  bouncetechDbUrl: string | undefined,
): Promise<MarketDataBatchResult> {
  const tokens = await fetchAllTokensOnchain(ponderUrl);
  if (tokens === null) {
    return { ok: false, error: "Indexer unavailable", code: 503 };
  }
  return buildBatchFromTokens(ponderUrl, bouncetechDbUrl, tokens);
}

/**
 * Same as `computeMarketDataBatch` but scoped to a specific set of token
 * addresses (e.g. a paginated `/tokens` page). Avoids loading every token in
 * the indexer when the caller already knows which ones they care about.
 */
export async function computeMarketDataForAddresses(
  ponderUrl: string | undefined,
  bouncetechDbUrl: string | undefined,
  addresses: string[],
): Promise<MarketDataBatchResult> {
  if (addresses.length === 0) {
    return { ok: true, data: { tokens: [], market: {} } };
  }
  const tokens = await fetchTokensOnchainByAddresses(ponderUrl, addresses);
  if (tokens === null) {
    return { ok: false, error: "Indexer unavailable", code: 503 };
  }
  return buildBatchFromTokens(ponderUrl, bouncetechDbUrl, tokens);
}

export type MarketDataSingleResult =
  | {
      ok: true;
      data: { token: PonderTokenOnchain; market: MarketDataItem };
    }
  | { ok: false; error: string; code: 404 | 503 };

export async function computeMarketDataSingle(
  ponderUrl: string | undefined,
  bouncetechDbUrl: string | undefined,
  tokenAddress: string,
): Promise<MarketDataSingleResult> {
  const token = await fetchTokenOnchain(ponderUrl, tokenAddress);
  if (token === "unavailable") {
    return { ok: false, error: "Indexer unavailable", code: 503 };
  }
  if (!token) {
    return { ok: false, error: "Token not found", code: 404 };
  }

  const result = await buildBatchFromTokens(ponderUrl, bouncetechDbUrl, [token]);
  if (!result.ok) return result;

  const market = result.data.market[token.address.toLowerCase()];
  if (!market) {
    return { ok: false, error: "Indexer unavailable", code: 503 };
  }
  return { ok: true, data: { token, market } };
}

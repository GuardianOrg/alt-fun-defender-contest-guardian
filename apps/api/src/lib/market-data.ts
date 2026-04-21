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
 * initialised in `FPair.mint` at launch. Used to analytically reconstruct a
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
   * raised" (== `IFPair.assetBalance()` on-chain) must subtract
   * `virtualLtReserveAtLaunch = k / TOTAL_SUPPLY_RAW`.
   */
  ltReserve: string;
  graduated: boolean;
  graduatedAt: string | null;
  bondingPair: string | null;
  hyperswapPair: string | null;
  /**
   * Cumulative net USDC (6dp) routed through LaunchpadRouter for this token
   * (buys minus sells, floored at 0). Used to split the graduation progress
   * bar into "organic buys" vs "LT price appreciation".
   */
  organicUsdcRaised: string;
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
            graduated
            graduatedAt
            bondingPair
            hyperswapPair
            organicUsdcRaised
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
            graduated
            graduatedAt
            bondingPair
            hyperswapPair
            organicUsdcRaised
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
        graduated
        graduatedAt
        bondingPair
        hyperswapPair
        organicUsdcRaised
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
 * `k` (the AMM invariant set in `FPair.mint`) rather than querying Ponder —
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

  return {
    priceUsd,
    mcapUsd,
    change24h,
    past24hPriceUsd,
    ltExchangeRate: currentLtRate > 0 ? currentLtRate : null,
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
async function buildBatchFromTokens(
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

  const cutoffSec = Math.floor(Date.now() / 1000) - 86_400;

  // Partition tokens by whether they've been live for the full 24h window.
  // Old tokens use the 24h-ago reference; new tokens use their launch state
  // (reconstructed analytically from `k`) + LT rate at launch, so the UI
  // can render "since-launch" change for tokens <24h old.
  const oldTokens = tokens.filter((t) => Number(t.timestamp) <= cutoffSec);
  const newTokens = tokens.filter((t) => Number(t.timestamp) > cutoffSec);

  const oldTokenAddresses = oldTokens.map((t) => t.address.toLowerCase());
  const oldLtAddresses = Array.from(
    new Set(oldTokens.map((t) => t.ltToken.toLowerCase())),
  );
  const newTokenLtInputs = newTokens.map((t) => ({
    tokenAddress: t.address.toLowerCase(),
    ltAddress: t.ltToken.toLowerCase(),
    launchSec: Number(t.timestamp),
  }));

  const [historicalCurve, historicalLtRatesAtCutoff, historicalLtRatesAtLaunch] =
    await Promise.all([
      fetchHistoricalCurveSnapshots(ponderUrl, oldTokenAddresses, cutoffSec),
      fetchHistoricalLtRates(bouncetechDbUrl, oldLtAddresses, cutoffSec),
      fetchLtRatesAtLaunches(bouncetechDbUrl, newTokenLtInputs),
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
    const currentLtRate = liveLtRates.get(token.ltToken.toLowerCase()) ?? 0;
    const past = buildPastPriceInputs(
      token,
      cutoffSec,
      historicalCurve,
      historicalLtRatesAtCutoff,
      historicalLtRatesAtLaunch,
    );
    market[addr] = buildMarketDataItem(token, currentLtRate, past);
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

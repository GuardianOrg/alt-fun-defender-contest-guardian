import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  notInArray,
  sql,
} from "drizzle-orm";

import {
  indexerCreatorEarnings,
  indexerGlobalStats,
  indexerHourlyVolume,
  indexerRouterTrade,
  indexerToken,
  indexerTokenBalance,
  indexerTokenHourlyMetrics,
  indexerTokenSnapshot,
} from "../db/indexer-schema.js";

import type { Database } from "../db/client.js";
import type {
  MarketDataItem,
  PonderTokenOnchain,
  RouterTradeActivity,
} from "./market-data.js";

/**
 * Direct-SQL replacements for the Ponder GraphQL fetchers that used to back
 * every user-facing read on the API. Ponder still owns the *writes* — the
 * indexer process keeps `ponder_views.*` up to date on every chain event — but
 * the API now reads from those tables directly via Drizzle on the existing
 * Neon connection. This eliminates the GraphQL hop entirely:
 *
 *   - No serialised Node event loop bottleneck on the Ponder process. The
 *     indexer can stay flat on the floor processing events while reads
 *     scale with Neon, not with the indexer's single isolate.
 *   - No HTTP fan-out to Railway. The list route used to do 3–25 sequential
 *     GraphQL POSTs per cold miss; now it does ~1–4 Postgres queries on
 *     the same Drizzle/Neon HTTP session the API already opens for its own
 *     `tokens` table.
 *   - Postgres planner does the joins/sorts/aggregations the route used to
 *     fake in TypeScript by paginating raw rows.
 *
 * Functions in this module return `null` on caught error (mirroring the
 * legacy `createPonderQuery` contract) so the existing 503-on-null branches
 * in the route handlers still work without restructuring. They never partially
 * succeed — every read is a single Postgres round-trip.
 *
 * Type-compatibility note: the `PonderTokenOnchain` / `MarketDataItem` /
 * `RouterTradeActivity` shapes are imported from `market-data.ts` to keep the
 * downstream enrichment code (`buildBatchFromTokens`, `enrich`, the trending
 * score) untouched. The field names mirror the legacy GraphQL response, even
 * though our column names are the snake-case Postgres versions — the Drizzle
 * schema in `indexer-schema.ts` handles the mapping.
 */

/**
 * Structured-logging shim for the catch blocks below. Every read in this
 * module follows the legacy `return null on error` contract so the route
 * handlers' existing 503 branches still trip — but the failure must not be
 * silent, or production 503s become unactionable. Logs the event name +
 * sanitized context as JSON so Cloudflare's tail / Logpush can pivot on
 * it. CodeRabbit feedback on PR #898.
 */
function logIndexerReadFailure(
  event: string,
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  console.log(
    JSON.stringify({
      level: "error",
      event,
      ...context,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : String(error),
      timestamp: new Date().toISOString(),
    }),
  );
}

interface IndexerTokenRow {
  address: string;
  ltToken: string;
  k: string;
  curveSupply: string;
  ltReserve: string;
  pendingGraduation: boolean;
  pendingGraduationAt: string | null;
  graduated: boolean;
  graduatedAt: string | null;
  bondingPair: string | null;
  hyperswapPair: string | null;
  organicUsdcRaised: string;
  volumeUsd: string;
  creatorFeesUsd: string;
  protocolFeesUsd: string;
  timestamp: string;
}

const TOKEN_COLUMNS = {
  address: indexerToken.address,
  ltToken: indexerToken.ltToken,
  k: indexerToken.k,
  curveSupply: indexerToken.curveSupply,
  ltReserve: indexerToken.ltReserve,
  pendingGraduation: indexerToken.pendingGraduation,
  pendingGraduationAt: indexerToken.pendingGraduationAt,
  graduated: indexerToken.graduated,
  graduatedAt: indexerToken.graduatedAt,
  bondingPair: indexerToken.bondingPair,
  hyperswapPair: indexerToken.hyperswapPair,
  organicUsdcRaised: indexerToken.organicUsdcRaised,
  volumeUsd: indexerToken.volumeUsd,
  creatorFeesUsd: indexerToken.creatorFeesUsd,
  protocolFeesUsd: indexerToken.protocolFeesUsd,
  timestamp: indexerToken.timestamp,
} as const;

function toPonderTokenOnchain(row: IndexerTokenRow): PonderTokenOnchain {
  return {
    address: row.address,
    ltToken: row.ltToken,
    k: row.k,
    curveSupply: row.curveSupply,
    ltReserve: row.ltReserve,
    pendingGraduation: row.pendingGraduation,
    pendingGraduationAt: row.pendingGraduationAt,
    graduated: row.graduated,
    graduatedAt: row.graduatedAt,
    bondingPair: row.bondingPair,
    hyperswapPair: row.hyperswapPair,
    organicUsdcRaised: row.organicUsdcRaised,
    volumeUsd: row.volumeUsd,
    creatorFeesUsd: row.creatorFeesUsd,
    protocolFeesUsd: row.protocolFeesUsd,
    timestamp: row.timestamp,
  };
}

/**
 * Fetch indexer-side on-chain state for a specific set of token addresses.
 * Addresses are matched case-insensitively (the indexer stores lowercased).
 * Returns `null` on unhandled error so callers can return 503; an empty result
 * for "no matching rows" returns `[]`.
 */
export async function fetchTokensOnchainByAddresses(
  db: Database,
  addresses: string[],
): Promise<PonderTokenOnchain[] | null> {
  if (addresses.length === 0) return [];
  const lowered = addresses.map((a) => a.toLowerCase());
  try {
    const rows = (await db
      .select(TOKEN_COLUMNS)
      .from(indexerToken)
      .where(inArray(indexerToken.address, lowered))) as IndexerTokenRow[];
    return rows.map(toPonderTokenOnchain);
  } catch (error) {
    logIndexerReadFailure("indexer_reads.fetchTokensOnchainByAddresses_failed", error, {
      addressCount: addresses.length,
    });
    return null;
  }
}

export async function fetchTokenOnchain(
  db: Database,
  address: string,
): Promise<PonderTokenOnchain | null | "unavailable"> {
  try {
    const rows = (await db
      .select(TOKEN_COLUMNS)
      .from(indexerToken)
      .where(eq(indexerToken.address, address.toLowerCase()))
      .limit(1)) as IndexerTokenRow[];
    if (rows.length === 0) return null;
    return toPonderTokenOnchain(rows[0]);
  } catch (error) {
    logIndexerReadFailure("indexer_reads.fetchTokenOnchain_failed", error, {
      address: address.toLowerCase(),
    });
    return "unavailable";
  }
}

/**
 * Page of graduated tokens ordered by `graduatedAt desc`. The `graduatedAt`
 * column can be null on rows for tokens that haven't been observed graduated
 * yet — the `graduated: true` filter guarantees we only see rows with a real
 * timestamp, but we still feed `desc(graduatedAt)` which Drizzle/Postgres
 * orders NULLS LAST by default for numeric desc.
 */
export async function fetchGraduatedTokensOnchain(
  db: Database,
  limit: number,
  offset: number,
): Promise<PonderTokenOnchain[] | null> {
  try {
    const rows = (await db
      .select(TOKEN_COLUMNS)
      .from(indexerToken)
      .where(eq(indexerToken.graduated, true))
      .orderBy(desc(indexerToken.graduatedAt))
      .limit(limit)
      .offset(offset)) as IndexerTokenRow[];
    return rows.map(toPonderTokenOnchain);
  } catch (error) {
    logIndexerReadFailure("indexer_reads.fetchGraduatedTokensOnchain_failed", error, {
      limit,
      offset,
    });
    return null;
  }
}

/**
 * Page of non-graduated tokens ordered by `curveSupply asc` (closest to
 * sold-out first). Used by the GRADUATING tab to derive a bounded candidate
 * pool before applying the USD-denominated `curveFilled >= 85%` gate in the
 * route handler — see `apps/api/AGENTS.md` → "Why fetch the Ponder pool
 * sorted by `curveSupply asc`".
 */
export async function fetchNonGraduatedTokensOnchain(
  db: Database,
  limit: number,
  offset: number,
): Promise<PonderTokenOnchain[] | null> {
  try {
    const rows = (await db
      .select(TOKEN_COLUMNS)
      .from(indexerToken)
      .where(eq(indexerToken.graduated, false))
      .orderBy(asc(indexerToken.curveSupply))
      .limit(limit)
      .offset(offset)) as IndexerTokenRow[];
    return rows.map(toPonderTokenOnchain);
  } catch (error) {
    logIndexerReadFailure(
      "indexer_reads.fetchNonGraduatedTokensOnchain_failed",
      error,
      { limit, offset },
    );
    return null;
  }
}

/**
 * Latest `token_snapshot` row per address with `timestamp <= cutoff`. Used to
 * reconstruct the curve ratio 24h ago for the change24h calculation.
 *
 * Single SQL query using `DISTINCT ON (token_address)` — replaces the legacy
 * `fetchHistoricalCurveSnapshots` which fanned out one aliased GraphQL
 * sub-query per token (capped at 50 per batch, sequential across batches).
 */
export async function fetchHistoricalCurveSnapshots(
  db: Database,
  tokenAddresses: string[],
  cutoffSec: number,
): Promise<Map<string, { curveSupply: string; ltReserve: string; timestamp: string } | null> | null> {
  const result = new Map<string, { curveSupply: string; ltReserve: string; timestamp: string } | null>();
  // Seed under the **lowercased** key so callers that pass checksum-case
  // addresses don't end up with two entries (`0xAbc... → null` from the
  // seed and `0xabc... → snapshot` from the write below) — the lookup by
  // the original key would then miss real data. Caller convention is
  // "compare addresses lowercased everywhere"; this map honours it.
  // CodeRabbit feedback on PR #898.
  for (const addr of tokenAddresses) result.set(addr.toLowerCase(), null);
  if (tokenAddresses.length === 0) return result;

  const lowered = tokenAddresses.map((a) => a.toLowerCase());
  try {
    // `drizzle-orm/neon-http`'s `db.execute(sql`...`)` resolves to a
    // `NeonHttpQueryResult` object (`{ rows, rowCount, command, ... }`) —
    // NOT the rows array directly. We have to pluck `.rows`. The raw
    // `neon()` SQL tag used elsewhere in this codebase (BounceTech reads
    // in `market-data.ts`) does return the array directly, so the two
    // patterns aren't symmetric. Discovered by the smoke test on the
    // sibling `fetchPortfolioPositions` after the original cast hid the
    // shape mismatch at type-check time.
    // `id DESC` is the same `(timestamp, id)` tiebreak `fetchTokenChartSnapshots`
    // and `fetchRouterTrades` already pin — `tokenSnapshot.timestamp` is
    // `block.timestamp` at second resolution and ties on multi-trade blocks
    // (and on a curve `Bonding.Trade` + post-grad `HyperSwapPair.Sync` in the
    // same block). Without it, `DISTINCT ON (token_address)` picks an
    // arbitrary tied row at the 24h cutoff and `change24h` wobbles across
    // requests. Lock the secondary sort to the indexer's primary key
    // (`${txHash}-${logIndex}`) so the historical reference is deterministic.
    const queryResult = await db.execute(sql`
      SELECT DISTINCT ON (token_address)
        token_address,
        curve_supply::text AS curve_supply,
        lt_reserve::text AS lt_reserve,
        timestamp::text AS timestamp
      FROM ponder_views.token_snapshot
      WHERE token_address = ANY(${lowered}::text[])
        AND timestamp <= ${cutoffSec}::numeric
      ORDER BY token_address, timestamp DESC, id DESC
    `);
    const rows = queryResult.rows as unknown as Array<{
      token_address: string;
      curve_supply: string;
      lt_reserve: string;
      timestamp: string;
    }>;
    for (const r of rows) {
      result.set(r.token_address.toLowerCase(), {
        curveSupply: r.curve_supply,
        ltReserve: r.lt_reserve,
        timestamp: r.timestamp,
      });
    }
    return result;
  } catch (error) {
    logIndexerReadFailure(
      "indexer_reads.fetchHistoricalCurveSnapshots_failed",
      error,
      { addressCount: tokenAddresses.length, cutoffSec },
    );
    return null;
  }
}

/**
 * Aggregate `Zap` router-trade activity (24h volume + last trade timestamp)
 * per token, in a single `GROUP BY` query.
 *
 * The legacy GraphQL implementation paginated up to 20×1000 rows over HTTP,
 * summed in memory, and returned `null` on truncation (so the trending score
 * could fall back to "unknown" rather than silently under-counting). This
 * direct-SQL version has no truncation case — Postgres aggregates the full
 * window in one shot — so we always return populated data.
 *
 * Tokens with no trades in the window are absent from the map; callers
 * substitute `volume24hUsd = 0` / `lastTradeAt = null` for them. Empty input
 * short-circuits to an empty map (no SQL).
 */
export async function fetchRouterTradeActivity(
  db: Database,
  addresses: string[],
  nowSec: number,
): Promise<Map<string, RouterTradeActivity> | null> {
  if (addresses.length === 0) return new Map();
  const lowered = addresses.map((a) => a.toLowerCase());
  const sinceSec = nowSec - 86_400;
  try {
    const rows = (await db
      .select({
        tokenAddress: indexerRouterTrade.tokenAddress,
        volumeUsdcRaw: sql<string>`SUM(${indexerRouterTrade.usdcAmount})::text`,
        lastTradeAtSec: sql<string>`MAX(${indexerRouterTrade.timestamp})::text`,
      })
      .from(indexerRouterTrade)
      .where(
        and(
          inArray(indexerRouterTrade.tokenAddress, lowered),
          gte(indexerRouterTrade.timestamp, String(sinceSec)),
        ),
      )
      .groupBy(indexerRouterTrade.tokenAddress)) as Array<{
        tokenAddress: string;
        volumeUsdcRaw: string;
        lastTradeAtSec: string;
      }>;

    const activity = new Map<string, RouterTradeActivity>();
    for (const row of rows) {
      // USDC is 6dp on-chain; convert to display USD here so the route
      // can ship the value verbatim.
      const volume24hUsd = Number(BigInt(row.volumeUsdcRaw)) / 1e6;
      activity.set(row.tokenAddress.toLowerCase(), {
        volume24hUsd,
        lastTradeAtSec: Number(row.lastTradeAtSec),
      });
    }
    return activity;
  } catch (error) {
    logIndexerReadFailure(
      "indexer_reads.fetchRouterTradeActivity_failed",
      error,
      { addressCount: addresses.length, sinceSec },
    );
    return null;
  }
}

/** Resolved metadata for the `/trades` per-token enrichment shim. */
export interface TokenLabel {
  address: string;
  name: string;
  symbol: string;
}

/**
 * Fetch display labels (`name`, `symbol`) for a set of token addresses. The
 * `/trades` route uses this to attach `tokenSymbol` / `tokenName` to each
 * `routerTrade` row in a single Postgres query — replaces a second Ponder
 * GraphQL round-trip per `/trades` response.
 */
export async function fetchTokenLabels(
  db: Database,
  addresses: string[],
): Promise<Map<string, TokenLabel> | null> {
  if (addresses.length === 0) return new Map();
  const lowered = addresses.map((a) => a.toLowerCase());
  try {
    const rows = await db
      .select({
        address: indexerToken.address,
        name: indexerToken.name,
        symbol: indexerToken.symbol,
      })
      .from(indexerToken)
      .where(inArray(indexerToken.address, lowered));
    const map = new Map<string, TokenLabel>();
    for (const r of rows) {
      map.set(r.address.toLowerCase(), {
        address: r.address,
        name: r.name,
        symbol: r.symbol,
      });
    }
    return map;
  } catch (error) {
    logIndexerReadFailure("indexer_reads.fetchTokenLabels_failed", error, {
      addressCount: addresses.length,
    });
    return null;
  }
}

/** Shape returned by `/trades` callers — matches the legacy `PonderRouterTrade`. */
export interface IndexerRouterTradeRow {
  id: string;
  tokenAddress: string;
  trader: string;
  isBuy: boolean;
  usdcAmount: string;
  tokenAmount: string;
  blockNumber: string;
  timestamp: string;
}

/**
 * Page of router trades, newest first. When `tokenAddress` is supplied the
 * page is scoped to a single token; otherwise the global feed is returned.
 *
 * The previous GraphQL paginator returned all 20×1000 rows for the `/ohlcv`
 * route by sweeping `routerTrades(orderDirection: asc)` from genesis. That
 * pattern is preserved by the `direction` argument so the OHLCV builder can
 * still walk the full per-token history in chronological order.
 */
export async function fetchRouterTrades(
  db: Database,
  opts: {
    tokenAddress?: string;
    limit: number;
    offset: number;
    direction?: "asc" | "desc";
  },
): Promise<IndexerRouterTradeRow[] | null> {
  const direction = opts.direction ?? "desc";
  // `timestamp` (block.timestamp, second resolution) is NOT unique — a single
  // block can carry multiple Zap.Buy / Zap.Sell events, all stamped with the
  // identical Unix-second value. Ordering by it alone makes offset-based
  // pagination non-deterministic: rows tied on `timestamp` reshuffle each
  // request, so the same `(limit, offset)` pair can return duplicates on one
  // call and skip rows on the next. Add `id` (the indexer-assigned primary
  // key, globally unique and stable) as the secondary sort to lock the
  // ordering. Mirrors the direction for both columns so reverse paging stays
  // symmetric. CodeRabbit feedback on PR #898.
  const orderBy =
    direction === "asc"
      ? [asc(indexerRouterTrade.timestamp), asc(indexerRouterTrade.id)]
      : [desc(indexerRouterTrade.timestamp), desc(indexerRouterTrade.id)];

  try {
    const where = opts.tokenAddress
      ? eq(indexerRouterTrade.tokenAddress, opts.tokenAddress.toLowerCase())
      : undefined;

    const rows = await db
      .select({
        id: indexerRouterTrade.id,
        tokenAddress: indexerRouterTrade.tokenAddress,
        trader: indexerRouterTrade.trader,
        isBuy: indexerRouterTrade.isBuy,
        usdcAmount: indexerRouterTrade.usdcAmount,
        tokenAmount: indexerRouterTrade.tokenAmount,
        blockNumber: indexerRouterTrade.blockNumber,
        timestamp: indexerRouterTrade.timestamp,
      })
      .from(indexerRouterTrade)
      .where(where)
      .orderBy(...orderBy)
      .limit(opts.limit)
      .offset(opts.offset);

    return rows.map((r) => ({
      id: r.id,
      tokenAddress: r.tokenAddress,
      trader: r.trader,
      isBuy: r.isBuy,
      usdcAmount: r.usdcAmount,
      tokenAmount: r.tokenAmount,
      blockNumber: r.blockNumber,
      timestamp: r.timestamp,
    }));
  } catch (error) {
    logIndexerReadFailure("indexer_reads.fetchRouterTrades_failed", error, {
      tokenAddress: opts.tokenAddress ?? null,
      limit: opts.limit,
      offset: opts.offset,
      direction,
    });
    return null;
  }
}

/**
 * Aggregated per-wallet positions, joining the indexer's
 * `token_balance` (live ERC-20 balance from every Transfer) with
 * `wallet_position` (Zap-only running cost basis).
 *
 * Returned shape mirrors what `/portfolio/:wallet` ships to the client.
 * Zero balances are filtered out at the SQL level. Wallets without any
 * Zap activity for a held token correctly surface as
 * `costBasisUsdc: "0"` — that mirrors the legacy semantics where a
 * direct-transfer recipient has no Zap cost basis.
 */
export interface WalletPositionRow {
  tokenAddress: string;
  tokenAmount: string;
  costBasisUsdc: string;
}

const PORTFOLIO_PAGE_SIZE = 1000;

export async function fetchPortfolioPositions(
  db: Database,
  wallet: string,
): Promise<{ positions: WalletPositionRow[]; truncated: boolean } | null> {
  const lowered = wallet.toLowerCase();
  try {
    // `LIMIT PAGE_SIZE + 1` is the "is there a next page?" trick: if the
    // query returns one row past the page size, the wallet has at least
    // one more holding we're cutting off (truncated). If it returns
    // exactly the page size or fewer, the page is complete. The previous
    // `length === PAGE_SIZE` check couldn't distinguish "exactly N
    // holdings" from "more than N", so wallets that happened to hold
    // exactly 1000 tokens were mis-flagged as truncated. CodeRabbit
    // feedback on PR #898.
    //
    // Note: `drizzle-orm/neon-http`'s `db.execute(sql`...`)` resolves to
    // a `NeonHttpQueryResult` (`{ rows, rowCount, ... }`) — NOT the rows
    // array. Unwrap `.rows`. The smoke test caught the original `result
    // .map is not a function` regression that the cast hid.
    const queryResult = await db.execute(sql`
      SELECT
        b.token_address     AS token_address,
        b.balance::text     AS balance,
        COALESCE(p.cost_basis_usdc, 0)::text AS cost_basis_usdc
      FROM ponder_views.token_balance b
      LEFT JOIN ponder_views.wallet_position p
        ON p.wallet = b.wallet AND p.token_address = b.token_address
      WHERE b.wallet = ${lowered}
        AND b.balance > 0
      LIMIT ${PORTFOLIO_PAGE_SIZE + 1}
    `);
    const rows = queryResult.rows as unknown as Array<{
      token_address: string;
      balance: string;
      cost_basis_usdc: string;
    }>;

    const truncated = rows.length > PORTFOLIO_PAGE_SIZE;
    const pageRows = truncated ? rows.slice(0, PORTFOLIO_PAGE_SIZE) : rows;
    const positions = pageRows.map((r) => ({
      tokenAddress: r.token_address,
      tokenAmount: r.balance,
      costBasisUsdc: r.cost_basis_usdc,
    }));

    return { positions, truncated };
  } catch (error) {
    logIndexerReadFailure(
      "indexer_reads.fetchPortfolioPositions_failed",
      error,
      { wallet: lowered },
    );
    return null;
  }
}

/** Shape returned by `fetchHolders`. */
export interface HolderRow {
  wallet: string;
  balance: string;
}

/**
 * Top-N holders (by balance desc) for a token, plus a total count of holders
 * with non-zero balance after excluding protocol wallets. Both come from a
 * single SQL round-trip; the previous GraphQL implementation paginated up to
 * 20K rows and counted in memory.
 *
 * `excludedWallets` carries the bonding proxy + bonding pair + hyperswap pair
 * + zero address, all lowercased — see the route handler for the rationale.
 */
export async function fetchHolders(
  db: Database,
  opts: {
    tokenAddress: string;
    limit: number;
    excludedWallets: string[];
  },
): Promise<{ holders: HolderRow[]; totalHolders: number } | null> {
  const tokenAddress = opts.tokenAddress.toLowerCase();
  const excluded = opts.excludedWallets.map((w) => w.toLowerCase());

  try {
    const baseConds = [
      eq(indexerTokenBalance.tokenAddress, tokenAddress),
      gt(indexerTokenBalance.balance, "0"),
    ];
    if (excluded.length > 0) {
      baseConds.push(notInArray(indexerTokenBalance.wallet, excluded));
    }

    const [{ count: rawCount } = { count: "0" }] = (await db
      .select({ count: sql<string>`COUNT(*)::text` })
      .from(indexerTokenBalance)
      .where(and(...baseConds))) as Array<{ count: string }>;

    const totalHolders = Number(rawCount);

    if (totalHolders === 0) {
      return { holders: [], totalHolders };
    }

    const rows = await db
      .select({
        wallet: indexerTokenBalance.wallet,
        balance: indexerTokenBalance.balance,
      })
      .from(indexerTokenBalance)
      .where(and(...baseConds))
      .orderBy(desc(indexerTokenBalance.balance))
      .limit(opts.limit);

    return {
      holders: rows.map((r) => ({ wallet: r.wallet, balance: r.balance })),
      totalHolders,
    };
  } catch (error) {
    logIndexerReadFailure("indexer_reads.fetchHolders_failed", error, {
      tokenAddress,
      limit: opts.limit,
    });
    return null;
  }
}

/** Shape returned by `fetchGlobalStats`. */
export interface GlobalStatsRow {
  totalTokens: number;
  tokensLive: number;
  tokensGraduated: number;
  totalVolumeUsd: string;
}

/** Bounded scan of the last 25 `hourly_volume` buckets summed via Postgres. */
export async function fetchPlatformStats(
  db: Database,
  windowStart: number,
): Promise<{ singleton: GlobalStatsRow | null; volume24h: bigint } | null> {
  try {
    const [singletonRow] = await db
      .select({
        totalTokens: indexerGlobalStats.totalTokens,
        tokensLive: indexerGlobalStats.tokensLive,
        tokensGraduated: indexerGlobalStats.tokensGraduated,
        totalVolumeUsd: indexerGlobalStats.totalVolumeUsd,
      })
      .from(indexerGlobalStats)
      .where(eq(indexerGlobalStats.id, "global"))
      .limit(1);

    const [{ volume24h = "0" } = { volume24h: "0" }] = (await db
      .select({
        volume24h: sql<string>`COALESCE(SUM(${indexerHourlyVolume.volumeUsd}), 0)::text`,
      })
      .from(indexerHourlyVolume)
      .where(gte(indexerHourlyVolume.hourStart, String(windowStart)))) as Array<{ volume24h: string }>;

    const singleton: GlobalStatsRow | null = singletonRow
      ? {
          totalTokens: Number(singletonRow.totalTokens ?? "0"),
          tokensLive: Number(singletonRow.tokensLive ?? "0"),
          tokensGraduated: Number(singletonRow.tokensGraduated ?? "0"),
          totalVolumeUsd: singletonRow.totalVolumeUsd ?? "0",
        }
      : null;

    return { singleton, volume24h: BigInt(volume24h) };
  } catch (error) {
    logIndexerReadFailure("indexer_reads.fetchPlatformStats_failed", error, {
      windowStart,
    });
    return null;
  }
}

/**
 * Resolve `(bondingPair, hyperswapPair)` for a token without pulling the
 * full row. Used by `/holders/:address` to build the exclusion list. A
 * missing row (`null`) means the token isn't indexed yet — the route falls
 * back to "exclude just the zero address + bonding proxy" in that case.
 */
export async function fetchTokenPairAddresses(
  db: Database,
  tokenAddress: string,
): Promise<{ bondingPair: string | null; hyperswapPair: string | null } | "missing" | "error"> {
  try {
    const [row] = await db
      .select({
        bondingPair: indexerToken.bondingPair,
        hyperswapPair: indexerToken.hyperswapPair,
      })
      .from(indexerToken)
      .where(eq(indexerToken.address, tokenAddress.toLowerCase()))
      .limit(1);
    if (!row) return "missing";
    return {
      bondingPair: row.bondingPair,
      hyperswapPair: row.hyperswapPair,
    };
  } catch (error) {
    logIndexerReadFailure(
      "indexer_reads.fetchTokenPairAddresses_failed",
      error,
      { tokenAddress: tokenAddress.toLowerCase() },
    );
    return "error";
  }
}

/** Resolved (address, 24h volume) pair for the trending pool. */
export interface TrendingVolumeCandidate {
  /** Lowercased token address. */
  tokenAddress: string;
  /** Gross USDC routed through `Zap` for this token in the last 24h, USD float. */
  volume24hUsd: number;
}

/**
 * Top-K trending candidate token addresses, ranked by **rolling 24h gross
 * USDC volume**. Pure-volume trending sort: the candidate fetch IS the
 * ranking — there's no per-request re-score on top, no precomputed
 * `base_score` column, no boost system, no freshness/recency/dead-token
 * heuristics. Sole backing store is `token_hourly_metrics` (hour-bucketed
 * gross USDC per token), summed over the last 24h.
 *
 * `cutoffHourStartSec` is the earliest `hour_start` to include — callers
 * pass `floor((now - 86400) / 3600) * 3600` to get a "trailing 24h"
 * window that's always at least 24h wide regardless of where in the hour
 * the request lands (matches the platform-wide `hourlyVolume` scan
 * semantics in `fetchPlatformStats`).
 *
 * Tokens with zero recent activity are absent from the result — the
 * `HAVING SUM(volume_usd) > 0` is implicit in the `GROUP BY` (a token
 * with no bucket rows in the window contributes nothing to the result).
 * The 24h cutoff + `(token_address, hour_start)` index keep this O(active
 * tokens × ≤25 buckets) — cheap even on a cold cache, no truncation case.
 *
 * Tie-breaking: the secondary `ORDER BY token_address ASC` makes the
 * truncated candidate set deterministic across requests. The route layer
 * then applies the documented `volume desc, mcap desc` tie-break over
 * the hydrated pool — that's intentionally best-effort because mcap
 * depends on the BounceTech LT rate × curve price and can't be expressed
 * in SQL here. Collisions on 6dp-USDC `SUM(volume_usd)` across 500+
 * tokens are vanishingly improbable in practice (each gross-USDC trade
 * tail adds entropy), so the deterministic SQL sort + best-effort mcap
 * tie-break is the right cost/correctness trade. CodeRabbit feedback on
 * PR #946.
 */
export async function fetchTrendingCandidatesByVolume(
  db: Database,
  limit: number,
  cutoffHourStartSec: number,
): Promise<TrendingVolumeCandidate[] | null> {
  try {
    const rows = (await db
      .select({
        tokenAddress: indexerTokenHourlyMetrics.tokenAddress,
        volumeRaw: sql<string>`SUM(${indexerTokenHourlyMetrics.volumeUsd})::text`,
      })
      .from(indexerTokenHourlyMetrics)
      .where(
        gte(indexerTokenHourlyMetrics.hourStart, String(cutoffHourStartSec)),
      )
      .groupBy(indexerTokenHourlyMetrics.tokenAddress)
      .orderBy(
        sql`SUM(${indexerTokenHourlyMetrics.volumeUsd}) DESC`,
        asc(indexerTokenHourlyMetrics.tokenAddress),
      )
      .limit(limit)) as Array<{ tokenAddress: string; volumeRaw: string }>;
    return rows.map((r) => ({
      tokenAddress: r.tokenAddress.toLowerCase(),
      // USDC is 6dp on-chain; convert to USD here so the route can ship
      // the value verbatim and sort by it without re-parsing the bigint.
      volume24hUsd: Number(BigInt(r.volumeRaw)) / 1e6,
    }));
  } catch (error) {
    logIndexerReadFailure(
      "indexer_reads.fetchTrendingCandidatesByVolume_failed",
      error,
      { limit, cutoffHourStartSec },
    );
    return null;
  }
}

/**
 * Per-creator earnings totals (USDC, 6dp raw amounts). Sourced from the
 * indexer's `creator_earnings` running-counter table, populated in
 * lockstep with every `FeeVault.FeeAccrued` / `FeeVault.CreatorFeesClaimed`
 * (see `apps/indexer/src/feeVault.ts`). Replaces the legacy frontend
 * pattern of two `eth_call` reads against `FeeVault.creatorBalance` /
 * `lifetimeCreatorEarned` per 30s poll per mounted earnings panel —
 * which fanned out to ~`O(connected wallets × pages mounted)` RPC reads
 * before this counter existed.
 *
 * The "no row" case is the steady state for any wallet that's never
 * launched a token — surfaced as `null` so the route can ship a clean
 * zero-state response instead of synthesising default zeros that the
 * caller would have to special-case anyway.
 */
export interface CreatorEarningsRow {
  /** Cumulative USDC accrued (6dp raw amount, decimal string). */
  lifetimeEarnedUsdcRaw: string;
  /** Cumulative USDC claimed (6dp raw amount, decimal string). */
  lifetimeClaimedUsdcRaw: string;
}

export async function fetchCreatorEarnings(
  db: Database,
  creator: string,
): Promise<CreatorEarningsRow | null | "unavailable"> {
  // Indexer stores hex addresses lowercased — match that to keep the
  // primary-key lookup hitting the index regardless of whether the API
  // caller passed a checksum-cased or lowercased address.
  const lowered = creator.toLowerCase();
  try {
    const rows = (await db
      .select({
        lifetimeEarnedUsdc: indexerCreatorEarnings.lifetimeEarnedUsdc,
        lifetimeClaimedUsdc: indexerCreatorEarnings.lifetimeClaimedUsdc,
      })
      .from(indexerCreatorEarnings)
      .where(eq(indexerCreatorEarnings.creator, lowered))
      .limit(1)) as Array<{
      lifetimeEarnedUsdc: string;
      lifetimeClaimedUsdc: string;
    }>;
    if (rows.length === 0) return null;
    const [row] = rows;
    return {
      lifetimeEarnedUsdcRaw: row.lifetimeEarnedUsdc ?? "0",
      lifetimeClaimedUsdcRaw: row.lifetimeClaimedUsdc ?? "0",
    };
  } catch (error) {
    logIndexerReadFailure("indexer_reads.fetchCreatorEarnings_failed", error, {
      creator: lowered,
    });
    return "unavailable";
  }
}

/**
 * Cheap-but-real reachability probe for the indexer DB connection. Mirrors
 * the legacy `checkPonderHealth` semantics: an empty table is fine (returns
 * `true`), a thrown exception is `false`. Used by the `/health` endpoint and
 * the OHLCV pre-check.
 *
 * Touches the `token` row count rather than `SELECT 1` so a Postgres pool
 * that's reachable but starved of capacity still surfaces as `false`.
 */
export async function checkIndexerHealth(db: Database): Promise<boolean> {
  try {
    await db
      .select({ address: indexerToken.address })
      .from(indexerToken)
      .limit(1);
    return true;
  } catch (error) {
    logIndexerReadFailure("indexer_reads.checkIndexerHealth_failed", error);
    return false;
  }
}

/**
 * Column subset of `ponder_views.token` needed to anchor the chart route:
 *
 *   - `k` — `reserve0 × reserve1` at `Pair.mint`. Drives the launch-anchor
 *     ratio inside `buildRatioTimeline` (`k / TOTAL_SUPPLY` is the virtual
 *     LT reserve at launch).
 *   - `ltToken` — fallback for the BounceTech LT address when the API's own
 *     `tokens.ltPair` row is missing (token created but registration backfill
 *     hasn't landed yet).
 *   - `graduated` / `graduatedAt` — present on the legacy GraphQL shape and
 *     surfaced here for parity even though the chart route doesn't currently
 *     branch on either field. Keeps a future "graduated-only chart styling"
 *     change a one-line read instead of a schema migration.
 *   - `timestamp` — block timestamp of `TokenLaunched`. Used as the floor for
 *     the chart's history window so we don't request pre-launch ratios.
 *
 * Return contract mirrors `fetchTokenOnchain`:
 *
 *   - `null`     → row genuinely doesn't exist (token not indexed yet)
 *   - `"unavailable"` → caught error (treat as 503-eligible)
 *
 * Lets the caller distinguish "404 because the indexer hasn't seen this
 * token" from "503 because the indexer DB is unreachable" without colour-
 * blinding on `null`. CodeRabbit feedback on PR #898 keeps this convention
 * consistent across the chart-context + portfolio + token-lookup helpers.
 */
export interface ChartTokenContext {
  k: string;
  ltToken: string;
  graduated: boolean;
  graduatedAt: string | null;
  timestamp: string;
}

export async function fetchTokenChartContext(
  db: Database,
  address: string,
): Promise<ChartTokenContext | null | "unavailable"> {
  try {
    const rows = await db
      .select({
        k: indexerToken.k,
        ltToken: indexerToken.ltToken,
        graduated: indexerToken.graduated,
        graduatedAt: indexerToken.graduatedAt,
        timestamp: indexerToken.timestamp,
      })
      .from(indexerToken)
      .where(eq(indexerToken.address, address.toLowerCase()))
      .limit(1);
    if (rows.length === 0) return null;
    const [row] = rows;
    return {
      k: row.k,
      ltToken: row.ltToken,
      graduated: row.graduated,
      graduatedAt: row.graduatedAt,
      timestamp: row.timestamp,
    };
  } catch (error) {
    logIndexerReadFailure(
      "indexer_reads.fetchTokenChartContext_failed",
      error,
      { address: address.toLowerCase() },
    );
    return "unavailable";
  }
}

/** Row shape returned by `fetchTokenChartSnapshots`. Mirrors the legacy `PonderTokenSnapshot`. */
export interface ChartTokenSnapshotRow {
  curveSupply: string;
  ltReserve: string;
  timestamp: string;
}

/**
 * Single-token tokenSnapshot window for the chart route. Replaces the legacy
 * GraphQL pair of (paginated in-window query + standalone pre-window anchor
 * query) with a single Postgres round-trip per phase, executed in parallel.
 *
 * Returns the anchor first (if any) followed by every in-window snapshot
 * ordered `(timestamp asc, id asc)` — matches the array shape
 * `buildRatioTimeline` already expects. Anchor presence is purely an
 * existence question: a token launched inside the window legitimately has no
 * pre-window snapshot, and the launch anchor inside `buildRatioTimeline` is
 * the right baseline.
 *
 * Why the `id` tiebreak: `tokenSnapshot.timestamp` is `block.timestamp` at
 * second resolution and is NOT unique — a single block can carry multiple
 * `Bonding.Trade` events (or a Bonding.Trade plus a HyperSwapPair.Sync
 * post-grad), all stamped with the identical Unix-second value. Ordering by
 * timestamp alone leaves the relative order of those rows to Postgres'
 * physical heap order, which (a) isn't stable across `VACUUM` / `CLUSTER` /
 * deploy schema swaps and (b) doesn't necessarily match the order the
 * legacy Ponder GraphQL paginator returned (id-keyed). Inside
 * `buildPriceTimeline` the *last* same-timestamp ratio entry wins for any
 * event at or after that timestamp, so a flipped order produces different
 * intra-bucket OHLC `high` / `low` / `close` values. Adding `asc(id)` as
 * the secondary sort locks the ordering to the indexer's globally-unique
 * primary key (`${txHash}-${logIndex}`), which is the same effective order
 * the legacy GraphQL path produced. Mirrors the fix `fetchRouterTrades`
 * already applies (`(timestamp, id)` composite sort).
 *
 * Truncation is impossible here — Postgres returns every row in one shot,
 * unlike the legacy paginator's `MAX_PAGES × 1000` cap. Callers that used to
 * branch on `truncated: true` (and 503 the response) no longer need that
 * branch when reading via this helper.
 */
export async function fetchTokenChartSnapshots(
  db: Database,
  tokenAddress: string,
  fromSec: number,
): Promise<ChartTokenSnapshotRow[] | null> {
  const lowered = tokenAddress.toLowerCase();
  const fromSecStr = String(fromSec);
  try {
    const [anchorRows, windowRows] = await Promise.all([
      db
        .select({
          curveSupply: indexerTokenSnapshot.curveSupply,
          ltReserve: indexerTokenSnapshot.ltReserve,
          timestamp: indexerTokenSnapshot.timestamp,
        })
        .from(indexerTokenSnapshot)
        .where(
          and(
            eq(indexerTokenSnapshot.tokenAddress, lowered),
            lt(indexerTokenSnapshot.timestamp, fromSecStr),
          ),
        )
        .orderBy(
          desc(indexerTokenSnapshot.timestamp),
          desc(indexerTokenSnapshot.id),
        )
        .limit(1),
      db
        .select({
          curveSupply: indexerTokenSnapshot.curveSupply,
          ltReserve: indexerTokenSnapshot.ltReserve,
          timestamp: indexerTokenSnapshot.timestamp,
        })
        .from(indexerTokenSnapshot)
        .where(
          and(
            eq(indexerTokenSnapshot.tokenAddress, lowered),
            gte(indexerTokenSnapshot.timestamp, fromSecStr),
          ),
        )
        .orderBy(
          asc(indexerTokenSnapshot.timestamp),
          asc(indexerTokenSnapshot.id),
        ),
    ]);
    return [...anchorRows, ...windowRows].map((r) => ({
      curveSupply: r.curveSupply,
      ltReserve: r.ltReserve,
      timestamp: r.timestamp,
    }));
  } catch (error) {
    logIndexerReadFailure(
      "indexer_reads.fetchTokenChartSnapshots_failed",
      error,
      { tokenAddress: lowered, fromSec },
    );
    return null;
  }
}

/**
 * Re-export the legacy shapes so callers can import them from one place
 * during the GraphQL → direct-SQL migration. `market-data.ts` still owns
 * the canonical type definitions; this is purely a re-export convenience.
 */
export type { MarketDataItem, PonderTokenOnchain, RouterTradeActivity };

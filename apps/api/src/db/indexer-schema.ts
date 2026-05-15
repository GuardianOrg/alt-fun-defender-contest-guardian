import {
  pgSchema,
  text,
  numeric,
  boolean,
  integer,
  index,
} from "drizzle-orm/pg-core";

/**
 * Drizzle handles for the indexer-owned objects that live in the
 * `ponder_views` Postgres schema (see `apps/indexer/ponder.schema.ts` for the
 * canonical write-side definitions, and the Ponder runtime for how those
 * map to columns here).
 *
 * **Read-only from this side.** Ponder is the source of truth for every
 * column below — it writes them on chain events and handles reorg-aware
 * versioning internally. The API queries the finalized tables (NOT the
 * `_reorg__*` shadows) so we always observe the same "current finalized
 * state" surface the GraphQL layer used to expose, just without the
 * GraphQL hop.
 *
 * **`ponder_views` is a stable views layer, not where data lives.** Each
 * indexer deploy writes its tables into a per-deploy Postgres schema
 * (`--schema=$RAILWAY_DEPLOYMENT_ID`) and Ponder's `db create-views`
 * step (auto-run when the new deployment hits `/ready`) drops + recreates
 * `ponder_views.<table>` as `SELECT * FROM <deploy_id>.<table>`. The API
 * keeps reading the same `ponder_views.*` names while the underlying
 * tables transparently flip on every deploy — see `apps/indexer/AGENTS.md`
 * → *Hosting* for the full lifecycle.
 */
const ponderSchema = pgSchema("ponder_views");

/**
 * `ponder_views.token` — one row per launched Alt Fun token, updated on
 * `Bonding.TokenLaunched` / `Bonding.Trade` / `Bonding.TokenGraduating` /
 * `Bonding.TokenGraduated` / `Zap.Buy` / `Zap.Sell` / `FeeVault.FeeAccrued`
 * (and the HyperSwap `Sync` mirror post-graduation).
 *
 * Numeric-typed bigint columns (`k`, `curve_supply`, `lt_reserve`, etc.)
 * land here as Postgres `numeric` — Drizzle returns them as strings, which
 * matches the JSON shape the API surfaces and avoids the JS bigint round-trip
 * cost. Callers that need arithmetic should `BigInt(...)` at the use site.
 */
export const indexerToken = ponderSchema.table(
  "token",
  {
    address: text("address").primaryKey(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    creator: text("creator").notNull(),
    ltToken: text("lt_token").notNull(),
    k: numeric("k").notNull(),
    curveSupply: numeric("curve_supply").notNull(),
    ltReserve: numeric("lt_reserve").notNull(),
    pendingGraduation: boolean("pending_graduation").notNull().default(false),
    pendingGraduationAt: numeric("pending_graduation_at"),
    graduated: boolean("graduated").notNull().default(false),
    graduatedAt: numeric("graduated_at"),
    bondingPair: text("bonding_pair"),
    hyperswapPair: text("hyperswap_pair"),
    organicUsdcRaised: numeric("organic_usdc_raised").notNull().default("0"),
    volumeUsd: numeric("volume_usd").notNull().default("0"),
    creatorFeesUsd: numeric("creator_fees_usd").notNull().default("0"),
    protocolFeesUsd: numeric("protocol_fees_usd").notNull().default("0"),
    blockNumber: numeric("block_number").notNull(),
    timestamp: numeric("timestamp").notNull(),
  },
  (table) => [index("token_creator_index").on(table.creator)],
);

/**
 * `ponder_views.router_trade` — USDC-denominated trades emitted from the
 * `Zap` router. Covers both curve and post-graduation activity (Zap is the
 * only user-facing entry point in either phase). Surfaced verbatim by the
 * `/trades` API and consumed in aggregate by the `/tokens` list for the
 * `volume24hUsd` / `lastTradeAt` columns and the trending recency bonus.
 */
export const indexerRouterTrade = ponderSchema.table(
  "router_trade",
  {
    id: text("id").primaryKey(),
    tokenAddress: text("token_address").notNull(),
    trader: text("trader").notNull(),
    isBuy: boolean("is_buy").notNull(),
    usdcAmount: numeric("usdc_amount").notNull(),
    tokenAmount: numeric("token_amount").notNull(),
    blockNumber: numeric("block_number").notNull(),
    timestamp: numeric("timestamp").notNull(),
  },
  (table) => [
    index("router_trade_token_address_index").on(table.tokenAddress),
    index("router_trade_trader_index").on(table.trader),
    index("router_trade_timestamp_index").on(table.timestamp),
    // Composite for `fetchRouterTradeActivity` — `WHERE token_address
    // IN (...) AND timestamp >= cutoff GROUP BY token_address`. See
    // the matching definition in `apps/indexer/ponder.schema.ts`;
    // both must stay in lockstep so a Ponder redeploy doesn't drop
    // the index.
    index("router_trade_token_address_timestamp_index").on(
      table.tokenAddress,
      table.timestamp,
    ),
  ],
);

/**
 * `ponder_views.token_balance` — per-(wallet, token) live balance, updated on
 * every ERC-20 `Transfer`. The `id` column is the composite `${wallet}-${tokenAddress}`
 * key Ponder uses internally; callers should match on `(wallet, tokenAddress)`
 * rather than reconstructing the id.
 */
export const indexerTokenBalance = ponderSchema.table(
  "token_balance",
  {
    id: text("id").primaryKey(),
    wallet: text("wallet").notNull(),
    tokenAddress: text("token_address").notNull(),
    balance: numeric("balance").notNull(),
  },
  (table) => [
    index("token_balance_wallet_index").on(table.wallet),
    index("token_balance_token_address_index").on(table.tokenAddress),
  ],
);

/**
 * `ponder_views.wallet_position` — Zap-only running cost basis per
 * (wallet, token). Independent from `token_balance`: this only tracks
 * Zap-mediated buys/sells (so a wallet that received tokens via direct
 * Transfer correctly shows a positive balance with zero cost basis).
 */
export const indexerWalletPosition = ponderSchema.table(
  "wallet_position",
  {
    id: text("id").primaryKey(),
    wallet: text("wallet").notNull(),
    tokenAddress: text("token_address").notNull(),
    zapTokenAmount: numeric("zap_token_amount").notNull().default("0"),
    costBasisUsdc: numeric("cost_basis_usdc").notNull().default("0"),
  },
  (table) => [index("wallet_position_wallet_index").on(table.wallet)],
);

/**
 * `ponder_views.token_snapshot` — post-trade curve state, written on every
 * `Bonding.Trade` (and on `HyperSwapPair.Sync` post-graduation). Used to
 * reconstruct a token's curve ratio at a past timestamp for 24h-change deltas.
 * The `(token_address, timestamp)` composite index is the read shape — see
 * `indexer-reads.ts → fetchHistoricalCurveSnapshots`.
 */
export const indexerTokenSnapshot = ponderSchema.table(
  "token_snapshot",
  {
    id: text("id").primaryKey(),
    tokenAddress: text("token_address").notNull(),
    curveSupply: numeric("curve_supply").notNull(),
    ltReserve: numeric("lt_reserve").notNull(),
    blockNumber: numeric("block_number").notNull(),
    timestamp: numeric("timestamp").notNull(),
  },
  (table) => [
    index("token_snapshot_token_address_timestamp_index").on(
      table.tokenAddress,
      table.timestamp,
    ),
  ],
);

/**
 * `ponder_views.global_stats` — singleton row keyed `"global"` with
 * platform-wide counters (`/api/v1/stats`). Bumped on every TokenLaunched /
 * TokenGraduated / Zap.Buy / Zap.Sell in lockstep with the per-token
 * counters on `indexerToken`.
 */
export const indexerGlobalStats = ponderSchema.table("global_stats", {
  id: text("id").primaryKey(),
  totalTokens: numeric("total_tokens").notNull().default("0"),
  tokensLive: numeric("tokens_live").notNull().default("0"),
  tokensGraduated: numeric("tokens_graduated").notNull().default("0"),
  totalVolumeUsd: numeric("total_volume_usd").notNull().default("0"),
});

/**
 * `ponder_views.hourly_volume` — one row per hour-start Unix timestamp
 * (`floor(ts / 3600) * 3600`). Used by `/api/v1/stats` to derive 24h volume
 * from a bounded 25-row scan (the extra bucket gives the rolling window a
 * full 24h regardless of where in the hour the request lands).
 */
export const indexerHourlyVolume = ponderSchema.table("hourly_volume", {
  hourStart: numeric("hour_start").primaryKey(),
  volumeUsd: numeric("volume_usd").notNull().default("0"),
});

/**
 * `ponder_views.token_metrics` — per-token derived counters maintained by
 * the indexer (lifetime volume / trade count / distinct traders / last
 * trade timestamp / a precomputed base trending score). Not currently
 * consumed by the API list route — the trending sort still computes the
 * score on the fly — but exposed here so it's available without a second
 * schema edit when we move trending to a fully precomputed score.
 */
export const indexerTokenMetrics = ponderSchema.table("token_metrics", {
  tokenAddress: text("token_address").primaryKey(),
  volumeUsdLifetime: numeric("volume_usd_lifetime").notNull().default("0"),
  tradeCount: integer("trade_count").notNull().default(0),
  distinctTraderCount: integer("distinct_trader_count").notNull().default(0),
  lastTradeAt: numeric("last_trade_at"),
  baseScore: numeric("base_score").notNull().default("0"),
  updatedAt: numeric("updated_at").notNull(),
});

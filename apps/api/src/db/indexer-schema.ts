import { desc } from "drizzle-orm";
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
    /** Immutable launch wallet. For the current fee earner see `feeRecipient`. */
    creator: text("creator").notNull(),
    /** Mirrors `Bonding.creatorOf(token)` — moves on creator handover / takeover. */
    feeRecipient: text("fee_recipient").notNull(),
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
  (table) => [
    index("token_creator_index").on(table.creator),
    // Backs fetchPendingGraduationTokens (graduation-keeper cron).
    // Matching definition in apps/indexer/ponder.schema.ts — keep in lockstep.
    index("token_pending_graduation_index").on(
      table.pendingGraduation,
      table.pendingGraduationAt,
    ),
    // Backs fetchMostRecentTokenAddresses (registration-backfill cron).
    // Matching definition in apps/indexer/ponder.schema.ts — keep in lockstep.
    index("token_block_number_index").on(desc(table.blockNumber)),
  ],
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
 * `ponder_views.token_hourly_metrics` — per-(token, hour-start) gross USDC
 * bucket. Sole backing store for the trending tab and per-token 24h
 * volume: the API sums the last 24 rows per token at read time
 * (`SUM(volume_usd) WHERE hour_start >= now - 24h GROUP BY token_address
 * ORDER BY total DESC LIMIT K`) to derive the rolling 24h figure that
 * powers `?sort=trending` and the `volume24hUsd` column, with no
 * precomputed score / cron / boost flow on top.
 *
 * `(token_address, hour_start)` is indexed for the GROUP BY's per-token
 * range scan; `hour_start` alone is indexed so the 24h cutoff can prune
 * old rows before the aggregate. See `apps/indexer/ponder.schema.ts` for
 * the canonical write-side definition and accumulation semantics.
 */
export const indexerTokenHourlyMetrics = ponderSchema.table(
  "token_hourly_metrics",
  {
    id: text("id").primaryKey(),
    tokenAddress: text("token_address").notNull(),
    hourStart: numeric("hour_start").notNull(),
    volumeUsd: numeric("volume_usd").notNull().default("0"),
    tradeCount: integer("trade_count").notNull().default(0),
  },
  (table) => [
    index("token_hourly_metrics_token_hour_index").on(
      table.tokenAddress,
      table.hourStart,
    ),
    index("token_hourly_metrics_hour_start_index").on(table.hourStart),
  ],
);

/**
 * `ponder_views.creator_earnings` — per-creator running counters,
 * one row per creator wallet keyed by `creator`. The indexer
 * (`apps/indexer/src/feeVault.ts`) keeps these in lockstep on every
 * `FeeVault.FeeAccrued` (bumps `lifetime_earned_usdc`) and
 * `FeeVault.CreatorFeesClaimed` (bumps `lifetime_claimed_usdc`), so
 * `GET /api/v1/creators/:wallet/earnings` resolves with a single
 * primary-key lookup — no RPC, no GraphQL hop, no per-token fan-out.
 *
 * Read-side derivation: `claimable = max(0, earned − claimed)`. The
 * floor absorbs the brief sub-block ordering quirks that can arise
 * during indexer catch-up (a `CreatorFeesClaimed` and the matching
 * `FeeAccrued` chain can land in different blocks if a buy and a
 * claim share the same tx). See the table-level docstring in
 * `apps/indexer/ponder.schema.ts` for the full contract.
 */
export const indexerCreatorEarnings = ponderSchema.table(
  "creator_earnings",
  {
    creator: text("creator").primaryKey(),
    lifetimeEarnedUsdc: numeric("lifetime_earned_usdc").notNull().default("0"),
    lifetimeClaimedUsdc: numeric("lifetime_claimed_usdc").notNull().default("0"),
  },
);

/**
 * `ponder_views.fee_accrual` — per-trade USDC fee accrual emitted by
 * `FeeVault:FeeAccrued`. Written on every router-mediated buy/sell (curve
 * and post-grad) plus the seed buy in `Zap.createToken`. The admin revenue
 * dashboard reads this directly (rather than the per-token `creatorFeesUsd`
 * / `protocolFeesUsd` counters on `token`) so it can bucket fees by day.
 *
 * Amounts are USDC (6dp) stored as `numeric` — same convention as every
 * other USDC column in the mirror; callers `BigInt(...)` at the use site.
 * Per-side aggregates have `creatorAmount` zero on buys against tokens
 * whose `feeShare.creator` is zero, and similarly for `protocolAmount`,
 * so the admin route filters `> 0` before bucketing.
 */
export const indexerFeeAccrual = ponderSchema.table(
  "fee_accrual",
  {
    id: text("id").primaryKey(),
    tokenAddress: text("token_address").notNull(),
    creator: text("creator").notNull(),
    creatorAmount: numeric("creator_amount").notNull(),
    protocolAmount: numeric("protocol_amount").notNull(),
    isBuy: boolean("is_buy").notNull(),
    blockNumber: numeric("block_number").notNull(),
    timestamp: numeric("timestamp").notNull(),
  },
  (table) => [
    index("fee_accrual_token_address_index").on(table.tokenAddress),
    index("fee_accrual_creator_index").on(table.creator),
    index("fee_accrual_timestamp_index").on(table.timestamp),
  ],
);

/**
 * `ponder_views.graduation` — one row per graduated token, written on
 * `Bonding.TokenGraduated`. Primary-key on `tokenAddress` (only one
 * graduation can ever land per token). The admin /graduations dashboard
 * scans by `timestamp_gte` so the timestamp index carries the read load.
 */
export const indexerGraduation = ponderSchema.table(
  "graduation",
  {
    tokenAddress: text("token_address").primaryKey(),
    pairAddress: text("pair_address").notNull(),
    liquidity: numeric("liquidity").notNull(),
    // Phase-1 LP-seed target, not necessarily the exact tokens deposited when
    // the pair was pre-seeded with live reserves. Prefer `liquidity` / live
    // reserves for actuals. See the indexer `ponder.schema.ts` `tokensInLP`.
    tokensInLP: numeric("tokens_in_lp").notNull(),
    lpBurned: numeric("lp_burned").notNull(),
    unsoldBurned: numeric("unsold_burned").notNull(),
    blockNumber: numeric("block_number").notNull(),
    timestamp: numeric("timestamp").notNull(),
  },
  (table) => [index("graduation_timestamp_index").on(table.timestamp)],
);

/**
 * `ponder_views.referral` — one row per `Referred` event (a buy with a
 * non-zero referrer attribute). The per-referrer index matches the read
 * pattern on `/api/v1/referrals/:wallet` which lists every referral
 * paid to a single referrer wallet.
 */
export const indexerReferral = ponderSchema.table(
  "referral",
  {
    id: text("id").primaryKey(),
    tokenAddress: text("token_address").notNull(),
    trader: text("trader").notNull(),
    referrer: text("referrer").notNull(),
    usdcAmount: numeric("usdc_amount").notNull(),
    blockNumber: numeric("block_number").notNull(),
    timestamp: numeric("timestamp").notNull(),
  },
  (table) => [index("referral_referrer_index").on(table.referrer)],
);

/**
 * `ponder_views.wallet_bot_position` — per-(wallet, token) running cost
 * basis / realised PnL for trades routed through `BotFeeRouter`. Powers
 * `/api/v1/bot/positions/:wallet`. Separate from `wallet_position` (which
 * tracks Zap-only) because the bot is a distinct fee-bearing router with
 * its own attribution surface.
 */
export const indexerWalletBotPosition = ponderSchema.table(
  "wallet_bot_position",
  {
    id: text("id").primaryKey(),
    wallet: text("wallet").notNull(),
    token: text("token").notNull(),
    ticker: text("ticker").notNull().default(""),
    tokenBalance: numeric("token_balance").notNull().default("0"),
    costBasisUsdc: numeric("cost_basis_usdc").notNull().default("0"),
    currentValueUsdc: numeric("current_value_usdc").notNull().default("0"),
    realisedPnlUsdc: numeric("realised_pnl_usdc").notNull().default("0"),
    totalCostUsdc: numeric("total_cost_usdc").notNull().default("0"),
    totalProceedsUsdc: numeric("total_proceeds_usdc").notNull().default("0"),
  },
  (table) => [
    index("wallet_bot_position_wallet_index").on(table.wallet),
    index("wallet_bot_position_token_index").on(table.token),
  ],
);

/**
 * `ponder_views.referrer_stats` — per-referrer aggregate row. Powers
 * `/api/v1/bot/referrals/:wallet`. Primary-key on the lowercased
 * referrer wallet, so callers should normalise before the lookup.
 */
export const indexerReferrerStats = ponderSchema.table("referrer_stats", {
  id: text("id").primaryKey(),
  referrer: text("referrer").notNull(),
  referredCount: integer("referred_count").notNull().default(0),
  lifetimeEarnedUsdc: numeric("lifetime_earned_usdc").notNull().default("0"),
  badPaymentCount: integer("bad_payment_count").notNull().default(0),
  attributionLossCount: integer("attribution_loss_count").notNull().default(0),
});

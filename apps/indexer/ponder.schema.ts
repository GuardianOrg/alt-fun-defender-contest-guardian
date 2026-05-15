import { onchainTable, index } from "ponder";

export const token = onchainTable("token", (t) => ({
  address: t.hex().primaryKey(),
  name: t.text().notNull(),
  symbol: t.text().notNull(),
  creator: t.hex().notNull(),
  ltToken: t.hex().notNull(),
  k: t.bigint().notNull(),
  curveSupply: t.bigint().notNull(),
  ltReserve: t.bigint().notNull(),
  /**
   * True between `TokenGraduating` (phase 1, fires inline on the threshold-
   * crossing buy) and `TokenGraduated` (phase 2, the permissionless
   * `finalizeGraduation` tx). Tokens in this state are contract-frozen —
   * `Zap.buy` / `Zap.sell` revert with `TokenIsGraduating`. Surfaced as the
   * `"graduating"` lifecycle on the API + frontend.
   */
  pendingGraduation: t.boolean().notNull().default(false),
  /** Block timestamp when phase 1 fired. Used by the keeper to detect stuck tokens. */
  pendingGraduationAt: t.bigint(),
  graduated: t.boolean().notNull().default(false),
  graduatedAt: t.bigint(),
  /** Bonding curve pair address (from Factory.PairCreated). Set once at launch. */
  bondingPair: t.hex(),
  /** HyperSwap V2 pair address (from Bonding.TokenGraduated). Set at graduation. */
  hyperswapPair: t.hex(),
  /**
   * Net USDC (6dp) put into this token via `Zap` — buys add
   * `usdcIn`, sells subtract `usdcOut` (floored at 0). Used to decompose the
   * graduation progress bar into "organic buys" vs "LT price appreciation":
   * we expose the organic USD contribution, and derive the boost as
   * `totalUsdRaised - organicUsdRaised`. Updated on every Buy/Sell regardless
   * of graduation status (the UI only shows the split while the token is on
   * the curve).
   */
  organicUsdcRaised: t.bigint().notNull().default(0n),
  /**
   * Cumulative gross USDC (6dp) routed through `Zap` for this
   * token — buys **and** sells both add to the counter (never subtract). This
   * is the lifetime trading-volume figure surfaced as `totalVolumeUsd` on
   * the API's token responses (hero card, creator rewards). Contrast with
   * `organicUsdcRaised` which is a net counter floored at 0 used for the
   * graduation-progress split.
   */
  volumeUsd: t.bigint().notNull().default(0n),
  /**
   * Cumulative USDC (6dp) accrued to this token's creator via
   * `FeeVault:FeeAccrued` (curve + post-grad, never subtracts on claim —
   * this is "earned per token" not "currently claimable"). Surfaced on
   * `ApiToken.creatorFeesUsd` for the Rewards-tab "earned" column. The
   * vault doesn't itself attribute balances back to individual tokens,
   * so the indexer is the only place this per-token decomposition lives.
   */
  creatorFeesUsd: t.bigint().notNull().default(0n),
  /**
   * Mirror counter for the protocol cut. Same lifetime semantics as
   * `creatorFeesUsd` (never decreases on protocol claim). Surfaced for
   * symmetry with the admin dashboard.
   */
  protocolFeesUsd: t.bigint().notNull().default(0n),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}), (table) => ({
  creatorIdx: index().on(table.creator),
}));

/** Bonding curve trades with LT amounts and curve state changes. */
export const trade = onchainTable("trade", (t) => ({
  id: t.text().primaryKey(),
  tokenAddress: t.hex().notNull(),
  trader: t.hex().notNull(),
  isBuy: t.boolean().notNull(),
  ltAmount: t.bigint().notNull(),
  tokenAmount: t.bigint().notNull(),
  curveSupply: t.bigint().notNull(),
  ltReserve: t.bigint().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}), (table) => ({
  tokenIdx: index().on(table.tokenAddress),
  traderIdx: index().on(table.trader),
  timestampIdx: index().on(table.timestamp),
}));

/** USDC-denominated trades from Zap (covers both curve and post-graduation). */
export const routerTrade = onchainTable("router_trade", (t) => ({
  id: t.text().primaryKey(),
  tokenAddress: t.hex().notNull(),
  trader: t.hex().notNull(),
  isBuy: t.boolean().notNull(),
  usdcAmount: t.bigint().notNull(),
  tokenAmount: t.bigint().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}), (table) => ({
  tokenIdx: index().on(table.tokenAddress),
  traderIdx: index().on(table.trader),
  timestampIdx: index().on(table.timestamp),
  // Composite for the API's `fetchRouterTradeActivity` aggregate
  // (`WHERE token_address IN (…) AND timestamp >= cutoff GROUP BY
  // token_address`). pg_stat_statements showed this query family at
  // ~32% of total DB time when the system was under load — the
  // single-column `tokenIdx` was forcing bitmap-or-seq scans on
  // larger IN lists. The composite lets each address's window slice
  // resolve as a single tight index range scan.
  tokenTimestampIdx: index().on(table.tokenAddress, table.timestamp),
}));

export const graduation = onchainTable("graduation", (t) => ({
  tokenAddress: t.hex().primaryKey(),
  pairAddress: t.hex().notNull(),
  liquidity: t.bigint().notNull(),
  /** Exact tokens seeded into the HyperSwap LP (dynamic LP seeding). */
  tokensInLP: t.bigint().notNull(),
  /** LP reserve leftovers burned to make the LP open at the last curve price. */
  lpBurned: t.bigint().notNull(),
  /** Unsold curve tokens burned when the USD trigger fires before sellout. */
  unsoldBurned: t.bigint().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}));

export const referral = onchainTable("referral", (t) => ({
  id: t.text().primaryKey(),
  tokenAddress: t.hex().notNull(),
  trader: t.hex().notNull(),
  referrer: t.hex().notNull(),
  usdcAmount: t.bigint().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}), (table) => ({
  referrerIdx: index().on(table.referrer),
}));

/**
 * USDC fee claim event from `FeeVault`. Covers both creator claims
 * (`CreatorFeesClaimed`) and protocol claims (`ProtocolFeesClaimed`).
 * Amounts are denominated in USDC (6dp) — the legacy per-LT accounting
 * is gone with the router-level fee migration.
 */
export const feeClaim = onchainTable("fee_claim", (t) => ({
  id: t.text().primaryKey(),
  claimer: t.hex().notNull(),
  amount: t.bigint().notNull(),
  isCreator: t.boolean().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}), (table) => ({
  claimerIdx: index().on(table.claimer),
}));

/**
 * Per-trade USDC fee accrual from `FeeVault:FeeAccrued`. Emitted by the
 * router on every buy/sell (curve + post-grad) plus the seed-buy on
 * `createToken`. Used by the admin revenue dashboard and per-token
 * creator-earnings views — both of which care about earned fees rather
 * than claim timing, so we keep accruals separate from `feeClaim`.
 */
export const feeAccrual = onchainTable("fee_accrual", (t) => ({
  id: t.text().primaryKey(),
  tokenAddress: t.hex().notNull(),
  creator: t.hex().notNull(),
  creatorAmount: t.bigint().notNull(),
  protocolAmount: t.bigint().notNull(),
  isBuy: t.boolean().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}), (table) => ({
  tokenIdx: index().on(table.tokenAddress),
  creatorIdx: index().on(table.creator),
}));

/** HyperSwap V2 Pair swaps (post-graduation DEX trades). */
export const swap = onchainTable("swap", (t) => ({
  id: t.text().primaryKey(),
  pairAddress: t.hex().notNull(),
  sender: t.hex().notNull(),
  to: t.hex().notNull(),
  amount0In: t.bigint().notNull(),
  amount1In: t.bigint().notNull(),
  amount0Out: t.bigint().notNull(),
  amount1Out: t.bigint().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}), (table) => ({
  pairIdx: index().on(table.pairAddress),
  timestampIdx: index().on(table.timestamp),
}));

/** Latest HyperSwap V2 Pair reserves (updated on Sync events). */
export const pairReserve = onchainTable("pair_reserve", (t) => ({
  pairAddress: t.hex().primaryKey(),
  reserve0: t.bigint().notNull(),
  reserve1: t.bigint().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}));

/**
 * Reverse map: HyperSwap V2 pair address → token address. Populated on
 * `Bonding:TokenGraduated` so the `HyperSwapPair:Sync` handler can resolve
 * the token (and its LT) from the pair without an O(n) scan or an extra
 * RPC read of `token0`/`token1`.
 *
 * `tokenIsToken0` is cached at graduation time (HyperSwap V2 sorts pair
 * tokens by ascending address, so it's deterministic from the addresses)
 * and used to map `(reserve0, reserve1)` → `(tokenReserve, ltReserve)` on
 * every Sync event without re-comparing strings each time.
 */
export const hyperswapPairIndex = onchainTable("hyperswap_pair_index", (t) => ({
  pairAddress: t.hex().primaryKey(),
  tokenAddress: t.hex().notNull(),
  ltAddress: t.hex().notNull(),
  tokenIsToken0: t.boolean().notNull(),
}));

/** Per-wallet token balances, updated on every ERC-20 Transfer. */
export const tokenBalance = onchainTable("token_balance", (t) => ({
  id: t.text().primaryKey(),
  wallet: t.hex().notNull(),
  tokenAddress: t.hex().notNull(),
  balance: t.bigint().notNull(),
}), (table) => ({
  walletIdx: index().on(table.wallet),
  tokenIdx: index().on(table.tokenAddress),
}));

/**
 * Post-trade curve state, written on every Bonding:Trade. Used to look up a
 * token's curve ratio at a past timestamp for 24h change deltas. The LT
 * exchange rate at the same cutoff is fetched from BounceTech's `token_snapshots_v1`
 * at API read time — reading `exchangeRate()` historically via `readContract`
 * reverts on HyperEVM because the LT view touches a Hyperliquid precompile.
 */
export const tokenSnapshot = onchainTable("token_snapshot", (t) => ({
  id: t.text().primaryKey(),
  tokenAddress: t.hex().notNull(),
  curveSupply: t.bigint().notNull(),
  ltReserve: t.bigint().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}), (table) => ({
  tokenTsIdx: index().on(table.tokenAddress, table.timestamp),
}));

/**
 * Singleton platform counters. Single row keyed `"global"` updated in the same
 * write as the per-token counters in `bonding.ts`. Lets `/api/v1/stats` answer
 * in O(1) instead of paginating every token + every 24h trade. The 24h volume
 * window is sourced from `hourlyVolume` (24-row scan, see below).
 */
export const globalStats = onchainTable("global_stats", (t) => ({
  id: t.text().primaryKey(),
  totalTokens: t.bigint().notNull().default(0n),
  tokensLive: t.bigint().notNull().default(0n),
  tokensGraduated: t.bigint().notNull().default(0n),
  /** Cumulative gross USDC (6dp) routed through Zap, all tokens, lifetime. */
  totalVolumeUsd: t.bigint().notNull().default(0n),
}));

/**
 * Hour-bucketed gross USDC volume across all tokens. Keyed by the hour-start
 * Unix timestamp (`timestamp / 3600 * 3600`) so the `/stats` route can answer
 * "last 24h volume" by summing 24 rows instead of paginating every trade.
 *
 * One row per hour grows at ~24 rows/day forever — negligible storage and the
 * API only ever scans the last 24. We deliberately don't dimension by token —
 * every consumer of this table cares about platform-wide volume; per-token
 * 24h volume already lives on `token.volume24hUsd` (computed differently).
 */
export const hourlyVolume = onchainTable("hourly_volume", (t) => ({
  hourStart: t.bigint().primaryKey(),
  volumeUsd: t.bigint().notNull().default(0n),
}));

/**
 * Per-token aggregate row updated incrementally on every `Zap:Buy` / `Zap:Sell`
 * event. Powers the trending tab in O(log N) regardless of catalogue size —
 * `GET /api/v1/tokens?sort=trending` selects the top-K candidates by
 * `baseScore` index, then re-scores them at the API layer with windowed inputs
 * (`change24h`, `volume24hUsd`, freshness/recency/dead time terms). Replaces
 * the legacy "newest 500 tokens, score in memory" candidate pool that was
 * trivially spammable.
 *
 * Anti-spam by construction: `baseScore` is a log-scale function of three
 * pure-activity signals, all zero for a token nobody trades:
 *
 *   baseScore = 15·log10(volumeUsdLifetime + 1)
 *             + 10·log10(distinctTraderCount + 1)
 *             +  5·log10(tradeCount + 1)
 *
 * Mass token creation alone does not move the needle — a spam burst of 500
 * zero-trade tokens scores 0 each and ranks below any token that has had
 * even one real trade.
 *
 * The score is deliberately a *candidate filter*, not the user-visible
 * ranking. The API re-applies the full `computeTrendingScore` at read time
 * on the top-K hydrated set so freshness, recency, and the dead-token
 * penalty still apply (those are time-dependent and can't be precomputed
 * cheaply). LT-rate drift is intentionally *not* a baseScore input — the
 * 1Hz LtTicker cadence would fan out one DB write per LT-backed token per
 * tick, defeating the point of the precompute.
 */
export const tokenMetrics = onchainTable("token_metrics", (t) => ({
  tokenAddress: t.hex().primaryKey(),
  /**
   * Cumulative gross USDC routed through `Zap` for this token, 6dp. Mirrors
   * `token.volumeUsd` but co-located on the metrics row for cache/index
   * locality. Both columns are kept in lockstep by the same write.
   */
  volumeUsdLifetime: t.bigint().notNull().default(0n),
  /** Cumulative count of `Zap.Buy` + `Zap.Sell` events on this token. */
  tradeCount: t.integer().notNull().default(0),
  /**
   * Count of distinct wallets that have ever traded this token via Zap.
   * Maintained via the `tokenTrader` side-table — a wallet's first trade
   * inserts a row + bumps this counter; subsequent trades by the same wallet
   * are no-ops here. Used as the primary anti-spam term in `baseScore`
   * (self-trading bots can inflate `tradeCount` but not `distinctTraderCount`).
   */
  distinctTraderCount: t.integer().notNull().default(0),
  /** Unix seconds of the most recent `Zap.Buy` / `Zap.Sell`. */
  lastTradeAt: t.bigint(),
  /**
   * Precomputed trade-driven trending score. See file docstring for the
   * formula. The `baseScoreIdx` lets `?sort=trending` answer top-K with a
   * single ORDER BY + LIMIT regardless of catalogue size.
   */
  baseScore: t.real().notNull().default(0),
  updatedAt: t.bigint().notNull(),
}), (table) => ({
  baseScoreIdx: index().on(table.baseScore),
  lastTradeAtIdx: index().on(table.lastTradeAt),
}));

/**
 * Per-(token, hour-start) volume + trade-count bucket — the per-token mirror
 * of the platform-wide `hourlyVolume` table. The API sums the last 24 rows
 * per token to derive exact 24h volume / trade count without scanning the
 * `routerTrade` table.
 *
 * Storage scales as O(active-tokens × hours-active) = O(N) per day worst
 * case (one bucket per token per active hour). At 100K tokens with 24
 * active hours/day that's 2.4M new rows/day — small for Postgres given
 * the `(tokenAddress, hourStart)` index.
 *
 * Id shape is `${tokenAddress}-${hourStart}` for upsert keying. We don't
 * use `(tokenAddress, hourStart)` as a composite PK because Ponder's
 * `db.update`/`db.find` APIs expect a single primary-key field.
 */
export const tokenHourlyMetrics = onchainTable("token_hourly_metrics", (t) => ({
  id: t.text().primaryKey(),
  tokenAddress: t.hex().notNull(),
  hourStart: t.bigint().notNull(),
  volumeUsd: t.bigint().notNull().default(0n),
  tradeCount: t.integer().notNull().default(0),
}), (table) => ({
  tokenHourIdx: index().on(table.tokenAddress, table.hourStart),
}));

/**
 * Membership table backing `tokenMetrics.distinctTraderCount`. One row per
 * `(token, trader)` pair, inserted the first time a wallet trades that
 * token via Zap. Subsequent trades by the same wallet on the same token
 * are no-ops here.
 *
 * Kept separate from `tokenMetrics` so the bump-on-first-trade pattern is
 * a single `find`+`insert` rather than re-reading a (potentially large)
 * `traders` array column. Storage is bounded by the platform's lifetime
 * distinct (token, wallet) pairs.
 *
 * Id shape mirrors `walletPosition` / `walletBotPosition`: `${trader}-${tokenAddress}`
 * lower-cased by Ponder's hex type. The `tokenIdx` is for any future
 * "list the wallets that have traded this token" debugging query — not
 * read by the API yet.
 */
export const tokenTrader = onchainTable("token_trader", (t) => ({
  id: t.text().primaryKey(),
  tokenAddress: t.hex().notNull(),
  trader: t.hex().notNull(),
  firstTradedAt: t.bigint().notNull(),
}), (table) => ({
  tokenIdx: index().on(table.tokenAddress),
}));

/**
 * Per-(wallet, token) Zap-derived position state. Tracks cumulative net buys
 * minus sells (for proportional cost-basis math) and the running USDC cost
 * basis. Read by `/api/v1/portfolio` so cost basis no longer requires
 * paginating the wallet's full trade history.
 *
 * Independent from `tokenBalance`: this row counts only Zap-mediated trades,
 * while `tokenBalance` mirrors every ERC-20 Transfer. A wallet that received
 * tokens via direct transfer / airdrop will show a positive balance with zero
 * cost basis here — which matches the intuition that the recipient didn't
 * spend USDC for them.
 */
export const walletPosition = onchainTable("wallet_position", (t) => ({
  id: t.text().primaryKey(),
  wallet: t.hex().notNull(),
  tokenAddress: t.hex().notNull(),
  /**
   * Net Zap-mediated token amount: `Σ buy.tokensOut − Σ sell.tokensIn`,
   * floored at 0. NOT the wallet's true balance (use `tokenBalance` for
   * that) — this is the denominator for proportional cost-basis reduction
   * on sells. Stays at 0 for wallets that only received tokens via transfer.
   */
  zapTokenAmount: t.bigint().notNull().default(0n),
  /** Cumulative USDC paid (6dp) less proportional reduction on each sell. */
  costBasisUsdc: t.bigint().notNull().default(0n),
}), (table) => ({
  walletIdx: index().on(table.wallet),
}));

/**
 * Raw `BotFeeRouter.BotRouterTrade` events. The Telegram-bot fee model
 * routes every trade through `BotFeeRouter` (which skims a 50 bps bot
 * fee, splits the skim 20/80 between an opt-in referrer and the
 * treasury, then forwards the rest to `Zap`). This table captures one
 * row per router trade and is the source-of-truth feeding
 * `walletBotPosition` and `referrerStats`.
 *
 * Mirrors `routerTrade` (Zap-mediated trades) but kept distinct because
 * the user-visible USDC amounts here are the **gross** the user paid
 * (buy) or received (sell, before bot-fee skim) — including the bot fee
 * — which is the right basis for the bot's PnL display. Zap's
 * `routerTrade` records the post-bot-fee net forwarded into Zap.
 */
export const botRouterTrade = onchainTable("bot_router_trade", (t) => ({
  id: t.text().primaryKey(),
  tokenAddress: t.hex().notNull(),
  trader: t.hex().notNull(),
  /** True for `Side.Buy` (0), false for `Side.Sell` (1). */
  isBuy: t.boolean().notNull(),
  /**
   * Gross USDC user paid on buy / gross USDC `Zap` returned on sell
   * (before the bot fee skim). 6dp.
   */
  usdcAmount: t.bigint().notNull(),
  /** Tokens received on buy / tokens consumed on sell. 18dp. */
  tokenAmount: t.bigint().notNull(),
  /** Bot fee paid in USDC (50 bps of `usdcAmount`). 6dp. */
  botFee: t.bigint().notNull(),
  /** Referrer wallet, or zero address if the trade had no referrer. */
  referrer: t.hex().notNull(),
  /**
   * USDC actually transferred to the referrer. Zero if no referrer,
   * the referrer's wallet rejected the USDC transfer (bad-rewards-wallet
   * fallback), or the candidate cut rounded to zero.
   */
  referrerCut: t.bigint().notNull(),
  /** USDC actually transferred to treasury. */
  treasuryCut: t.bigint().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}), (table) => ({
  traderIdx: index().on(table.trader),
  referrerIdx: index().on(table.referrer),
  tokenIdx: index().on(table.tokenAddress),
  timestampIdx: index().on(table.timestamp),
}));

/**
 * Per-(wallet, token) Bot-router-derived position state. Powers the
 * Telegram bot's `/positions` view: one DB row per (wallet, token) so
 * the bot makes a single API call regardless of how many tokens the
 * user holds — no per-token RPC fan-out.
 *
 * Independent from `walletPosition`: that one is Zap-only and tracks
 * cost basis for the web app's `/portfolio`; this one is router-only
 * and includes the bot fee + realised PnL columns the bot needs.
 *
 * Cost basis is the **gross USDC the user spent** (already includes
 * Alt Fun's 0.5% fee, the bot's 0.5% fee, and any slippage), so PnL
 * surfaces correctly without per-fee subtraction at read time.
 * Realised PnL uses average-cost accounting on partial sells: when the
 * wallet sells `n` of `N` held tokens, the realised cost for the chunk
 * is `costBasisUsdc × (n / N)`. Matches the historical /portfolio math.
 */
export const walletBotPosition = onchainTable("wallet_bot_position", (t) => ({
  id: t.text().primaryKey(),
  wallet: t.hex().notNull(),
  token: t.hex().notNull(),
  /**
   * Denormalised from the `token` row so `GET /api/v1/bot/positions/:wallet`
   * answers with a single GraphQL query. Updated on every router trade for
   * this token to absorb late-arriving `Bonding:TokenLaunched` symbol
   * fills (matches the `tokenSymbol` enrichment pattern in `bonding.ts`).
   */
  ticker: t.text().notNull().default(""),
  /** Currently-held tokens routed through `BotFeeRouter` (18dp). Floors at 0. */
  tokenBalance: t.bigint().notNull().default(0n),
  /**
   * Cumulative USDC (6dp) the wallet has spent on currently-held tokens,
   * reduced proportionally on each sell. Goes to 0 when `tokenBalance` hits 0.
   */
  costBasisUsdc: t.bigint().notNull().default(0n),
  /**
   * `tokenBalance × lastTradeImpliedPriceUsdcPerToken`, refreshed on
   * every router trade for this (wallet, token). 6dp. Zero when the
   * wallet has no balance.
   *
   * Stale between trades on this position. `GET /api/v1/bot/positions`
   * overrides this with a live curve / HyperSwap mark at read time and
   * only falls back to this snapshot when the live lookup fails — see
   * the `fetchCurrentPricesUsdc` helper there. Don't trust this column
   * as the user-visible mark, but do keep writing it: it's the
   * degraded-mode fallback when BounceTech or the indexer is down.
   */
  currentValueUsdc: t.bigint().notNull().default(0n),
  /** Running sum of `(proceeds − cost)` for closed-out chunks. Signed. 6dp. */
  realisedPnlUsdc: t.bigint().notNull().default(0n),
  /** Lifetime sum of buy notional (gross USDC). 6dp. Never decreases. */
  totalCostUsdc: t.bigint().notNull().default(0n),
  /** Lifetime sum of sell notional (gross USDC). 6dp. Never decreases. */
  totalProceedsUsdc: t.bigint().notNull().default(0n),
}), (table) => ({
  walletIdx: index().on(table.wallet),
  tokenIdx: index().on(table.token),
}));

/**
 * Per-referrer aggregate stats. One row per referrer wallet (the
 * address that received `ReferralPaid` payouts via `BotFeeRouter`).
 * Powers `GET /api/v1/bot/referrals/:wallet`.
 *
 * - `referredCount`: distinct trader wallets attributed to this
 *   referrer over the router's lifetime. Tracked via the helper
 *   `botReferrerTrader` table so re-trades don't double-count.
 * - `lifetimeEarnedUsdc`: sum of every `ReferralPaid.amount` to this
 *   referrer. The router emits `ReferralPaid` only when the USDC
 *   transfer to the rewards wallet succeeds, so this is a
 *   transfer-confirmed total and never inflates with bad-payout trades.
 * - `badPaymentCount`: count of `BotRouterTrade` events where the
 *   trade had a referrer but the referrer cut was zero (the
 *   bad-rewards-wallet fallback fired). Surfaced as a /referral banner
 *   so the referrer knows to fix their rewards wallet.
 * - `attributionLossCount`: count of attribution-loss events. The
 *   indexer cannot observe attribution drops directly (they happen
 *   bot-side at /start when a deeplink can't be resolved), so this
 *   stays at 0 from the indexer; the bot is free to surface its own
 *   tracking on top of the indexer-sourced fields.
 */
export const referrerStats = onchainTable("referrer_stats", (t) => ({
  /** Referrer wallet, lowercased. */
  id: t.text().primaryKey(),
  referrer: t.hex().notNull(),
  referredCount: t.integer().notNull().default(0),
  lifetimeEarnedUsdc: t.bigint().notNull().default(0n),
  badPaymentCount: t.integer().notNull().default(0),
  attributionLossCount: t.integer().notNull().default(0),
}));

/**
 * Helper table: tracks which trader wallets have already been counted
 * toward a referrer's `referredCount`. Without this, multiple trades
 * by the same trader under the same referrer would over-count distinct
 * referees. One row per `(referrer, trader)` pair, inserted the first
 * time we see that pair on a `BotRouterTrade`.
 */
export const botReferrerTrader = onchainTable("bot_referrer_trader", (t) => ({
  /** `${referrer}-${trader}`, both lowercased. */
  id: t.text().primaryKey(),
  referrer: t.hex().notNull(),
  trader: t.hex().notNull(),
}), (table) => ({
  referrerIdx: index().on(table.referrer),
}));


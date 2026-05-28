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
  // Backs the GRADUATED tab on `GET /api/v1/tokens?status=graduated`:
  //
  //   SELECT ... FROM ponder_views.token
  //   WHERE graduated = true
  //   ORDER BY graduated_at DESC
  //   LIMIT 500
  //
  // Without a directionally-matching composite the planner falls back
  // to a seq scan of the full token catalogue and an external sort —
  // GRADUATED tab loads grow linearly with token count and tip into
  // multi-second territory once the catalogue is even a few thousand
  // rows. The `(graduated, graduated_at DESC)` index lets the
  // `graduated = true` slice resolve as a tight reverse-ordered range
  // scan capped at LIMIT, matching the same fix pattern as
  // `tokenSnapshot.tokenTsDescIdIdx`.
  graduatedAtIdx: index().on(table.graduated, table.graduatedAt.desc()),
  // Backs the GRADUATING tab on `GET /api/v1/tokens?status=graduating`:
  //
  //   SELECT ... FROM ponder_views.token
  //   WHERE graduated = false
  //   ORDER BY curve_supply ASC
  //   LIMIT 500
  //
  // Same shape regression: the `graduated = false` slice covers most
  // of the catalogue (only a small fraction of tokens have ever
  // graduated), so without this index every GRADUATING-tab request
  // seq-scans the whole table and sorts in memory. The composite lets
  // the planner walk the `graduated = false` segment in ascending
  // `curveSupply` order (closest-to-sold-out first — the candidate
  // ordering the route's USD-denominated 75% gate consumes; see
  // `routes/tokens/list.ts → fetchNonGraduatedTokensOnchain`).
  curveSupplyIdx: index().on(table.graduated, table.curveSupply),
  // Backs `fetchPendingGraduationTokens` in `graduation-keeper.ts`:
  //
  //   SELECT address, pending_graduation_at FROM ponder_views.token
  //   WHERE pending_graduation = true AND graduated = false
  //   ORDER BY pending_graduation_at ASC LIMIT 50
  //
  // Without this, Postgres seq-scans the full token catalogue on every
  // keeper cron tick (once per minute) even though only 0–5 rows ever
  // match. The composite on (pending_graduation, pending_graduation_at)
  // lets the planner seek directly to the pending slice and walk it in
  // ascending timestamp order, capping at LIMIT 50 without a sort step.
  // graduated is not included — by contract pending_graduation = true
  // implies graduated = false, so the filter never removes rows.
  pendingGraduationIdx: index().on(table.pendingGraduation, table.pendingGraduationAt),
  // Backs `fetchMostRecentTokenAddresses` in `registration-backfill.ts`:
  //
  //   SELECT address FROM ponder_views.token
  //   ORDER BY block_number DESC LIMIT 50
  //
  // Without this, every backfill tick (once per minute) seq-scans the
  // entire token table and runs a top-N heapsort. The DESC index lets
  // the planner walk the newest rows first and stop at LIMIT 50 with
  // no sort step, regardless of catalogue size.
  blockNumberIdx: index().on(table.blockNumber.desc()),
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
  // Backs the analytics revenue queries (`fetchRevenueBuckets`,
  // `fetchWindowedFees`) which scan `fee_accrual` by a trailing
  // `timestamp >=` cutoff. Without this, those queries seq-scan all
  // ~250K rows even on a selective 24h window (~25 ms). With the
  // index, selective windows drop to sub-ms. Mirrors the equivalent
  // `routerTrade.timestampIdx` and matches the API-side Drizzle
  // handle in `apps/api/src/db/indexer-schema.ts`. Added in PR #1168
  // after a perf review against the live read replica.
  timestampIdx: index().on(table.timestamp),
}));

/**
 * Per-creator running counters. One row per creator wallet, bumped in
 * lockstep on every `FeeVault:FeeAccrued` (lifetimeEarnedUsdc) and
 * `FeeVault:CreatorFeesClaimed` (lifetimeClaimedUsdc). Lets the API
 * answer `GET /creators/:wallet/earnings` in O(1) — a single primary-key
 * lookup — instead of either (a) reading `creatorBalance` /
 * `lifetimeCreatorEarned` from the FeeVault contract over RPC on every
 * 30s poll from every wallet that has the rewards panel open, or (b)
 * paginating `feeAccrual` + `feeClaim` per request. Mirrors the
 * `walletPosition` pattern (issue #397) — same tradeoff: O(1) read,
 * O(1) write maintenance from the existing event handlers.
 *
 * `claimableUsdc` is derived at read time as
 * `lifetimeEarnedUsdc − lifetimeClaimedUsdc`, clamped at 0 — the two
 * counters are bumped from independent events and can briefly disagree
 * by sub-block ordering quirks during indexer catch-up. Storing the
 * difference would just compound the drift; the floor in the read path
 * is the right place to absorb it.
 */
export const creatorEarnings = onchainTable("creator_earnings", (t) => ({
  creator: t.hex().primaryKey(),
  /**
   * Cumulative USDC (6dp) accrued to this creator across every token
   * they've launched. Mirror of `lifetimeCreatorEarned(creator)` on the
   * `FeeVault` contract — bumped on every `FeeVault:FeeAccrued`. Never
   * decreases.
   */
  lifetimeEarnedUsdc: t.bigint().notNull().default(0n),
  /**
   * Cumulative USDC (6dp) the creator has actually claimed. Bumped on
   * every `FeeVault:CreatorFeesClaimed`. Never decreases. The vault
   * contract resets `creatorBalance` to 0 on claim — the indexer is the
   * only place this lifetime claimed total lives, so this counter
   * doubles as the source of truth for the rewards-panel "claimed"
   * pill.
   */
  lifetimeClaimedUsdc: t.bigint().notNull().default(0n),
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
  // `(token_address asc, timestamp desc, id desc)` matches the
  // `fetchHistoricalCurveSnapshots` query verbatim:
  //
  //   SELECT DISTINCT ON (token_address) ...
  //   FROM ponder_views.token_snapshot
  //   WHERE token_address = ANY($1::text[]) AND timestamp <= $2::numeric
  //   ORDER BY token_address, timestamp DESC, id DESC
  //
  // Without a directionally-matching composite the planner falls back
  // to per-key index seeks on `(token_address, timestamp)` followed by
  // an external sort to enforce the `timestamp DESC, id DESC` tiebreak
  // — pg_stat_statements measured ~1 s per call × ~77 calls/s in
  // production (incident on 2026-05-16, PR #988 originally tripped
  // it). The composite lets the DISTINCT ON resolve as a tight index
  // scan per `token_address` slice with no sort step. Mirrors the
  // same fix pattern as `routerTrade.tokenTimestampIdx`.
  //
  // The existing `(token_address, timestamp)` ascending index is kept
  // because `fetchTokenChartSnapshots`'s in-window scan reads
  // `timestamp ASC, id ASC` for a fixed token — Postgres can serve
  // that by reverse-scanning the new descending index, but the
  // forward scan on the legacy index is cheaper for the per-token
  // chart hot path where N rows are small and we never want a
  // backward scan.
  tokenTsIdx: index().on(table.tokenAddress, table.timestamp),
  tokenTsDescIdIdx: index().on(
    table.tokenAddress,
    table.timestamp.desc(),
    table.id.desc(),
  ),
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
 * Per-(token, hour-start) gross USDC bucket. Sole backing store for the
 * trending tab and per-token 24h volume — the API sums the last 24 rows
 * per token to derive the rolling 24h figure (`SUM(volume_usd) WHERE
 * hour_start >= now - 24h GROUP BY token_address`) without scanning the
 * `routerTrade` table. Trending is just `ORDER BY that sum DESC` plus a
 * `LIMIT` for the candidate pool — no precomputed score, no cron, no
 * boost.
 *
 * Storage scales as O(active-tokens × hours-active) = O(N) per day worst
 * case (one bucket per token per active hour). At 100K tokens with 24
 * active hours/day that's 2.4M new rows/day — small for Postgres given
 * the `(tokenAddress, hourStart)` index.
 *
 * Id shape is `${tokenAddress}-${hourStart}` for upsert keying. We don't
 * use `(tokenAddress, hourStart)` as a composite PK because Ponder's
 * `db.update`/`db.find` APIs expect a single primary-key field.
 *
 * Spam-resistance comes from the same property the platform-wide
 * `hourlyVolume` has: a token nobody trades simply has no rows here, so
 * mass token creation cannot move the trending ranking. The `tradeCount`
 * column is retained for parity with the platform-wide table but is not
 * read by the trending sort.
 */
export const tokenHourlyMetrics = onchainTable("token_hourly_metrics", (t) => ({
  id: t.text().primaryKey(),
  tokenAddress: t.hex().notNull(),
  hourStart: t.bigint().notNull(),
  volumeUsd: t.bigint().notNull().default(0n),
  tradeCount: t.integer().notNull().default(0),
}), (table) => ({
  tokenHourIdx: index().on(table.tokenAddress, table.hourStart),
  // `hour_start` index supports the API's `WHERE hour_start >= cutoff
  // GROUP BY token_address ORDER BY SUM(volume_usd) DESC LIMIT K` access
  // pattern: the planner uses this to skip rows older than 24h before
  // hashing the GROUP BY. Without it the trending pool query falls back
  // to a seq scan once the table is multiple days deep.
  hourStartIdx: index().on(table.hourStart),
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


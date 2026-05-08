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
}), (table) => ({
  hourIdx: index().on(table.hourStart),
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


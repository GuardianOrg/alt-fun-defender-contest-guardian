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
 * Singleton row mirroring mutable Bonding owner-controlled parameters that
 * the API + frontend need to read frequently. Currently just the graduation
 * threshold; structured as a singleton (PK = `"global"`) so additional
 * tunables can be added as columns without schema churn.
 *
 * Bootstrapped lazily: written on the first `Bonding:GraduationThresholdUpdated`
 * event the indexer sees AND on the first `Bonding:TokenLaunched` (defensive
 * — covers the case where no admin update has fired yet but the deployed
 * contract is already trading at its initialise-time default). API reads
 * fall back to the compile-time default (12_000) when the row is missing,
 * so a fresh indexer is never load-bearing for the curve-filled progress bar.
 */
export const protocolConfig = onchainTable("protocol_config", (t) => ({
  id: t.text().primaryKey(),
  graduationThresholdUsd: t.bigint().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
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


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
  /** Bonding curve pair address (from FFactory.PairCreated). Set once at launch. */
  bondingPair: t.hex(),
  /** HyperSwap V2 pair address (from Bonding.TokenGraduated). Set at graduation. */
  hyperswapPair: t.hex(),
  /**
   * Net USDC (6dp) put into this token via `LaunchpadRouter` — buys add
   * `usdcIn`, sells subtract `usdcOut` (floored at 0). Used to decompose the
   * graduation progress bar into "organic buys" vs "LT price appreciation":
   * we expose the organic USD contribution, and derive the boost as
   * `totalUsdRaised - organicUsdRaised`. Updated on every Buy/Sell regardless
   * of graduation status (the UI only shows the split while the token is on
   * the curve).
   */
  organicUsdcRaised: t.bigint().notNull().default(0n),
  /**
   * Cumulative gross USDC (6dp) routed through `LaunchpadRouter` for this
   * token — buys **and** sells both add to the counter (never subtract). This
   * is the lifetime trading-volume figure surfaced as `totalVolumeUsd` on
   * the API's token responses (hero card, creator rewards). Contrast with
   * `organicUsdcRaised` which is a net counter floored at 0 used for the
   * graduation-progress split.
   */
  volumeUsd: t.bigint().notNull().default(0n),
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

/** USDC-denominated trades from LaunchpadRouter (covers both curve and post-graduation). */
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

export const feeClaim = onchainTable("fee_claim", (t) => ({
  id: t.text().primaryKey(),
  claimer: t.hex().notNull(),
  ltAddress: t.hex().notNull(),
  amount: t.bigint().notNull(),
  isCreator: t.boolean().notNull(),
  blockNumber: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}), (table) => ({
  claimerIdx: index().on(table.claimer),
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


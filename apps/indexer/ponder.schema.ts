import { onchainTable, index } from "@ponder/core";

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
  pairAddress: t.hex(),
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

/** USDC-denominated trades from RedemptionRouter (covers both curve and post-graduation). */
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

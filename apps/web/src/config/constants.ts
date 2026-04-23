export const FEES = {
  /** 0.5% on buy — split 0.4% protocol / 0.1% creator */
  curveBuy: 0.005,
  /** 0.5% on sell — split 0.4% protocol / 0.1% creator */
  curveSell: 0.005,
  /** 0.3% on notional (USD × leverage) — sells only, 100% protocol */
  ltRedemption: 0.003,
  protocolSplit: 0.004,
  creatorSplit: 0.001,
} as const;

/**
 * Default referral code for the Referral Module.
 * Set to bytes32(0) for no referral — replace with partner codes in production.
 */
export const DEFAULT_REFERRAL_CODE =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

export const TOKEN_SUPPLY = 1_000_000_000;

export const SLIPPAGE_OPTIONS = [0.005, 0.01, 0.02] as const;

export const QUICK_AMOUNTS = [50, 100, 500, 1000] as const;

export const SELL_PERCENT_OPTIONS = [10, 25, 50, 75, 100] as const;

export const SEED_PCT_OPTIONS = [0.5, 1, 2, 3, 5] as const;

export const UNDERLYING_ASSETS = [
  "HYPE",
  "ETH",
  "BTC",
  "SOL",
  "ARB",
  "OP",
] as const;
export type UnderlyingAsset = (typeof UNDERLYING_ASSETS)[number];

export const LEVERAGE_OPTIONS = [2, 3, 5] as const;
export type Leverage = (typeof LEVERAGE_OPTIONS)[number];

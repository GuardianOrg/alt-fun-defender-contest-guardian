export const FEES = {
  /**
   * 0.5% on every buy — split 0.4% protocol / 0.1% creator. Charged at the
   * `Zap` layer in USDC, accrued into `FeeVault`. Applies on
   * both the bonding curve and post-graduation HyperSwap paths. See also
   * `apps/web/src/services/tradeRouter.ts`.
   */
  curveBuy: 0.005,
  /**
   * 0.5% on every sell — split 0.4% protocol / 0.1% creator. Same router
   * layer, same USDC vault as `curveBuy` — the "curve" prefix is retained
   * for UI continuity but the fee now covers post-grad trades too.
   */
  curveSell: 0.005,
  /**
   * 0.3% on notional (USD × leverage) — BounceTech LT redemption fee
   * applied on sells only, 100% to BounceTech protocol (not ours).
   * Independent of our router-level fee.
   */
  ltRedemption: 0.003,
  /** Protocol share of the 0.5% fee (0.4% of trade notional). */
  protocolSplit: 0.004,
  /** Creator share of the 0.5% fee (0.1% of trade notional). */
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

export const QUICK_AMOUNTS = [25, 50, 100, 250] as const;

export const SELL_PERCENT_OPTIONS = [10, 25, 50, 75, 100] as const;

export const SEED_PCT_OPTIONS = [0.5, 1, 2, 3, 5] as const;

export const UNDERLYING_ASSETS = ["HYPE", "ETH", "BTC", "SOL"] as const;
export type UnderlyingAsset = (typeof UNDERLYING_ASSETS)[number];

export const LEVERAGE_OPTIONS = [2, 3, 5] as const;
export type Leverage = (typeof LEVERAGE_OPTIONS)[number];

export const FEES = {
  /** 0.75% on every buy, split protocol/creator and charged by `Zap`. */
  curveBuy: 0.0075,
  /** 0.75% on every sell; the legacy "curve" prefix also covers post-grad. */
  curveSell: 0.0075,
  /** BounceTech LT redemption fee on sells, independent of our router fee. */
  ltRedemption: 0.003,
  /** Protocol share of the 0.75% fee (0.5% of trade notional). */
  protocolSplit: 0.005,
  /** Creator share of the 0.75% fee (0.25% of trade notional). */
  creatorSplit: 0.0025,
} as const;

// Derived for creator-fee copy so it stays in sync with `FEES`.
const TOTAL_FEE_SPLIT = FEES.creatorSplit + FEES.protocolSplit;
export const CREATOR_FEE_SHARE_PCT =
  TOTAL_FEE_SPLIT > 0
    ? Math.round((FEES.creatorSplit / TOTAL_FEE_SPLIT) * 100)
    : 0;

/** bytes32(0) means no default referral. */
export const DEFAULT_REFERRAL_CODE =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

export const TOKEN_SUPPLY = 1_000_000_000;

// Service-layer fallback when the on-chain image field is empty.
export const DEFAULT_TOKEN_IMAGE = "/default-token-image.png";

// Fractional values match router/quote slippage args; default must be included.
export const SLIPPAGE_OPTIONS = [0.02, 0.05, 0.1, 0.15] as const;

// Default high enough for volatile LT-backed trades; users can tighten it.
export const DEFAULT_SLIPPAGE = 0.1;

export const QUICK_AMOUNTS = [25, 50, 100, 250] as const;

export const SELL_PERCENT_OPTIONS = [10, 25, 50, 75, 100] as const;

export const SEED_PCT_OPTIONS = [1, 2, 3, 5] as const;

// Canonical allowlists; visible markets are narrowed by the live LT directory.
export {
  SUPPORTED_UNDERLYING_ASSETS as UNDERLYING_ASSETS,
  SUPPORTED_LEVERAGES as LEVERAGE_OPTIONS,
} from "@launchpad/shared";
export type {
  SupportedAsset as UnderlyingAsset,
  SupportedLeverage as Leverage,
} from "@launchpad/shared";

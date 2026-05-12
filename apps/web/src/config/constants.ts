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
 * Creator's share of the total Alt Fun trading fee (currently 20% — i.e.
 * 0.1% creator out of the 0.5% total). Used in user-facing copy that frames
 * the creator cut as a percentage of fees rather than of trade notional.
 *
 * Derived so the displayed % stays in lock-step with `FEES` if the split
 * is ever rebalanced. Guarded against a zero-total split (would otherwise
 * render `Infinity%` in copy if a future config sets both shares to 0)
 * and rounded to 2dp so non-clean ratios stay display-friendly.
 */
const TOTAL_FEE_SPLIT = FEES.creatorSplit + FEES.protocolSplit;
export const CREATOR_FEE_SHARE_PCT =
  TOTAL_FEE_SPLIT > 0
    ? Number(((FEES.creatorSplit / TOTAL_FEE_SPLIT) * 100).toFixed(2))
    : 0;

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

// Re-export the canonical asset / leverage sets from `@launchpad/shared` so
// the create flow and the API stay in lock-step. Adding a new BounceTech LT
// asset is a one-line change in `packages/shared/src/constants/bouncetech.ts`.
export {
  SUPPORTED_UNDERLYING_ASSETS as UNDERLYING_ASSETS,
  SUPPORTED_LEVERAGES as LEVERAGE_OPTIONS,
} from "@launchpad/shared";
export type { SupportedAsset as UnderlyingAsset, SupportedLeverage as Leverage } from "@launchpad/shared";
